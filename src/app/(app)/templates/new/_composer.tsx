"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  extractVariables,
  suggestTemplateName,
  type TemplateButton,
} from "@/lib/templates/builder";

import { createTemplateAction, type CreateTemplateState } from "./actions";
import { ButtonEditor } from "./_button-editor";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
  { code: "te", label: "Telugu" },
  { code: "ta", label: "Tamil" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "bn", label: "Bengali" },
];

export function TemplateComposer() {
  const [state, setState] = useState<CreateTemplateState>({});
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [buttons, setButtons] = useState<TemplateButton[]>([]);

  const variables = extractVariables(bodyText);

  // Live preview with the example values substituted, so what is on screen is
  // what a customer would actually read.
  const preview = bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, i: string) =>
    examples[i]?.trim() ? examples[i] : match,
  );

  function submit(formData: FormData) {
    // Buttons live in React state rather than form fields, so they are
    // serialised here rather than relying on hidden inputs staying in sync.
    formData.set("buttons", JSON.stringify(buttons));

    startTransition(async () => {
      setState(await createTemplateAction({}, formData));
    });
  }

  if (state.success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950">
        <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
          Sent for approval
        </h2>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
          {state.success}
        </p>
        <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">
          You do not need to wait here — the status updates on its own, and the
          template becomes available for campaigns once approved.
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/templates">
            <Button>View templates</Button>
          </Link>
          <Link href="/templates/new">
            <Button variant="secondary">Create another</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-5">
      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <Field
          label="What is this message for?"
          htmlFor="title"
          hint="your own reference"
          error={state.issues?.name}
        >
          <Input
            id="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setName(suggestTemplateName(e.target.value));
            }}
            placeholder="Order shipped"
          />
          {name && (
            <p className="mt-1 text-xs text-slate-400">
              WhatsApp will store it as{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                {name}
              </code>
            </p>
          )}
          <input type="hidden" name="name" value={name} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type of message" htmlFor="category">
            <Select
              id="category"
              name="category"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as "MARKETING" | "UTILITY")
              }
            >
              <option value="UTILITY">
                Order or account update (Utility)
              </option>
              <option value="MARKETING">
                Promotion or announcement (Marketing)
              </option>
            </Select>
            <p className="mt-1 text-xs text-slate-400">
              {category === "UTILITY"
                ? "Cheaper, and reaches everyone. Only for genuine order or account updates."
                : "Costs more, and only reaches contacts who have opted in."}
            </p>
          </Field>

          <Field label="Language" htmlFor="language">
            <Select id="language" name="language" defaultValue="en">
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          The message
        </h2>

        <Field
          label="Heading"
          htmlFor="headerText"
          hint="optional, max 60"
          error={state.issues?.headerText}
        >
          <Input
            id="headerText"
            name="headerText"
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            maxLength={60}
            placeholder="Your order is on its way"
          />
        </Field>

        <Field
          label="Message text"
          htmlFor="bodyText"
          hint="max 1024"
          error={state.issues?.bodyText}
        >
          <Textarea
            id="bodyText"
            name="bodyText"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={5}
            required
            placeholder="Hi {{1}}, your Uncanned order {{2}} has shipped."
          />
          <p className="mt-1 text-xs text-slate-400">
            Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> for parts that
            change per person. {bodyText.length}/1024
          </p>
        </Field>

        <Field
          label="Footer"
          htmlFor="footerText"
          hint="optional, max 60"
          error={state.issues?.footerText}
        >
          <Input
            id="footerText"
            name="footerText"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            maxLength={60}
            placeholder="Uncanned"
          />
        </Field>
      </section>

      {/* Meta rejects any template with variables that has no example values,
          often with an error that never mentions examples. */}
      {variables.length > 0 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Example values
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              WhatsApp needs an example of what each blank will contain, so a
              reviewer can see how the message reads. These are only used for
              review — real messages use your contacts&rsquo; details.
            </p>
          </div>

          {variables.map((index) => (
            <Field
              key={index}
              label={`What goes in {{${index}}}?`}
              htmlFor={`example_${index}`}
              error={state.issues?.[`example_${index}`]}
            >
              <Input
                id={`example_${index}`}
                name={`example_${index}`}
                value={examples[index] ?? ""}
                onChange={(e) =>
                  setExamples((prev) => ({ ...prev, [index]: e.target.value }))
                }
                placeholder={index === "1" ? "Vamshi" : "UNC-10432"}
              />
            </Field>
          ))}
        </section>
      )}

      <ButtonEditor
        buttons={buttons}
        onChange={setButtons}
        issues={state.issues}
      />

      {bodyText.trim() && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
            How it will look
          </h2>

          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-950/50">
            <div className="ml-auto max-w-sm rounded-xl rounded-br-sm bg-emerald-100 px-3 py-2 text-sm shadow-sm dark:bg-emerald-900">
              {headerText && (
                <p className="mb-1 font-semibold text-slate-900 dark:text-emerald-50">
                  {headerText}
                </p>
              )}
              <p className="whitespace-pre-wrap text-slate-900 dark:text-emerald-50">
                {preview}
              </p>
              {footerText && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-emerald-200/70">
                  {footerText}
                </p>
              )}
            </div>

            {/* Buttons render as separate tappable rows beneath the bubble,
                which is how WhatsApp actually shows them. */}
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
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          <Badge tone={category === "MARKETING" ? "purple" : "blue"}>
            {category.toLowerCase()}
          </Badge>
          <span className="ml-2">
            {variables.length} blank{variables.length === 1 ? "" : "s"} to fill
            per person
          </span>
        </div>

        <div className="flex gap-2">
          <Link href="/templates">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isPending || !bodyText.trim()}>
            {isPending ? "Submitting…" : "Send for approval"}
          </Button>
        </div>
      </div>
    </form>
  );
}
