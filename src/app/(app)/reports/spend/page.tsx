import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { requireAuth } from "@/lib/auth/guards";
import {
  getSpendByCampaign,
  getSpendByCategory,
  getSpendByMonth,
  getSpendTotals,
} from "@/lib/campaigns/spend";
import { can } from "@/lib/rbac";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Money spent" };

const PERIODS = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 3 months", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  marketing: "Marketing",
  utility: "Utility",
  authentication: "Authentication",
  authentication_international: "Authentication (international)",
  service: "Service replies",
};

/** Money, in the currency the rates are set in. */
function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth("report:view");
  const query = await searchParams;

  const periodKey = typeof query.period === "string" ? query.period : "30";
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[0];
  const days = period.days ?? undefined;

  const [totals, byCampaign, byMonth, byCategory] = await Promise.all([
    getSpendTotals(days),
    getSpendByCampaign(50, days),
    getSpendByMonth(12),
    getSpendByCategory(days),
  ]);

  const spentCampaigns = byCampaign.filter((c) => c.cost > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/reports"
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
          >
            ← Back to reports
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Money spent
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What WhatsApp has charged you, worked out from messages it confirmed
            it delivered.
          </p>
        </div>

        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/reports/spend?period=${p.key}`}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                p.key === period.key
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Headline                                                       */}
      {/* ------------------------------------------------------------- */}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Spent · {period.label.toLowerCase()}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {money(totals.total, totals.currency)}
          </p>
          <p className="text-xs text-slate-400">
            {formatNumber(totals.messages)} charged message
            {totals.messages === 1 ? "" : "s"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Free messages
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatNumber(totals.free)}
          </p>
          <p className="text-xs text-slate-400">
            Replies inside the 24-hour window cost nothing
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Average per message
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {totals.messages > 0
              ? money(totals.total / totals.messages, totals.currency)
              : "—"}
          </p>
        </div>
      </div>

      {/*
        A total that silently omits unpriced messages reads as complete when it
        is not, so this says so rather than quietly understating the bill.
      */}
      {totals.unpriced > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <strong>{formatNumber(totals.unpriced)}</strong> delivered message
            {totals.unpriced === 1 ? "" : "s"} could not be priced, so the total
            above is lower than your real bill.
          </p>
          {can(user, "settings:pricing") && (
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              <Link href="/settings/pricing" className="underline">
                Add the missing rate
              </Link>{" "}
              and these will be included from then on.
            </p>
          )}
        </div>
      )}

      {totals.messages === 0 && totals.unpriced === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nothing charged in this period.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* By campaign                                                    */}
      {/* ------------------------------------------------------------- */}

      {spentCampaigns.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              By campaign
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Most expensive first.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Delivered</th>
                  <th className="px-4 py-2.5 font-medium">Cost</th>
                  <th className="px-4 py-2.5 font-medium">Per message</th>
                </tr>
              </thead>
              <tbody>
                {spentCampaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {c.name}
                      </Link>
                      {c.isRetry && (
                        <Badge tone="neutral" className="ml-2">
                          Resend
                        </Badge>
                      )}
                      <p className="text-xs text-slate-400">
                        {formatDate(c.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-400">
                      {formatNumber(c.delivered)}
                    </td>
                    <td className="px-4 py-2.5 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {money(c.cost, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-xs text-slate-500">
                      {c.delivered > 0
                        ? money(c.cost / c.delivered, c.currency)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* By month and by type                                           */}
      {/* ------------------------------------------------------------- */}

      <div className="grid gap-5 lg:grid-cols-2">
        {byMonth.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Month by month
              </h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {byMonth.map((m) => (
                  <tr
                    key={m.month}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                      {m.month}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-400 tabular-nums">
                      {formatNumber(m.messages)} messages
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {money(m.total, totals.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {byCategory.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                By message type
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                As WhatsApp charged them.
              </p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {byCategory.map((c) => (
                  <tr
                    key={c.category}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                      {CATEGORY_LABELS[c.category] ?? c.category}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-400 tabular-nums">
                      {formatNumber(c.messages)} messages
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {money(c.total, totals.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <p className="text-xs text-slate-400">
        WhatsApp reports which messages it charged for, but not the price, so
        these totals use the rates in Settings. Keep those matching your Meta
        invoice and these figures will match your bill.
      </p>
    </div>
  );
}
