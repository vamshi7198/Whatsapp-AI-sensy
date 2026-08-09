import { Badge } from "@/components/ui/badge";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";

import { TechnicalDetails } from "./_technical-details";

export const metadata = { title: "Activity log" };

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

const EVENT_LABELS: Record<string, string> = {
  inbound_message: "Message received",
  status_update: "Delivery update",
  template_status: "Template status changed",
  quality_update: "Account quality changed",
  unknown: "Unrecognised event",
};

export default async function LogsPage() {
  await requireAuth("logs:view");

  const [events, messages, audits, counts] = await Promise.all([
    prisma.webhookEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.message.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        direction: true,
        type: true,
        body: true,
        status: true,
        wamid: true,
        errorCode: true,
        errorUserMessage: true,
        errorDetail: true,
        createdAt: true,
        contact: { select: { name: true, phoneE164: true } },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        action: true,
        actorEmail: true,
        metadata: true,
        ip: true,
        createdAt: true,
      },
    }),
    prisma.webhookEvent.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  const lastEvent = events[0];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Activity log
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Everything WhatsApp has sent us, and everything we have sent back.
          Administrators only.
        </p>
      </div>

      {/* The single most useful fact when nothing seems to be working. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Last message from WhatsApp
        </p>
        <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
          {lastEvent ? formatTime(lastEvent.receivedAt) : "Never"}
        </p>
        {!lastEvent && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            WhatsApp has not contacted this app yet. Check that the callback
            address is saved in your Meta app settings, and that
            &ldquo;Subscribe webhooks&rdquo; is switched on for your number.
          </p>
        )}
        {counts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {counts.map((c) => (
              <Badge
                key={c.status}
                tone={c.status === "FAILED" ? "red" : "neutral"}
              >
                {c.status.toLowerCase()}: {c._count}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Webhook events */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Received from WhatsApp
          </h3>
        </div>

        {events.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nothing received yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Event</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">
                      {formatTime(e.receivedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200">
                      {EVENT_LABELS[e.eventType] ?? e.eventType}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          e.status === "PROCESSED"
                            ? "green"
                            : e.status === "FAILED"
                              ? "red"
                              : "neutral"
                        }
                      >
                        {e.status.toLowerCase()}
                      </Badge>
                      {!e.signatureValid && (
                        <Badge tone="red" className="ml-1">
                          unverified
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {e.error && (
                        <p className="mb-1 text-xs text-red-600 dark:text-red-400">
                          {e.error}
                        </p>
                      )}
                      <TechnicalDetails
                        data={JSON.stringify(e.payload, null, 2)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Messages */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Messages
          </h3>
        </div>

        {messages.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No messages yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Direction</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">
                      {formatTime(m.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {m.direction === "INBOUND" ? "Received" : "Sent"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200">
                      {m.contact.name || "Unnamed"}
                      <span className="block text-xs text-slate-400">
                        {formatPhoneForDisplay(m.contact.phoneE164)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          m.status === "READ"
                            ? "green"
                            : m.status === "FAILED"
                              ? "red"
                              : "neutral"
                        }
                      >
                        {m.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="max-w-xs truncate text-slate-600 dark:text-slate-400">
                        {m.body || `(${m.type})`}
                      </p>
                      {/* Plain English first; the code only under the
                          technical view, and only for administrators. */}
                      {m.errorUserMessage && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {m.errorUserMessage}
                        </p>
                      )}
                      {(m.errorCode || m.wamid) && (
                        <TechnicalDetails
                          data={[
                            m.wamid ? `Message ID: ${m.wamid}` : null,
                            m.errorCode ? `Error code: ${m.errorCode}` : null,
                            m.errorDetail ? `Detail: ${m.errorDetail}` : null,
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Who did what */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Team activity
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {audits.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">
                    {formatTime(a.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200">
                    {a.action}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                    {a.actorEmail ?? "system"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {a.ip ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
