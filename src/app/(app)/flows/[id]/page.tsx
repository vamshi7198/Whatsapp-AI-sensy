import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { requireAuth } from "@/lib/auth/guards";
import { getFlowWithResponses } from "@/lib/flows/service";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import { formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Form answers" };

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

/** One answer, rendered readably whatever shape it arrived in. */
function renderAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default async function FlowResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("flow:view");
  const { id } = await params;

  const flow = await getFlowWithResponses(id);
  if (!flow) notFound();

  // Columns come from the answers themselves, not from the form definition:
  // a form that changed still has old answers, and dropping a column because
  // the question was removed would hide real data.
  const columns = [
    ...new Set(
      flow.responses.flatMap((r) =>
        Object.keys((r.answers ?? {}) as Record<string, unknown>).filter(
          (k) => k !== "flow_token" && !k.startsWith("__"),
        ),
      ),
    ),
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/flows"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to forms
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {flow.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Version {flow.version} ·{" "}
              {flow.category.toLowerCase().replace(/_/g, " ")}
            </p>
          </div>

          <Badge tone={flow.status === "PUBLISHED" ? "green" : "neutral"}>
            {flow.status === "PUBLISHED" ? "Live" : "Draft"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Sent</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatNumber(flow._count.sends)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Answered</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatNumber(flow._count.responses)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Completion
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatPercent(flow._count.responses, flow._count.sends)}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Answers
          </h2>
        </div>

        {flow.responses.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nobody has filled this in yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Who</th>
                  {columns.map((c) => (
                    <th key={c} className="px-4 py-2.5 font-medium">
                      {c.replace(/_/g, " ")}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {flow.responses.map((r) => {
                  const answers = (r.answers ?? {}) as Record<string, unknown>;

                  return (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                    >
                      <td className="px-4 py-2.5">
                        <p className="text-slate-900 dark:text-slate-100">
                          {r.contact.name || "Unnamed"}
                        </p>
                        <p className="text-xs text-slate-400 tabular-nums">
                          {formatPhoneForDisplay(r.contact.phoneE164)}
                        </p>
                      </td>

                      {columns.map((c) => (
                        <td
                          key={c}
                          className="px-4 py-2.5 text-slate-700 dark:text-slate-300"
                        >
                          {renderAnswer(answers[c])}
                        </td>
                      ))}

                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        {formatDateTime(r.receivedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
