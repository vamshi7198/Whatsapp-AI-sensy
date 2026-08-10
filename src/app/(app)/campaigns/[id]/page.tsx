import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import {
  getCampaign,
  getCampaignRecipients,
  getRetryPreview,
} from "@/lib/campaigns/service";
import { SKIP_REASON_LABELS } from "@/lib/campaigns/audience";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import { can } from "@/lib/rbac";
import { formatNumber, formatPercent } from "@/lib/utils";

import { CancelButton } from "./_cancel-button";
import { RetryPanel } from "./_retry-panel";

export const metadata = { title: "Campaign" };

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

const RECIPIENT_STATUS: Record<
  string,
  { label: string; tone: "green" | "amber" | "red" | "blue" | "neutral" }
> = {
  PENDING: { label: "Waiting", tone: "neutral" },
  QUEUED: { label: "Queued", tone: "neutral" },
  SENT: { label: "Sent", tone: "blue" },
  DELIVERED: { label: "Delivered", tone: "blue" },
  READ: { label: "Read", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SKIPPED: { label: "Skipped", tone: "amber" },
};

function formatDateTime(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
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
  tone?: "red";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "red"
            ? "text-red-600 dark:text-red-400"
            : "text-slate-900 dark:text-slate-50"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default async function CampaignReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth("campaign:view");
  const { id } = await params;
  const query = await searchParams;

  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const statusFilter =
    typeof query.status === "string" ? query.status : undefined;
  const page = Number(query.page ?? 1) || 1;

  const recipients = await getCampaignRecipients(id, {
    status: statusFilter,
    page,
  });

  // Only worth loading once something has actually failed.
  const retryPreview =
    campaign.failedCount > 0 ? await getRetryPreview(id) : null;

  const status = STATUS[campaign.status] ?? {
    label: campaign.status,
    tone: "neutral" as const,
  };

  const inFlight = ["QUEUED", "RUNNING"].includes(campaign.status);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/campaigns"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to campaigns
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {campaign.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {campaign.templateName} ·{" "}
              {campaign.templateCategory.toLowerCase()} ·{" "}
              {campaign.templateLanguage} · started by{" "}
              {campaign.createdBy.name} on {formatDateTime(campaign.createdAt)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {can(user, "report:export") && (
              <a
                href={`/api/campaigns/${id}/export`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Export CSV
              </a>
            )}
            {inFlight && can(user, "campaign:cancel") && (
              <CancelButton campaignId={id} />
            )}
          </div>
        </div>
      </div>

      {inFlight && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
          <p className="text-sm text-blue-900 dark:text-blue-200">
            This campaign is still sending. Delivery reports arrive from
            WhatsApp over the following minutes — WhatsApp deliberately paces
            large campaigns, so &ldquo;sent&rdquo; running ahead of
            &ldquo;delivered&rdquo; is normal.
          </p>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
            Refresh the page for the latest numbers.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Recipients"
          value={formatNumber(campaign.totalRecipients)}
        />
        <Stat label="Sent" value={formatNumber(campaign.sentCount)} />
        <Stat
          label="Delivered"
          value={formatNumber(campaign.deliveredCount)}
          sub={formatPercent(campaign.deliveredCount, campaign.sentCount)}
        />
        <Stat
          label="Read"
          value={formatNumber(campaign.readCount)}
          sub={formatPercent(campaign.readCount, campaign.sentCount)}
        />
        <Stat
          label="Failed"
          value={formatNumber(campaign.failedCount)}
          sub={formatPercent(campaign.failedCount, campaign.sentCount)}
          tone={campaign.failedCount > 0 ? "red" : undefined}
        />
        <Stat
          label="Replied"
          value={formatNumber(campaign.repliedCount)}
          sub={formatPercent(campaign.repliedCount, campaign.sentCount)}
        />
      </div>

      {retryPreview && can(user, "campaign:send") && (
        <RetryPanel campaignId={id} preview={retryPreview} />
      )}

      {campaign.retryOfCampaignId && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            This is a resend to the people another campaign could not reach.{" "}
            <Link
              href={`/campaigns/${campaign.retryOfCampaignId}`}
              className="text-emerald-700 underline dark:text-emerald-400"
            >
              See the original
            </Link>
          </p>
        </div>
      )}

      {campaign.skippedCount > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <strong>{formatNumber(campaign.skippedCount)}</strong> contact
            {campaign.skippedCount === 1 ? " was" : "s were"} not messaged.
            {" "}
            <Link
              href={`/campaigns/${id}?status=SKIPPED`}
              className="text-emerald-700 underline dark:text-emerald-400"
            >
              See who and why
            </Link>
          </p>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Recipients
          </h2>

          <div className="ml-auto flex flex-wrap gap-1">
            {[
              ["", "All"],
              ["SENT", "Sent"],
              ["DELIVERED", "Delivered"],
              ["READ", "Read"],
              ["FAILED", "Failed"],
              ["SKIPPED", "Skipped"],
            ].map(([value, label]) => (
              <Link
                key={label}
                href={value ? `/campaigns/${id}?status=${value}` : `/campaigns/${id}`}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  (statusFilter ?? "") === value
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">Recipient</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Sent</th>
                <th className="px-4 py-2.5 font-medium">Delivered</th>
                <th className="px-4 py-2.5 font-medium">Read</th>
                <th className="px-4 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {recipients.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-slate-400"
                  >
                    No recipients match this filter.
                  </td>
                </tr>
              ) : (
                recipients.items.map((r) => {
                  const rs = RECIPIENT_STATUS[r.status] ?? {
                    label: r.status,
                    tone: "neutral" as const,
                  };

                  return (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                    >
                      <td className="px-4 py-2.5">
                        <p className="text-slate-900 dark:text-slate-100">
                          {r.name || "Unnamed"}
                        </p>
                        <p className="text-xs text-slate-400 tabular-nums">
                          {formatPhoneForDisplay(r.phoneE164)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={rs.tone}>{rs.label}</Badge>
                        {r.repliedAt && (
                          <Badge tone="green" className="ml-1">
                            Replied
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        {formatDateTime(r.message?.sentAt ?? null)}
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        {formatDateTime(r.message?.deliveredAt ?? null)}
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        {formatDateTime(r.message?.readAt ?? null)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                        {/* Plain English only. The Meta error code is
                            available to admins in the activity log. */}
                        {r.message?.errorUserMessage ??
                          (r.skipReason
                            ? (SKIP_REASON_LABELS[
                                r.skipReason as keyof typeof SKIP_REASON_LABELS
                              ] ??
                              (r.skipReason === "campaign_cancelled"
                                ? "Campaign was cancelled before this was sent"
                                : r.skipReason === "contact_deleted"
                                  ? "Contact was deleted"
                                  : r.skipReason))
                            : "—")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {recipients.total > recipients.pageSize && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">
              Showing {(page - 1) * recipients.pageSize + 1}–
              {Math.min(page * recipients.pageSize, recipients.total)} of{" "}
              {formatNumber(recipients.total)}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/campaigns/${id}?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  Previous
                </Link>
              )}
              {page * recipients.pageSize < recipients.total && (
                <Link
                  href={`/campaigns/${id}?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
