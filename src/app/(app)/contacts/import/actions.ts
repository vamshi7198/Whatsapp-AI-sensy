"use server";

import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import Papa from "papaparse";
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

/**
 * Finds or creates a tag, tolerating two names that slugify the same.
 *
 * Tag.slug is unique and slugify is lossy: "VIP List" and "vip-list" both
 * become "vip-list", and any two names made only of emoji or non-Latin script
 * both become "". A plain upsert on the NAME therefore succeeded for the first
 * and threw P2002 on the SLUG for the second — which unwound to the outer
 * catch, imported nothing at all, left the ImportJob RUNNING forever, and
 * reproduced exactly on every retry.
 *
 * Returns null if it truly cannot, so one awkward tag costs its own label
 * rather than the entire file.
 */
async function ensureTag(name: string): Promise<string | null> {
  const existing = await prisma.tag.findUnique({
    where: { name },
    select: { id: true },
  });

  if (existing) return existing.id;

  // An empty slug is not a usable fallback — every emoji-only name would
  // collide with every other. Derived from the name so it is stable across
  // imports of the same file.
  const base =
    slugify(name) ||
    `tag-${createHash("sha1").update(name).digest("hex").slice(0, 8)}`;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;

    try {
      const tag = await prisma.tag.create({
        data: { name, slug },
        select: { id: true },
      });
      return tag.id;
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }

      // Either another import just created this exact name, or the slug is
      // taken by a different name. The first is a win; the second needs the
      // next suffix.
      const now = await prisma.tag.findUnique({
        where: { name },
        select: { id: true },
      });

      if (now) return now.id;
    }
  }

  return null;
}

export interface PreviewState {
  error?: string;
  headers?: string[];
  suggested?: Partial<ColumnMapping>;
  sampleRows?: Record<string, string>[];
  /** Set when the file's own structure is wrong, e.g. an unquoted comma. */
  structureWarning?: string;
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

  if (!text.trim()) {
    return { error: "That file appears to be empty." };
  }

  /*
    The same parser the import uses, not a split on commas.

    This used to do `line.split(",")`, which has no idea what a quoted field
    is — so a cell reading "pilot,influencers,hyderabad" became three columns
    and everything after it appeared shifted by two. That is a fair description
    of a BROKEN file and a completely false one of a correct file, and the
    preview showed it for both.

    Which made the preview worse than useless on the one job it has: somebody
    quoting their file properly saw the identical mess and concluded the fix
    had not worked. The preview must show what the import will actually see.
  */
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter(Boolean);

  if (headers.length === 0) {
    return { error: "Could not read column headings from that file." };
  }

  // A row carrying more values than there are columns. Said here, at the
  // preview, rather than leaving it to be discovered at import — this is the
  // screen where somebody is looking at their data and can still fix it.
  const ragged = parsed.data.findIndex(
    (row) => Array.isArray(row.__parsed_extra) && row.__parsed_extra.length > 0,
  );

  const structureWarning =
    ragged === -1
      ? undefined
      : `Line ${ragged + 2} has more values than the file has columns, so its ` +
        `values have shifted along. A cell containing a comma must be wrapped ` +
        `in quotes — check the tags and address columns. Rows like this will ` +
        `be refused rather than imported with the wrong values.`;

  const sampleRows = parsed.data.slice(0, 5).map((row) =>
    Object.fromEntries(
      headers.map((h) => [h, typeof row[h] === "string" ? (row[h] as string) : ""]),
    ),
  );

  return {
    headers,
    suggested: suggestMapping(headers),
    sampleRows,
    structureWarning,
    csvText: text,
    totalRows: parsed.data.length,
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
  /** Set once the job row exists, so a failure can close it off. */
  let jobId: string | null = null;

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

    // Kept outside the try's scope so the catch can close the job off. A
    // failure used to leave it RUNNING forever, which reads on the imports
    // list as an import still in progress that will never finish.
    jobId = job.id;

    // Resolve every tag name in the file up front, so N rows do not cause N
    // tag lookups.
    const tagNames = [...new Set(parsed.rows.flatMap((r) => r.tags))];
    const tagIdByName = new Map<string, string>();

    for (const name of tagNames) {
      const id = await ensureTag(name);

      // A tag that cannot be created must not take the whole import with it.
      // The contacts still import; they just miss that one label, which is
      // recoverable in a way that "nothing imported" is not.
      if (id) tagIdByName.set(name, id);
      else {
        log.warn({ tag: name }, "Could not create tag during import — skipped");
      }
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

    if (jobId) {
      await prisma.importJob
        .update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date() } })
        .catch(() => undefined);
    }

    return { error: "The import could not be completed. Please try again." };
  }
}
