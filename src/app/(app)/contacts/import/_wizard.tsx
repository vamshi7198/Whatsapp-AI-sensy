"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

import {
  previewCsv,
  runImport,
  type ImportState,
  type PreviewState,
} from "./actions";

const SAMPLE_CSV = `name,phone,email,tags
Vamshi,+919876543210,vamshi@email.com,pilot
Rahul,+919876543211,rahul@email.com,influencer`;

function StepHeader({
  step,
  current,
  label,
}: {
  step: number;
  current: number;
  label: string;
}) {
  const done = current > step;
  const active = current === step;

  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
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
            ? "text-sm font-medium text-slate-900 dark:text-slate-100"
            : "text-sm text-slate-500 dark:text-slate-400"
        }
      >
        {label}
      </span>
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Step 1 — upload
   ---------------------------------------------------------------------- */

function UploadStep({
  preview,
  action,
  pending,
  onFilename,
}: {
  preview: PreviewState;
  action: (formData: FormData) => void;
  pending: boolean;
  onFilename: (name: string) => void;
}) {
  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "uncanned-contacts-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      {preview.error && <Alert>{preview.error}</Alert>}

      <Field label="CSV file" htmlFor="file">
        <Input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => onFilename(e.target.files?.[0]?.name ?? "")}
          className="file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm dark:file:bg-slate-800"
        />
      </Field>

      <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
        <p className="font-medium text-slate-700 dark:text-slate-300">
          Your file should have a heading row
        </p>
        <pre className="mt-1.5 overflow-x-auto text-xs text-slate-500 dark:text-slate-400">
          {SAMPLE_CSV}
        </pre>
        <button
          type="button"
          onClick={downloadSample}
          className="mt-2 text-xs font-medium text-emerald-700 underline dark:text-emerald-400"
        >
          Download a sample file
        </button>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Reading…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Steps 2 & 3 — match columns, review, confirm

   Split out so `headers` arrives as a non-optional prop; narrowing in the
   parent does not survive into the nested .map() callbacks.
   ---------------------------------------------------------------------- */

function MappingStep({
  preview,
  headers,
  filename,
  result,
  action,
  pending,
  defaultOptIn,
}: {
  preview: PreviewState;
  headers: string[];
  filename: string;
  result: ImportState;
  action: (formData: FormData) => void;
  pending: boolean;
  defaultOptIn: boolean;
}) {
  return (
    <form
      action={action}
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <input type="hidden" name="csvText" value={preview.csvText ?? ""} />
      <input type="hidden" name="filename" value={filename} />

      {result.error && <Alert>{result.error}</Alert>}

      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Match your columns
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          We found {preview.totalRows} rows. Check these are right.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number" htmlFor="col_phone" hint="required">
          <Select
            id="col_phone"
            name="col_phone"
            required
            defaultValue={preview.suggested?.phone ?? ""}
          >
            <option value="">Choose a column…</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>

        {(["name", "email", "tags"] as const).map((field) => (
          <Field
            key={field}
            label={field[0].toUpperCase() + field.slice(1)}
            htmlFor={`col_${field}`}
            hint="optional"
          >
            <Select
              id={`col_${field}`}
              name={`col_${field}`}
              defaultValue={preview.suggested?.[field] ?? ""}
            >
              <option value="">Do not import</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>

      {/*
        Above the sample rows, because the sample is what looks wrong and this
        is why. Without it somebody sees their address column holding a tag and
        has no way to tell whether the file is broken or the app is.
      */}
      {preview.structureWarning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/50">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Some lines in this file do not line up with its columns
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            {preview.structureWarning}
          </p>
        </div>
      )}

      {preview.sampleRows && preview.sampleRows.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            First few rows from your file
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    {headers.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-1.5 text-slate-600 dark:text-slate-400"
                      >
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Phone numbers will be converted to international format
            automatically.
          </p>
        </div>
      )}

      {/* Consent is a deliberate, separate decision — never a side effect of
          uploading a file. */}
      <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
        <input
          type="checkbox"
          name="optedIn"
          defaultChecked={defaultOptIn}
          className="mt-0.5 rounded border-slate-300"
        />
        <span className="text-sm text-amber-900 dark:text-amber-200">
          These contacts have agreed to receive marketing messages
          <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
            Only tick this if you genuinely have their consent. Leave it
            unticked and they can still receive order and account updates.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <Link href="/contacts/import">
          <Button type="button" variant="secondary">
            Start over
          </Button>
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import contacts"}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Step 4 — result
   ---------------------------------------------------------------------- */

function ResultStep({ result }: { result: ImportState }) {
  const stats = [
    { value: result.created, label: "new contacts", tone: "emerald" },
    { value: result.updated, label: "updated", tone: "blue" },
    { value: result.skipped, label: "duplicates in file", tone: "slate" },
    // Only shown when it happened, so an ordinary import is not cluttered by a
    // zero — but never hidden when it did, because "my file had 500 rows and
    // 497 imported" needs an answer.
    ...(result.skippedDeleted
      ? ([
          {
            value: result.skippedDeleted,
            label: "previously deleted, left alone",
            tone: "slate",
          },
        ] as const)
      : []),
    { value: result.errorCount, label: "rows with problems", tone: "amber" },
  ] as const;

  const toneClasses: Record<string, string> = {
    emerald:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    slate: "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        Import complete
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded-lg p-3 ${toneClasses[s.tone]}`}
          >
            <p className="text-xl font-semibold tabular-nums">{s.value ?? 0}</p>
            <p className="text-xs opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Every rejected row is listed. Nothing is dropped silently. */}
      {result.errors && result.errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900">
          <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Rows that were not imported
          </p>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {result.errors.map((e, i) => (
              <li key={i} className="px-3 py-2 text-sm">
                <span className="text-slate-400">Line {e.line}</span>{" "}
                <span className="text-slate-700 dark:text-slate-300">
                  {e.reason}
                </span>
                {e.rawPhone && (
                  <span className="ml-1 text-slate-400">
                    (&ldquo;{e.rawPhone}&rdquo;)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Link href="/contacts">
          <Button>View contacts</Button>
        </Link>
        <Link href="/contacts/import">
          <Button variant="secondary">Import another file</Button>
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Wizard
   ---------------------------------------------------------------------- */

export function ImportWizard({
  defaultOptIn = false,
}: {
  defaultOptIn?: boolean;
}) {
  const [preview, previewAction, previewPending] = useActionState<
    PreviewState,
    FormData
  >(previewCsv, {});
  const [result, importAction, importPending] = useActionState<
    ImportState,
    FormData
  >(runImport, {});
  const [filename, setFilename] = useState("");

  const headers = preview.headers ?? [];
  const step = result.done ? 4 : headers.length > 0 ? 2 : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <StepHeader step={1} current={step} label="Upload" />
        <span className="text-slate-300">→</span>
        <StepHeader step={2} current={step} label="Match columns" />
        <span className="text-slate-300">→</span>
        <StepHeader step={3} current={step} label="Review" />
        <span className="text-slate-300">→</span>
        <StepHeader step={4} current={step} label="Done" />
      </div>

      {result.done ? (
        <ResultStep result={result} />
      ) : headers.length > 0 ? (
        <MappingStep
          preview={preview}
          headers={headers}
          filename={filename}
          result={result}
          action={importAction}
          pending={importPending}
          defaultOptIn={defaultOptIn}
        />
      ) : (
        <UploadStep
          preview={preview}
          action={previewAction}
          pending={previewPending}
          onFilename={setFilename}
        />
      )}
    </div>
  );
}
