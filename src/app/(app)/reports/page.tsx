import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth/guards";
import { can } from "@/lib/rbac";
import {
  getCampaignReport,
  getContactGrowth,
  getFailureBreakdown,
  getInboxStats,
  getSkipBreakdown,
  rangeFromPreset,
} from "@/lib/reports/service";
import { formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Reports" };

const PRESETS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "red" | "green";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "red"
            ? "text-red-600 dark:text-red-400"
            : tone === "green"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-900 dark:text-slate-50"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ reason: string; count: number }>;
  empty: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h2>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.reason} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {r.reason}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-slate-900 dark:text-slate-100">
                  {formatNumber(r.count)}
                  <span className="ml-1 text-xs text-slate-400">
                    {formatPercent(r.count, total)}
                  </span>
                </span>
              </div>
              {/* A bar makes the dominant reason obvious at a glance, which
                  is the only question this table is really answering. */}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-slate-400 dark:bg-slate-600"
                  style={{ width: `${total ? (r.count / total) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth("report:view");
  const params = await searchParams;

  const preset = typeof params.range === "string" ? params.range : "30d";
  const range = rangeFromPreset(preset);

  const [report, failures, skips, inbox, contacts] = await Promise.all([
    getCampaignReport(range),
    getFailureBreakdown(range),
    getSkipBreakdown(range),
    getInboxStats(range),
    getContactGrowth(range),
  ]);

  const { totals } = report;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Reports
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {formatDate(range.from)} — {formatDate(range.to)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <Link
                key={p.value}
                href={`/reports?range=${p.value}`}
                className={`rounded-md px-2.5 py-1.5 text-xs transition ${
                  preset === p.value
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>

          <Link
            href="/reports/spend"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Money spent
          </Link>

          {can(user, "report:export") && (
            <a
              href={`/api/reports/export?range=${preset}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Export CSV
            </a>
          )}
        </div>
      </div>

      {/* Rates are shares of what was actually sent, not of the audience
          considered — dividing by the audience would flatter every number. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Campaigns" value={formatNumber(totals.campaigns)} />
        <Stat label="Messages sent" value={formatNumber(totals.sent)} />
        <Stat
          label="Delivered"
          value={formatNumber(totals.delivered)}
          sub={`${formatPercent(totals.delivered, totals.sent)} of sent`}
        />
        <Stat
          label="Read"
          value={formatNumber(totals.read)}
          sub={`${formatPercent(totals.read, totals.sent)} of sent`}
        />
        <Stat
          label="Failed"
          value={formatNumber(totals.failed)}
          sub={`${formatPercent(totals.failed, totals.sent)} of sent`}
          tone={totals.failed > 0 ? "red" : undefined}
        />
        <Stat
          label="Replied"
          value={formatNumber(totals.replied)}
          sub={`${formatPercent(totals.replied, totals.sent)} of sent`}
          tone={totals.replied > 0 ? "green" : undefined}
        />
      </section>

      {totals.campaigns === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title="No campaigns in this period"
            description="Send a campaign and its results will appear here — delivery, read and reply rates, and why anything failed or was skipped."
            action={
              can(user, "campaign:create") ? (
                <Link href="/campaigns/new">
                  <span className={buttonVariants({ variant: "primary" })}>
                    Create a campaign
                  </span>
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown
          title="Why messages failed"
          rows={failures}
          empty="No failures in this period."
        />
        <Breakdown
          title="Why contacts were skipped"
          rows={skips}
          empty="Nobody was skipped in this period."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
            Conversations
          </h2>
          <dl className="space-y-2 text-sm">
            {[
              ["Active conversations", formatNumber(inbox.conversations)],
              ["Messages received", formatNumber(inbox.inbound)],
              ["Messages sent", formatNumber(inbox.outbound)],
              ["Open now", formatNumber(inbox.openConversations)],
              ["Unread", formatNumber(inbox.unread)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
            Contacts
          </h2>
          <dl className="space-y-2 text-sm">
            {[
              ["Total contacts", formatNumber(contacts.total)],
              ["Added in this period", formatNumber(contacts.addedInRange)],
              ["Can receive marketing", formatNumber(contacts.optedIn)],
              ["Opted out", formatNumber(contacts.optedOut)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {contacts.bySource.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
                Where they came from
              </p>
              <div className="flex flex-wrap gap-1.5">
                {contacts.bySource.map((s) => (
                  <Badge key={s.source} tone="neutral">
                    {s.source.replace(/_/g, " ")}: {s.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {report.campaigns.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Campaign by campaign
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Delivered
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">Read</th>
                  <th className="px-4 py-2.5 text-right font-medium">Failed</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Replied
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-slate-900 hover:text-emerald-700 dark:text-slate-100"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {c.templateName} · {c.category.toLowerCase()} ·{" "}
                        {formatDate(c.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {formatNumber(c.sentCount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatPercent(c.deliveredCount, c.sentCount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatPercent(c.readCount, c.sentCount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {c.failedCount > 0 ? (
                        <span className="text-red-600 dark:text-red-400">
                          {formatPercent(c.failedCount, c.sentCount)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatPercent(c.repliedCount, c.sentCount)}
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
