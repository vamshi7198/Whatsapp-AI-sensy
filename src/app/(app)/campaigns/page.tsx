import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth/guards";
import { listCampaigns } from "@/lib/campaigns/service";
import { can } from "@/lib/rbac";
import { isMetaConnected } from "@/lib/settings";
import { formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Campaigns" };

const STATUS: Record<
  string,
  { label: string; tone: "green" | "amber" | "red" | "blue" | "neutral" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "blue" },
  QUEUED: { label: "Queued", tone: "blue" },
  RUNNING: { label: "Sending…", tone: "amber" },
  COMPLETED: { label: "✓ Completed", tone: "green" },
  PARTIALLY_FAILED: { label: "Partly failed", tone: "amber" },
  FAILED: { label: "✕ Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function CampaignsPage() {
  const user = await requireAuth("campaign:view");

  const [campaigns, connected] = await Promise.all([
    listCampaigns(),
    isMetaConnected(),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Send an approved template to a group of contacts.
          </p>
        </div>

        {can(user, "campaign:create") && (
          <Link
            href="/campaigns/new"
            className={buttonVariants({
              variant: connected ? "primary" : "secondary",
            })}
          >
            New campaign
          </Link>
        )}
      </div>

      {!connected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected yet
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            You can plan a campaign, but nothing can be sent until an
            administrator connects your WhatsApp Business account in Settings.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            description="A campaign sends one approved WhatsApp template to a group of your contacts, and shows you exactly who received, read and replied to it."
            action={
              can(user, "campaign:create") ? (
                <Link href="/campaigns/new">
                  <Button>Create your first campaign</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
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
                {campaigns.map((c) => {
                  const status = STATUS[c.status] ?? {
                    label: c.status,
                    tone: "neutral" as const,
                  };

                  return (
                    <tr
                      key={c.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-medium text-slate-900 hover:text-emerald-700 dark:text-slate-100 dark:hover:text-emerald-400"
                        >
                          {c.name}
                        </Link>
                        <p className="text-xs text-slate-400">
                          {c.templateName} ·{" "}
                          {c.templateCategory.toLowerCase()} ·{" "}
                          {formatDate(c.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {formatNumber(c.sentCount)}
                        <span className="block text-xs text-slate-400">
                          of {formatNumber(c.totalRecipients)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                        {formatNumber(c.deliveredCount)}
                        <span className="block text-xs text-slate-400">
                          {formatPercent(c.deliveredCount, c.sentCount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                        {formatNumber(c.readCount)}
                        <span className="block text-xs text-slate-400">
                          {formatPercent(c.readCount, c.sentCount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                        {c.failedCount > 0 ? (
                          <span className="text-red-600 dark:text-red-400">
                            {formatNumber(c.failedCount)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                        {formatNumber(c.repliedCount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
