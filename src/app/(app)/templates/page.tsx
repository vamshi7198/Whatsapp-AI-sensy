import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { isMetaConnected } from "@/lib/settings";
import {
  getTemplateBody,
  getTemplateFooter,
  getTemplateHeader,
  listTemplates,
} from "@/lib/templates/service";
import type { TemplateComponent } from "@/lib/whatsapp/types";

import { AutoRefreshWhilePending } from "./_auto-refresh";
import {
  TemplatePreviewWithContact,
  type SampleContact,
} from "./_preview-with-contact";
import { SyncButton } from "./_sync-button";

export const metadata = { title: "Templates" };

type TemplateRow = Awaited<ReturnType<typeof listTemplates>>[number];

const CATEGORY_TONE = {
  MARKETING: "purple",
  UTILITY: "blue",
  AUTHENTICATION: "neutral",
} as const;

function formatDate(value: Date | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

/** Example values supplied to Meta at creation, used as preview fallbacks. */
function metaExamplesFor(components: unknown): string[] {
  const list = (components as TemplateComponent[]) ?? [];
  const body = list.find((c) => c.type === "BODY");
  const example = body?.example as
    | { body_text?: string[][] }
    | undefined;
  return example?.body_text?.[0] ?? [];
}

function TemplateCard({
  template,
  contacts,
}: {
  template: TemplateRow;
  contacts: SampleContact[];
}) {
  const header = getTemplateHeader(template.components);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <h3 className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
          {template.name}
        </h3>
        <Badge tone={CATEGORY_TONE[template.category]}>
          {template.category.toLowerCase()}
        </Badge>
        <Badge tone="neutral">{template.language}</Badge>
        {template.variableCount > 0 && (
          <Badge tone="neutral">
            {template.variableCount} blank
            {template.variableCount === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <TemplatePreviewWithContact
        body={getTemplateBody(template.components)}
        header={header?.format === "TEXT" ? header.text : undefined}
        footer={getTemplateFooter(template.components) || undefined}
        variableCount={template.variableCount}
        metaExamples={metaExamplesFor(template.components)}
        contacts={contacts}
      />
    </article>
  );
}

export default async function TemplatesPage() {
  const user = await requireAuth("template:view");

  const [templates, connected, sampleContacts] = await Promise.all([
    listTemplates(),
    isMetaConnected(),
    prisma.contact.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        attributes: true,
      },
    }),
  ]);

  const contacts: SampleContact[] = sampleContacts.map((c) => ({
    id: c.id,
    name: c.name,
    phoneE164: c.phoneE164,
    email: c.email,
    attributes: (c.attributes as Record<string, string>) ?? {},
  }));

  const approved = templates.filter((t) => t.status === "APPROVED");
  const pending = templates.filter((t) => t.status === "PENDING");
  const rejected = templates.filter((t) => t.status === "REJECTED");
  const paused = templates.filter((t) => t.status === "PAUSED");
  const unavailable = templates.filter(
    (t) => t.status === "DISABLED" || t.status === "DRAFT",
  );

  const lastSync = templates.reduce<Date | null>(
    (latest, t) =>
      t.lastSyncedAt && (!latest || t.lastSyncedAt > latest)
        ? t.lastSyncedAt
        : latest,
    null,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Templates
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Last checked {formatDate(lastSync)}.
          </p>
          <AutoRefreshWhilePending pendingCount={pending.length} />
        </div>

        <div className="flex items-center gap-2">
          {can(user, "template:create") && (
            <Link
              href="/templates/new"
              className={buttonVariants({ variant: "primary" })}
            >
              New template
            </Link>
          )}
          {can(user, "template:sync") && <SyncButton disabled={!connected} />}
        </div>
      </div>

      {/* Counts first, so the state of everything is visible without
          scrolling through cards. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Ready to use", count: approved.length, tone: "green" },
          { label: "Waiting for approval", count: pending.length, tone: "amber" },
          { label: "Rejected", count: rejected.length, tone: "red" },
          {
            label: "Paused or unavailable",
            count: paused.length + unavailable.length,
            tone: "neutral",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
              {s.count}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {!connected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected yet
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Connect it in Settings to load your templates and submit new ones.
          </p>
        </div>
      )}

      {templates.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title="No templates yet"
            description="Write one here and send it to WhatsApp for approval, or sync the ones you already have."
          />
        </div>
      )}

      {/* ---- Waiting for approval ---- */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Waiting for approval ({pending.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              WhatsApp usually decides within a few minutes. This page updates
              on its own — you do not need to refresh.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((t) => (
              <TemplateCard key={t.id} template={t} contacts={contacts} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Rejected ---- */}
      {rejected.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Rejected ({rejected.length})
          </h2>

          <div className="space-y-3">
            {rejected.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-slate-900"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <h3 className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                    {t.name}
                  </h3>
                  <Badge tone="red">✕ Rejected</Badge>
                  <Badge tone="neutral">{t.language}</Badge>
                </div>

                {/* Meta's reason verbatim, tidied into readable words. */}
                <p className="text-sm text-red-700 dark:text-red-400">
                  {t.rejectedReason
                    ? `WhatsApp rejected this: ${t.rejectedReason.toLowerCase().replace(/_/g, " ")}`
                    : "WhatsApp rejected this template without giving a reason."}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Names cannot be reused, so create a new template with a
                  different name and adjust the wording.
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Ready to use ---- */}
      {approved.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Ready to use ({approved.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pick a contact to see exactly how each message will reach them.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {approved.map((t) => (
              <TemplateCard key={t.id} template={t} contacts={contacts} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Paused / unavailable ---- */}
      {(paused.length > 0 || unavailable.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Not available for sending ({paused.length + unavailable.length})
          </h2>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <tbody>
                {[...paused, ...unavailable].map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                      {t.name}
                      <span className="ml-1.5 text-xs text-slate-400">
                        {t.language}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={t.status === "PAUSED" ? "amber" : "neutral"}>
                        {t.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                      {t.status === "PAUSED"
                        ? "Paused by WhatsApp after customer feedback. It usually resumes on its own."
                        : t.status === "DISABLED"
                          ? "No longer in your WhatsApp account."
                          : "Not submitted to WhatsApp."}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
