import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TemplatePreview } from "@/components/template-preview";
import { requireAuth } from "@/lib/auth/guards";
import { can } from "@/lib/rbac";
import { isMetaConnected } from "@/lib/settings";
import { listTemplates } from "@/lib/templates/service";

import { SyncButton } from "./_sync-button";

export const metadata = { title: "Templates" };

const STATUS_TONE = {
  APPROVED: "green",
  PENDING: "amber",
  REJECTED: "red",
  PAUSED: "amber",
  DISABLED: "neutral",
  DRAFT: "neutral",
} as const;

const STATUS_LABEL = {
  APPROVED: "✓ Approved",
  PENDING: "⏳ In review",
  REJECTED: "✕ Rejected",
  PAUSED: "⏸ Paused",
  DISABLED: "Not available",
  DRAFT: "Draft",
} as const;

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

export default async function TemplatesPage() {
  const user = await requireAuth("template:view");

  const [templates, connected] = await Promise.all([
    listTemplates(),
    isMetaConnected(),
  ]);

  const approved = templates.filter((t) => t.status === "APPROVED");
  const others = templates.filter((t) => t.status !== "APPROVED");
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
            Message formats approved by WhatsApp. Last synced{" "}
            {formatDate(lastSync)}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {can(user, "template:create") && (
            <Link
              href="/templates/new"
              className={buttonVariants({ variant: "secondary" })}
            >
              New template
            </Link>
          )}
          {can(user, "template:sync") && <SyncButton disabled={!connected} />}
        </div>
      </div>

      {!connected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected yet
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Your templates live in your WhatsApp Business account. Connect it in
            Settings and they will appear here.
          </p>
        </div>
      )}

      {/* Stated plainly, because it is the rule that most often surprises
          people moving from ordinary messaging apps. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Why templates exist
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          WhatsApp requires businesses to get message formats approved before
          sending them to anyone who has not messaged first. Only approved
          templates can be used in a campaign.
        </p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          You can write one here with{" "}
          <strong className="text-slate-700 dark:text-slate-300">
            New template
          </strong>{" "}
          — it goes straight to WhatsApp for approval, which usually takes a few
          minutes. Templates created directly in WhatsApp Manager appear here
          too, after a sync.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title="No templates yet"
            description={
              connected
                ? "Click Sync to load the templates from your WhatsApp Business account."
                : "Connect your WhatsApp Business account in Settings, then sync."
            }
          />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Ready to use ({approved.length})
            </h2>

            {approved.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                None of your templates are approved yet, so no campaigns can be
                sent.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {approved.map((t) => (
                  <article
                    key={t.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <h3 className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                        {t.name}
                      </h3>
                      <Badge tone={CATEGORY_TONE[t.category]}>
                        {t.category.toLowerCase()}
                      </Badge>
                      <Badge tone="neutral">{t.language}</Badge>
                      {t.variableCount > 0 && (
                        <Badge tone="neutral">
                          {t.variableCount} variable
                          {t.variableCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>

                    <TemplatePreview components={t.components} />
                  </article>
                ))}
              </div>
            )}
          </section>

          {others.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Not available for sending ({others.length})
              </h2>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Category</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                          {t.name}
                          <span className="ml-1.5 text-xs text-slate-400">
                            {t.language}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={CATEGORY_TONE[t.category]}>
                            {t.category.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[t.status]}>
                            {STATUS_LABEL[t.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                          {t.status === "PENDING" &&
                            "WhatsApp is reviewing this. It usually takes under 24 hours."}
                          {t.status === "REJECTED" &&
                            (t.rejectedReason
                              ? `WhatsApp rejected it: ${t.rejectedReason.toLowerCase().replace(/_/g, " ")}`
                              : "WhatsApp rejected this template.")}
                          {t.status === "PAUSED" &&
                            "Paused by WhatsApp because of customer feedback. It usually resumes on its own."}
                          {t.status === "DISABLED" &&
                            "No longer in your WhatsApp account."}
                          {t.status === "DRAFT" && "Not submitted to WhatsApp."}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
