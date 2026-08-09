"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";

import {
  resolveCsvAudience,
  searchContactsForCampaign,
  type ContactSearchResult,
  type CsvAudienceResult,
} from "../actions";

/**
 * "Choose people yourself" — type-ahead search with a running selection.
 */
export function ManualContactPicker({
  selected,
  onChange,
}: {
  selected: ContactSearchResult[];
  onChange: (contacts: ContactSearchResult[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function runSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    startTransition(async () => {
      setResults(await searchContactsForCampaign(value));
      setSearched(true);
    });
  }

  function toggle(contact: ContactSearchResult) {
    onChange(
      selected.some((c) => c.id === contact.id)
        ? selected.filter((c) => c.id !== contact.id)
        : [...selected, contact],
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <Input
        type="search"
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        placeholder="Search by name or phone number"
        aria-label="Search contacts"
      />

      {isPending && (
        <p className="text-xs text-slate-400">Searching…</p>
      )}

      {searched && results.length === 0 && !isPending && (
        <p className="text-xs text-slate-400">
          Nobody matches that. Check the spelling, or add them under Contacts
          first.
        </p>
      )}

      {results.length > 0 && (
        <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {results.map((c) => {
            const isSelected = selected.some((s) => s.id === c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="rounded border-slate-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900 dark:text-slate-100">
                      {c.name || "Unnamed"}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {formatPhoneForDisplay(c.phoneE164)}
                    </span>
                  </span>
                  {!c.optedIn && (
                    <Badge tone="amber">no marketing consent</Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/50">
          <p className="mb-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            {selected.length} chosen
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selected.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c)}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white"
              >
                {c.name || formatPhoneForDisplay(c.phoneE164)}
                <span aria-hidden="true">×</span>
                <span className="sr-only">Remove</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Upload a list" — matches a CSV of phone numbers against existing contacts.
 *
 * It never creates contacts. An audience file is not a consent record, and
 * importing people from it would mean messaging someone whose opt-in nobody
 * established.
 */
export function CsvAudiencePicker({
  onResolved,
}: {
  onResolved: (contactIds: string[]) => void;
}) {
  const [result, setResult] = useState<CsvAudienceResult>({});
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-2 space-y-2">
      <form
        action={(formData) => {
          startTransition(async () => {
            const res = await resolveCsvAudience({}, formData);
            setResult(res);
            if (res.contactIds) onResolved(res.contactIds);
          });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="max-w-xs file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm dark:file:bg-slate-800"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
          {isPending ? "Reading…" : "Match contacts"}
        </Button>
      </form>

      <p className="text-xs text-slate-400">
        A column of phone numbers is enough. A full contact export works too —
        the first valid number in each row is used.
      </p>

      {result.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {result.error}
        </p>
      )}

      {result.matched !== undefined && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {result.matched} contact{result.matched === 1 ? "" : "s"} matched
          </p>

          {result.notFound! > 0 && (
            <>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                {result.notFound} number
                {result.notFound === 1 ? " is" : "s are"} not in your contacts
                and will not be messaged.
              </p>
              {result.notFoundSamples && result.notFoundSamples.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-400">
                  For example: {result.notFoundSamples.join(", ")}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Import them under Contacts first if you want to include them —
                that way their consent is recorded properly.
              </p>
            </>
          )}

          {result.invalid! > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              {result.invalid} row{result.invalid === 1 ? "" : "s"} had no
              readable phone number.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
