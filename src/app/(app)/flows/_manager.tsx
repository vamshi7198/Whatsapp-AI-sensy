"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { FieldType, FlowDefinition } from "@/lib/flows/builder";
import { formatNumber } from "@/lib/utils";

import {
  createFlowAction,
  publishFlowAction,
  retireFlowAction,
  type FlowState,
} from "./actions";

interface FlowRow {
  id: string;
  name: string;
  family: string;
  version: number;
  status: string;
  category: string;
  sends: number;
  responses: number;
  createdBy: string | null;
  createdAt: string;
}

interface Starter {
  key: string;
  label: string;
  category: string;
  definition: FlowDefinition;
}

/** A question being edited. Kept separate from the saved shape. */
interface DraftField {
  label: string;
  type: FieldType;
  required: boolean;
  options: string;
}

const TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Short answer",
  long_text: "Long answer",
  single_choice: "Pick one",
  multiple_choice: "Pick several",
  dropdown: "Dropdown list",
  date: "Date",
};

const NEEDS_OPTIONS: FieldType[] = [
  "single_choice",
  "multiple_choice",
  "dropdown",
];

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function FlowManager({
  canManage,
  flows,
  starters,
}: {
  canManage: boolean;
  flows: FlowRow[];
  starters: Starter[];
}) {
  const [state, setState] = useState<FlowState>({});
  const [isPending, startTransition] = useTransition();
  const [building, setBuilding] = useState(false);
  const [title, setTitle] = useState("");
  const [heading, setHeading] = useState("");
  const [submitLabel, setSubmitLabel] = useState("Submit");
  const [category, setCategory] = useState("SURVEY");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);

  function loadStarter(starter: Starter) {
    setTitle(starter.definition.title);
    setHeading(starter.definition.heading ?? "");
    setSubmitLabel(starter.definition.submitLabel);
    setCategory(starter.category);
    setFields(
      starter.definition.fields.map((f) => ({
        label: f.label,
        type: f.type,
        required: f.required,
        options: (f.options ?? []).join(", "),
      })),
    );
    setBuilding(true);
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((current) =>
      current.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }

  function run(
    action: (prev: FlowState, data: FormData) => Promise<FlowState>,
    formData: FormData,
  ) {
    startTransition(async () => {
      setState(await action({}, formData));
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Forms
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Collect answers inside the chat, without sending anyone to a
            website.
          </p>
        </div>

        {canManage && !building && (
          <Button onClick={() => setBuilding(true)}>New form</Button>
        )}
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      {state.problems && state.problems.length > 0 && (
        <ul
          role="alert"
          className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {state.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Builder                                                           */}
      {/* ---------------------------------------------------------------- */}

      {building && canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {fields.length === 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Start from one of these
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => loadStarter(s)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            action={(formData) => {
              run(createFlowAction, formData);
              setBuilding(false);
            }}
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Title"
                htmlFor="title"
                hint="Shown at the top of the form."
              >
                <Input
                  id="title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={80}
                />
              </Field>

              <Field label="What is it for?" htmlFor="category">
                <Select
                  id="category"
                  name="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="SURVEY">Survey or feedback</option>
                  <option value="CONTACT_US">Enquiry</option>
                  <option value="LEAD_GENERATION">Collecting details</option>
                  <option value="APPOINTMENT_BOOKING">Booking</option>
                  <option value="CUSTOMER_SUPPORT">Support</option>
                  <option value="OTHER">Something else</option>
                </Select>
              </Field>
            </div>

            <Field
              label="Opening line (optional)"
              htmlFor="heading"
              hint="A sentence above the questions."
            >
              <Input
                id="heading"
                name="heading"
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                maxLength={200}
              />
            </Field>

            {/* ---------- Questions ---------- */}

            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Questions
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setFields((f) => [
                      ...f,
                      { label: "", type: "short_text", required: true, options: "" },
                    ])
                  }
                >
                  Add a question
                </Button>
              </div>

              {fields.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400 dark:border-slate-700">
                  No questions yet.
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  {fields.map((field, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <Input
                          name="fieldLabel"
                          value={field.label}
                          onChange={(e) =>
                            updateField(index, { label: e.target.value })
                          }
                          placeholder="What do you want to ask?"
                          aria-label={`Question ${index + 1}`}
                        />

                        <div className="flex items-center gap-2">
                          <Select
                            name="fieldType"
                            value={field.type}
                            onChange={(e) =>
                              updateField(index, {
                                type: e.target.value as FieldType,
                              })
                            }
                            className="w-auto"
                            aria-label={`Answer type for question ${index + 1}`}
                          >
                            {Object.entries(TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </Select>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setFields((f) => f.filter((_, i) => i !== index))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </div>

                      {/*
                        Always present, even when hidden, because the server
                        reads these as parallel arrays and a missing entry
                        would shift every later answer onto the wrong question.
                      */}
                      <input
                        type="hidden"
                        name="fieldRequired"
                        value={field.required ? "on" : ""}
                      />

                      {NEEDS_OPTIONS.includes(field.type) ? (
                        <Input
                          name="fieldOptions"
                          value={field.options}
                          onChange={(e) =>
                            updateField(index, { options: e.target.value })
                          }
                          placeholder="Choices, separated by commas"
                          className="mt-2"
                          aria-label={`Choices for question ${index + 1}`}
                        />
                      ) : (
                        <input type="hidden" name="fieldOptions" value="" />
                      )}

                      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) =>
                            updateField(index, { required: e.target.checked })
                          }
                        />
                        Must be answered
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Field label="Button on the form" htmlFor="submitLabel">
              <Input
                id="submitLabel"
                name="submitLabel"
                value={submitLabel}
                onChange={(e) => setSubmitLabel(e.target.value)}
                maxLength={35}
              />
            </Field>

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <Button type="submit" disabled={isPending || fields.length === 0}>
                {isPending ? "Creating…" : "Create as a draft"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setBuilding(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The list                                                          */}
      {/* ---------------------------------------------------------------- */}

      {flows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No forms yet.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            A feedback survey after an order is the usual first one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <section
              key={flow.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/flows/${flow.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-50"
                    >
                      {flow.name}
                    </Link>
                    <Badge
                      tone={flow.status === "PUBLISHED" ? "green" : "neutral"}
                    >
                      {flow.status === "PUBLISHED" ? "Live" : "Draft"}
                    </Badge>
                    {flow.version > 1 && (
                      <Badge tone="neutral">Version {flow.version}</Badge>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-400">
                    Sent {formatNumber(flow.sends)} time
                    {flow.sends === 1 ? "" : "s"} ·{" "}
                    {formatNumber(flow.responses)} answered ·{" "}
                    {formatDate(flow.createdAt)}
                    {flow.createdBy ? ` · by ${flow.createdBy}` : ""}
                  </p>
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    {flow.status === "DRAFT" &&
                      (confirmPublish === flow.id ? (
                        <>
                          <span className="max-w-xs text-xs text-amber-700 dark:text-amber-400">
                            Once published this form can never be edited —
                            changing it later means making a new version.
                          </span>
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              const formData = new FormData();
                              formData.set("id", flow.id);
                              run(publishFlowAction, formData);
                              setConfirmPublish(null);
                            }}
                          >
                            Publish
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmPublish(null)}
                          >
                            Not yet
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => setConfirmPublish(flow.id)}
                        >
                          Publish
                        </Button>
                      ))}

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("id", flow.id);
                        run(retireFlowAction, formData);
                      }}
                    >
                      {flow.status === "DRAFT" ? "Delete" : "Retire"}
                    </Button>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        A form can be sent to anyone who has messaged you in the last 24 hours.
        To send one to a wider list, it has to travel on an approved template
        with a form button, which WhatsApp reviews first.
      </p>
    </div>
  );
}
