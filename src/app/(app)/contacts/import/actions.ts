"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import {
  IMPORT_LIMITS,
  parseContactCsv,
  suggestMapping,
  type ColumnMapping,
} from "@/lib/contacts/csv";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/contacts/schema";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("import");

export interface PreviewState {
  error?: string;
  headers?: string[];
  suggested?: Partial<ColumnMapping>;
  sampleRows?: Record<string, string>[];
  csvText?: string;
  totalRows?: number;
}

/** Step 1→2: read the file, return headers and a suggested column mapping. */
export async function previewCsv(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  await requireApiAuth("contact:import");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload." };
  }

  if (file.size > IMPORT_LIMITS.MAX_FILE_BYTES) {
    return {
      error: `That file is larger than ${IMPORT_LIMITS.MAX_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files and import them one at a time.`,
    };
  }

  const text = await file.text();
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.trim()) {
    return { error: "That file appears to be empty." };
  }

  const headers = firstLine
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  if (headers.length === 0) {
    return { error: "Could not read column headings from that file." };
  }

  // Parse a few rows purely to show a preview; full validation happens after
  // the user confirms the mapping.
  const sampleLines = text.split(/\r?\n/).slice(0, 6);
  const sampleRows = sampleLines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });

  return {
    headers,
    suggested: suggestMapping(headers),
    sampleRows,
    csvText: text,
    totalRows: text.split(/\r?\n/).filter((l) => l.trim()).length - 1,
  };
}

export interface ImportState {
  error?: string;
  done?: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  /** Rows matching a deleted contact, which an import must not revive. */
  skippedDeleted?: number;
  errorCount?: number;
  errors?: { line: number; reason: string; rawPhone?: string }[];
}

/** Step 3→4: validate every row and write the contacts. */
export async function runImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    const user = await requireApiAuth("contact:import");

    const csvText = String(formData.get("csvText") ?? "");
    const phoneColumn = String(formData.get("col_phone") ?? "");

    if (!csvText) return { error: "The uploaded file was lost. Please upload it again." };
    if (!phoneColumn) return { error: "Choose which column holds the phone number." };

    const mapping: ColumnMapping = {
      phone: phoneColumn,
      name: String(formData.get("col_name") ?? "") || undefined,
      email: String(formData.get("col_email") ?? "") || undefined,
      tags: String(formData.get("col_tags") ?? "") || undefined,
    };

    const markOptedIn = formData.get("optedIn") === "on";
    const parsed = parseContactCsv(csvText, mapping);

    if (parsed.rows.length === 0) {
      return {
        error: "No valid contacts were found in that file.",
        errors: parsed.errors.slice(0, 50),
        errorCount: parsed.errors.length,
      };
    }

    const job = await prisma.importJob.create({
      data: {
        filename: String(formData.get("filename") ?? "import.csv"),
        status: "RUNNING",
        totalRows: parsed.totalRows,
        createdById: user.id,
      },
    });

    // Resolve every tag name in the file up front, so N rows do not cause N
    // tag lookups.
    const tagNames = [...new Set(parsed.rows.flatMap((r) => r.tags))];
    const tagIdByName = new Map<string, string>();

    for (const name of tagNames) {
      const tag = await prisma.tag.upsert({
        where: { name },
        update: {},
        create: { name, slug: slugify(name) },
      });
      tagIdByName.set(name, tag.id);
    }

    let created = 0;
    let updated = 0;
    /** Rows matching a contact that was deleted, which import must not revive. */
    let skippedDeleted = 0;

    // Chunked so a large file does not build one enormous transaction.
    const CHUNK = 200;
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      const chunk = parsed.rows.slice(i, i + CHUNK);

      await Promise.all(
        chunk.map(async (row) => {
          const existing = await prisma.contact.findUnique({
            where: { phoneE164: row.phoneE164 },
            select: { id: true, deletedAt: true },
          });

          // Someone who asked to be erased is left alone entirely — not even
          // their name is refreshed from the file. Counted and reported, so
          // the numbers add up and nobody wonders where the row went.
          if (existing?.deletedAt) {
            skippedDeleted += 1;
            return;
          }

          const contact = await prisma.contact.upsert({
            where: { phoneE164: row.phoneE164 },
            update: {
              // Only fill blanks on re-import; never overwrite a curated name
              // with an empty cell from a newer file.
              ...(row.name ? { name: row.name } : {}),
              ...(row.email ? { email: row.email } : {}),
              ...(Object.keys(row.attributes).length
                ? { attributes: row.attributes }
                : {}),
              // deletedAt is deliberately NOT cleared here.
              //
              // It used to be, so re-importing a list that still contained
              // someone who had asked to be erased brought them back and made
              // them marketable again — counted under "updated" in the summary
              // with nothing said. Under India's DPDP that is an erasure
              // request quietly reversing itself, and old CSVs get re-imported
              // all the time.
              //
              // A deleted contact stays deleted. Restoring one is a decision
              // somebody makes on purpose, not a side effect of a file.
            },
            create: {
              name: row.name,
              phoneE164: row.phoneE164,
              phoneCountry: row.phoneCountry,
              email: row.email,
              source: "csv_import",
              attributes: Object.keys(row.attributes).length
                ? row.attributes
                : undefined,
              optInStatus: markOptedIn ? "OPTED_IN" : "UNKNOWN",
              optInAt: markOptedIn ? new Date() : null,
              optInSource: markOptedIn ? "csv_import" : null,
            },
          });

          if (existing) updated += 1;
          else created += 1;

          if (row.tags.length) {
            await prisma.contactTag.createMany({
              data: row.tags
                .map((t) => tagIdByName.get(t))
                .filter((id): id is string => Boolean(id))
                .map((tagId) => ({
                  contactId: contact.id,
                  tagId,
                  addedById: user.id,
                })),
              skipDuplicates: true,
            });
          }
        }),
      );
    }

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        createdCount: created,
        updatedCount: updated,
        skippedCount: parsed.duplicatesInFile + skippedDeleted,
        errorCount: parsed.errors.length,
        errorReport: parsed.errors.slice(0, 500) as never,
        completedAt: new Date(),
      },
    });

    await audit(user, "contact.import", {
      entityType: "ImportJob",
      entityId: job.id,
      metadata: {
        created,
        updated,
        skippedDeleted,
        errors: parsed.errors.length,
        markedOptedIn: markOptedIn,
      },
    });

    revalidatePath("/contacts");

    return {
      done: true,
      created,
      updated,
      skipped: parsed.duplicatesInFile,
      skippedDeleted,
      errorCount: parsed.errors.length,
      errors: parsed.errors.slice(0, 100),
    };
  } catch (error) {
    log.error(
      { err: error instanceof Error ? error.message : error },
      "Import failed",
    );
    return { error: "The import could not be completed. Please try again." };
  }
}
