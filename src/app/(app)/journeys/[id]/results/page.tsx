import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import { prisma } from "@/lib/db";
import {
  getActiveSessions,
  getBranchCounts,
  getJourneyTotals,
} from "@/lib/journeys/analytics";
import { can } from "@/lib/rbac";
import { formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Journey results" };

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Working through it",
  WAITING_FOR_REPLY: "Waiting for them",
  WAITING_UNTIL: "Paused",
  HANDED_OFF: "With a person",
};

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function JourneyResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth("journey:view");
  const { id } = await params;

  const journey = await prisma.journey.findUnique({
    where: { id },
    select: { id: true, name: true, description: true },
  });

  if (!journey) notFound();

  const [totals, branches, active] = await Promise.all([
    getJourneyTotals(id),
    getBranchCounts(id),
    getActiveSessions(id),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/journeys"
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
          >
            ← All journeys
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            {journey.name}
          </h1>
          {journey.description && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {journey.description}
            </p>
          )}
        </div>

        {can(user, "journey:manage") && (
          <Link
            href={`/journeys/${id}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Edit the journey
          </Link>
        )}
      </div>

      {totals.started === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nobody has been through this journey yet.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Started" value={formatNumber(totals.started)} />
            <Stat
              label="Finished"
              value={formatNumber(totals.completed)}
              sub={formatPercent(totals.completed, totals.started)}
            />
            <Stat
              label="Still waiting"
              value={formatNumber(totals.waitingForReply + totals.waitingUntil)}
            />
            <Stat
              label="Stopped early"
              value={formatNumber(totals.failed)}
              tone={totals.failed > 0 ? "red" : undefined}
            />
          </div>

          {/* ------------------------------------------------------------- */}
          {/* What people chose                                             */}
          {/* ------------------------------------------------------------- */}

          {branches.map((branch) => (
            <section
              key={branch.stepId}
              className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {branch.stepName}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Asked {formatNumber(branch.asked)}{" "}
                  {branch.asked === 1 ? "person" : "people"}
                  {branch.noAnswer > 0 &&
                    ` · ${formatNumber(branch.noAnswer)} never answered`}
                </p>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {branch.options.map((option) => (
                  <div key={option.optionId} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-slate-700 dark:text-slate-300">
                        {option.label}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {formatNumber(option.count)}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          {Math.round(option.share * 100)}%
                        </span>
                      </span>
                    </div>

                    {/* A bar, because a column of numbers hides the shape. */}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.round(option.share * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* ------------------------------------------------------------- */}
          {/* Who is mid-conversation                                       */}
          {/* ------------------------------------------------------------- */}

          {active.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Partway through right now
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {active.map((session) => (
                      <tr
                        key={session.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/contacts/${session.contact.id}`}
                            className="text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {session.contact.name || "Unnamed"}
                          </Link>
                          <p className="text-xs text-slate-400 tabular-nums">
                            {formatPhoneForDisplay(session.contact.phoneE164)}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                          {session.currentStep?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            tone={
                              session.status === "HANDED_OFF" ? "amber" : "neutral"
                            }
                          >
                            {STATUS_LABELS[session.status] ?? session.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-slate-400">
                          {formatDateTime(session.updatedAt)}
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
