"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type {
  AudienceFilter,
  VariableMapping,
  VariableSource,
} from "@/lib/campaigns/audience";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import { formatCost, formatNumber } from "@/lib/utils";

import {
  previewCampaign,
  sendCampaign,
  type AudiencePreview,
  type ContactSearchResult,
  type SendState,
} from "../actions";
import { CsvAudiencePicker, ManualContactPicker } from "./_audience-picker";
import { MediaUpload } from "./_media-upload";

interface TemplateOption {
  id: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  variableCount: number;
  body: string;
  components: unknown;
  /** Set when the template's header is media rather than text. */
  headerMediaType: "image" | "video" | "document" | null;
}

interface TagOption {
  id: string;
  name: string;
  contactCount: number;
}

const STEPS = [
  "Name",
  "Audience",
  "Template",
  "Values",
  "Preview",
  "Confirm",
] as const;

function StepBar({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = current > step;
        const active = current === step;

        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                done
                  ? "bg-emerald-600 text-white"
                  : active
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-slate-200 text-slate-500 dark:bg-slate-800"
              }`}
            >
              {done ? "✓" : step}
            </span>
            <span
              className={
                active
                  ? "font-medium text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }
            >
              {label}
            </span>
            {step < STEPS.length && (
              <span className="text-slate-300 dark:text-slate-700">→</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function CampaignWizard({
  templates,
  tags,
  attributeKeys,
  idempotencyKey,
}: {
  templates: TemplateOption[];
  tags: TagOption[];
  attributeKeys: string[];
  /**
   * Generated once per page load on the server. Stable for the life of this
   * wizard, so a double-click or a resubmitted form resolves to the same
   * campaign — but a genuinely new campaign gets a fresh key.
   */
  idempotencyKey: string;
}) {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<AudienceFilter>({
    type: "ALL_CONTACTS",
  });
  const [templateId, setTemplateId] = useState("");
  const [mapping, setMapping] = useState<VariableMapping>({});
  const [preview, setPreview] = useState<AudiencePreview>({});
  const [sendState, setSendState] = useState<SendState>({});
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Kept alongside the audience filter so the chosen people stay visible as
  // chips while the user keeps searching.
  const [manualContacts, setManualContacts] = useState<ContactSearchResult[]>(
    [],
  );
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("10:00");

  const template = templates.find((t) => t.id === templateId);
  const variableIndexes = template
    ? Array.from({ length: template.variableCount }, (_, i) => String(i + 1))
    : [];

  function runPreview() {
    const formData = new FormData();
    formData.set("templateId", templateId);
    formData.set("audience", JSON.stringify(audience));
    formData.set("mapping", JSON.stringify(mapping));

    startTransition(async () => {
      const result = await previewCampaign({}, formData);
      setPreview(result);
      if (!result.error) setStep(5);
    });
  }

  function submit() {
    const formData = new FormData();
    formData.set("name", name);
    formData.set("templateId", templateId);
    formData.set("idempotencyKey", idempotencyKey);
    formData.set("confirmed", confirmed ? "on" : "");
    formData.set("audience", JSON.stringify(audience));
    formData.set("mapping", JSON.stringify(mapping));

    if (headerMediaUrl && template?.headerMediaType) {
      formData.set("headerMediaUrl", headerMediaUrl);
      formData.set("headerMediaType", template.headerMediaType);
    }

    formData.set("sendMode", sendMode);
    if (sendMode === "later") {
      formData.set("scheduledDate", scheduledDate);
      formData.set("scheduledTime", scheduledTime);
    }

    startTransition(async () => {
      const result = await sendCampaign({}, formData);
      setSendState(result);
      if (result.campaignId) router.push(`/campaigns/${result.campaignId}`);
    });
  }

  // Each audience type needs something actually chosen before continuing,
  // otherwise the preview step reports "nobody matches" and the user has to
  // work out why themselves.
  const audienceReady =
    audience.type === "ALL_CONTACTS"
      ? true
      : audience.type === "TAG" || audience.type === "TAGS"
        ? (audience.tagIds?.length ?? 0) > 0
        : (audience.contactIds?.length ?? 0) > 0;

  const canContinue =
    step === 1
      ? name.trim().length > 0
      : step === 2
        ? audienceReady
        : step === 3
          ? Boolean(templateId)
          : step === 4
            ? variableIndexes.every((i) => mapping[i]) &&
              // A media-header template without a file is refused by Meta for
              // every recipient, so it cannot be left until the end.
              (!template?.headerMediaType || Boolean(headerMediaUrl))
            : true;

  return (
    <div className="space-y-4">
      <StepBar current={step} />

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        {/* ---------- 1. Name ---------- */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Name this campaign
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                For your team only. Customers never see it.
              </p>
            </div>

            <Field label="Campaign name" htmlFor="campaign-name">
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pilot Feedback – August 2026"
                autoFocus
              />
            </Field>
          </div>
        )}

        {/* ---------- 2. Audience ---------- */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Who should receive it?
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                You will see exactly who is included before anything is sent.
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <input
                  type="radio"
                  name="audience"
                  checked={audience.type === "ALL_CONTACTS"}
                  onChange={() => setAudience({ type: "ALL_CONTACTS" })}
                  className="mt-0.5"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  Everyone
                  <span className="block text-xs text-slate-500">
                    All contacts, minus anyone excluded by the checks below.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <input
                  type="radio"
                  name="audience"
                  checked={audience.type === "TAG"}
                  onChange={() =>
                    setAudience({ type: "TAG", tagIds: [], match: "any" })
                  }
                  className="mt-0.5"
                />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                  People with a tag
                  {audience.type === "TAG" && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {tags.length === 0 && (
                        <span className="text-xs text-slate-400">
                          No tags yet. Add tags to contacts first.
                        </span>
                      )}
                      {tags.map((t) => {
                        const selected = audience.tagIds?.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              const current = audience.tagIds ?? [];
                              setAudience({
                                ...audience,
                                tagIds: selected
                                  ? current.filter((id) => id !== t.id)
                                  : [...current, t.id],
                              });
                            }}
                            className={`rounded-md px-2 py-1 text-xs transition ${
                              selected
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {t.name} ({t.contactCount})
                          </button>
                        );
                      })}
                    </span>
                  )}
                </span>
              </label>

              {audience.type === "TAG" && (audience.tagIds?.length ?? 0) > 1 && (
                <div className="ml-8">
                  <Select
                    value={audience.match ?? "any"}
                    onChange={(e) =>
                      setAudience({
                        ...audience,
                        match: e.target.value as "any" | "all",
                      })
                    }
                    className="w-auto text-xs"
                    aria-label="Tag matching"
                  >
                    <option value="any">Has any of these tags</option>
                    <option value="all">Has all of these tags</option>
                  </Select>
                </div>
              )}

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <input
                  type="radio"
                  name="audience"
                  checked={audience.type === "SELECTED"}
                  onChange={() =>
                    setAudience({ type: "SELECTED", contactIds: [] })
                  }
                  className="mt-0.5"
                />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                  Choose people yourself
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Search by name or phone number and pick them one by one.
                  </span>
                  {audience.type === "SELECTED" && (
                    <ManualContactPicker
                      selected={manualContacts}
                      onChange={(contacts) => {
                        setManualContacts(contacts);
                        setAudience({
                          type: "SELECTED",
                          contactIds: contacts.map((c) => c.id),
                        });
                      }}
                    />
                  )}
                </span>
              </label>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <input
                  type="radio"
                  name="audience"
                  checked={audience.type === "CSV_UPLOAD"}
                  onChange={() =>
                    setAudience({ type: "CSV_UPLOAD", contactIds: [] })
                  }
                  className="mt-0.5"
                />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                  Upload a list of numbers
                  <span className="mt-0.5 block text-xs text-slate-500">
                    A CSV of phone numbers, matched against your existing
                    contacts.
                  </span>
                  {audience.type === "CSV_UPLOAD" && (
                    <CsvAudiencePicker
                      onResolved={(contactIds) => {
                        // Resolved to contact IDs, so the same compliance and
                        // variable rules apply as any other audience.
                        setAudience({ type: "CSV_UPLOAD", contactIds });
                      }}
                    />
                  )}
                </span>
              </label>
            </div>
          </div>
        )}

        {/* ---------- 3. Template ---------- */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Choose the message
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Only templates approved by WhatsApp can be sent.
              </p>
            </div>

            <div className="space-y-2">
              {templates.map((t) => (
                <label
                  key={t.id}
                  className={`block cursor-pointer rounded-lg border p-3 transition ${
                    templateId === t.id
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                      : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="template"
                      checked={templateId === t.id}
                      onChange={() => {
                        setTemplateId(t.id);
                        setMapping({});
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-sm text-slate-900 dark:text-slate-100">
                          {t.name}
                        </span>
                        <Badge
                          tone={
                            t.category === "MARKETING" ? "purple" : "blue"
                          }
                        >
                          {t.category.toLowerCase()}
                        </Badge>
                        <Badge tone="neutral">{t.language}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {t.body}
                      </p>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {template?.category === "MARKETING" && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                This is a marketing message, so it will only go to contacts who
                have agreed to receive marketing. You will see how many are
                excluded before sending.
              </p>
            )}
          </div>
        )}

        {/* ---------- 4. Variables ---------- */}
        {step === 4 && template && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {template.headerMediaType
                  ? "Image and blanks"
                  : "Fill in the blanks"}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {variableIndexes.length === 0 && !template.headerMediaType
                  ? "This template has no blanks to fill."
                  : "Choose where each value comes from."}
              </p>
            </div>

            {template.headerMediaType && (
              <MediaUpload
                mediaType={template.headerMediaType}
                value={headerMediaUrl}
                onChange={setHeaderMediaUrl}
              />
            )}

            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {template.body}
              </p>
            </div>

            {variableIndexes.map((index) => {
              const source = mapping[index];

              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-700">
                    {`{{${index}}}`}
                  </code>
                  <span className="text-slate-400">→</span>

                  <Select
                    value={
                      source?.source === "contact_field"
                        ? `field:${source.field}`
                        : source?.source === "attribute"
                          ? `attr:${source.key}`
                          : source?.source === "fixed"
                            ? "fixed"
                            : ""
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      let next: VariableSource | undefined;

                      if (value.startsWith("field:")) {
                        next = {
                          source: "contact_field",
                          field: value.slice(6) as "name" | "phone" | "email",
                        };
                      } else if (value.startsWith("attr:")) {
                        next = { source: "attribute", key: value.slice(5) };
                      } else if (value === "fixed") {
                        next = { source: "fixed", value: "" };
                      }

                      setMapping((m) =>
                        next ? { ...m, [index]: next } : m,
                      );
                    }}
                    className="w-auto"
                    aria-label={`Value for placeholder ${index}`}
                  >
                    <option value="">Choose…</option>
                    <option value="field:name">Contact name</option>
                    <option value="field:phone">Phone number</option>
                    <option value="field:email">Email</option>
                    {attributeKeys.map((key) => (
                      <option key={key} value={`attr:${key}`}>
                        Imported column: {key}
                      </option>
                    ))}
                    <option value="fixed">The same text for everyone</option>
                  </Select>

                  {source?.source === "fixed" && (
                    <Input
                      value={source.value}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          [index]: { source: "fixed", value: e.target.value },
                        }))
                      }
                      placeholder="Type the text"
                      className="max-w-xs"
                      aria-label={`Fixed text for placeholder ${index}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ---------- 5. Preview ---------- */}
        {step === 5 && template && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                What people will receive
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Real values from up to five actual recipients.
              </p>
            </div>

            {preview.error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {preview.error}
              </p>
            )}

            {preview.variableProblems &&
              preview.variableProblems.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    Some values will be rejected by WhatsApp
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                    {preview.variableProblems.map((p, i) => (
                      <li key={i}>
                        {p.name ?? "A contact"}: {p.problem}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            <div className="space-y-3">
              {preview.samples?.map((s, i) => (
                <div key={i}>
                  <p className="mb-1 text-xs text-slate-400">
                    {s.name || "Unnamed"} ·{" "}
                    {formatPhoneForDisplay(s.phoneE164)}
                  </p>
                  {/* The rendered body, in a WhatsApp-style bubble. Any
                      {{n}} still visible is a value that could not be
                      resolved for this recipient. */}
                  <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-950/50">
                    <div className="ml-auto max-w-sm rounded-xl rounded-br-sm bg-emerald-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-900 shadow-sm dark:bg-emerald-900 dark:text-emerald-50">
                      {s.rendered}
                    </div>
                  </div>
                  {s.missing.length > 0 && (
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      Will be skipped — missing a value
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- 6. Confirm ---------- */}
        {step === 6 && template && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Review before sending
            </h2>

            {sendState.error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {sendState.error}
              </p>
            )}

            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {[
                ["Campaign", name],
                ["Template", `${template.name} (${template.language})`],
                ["Type", template.category.toLowerCase()],
                [
                  "Matched contacts",
                  formatNumber(preview.totalMatched ?? 0),
                ],
                [
                  "Will receive it",
                  formatNumber(preview.eligible ?? 0),
                ],
                [
                  "Estimated cost",
                  preview.cost?.total !== null &&
                  preview.cost?.total !== undefined
                    ? formatCost(preview.cost.total, preview.cost.currency)
                    : "No price set",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-3 py-2">
                  <dt className="text-sm text-slate-500 dark:text-slate-400">
                    {label}
                  </dt>
                  <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Skips are always shown. Compliance that hides its decisions is
                not trustworthy, and "why only 453 of 500?" needs an answer. */}
            {preview.skipped && preview.skipped.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Who will not receive it
                </p>
                <ul className="mt-1.5 space-y-1">
                  {preview.skipped.map((s) => (
                    <li
                      key={s.reason}
                      className="flex justify-between text-sm text-slate-600 dark:text-slate-400"
                    >
                      <span>{s.label}</span>
                      <span className="tabular-nums">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cost is an estimate on purpose: Meta bills on delivery, so
                messages that fail are never charged. */}
            {preview.cost?.total !== null &&
              preview.cost?.total !== undefined && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Meta charges when a message is delivered, so failed messages
                  cost nothing and the final amount may be slightly lower.
                  {preview.cost.perMessage !== null &&
                    ` About ${formatCost(preview.cost.perMessage, preview.cost.currency)} per message.`}
                  {preview.cost.usedFallbackRate &&
                    " Some numbers used the default rate — set country rates in Settings for a closer estimate."}
                </p>
              )}

            {preview.cost?.total === null && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No message prices are set, so the cost cannot be estimated. An
                administrator can add them under Settings.
              </p>
            )}

            {(preview.eligible ?? 0) >= 500 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                ⚠️ This is a large campaign. {formatNumber(preview.eligible ?? 0)}{" "}
                people will receive a WhatsApp message, and it cannot be undone
                once sent.
              </p>
            )}

            {/* ---------- When to send ---------- */}
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                When should this go out?
              </p>

              <div className="mt-2 flex gap-2">
                {(
                  [
                    ["now", "Send now"],
                    ["later", "Send later"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSendMode(value)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      sendMode === value
                        ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {sendMode === "later" && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      aria-label="Date to send"
                      className="w-auto"
                    />
                    <Input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      aria-label="Time to send"
                      className="w-auto"
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    India time. The campaign is checked every few minutes, so it
                    may go out a moment after the time you choose. If the
                    computer is off at that time, it sends when it next starts
                    up rather than being missed.
                  </p>
                </div>
              )}
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border border-slate-300 p-3 dark:border-slate-600">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                I confirm this campaign is intended for these recipients.
              </span>
            </label>
          </div>
        )}

        {/* ---------- Navigation ---------- */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || isPending}
          >
            Back
          </Button>

          {step < 5 && (
            <Button
              onClick={() => (step === 4 ? runPreview() : setStep(step + 1))}
              disabled={!canContinue || isPending}
            >
              {isPending ? "Checking…" : "Continue"}
            </Button>
          )}

          {step === 5 && (
            <Button onClick={() => setStep(6)} disabled={isPending}>
              Continue
            </Button>
          )}

          {step === 6 && (
            <Button
              onClick={submit}
              disabled={
                !confirmed ||
                isPending ||
                (sendMode === "later" && !scheduledDate)
              }
              title={
                !confirmed
                  ? "Tick the confirmation box first"
                  : sendMode === "later" && !scheduledDate
                    ? "Choose the date to send"
                    : undefined
              }
            >
              {isPending
                ? sendMode === "later"
                  ? "Scheduling…"
                  : "Sending…"
                : sendMode === "later"
                  ? `Schedule for ${formatNumber(preview.eligible ?? 0)} people`
                  : `Send to ${formatNumber(preview.eligible ?? 0)} people`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
