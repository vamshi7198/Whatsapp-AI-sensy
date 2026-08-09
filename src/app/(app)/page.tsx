import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getSetting, isMetaConnected, SETTING_KEYS } from "@/lib/settings";
import { formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Dashboard · Uncanned WhatsApp" };

/** Six cards, as specified. Deliberately not overloaded. */
function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          {sub}
        </p>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireAuth("dashboard:view");

  // Counters are read from denormalised columns and simple counts, so the
  // dashboard never aggregates over the full message table on page load.
  const [
    contacts,
    sent,
    delivered,
    read,
    failed,
    replies,
    campaigns,
    connected,
    quality,
  ] = await Promise.all([
      prisma.contact.count({ where: { deletedAt: null } }),
      prisma.message.count({ where: { direction: "OUTBOUND" } }),
      prisma.message.count({
        where: { direction: "OUTBOUND", deliveredAt: { not: null } },
      }),
      prisma.message.count({
        where: { direction: "OUTBOUND", readAt: { not: null } },
      }),
      prisma.message.count({
        where: { direction: "OUTBOUND", status: "FAILED" },
      }),
      prisma.message.count({ where: { direction: "INBOUND" } }),
      prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          status: true,
          sentCount: true,
          deliveredCount: true,
          readCount: true,
          failedCount: true,
        },
      }),
      isMetaConnected(),
      getSetting(SETTING_KEYS.QUALITY_RATING),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Welcome back, {user.name.split(" ")[0]}.
        </p>
      </div>

      {/* Shown only when it is actually true. Until now this was hardcoded,
          so it claimed WhatsApp was disconnected even after it was set up. */}
      {!connected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected yet
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Add your WhatsApp Business details in Settings to load templates and
            start sending campaigns.
          </p>
        </div>
      )}

      {/* A falling quality rating is the earliest warning that sending
          behaviour needs to change, so it belongs on the first screen. */}
      {connected && quality && quality.toUpperCase() !== "GREEN" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {quality.toUpperCase() === "RED"
              ? "WhatsApp has flagged your number"
              : "Your WhatsApp quality rating has dropped"}
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            This happens when people block or report your messages. Send fewer
            marketing messages, only to contacts who expect them, and it
            usually recovers within a few days. If it stays low, WhatsApp can
            reduce how many people you may message each day.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Contacts" value={formatNumber(contacts)} />
        <StatCard label="Messages sent" value={formatNumber(sent)} />
        <StatCard
          label="Delivered"
          value={formatNumber(delivered)}
          sub={formatPercent(delivered, sent)}
        />
        <StatCard
          label="Read"
          value={formatNumber(read)}
          sub={formatPercent(read, sent)}
        />
        <StatCard
          label="Failed"
          value={formatNumber(failed)}
          sub={formatPercent(failed, sent)}
        />
        <StatCard label="Replies" value={formatNumber(replies)} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Recent campaigns
          </h2>
        </div>

        {campaigns.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No campaigns yet.
            </p>
            <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
              Once WhatsApp is connected, your campaigns will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Campaign</th>
                  <th className="px-5 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    Delivered
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium">Read</th>
                  <th className="px-5 py-2.5 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-5 py-3 text-slate-900 dark:text-slate-100">
                      {c.name}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatNumber(c.sentCount)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatNumber(c.deliveredCount)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatNumber(c.readCount)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatNumber(c.failedCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
