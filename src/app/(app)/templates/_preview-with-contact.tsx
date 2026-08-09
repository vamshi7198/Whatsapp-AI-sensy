"use client";

import { useState } from "react";

import { Select } from "@/components/ui/field";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";

export interface SampleContact {
  id: string;
  name: string | null;
  phoneE164: string;
  email: string | null;
  attributes: Record<string, string>;
}

/**
 * Shows a template as a specific customer would actually receive it.
 *
 * The point is to catch the awkward cases before a campaign goes out: a
 * contact stored as "vamshi p." rendering as "Hi vamshi p.!", or a blank name
 * leaving "Hi !". Rendering with real data is the only way to see that.
 */
export interface PreviewButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
}

export function TemplatePreviewWithContact({
  body,
  header,
  footer,
  variableCount,
  metaExamples,
  contacts,
  buttons = [],
}: {
  body: string;
  header?: string;
  footer?: string;
  variableCount: number;
  /** Example values supplied to Meta when the template was created. */
  metaExamples: string[];
  contacts: SampleContact[];
  buttons?: PreviewButton[];
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [sources, setSources] = useState<Record<string, string>>(() => {
    // {{1}} is nearly always the person's name, so default to it and let the
    // rest fall back to whatever was shown to Meta's reviewer.
    const initial: Record<string, string> = {};
    for (let i = 1; i <= variableCount; i += 1) {
      initial[String(i)] = i === 1 ? "field:name" : "example";
    }
    return initial;
  });

  const contact = contacts.find((c) => c.id === contactId);

  const attributeKeys = [
    ...new Set(contacts.flatMap((c) => Object.keys(c.attributes ?? {}))),
  ].sort();

  function valueFor(index: string): string {
    const source = sources[index] ?? "example";
    const exampleValue = metaExamples[Number(index) - 1] ?? `{{${index}}}`;

    if (source === "example") return exampleValue;
    if (!contact) return exampleValue;

    if (source === "field:name") return contact.name ?? "";
    if (source === "field:phone") return contact.phoneE164;
    if (source === "field:email") return contact.email ?? "";
    if (source.startsWith("attr:")) {
      return contact.attributes?.[source.slice(5)] ?? "";
    }

    return exampleValue;
  }

  const render = (text: string) =>
    text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, i: string) => valueFor(i));

  const rendered = render(body);
  const hasEmptyValue = Array.from({ length: variableCount }, (_, i) =>
    valueFor(String(i + 1)),
  ).some((v) => !v.trim());

  return (
    <div className="space-y-3">
      {contacts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={`preview-contact-${body.slice(0, 8)}`}
            className="text-xs text-slate-500 dark:text-slate-400"
          >
            Preview as
          </label>
          <Select
            id={`preview-contact-${body.slice(0, 8)}`}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="w-auto text-xs"
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || formatPhoneForDisplay(c.phoneE164)}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Per-variable source pickers, so the preview reflects what a campaign
          would actually put there rather than a guess. */}
      {variableCount > 0 && contacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: variableCount }, (_, i) => String(i + 1)).map(
            (index) => (
              <div key={index} className="flex items-center gap-1">
                <code className="rounded bg-slate-200 px-1 py-0.5 text-[10px] dark:bg-slate-700">
                  {`{{${index}}}`}
                </code>
                <Select
                  value={sources[index] ?? "example"}
                  onChange={(e) =>
                    setSources((prev) => ({ ...prev, [index]: e.target.value }))
                  }
                  aria-label={`Value for placeholder ${index}`}
                  className="w-auto py-1 text-[11px]"
                >
                  <option value="field:name">Name</option>
                  <option value="field:phone">Phone</option>
                  <option value="field:email">Email</option>
                  {attributeKeys.map((key) => (
                    <option key={key} value={`attr:${key}`}>
                      {key}
                    </option>
                  ))}
                  <option value="example">Sample value</option>
                </Select>
              </div>
            ),
          )}
        </div>
      )}

      <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-950/50">
        <div className="ml-auto max-w-sm rounded-xl rounded-br-sm bg-emerald-100 px-3 py-2 text-sm shadow-sm dark:bg-emerald-900">
          {header && (
            <p className="mb-1 font-semibold text-slate-900 dark:text-emerald-50">
              {render(header)}
            </p>
          )}
          <p className="whitespace-pre-wrap text-slate-900 dark:text-emerald-50">
            {rendered}
          </p>
          {footer && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-emerald-200/70">
              {footer}
            </p>
          )}
        </div>

        {/* Buttons appear as separate tappable rows beneath the bubble, not
            inside it, which is how WhatsApp renders them. */}
        {buttons.length > 0 && (
          <div className="mt-1 ml-auto max-w-sm space-y-1">
            {buttons.map((b, i) => (
              <div
                key={i}
                className="rounded-lg bg-white px-3 py-1.5 text-center text-sm text-sky-600 shadow-sm dark:bg-slate-800 dark:text-sky-400"
              >
                {b.type === "PHONE_NUMBER" && "📞 "}
                {b.type === "URL" && "🔗 "}
                {b.text || "Button"}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* A blank value is the failure people only notice after sending. */}
      {hasEmptyValue && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          This contact has no value for one of the blanks, so the message would
          read oddly. In a campaign they would be skipped rather than sent a
          half-finished message.
        </p>
      )}
    </div>
  );
}
