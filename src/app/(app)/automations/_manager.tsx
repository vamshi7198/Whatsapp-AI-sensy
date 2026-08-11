"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatNumber } from "@/lib/utils";

import {
  createAutomationAction,
  deleteAutomationAction,
  toggleAutomationAction,
  type AutomationState,
} from "./actions";

interface Automation {
  id: string;
  name: string;
  isActive: boolean;
  trigger: string;
  replyKind: "text" | "template";
  replyText: string;
  runCount: number;
  lastRunAt: string | null;
  createdBy: string | null;
}

interface Run {
  id: string;
  automationName: string;
  contactName: string;
  status: string;
  error: string | null;
  at: string;
}

interface TemplateOption {
  id: string;
  name: string;
  category: string;
  language: string;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function AutomationManager({
  canManage,
  automations,
  runs,
  templates,
}: {
  canManage: boolean;
  automations: Automation[];
  runs: Run[];
  templates: TemplateOption[];
}) {
  const [state, setState] = useState<AutomationState>({});
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [replyKind, setReplyKind] = useState<"text" | "template">("text");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function run(
    action: (prev: AutomationState, data: FormData) => Promise<AutomationState>,
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
            Automatic replies
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Answer common questions the moment a customer asks, without anyone
            having to be at a screen.
          </p>
        </div>

        {canManage && !showForm && (
          <Button onClick={() => setShowForm(true)}>New automatic reply</Button>
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
      {state.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* New automation                                                    */}
      {/* ---------------------------------------------------------------- */}

      {showForm && canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            New automatic reply
          </h2>

          <form
            action={(formData) => {
              formData.set("replyKind", replyKind);
              run(createAutomationAction, formData);
              setShowForm(false);
            }}
            className="mt-4 space-y-4"
          >
            <Field
              label="Name"
              htmlFor="name"
              hint="Just for you — the customer never sees this."
            >
              <Input
                id="name"
                name="name"
                required
                maxLength={120}
                placeholder="Where is my order"
              />
            </Field>

            <Field
              label="Reply when a customer says"
              htmlFor="keywords"
              hint="Separate words with commas. Leave empty to reply to every message."
            >
              <Input
                id="keywords"
                name="keywords"
                placeholder="track, order status, where is my order"
              />
            </Field>

            <Field label="Match" htmlFor="matchType">
              <Select id="matchType" name="matchType" defaultValue="contains">
                <option value="contains">
                  The message mentions one of these words
                </option>
                <option value="exact">
                  The message is exactly one of these words
                </option>
              </Select>
            </Field>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                What to send back
              </p>

              <div className="mt-2 flex gap-2">
                {(
                  [
                    ["text", "Write a reply"],
                    ["template", "Send a template"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setReplyKind(value)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      replyKind === value
                        ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {replyKind === "text" ? (
                <div className="mt-3 space-y-1">
                  <Textarea
                    name="body"
                    rows={4}
                    maxLength={4096}
                    placeholder="Thanks for getting in touch! You can track your order at uncanned.in/track — we usually reply within a few hours."
                  />
                  {/*
                    Worth saying, because it is the one thing that makes this
                    feature cheap: a reply inside the customer's own 24-hour
                    window is free and needs no Meta approval.
                  */}
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Free to send, and no WhatsApp approval needed, because it is
                    a reply within 24 hours of the customer messaging you.
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-1">
                  {templates.length === 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      No template can be used here yet. An automatic reply needs
                      an approved template with no blanks to fill in, because
                      there is nothing to fill them from.
                    </p>
                  ) : (
                    <>
                      <Select name="templateId" required>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.category.toLowerCase()}, {t.language})
                          </option>
                        ))}
                      </Select>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Templates are charged by WhatsApp. Writing the reply out
                        instead is free.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create, switched off"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowForm(false)}
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

      {automations.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No automatic replies yet.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            A good first one: reply to &ldquo;track&rdquo; with your order
            tracking link.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map((a) => (
            <section
              key={a.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-900 dark:text-slate-50">
                      {a.name}
                    </h3>
                    <Badge tone={a.isActive ? "green" : "neutral"}>
                      {a.isActive ? "Live" : "Off"}
                    </Badge>
                    {a.replyKind === "template" && (
                      <Badge tone="amber">Costs money</Badge>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {a.trigger}
                  </p>

                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {a.replyKind === "template" ? (
                      <>Sends the template &ldquo;{a.replyText}&rdquo;</>
                    ) : (
                      a.replyText
                    )}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Replied {formatNumber(a.runCount)} time
                    {a.runCount === 1 ? "" : "s"} · last{" "}
                    {formatDateTime(a.lastRunAt)}
                    {a.createdBy ? ` · set up by ${a.createdBy}` : ""}
                  </p>
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant={a.isActive ? "secondary" : "primary"}
                      disabled={isPending}
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("id", a.id);
                        formData.set("isActive", a.isActive ? "" : "on");
                        run(toggleAutomationAction, formData);
                      }}
                    >
                      {a.isActive ? "Switch off" : "Turn on"}
                    </Button>

                    {confirmDelete === a.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={isPending}
                          onClick={() => {
                            const formData = new FormData();
                            formData.set("id", a.id);
                            run(deleteAutomationAction, formData);
                            setConfirmDelete(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(a.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* What they have been doing                                         */}
      {/* ---------------------------------------------------------------- */}

      {runs.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Recently
            </h2>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                    {r.automationName}
                    <span className="text-slate-400"> replied to </span>
                    {r.contactName}
                  </td>
                  <td className="px-4 py-2">
                    {r.status === "FAILED" ? (
                      <span
                        className="text-xs text-red-600 dark:text-red-400"
                        title={r.error ?? undefined}
                      >
                        {r.error ?? "Failed"}
                      </span>
                    ) : (
                      <Badge tone="green">Sent</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-xs whitespace-nowrap text-slate-400">
                    {formatDateTime(r.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
