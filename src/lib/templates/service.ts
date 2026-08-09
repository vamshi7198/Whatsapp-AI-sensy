import { prisma } from "../db";
import { moduleLogger } from "../logger";
import { getProvider } from "../whatsapp";
import { countTemplateVariables } from "../whatsapp/providers/meta/mappers";
import type { TemplateComponent } from "../whatsapp/types";

const log = moduleLogger("templates");

export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  disabled: number;
  total: number;
  error?: string;
}

/**
 * Pulls templates from Meta into the local cache.
 *
 * Templates are never authored here — they are Meta's records, mirrored so the
 * campaign wizard can list them without an API call per page load, and so a
 * campaign keeps a resolvable reference to a template that later disappears.
 */
export async function syncTemplates(): Promise<SyncResult> {
  const provider = await getProvider();

  if (!provider) {
    return {
      ok: false,
      created: 0,
      updated: 0,
      disabled: 0,
      total: 0,
      error:
        "WhatsApp is not connected. Add your WhatsApp Business details in Settings first.",
    };
  }

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();

  try {
    let cursor: string | undefined;

    // Meta paginates; without following the cursor a business with more than
    // 100 templates would silently see only the first page.
    do {
      const page = await provider.getTemplates(cursor);

      for (const template of page.items) {
        const key = `${template.name}::${template.language}`;
        seen.add(key);

        const existing = await prisma.template.findUnique({
          where: {
            name_language: {
              name: template.name,
              language: template.language,
            },
          },
          select: { id: true },
        });

        const data = {
          metaTemplateId: template.id,
          category: template.category,
          status: template.status,
          components: template.components as never,
          variableCount: countTemplateVariables(
            template.components as TemplateComponent[],
          ),
          qualityScore: template.qualityScore,
          rejectedReason: template.rejectedReason,
          lastSyncedAt: new Date(),
        };

        await prisma.template.upsert({
          where: {
            name_language: {
              name: template.name,
              language: template.language,
            },
          },
          update: data,
          create: {
            name: template.name,
            language: template.language,
            ...data,
          },
        });

        if (existing) updated += 1;
        else created += 1;
      }

      cursor = page.nextCursor;
    } while (cursor);

    // Templates deleted at Meta are marked DISABLED rather than removed, so
    // past campaigns keep a resolvable reference.
    const stale = await prisma.template.findMany({
      where: { status: { not: "DISABLED" }, metaTemplateId: { not: null } },
      select: { id: true, name: true, language: true },
    });

    const disabledIds = stale
      .filter((t) => !seen.has(`${t.name}::${t.language}`))
      .map((t) => t.id);

    if (disabledIds.length) {
      await prisma.template.updateMany({
        where: { id: { in: disabledIds } },
        data: { status: "DISABLED", lastSyncedAt: new Date() },
      });
    }

    log.info(
      { created, updated, disabled: disabledIds.length },
      "Template sync complete",
    );

    return {
      ok: true,
      created,
      updated,
      disabled: disabledIds.length,
      total: seen.size,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not reach WhatsApp";
    log.error({ err: message }, "Template sync failed");

    return {
      ok: false,
      created,
      updated,
      disabled: 0,
      total: seen.size,
      error: message,
    };
  }
}

export async function listTemplates() {
  return prisma.template.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      status: true,
      components: true,
      variableCount: true,
      qualityScore: true,
      rejectedReason: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Templates a campaign may actually use.
 *
 * Approval is checked here, again when the campaign is created, and once more
 * in the worker immediately before the API call — Meta can pause a template
 * mid-campaign, and the last check is the one that matters.
 */
export async function listSendableTemplates() {
  return prisma.template.findMany({
    where: { status: "APPROVED" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      components: true,
      variableCount: true,
    },
  });
}

export async function getTemplate(id: string) {
  return prisma.template.findUnique({ where: { id } });
}

/** Extracts the body text of a template, for previews. */
export function getTemplateBody(components: unknown): string {
  const list = (components as TemplateComponent[]) ?? [];
  return list.find((c) => c.type === "BODY")?.text ?? "";
}

export function getTemplateHeader(components: unknown): TemplateComponent | null {
  const list = (components as TemplateComponent[]) ?? [];
  return list.find((c) => c.type === "HEADER") ?? null;
}

export function getTemplateFooter(components: unknown): string {
  const list = (components as TemplateComponent[]) ?? [];
  return list.find((c) => c.type === "FOOTER")?.text ?? "";
}

export function getTemplateButtons(components: unknown) {
  const list = (components as TemplateComponent[]) ?? [];
  return list.find((c) => c.type === "BUTTONS")?.buttons ?? [];
}

/**
 * Substitutes {{n}} placeholders for preview.
 *
 * Unfilled placeholders are left visible rather than blanked, so an operator
 * previewing a campaign can see at a glance that a value is missing.
 */
export function renderTemplateBody(
  body: string,
  variables: Record<string, string>,
): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index: string) => {
    const value = variables[index];
    return value !== undefined && value !== "" ? value : match;
  });
}
