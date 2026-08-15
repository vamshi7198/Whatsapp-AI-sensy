import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, OptInBadge } from "@/components/ui/badge";
import { requireAuth } from "@/lib/auth/guards";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import { getContact, listTags, readCustomFields } from "@/lib/contacts/service";
import { can } from "@/lib/rbac";

import { EditContactButton } from "./_edit-contact";

export const metadata = { title: "Contact" };

function formatDateTime(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth("contact:view");
  const { id } = await params;

  const [contact, tags] = await Promise.all([getContact(id), listTags()]);
  if (!contact) notFound();

  const customFields = readCustomFields(contact.attributes);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/contacts"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to contacts
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {contact.name || "Unnamed contact"}
            </h1>
            <p className="mt-1 font-mono text-sm text-slate-500 dark:text-slate-400">
              {formatPhoneForDisplay(contact.phoneE164)}
            </p>
          </div>

          {can(user, "contact:edit") && (
            <EditContactButton
              contact={{
                id: contact.id,
                name: contact.name,
                phoneE164: contact.phoneE164,
                email: contact.email,
                notes: contact.notes,
                optedIn: contact.optInStatus === "OPTED_IN",
                tagIds: contact.tags.map((t) => t.tag.id),
              }}
              tags={tags.map((t) => ({ id: t.id, name: t.name }))}
              canDelete={can(user, "contact:delete")}
            />
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
              Details
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <Row label="Email" value={contact.email || "—"} />
              <Row label="Source" value={contact.source || "—"} />
              <Row
                label="WhatsApp"
                value={
                  contact.whatsappStatus === "VALID" ? (
                    <Badge tone="green">On WhatsApp</Badge>
                  ) : contact.whatsappStatus === "INVALID" ? (
                    <Badge tone="red">Not on WhatsApp</Badge>
                  ) : (
                    <Badge tone="neutral">Not checked yet</Badge>
                  )
                }
              />
              <Row label="Added" value={formatDateTime(contact.createdAt)} />
              <Row
                label="Last contacted"
                value={formatDateTime(contact.lastContactedAt)}
              />
            </div>
          </section>

          {/* Consent shown with its provenance. A boolean alone proves
              nothing if consent is ever challenged. */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
              Marketing consent
            </h2>
            <OptInBadge
              status={contact.optInStatus}
              marketingOptOut={contact.marketingOptOut}
            />
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              <Row
                label="Opted in on"
                value={formatDateTime(contact.optInAt)}
              />
              <Row label="Recorded via" value={contact.optInSource || "—"} />
              {contact.marketingOptOut && (
                <Row
                  label="Opted out on"
                  value={formatDateTime(contact.marketingOptOutAt)}
                />
              )}
            </div>
            {contact.marketingOptOut && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                This contact will be skipped by all marketing campaigns. They
                can still receive order and account updates.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
              Tags
            </h2>
            {contact.tags.length === 0 ? (
              <p className="text-sm text-slate-400">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map(({ tag }) => (
                  <Badge key={tag.id} tone="blue">
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {/*
            Whatever the CSV happened to carry.

            Deliberately driven by the data rather than a list of known fields:
            a column added to next month's import — AWB number, delivery
            partner, anything — appears here without a code change. Hard-coding
            the names would mean the app needing an edit every time the
            spreadsheet gains a column, which is the opposite of the point.

            Sorted, so the same contact does not present its fields in a
            different order each time it loads — Postgres gives no ordering
            guarantee for JSON keys.
          */}
          {customFields.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
                Other details
              </h2>
              <dl className="flex flex-col gap-2.5">
                {customFields.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">
                      {key}
                    </dt>
                    {/*
                      break-words, because an address or a tracking number can
                      be long and unbroken, and it must wrap rather than push
                      the column wider than the page.
                    */}
                    <dd className="text-sm break-words text-slate-900 dark:text-slate-100">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Message history
            </h2>
          </div>

          {contact.messages.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No messages yet.
              </p>
              <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
                Messages appear here once WhatsApp is connected and you send a
                campaign or reply.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {contact.messages.map((m) => (
                <li key={m.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400">
                        {m.direction === "INBOUND" ? "Received" : "Sent"} ·{" "}
                        {formatDateTime(m.createdAt)}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-slate-800 dark:text-slate-200">
                        {m.body || `(${m.type})`}
                      </p>
                      {m.errorUserMessage && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {m.errorUserMessage}
                        </p>
                      )}
                    </div>
                    <Badge
                      tone={
                        m.status === "READ"
                          ? "green"
                          : m.status === "FAILED"
                            ? "red"
                            : m.status === "DELIVERED"
                              ? "blue"
                              : "neutral"
                      }
                    >
                      {m.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {contact.campaignRecipients.length > 0 && (
            <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                Campaigns
              </h3>
              <ul className="space-y-1.5">
                {contact.campaignRecipients.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <Link
                      href={`/campaigns/${r.campaign.id}`}
                      className="text-slate-700 hover:text-emerald-700 dark:text-slate-300"
                    >
                      {r.campaign.name}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {r.skipReason ? `Skipped — ${r.skipReason}` : r.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
