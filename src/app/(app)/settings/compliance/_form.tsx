"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatNumber } from "@/lib/utils";

import {
  optInExistingContacts,
  saveComplianceSettings,
  type BulkOptInState,
  type ComplianceState,
} from "./actions";

interface Initial {
  defaultOptIn: boolean;
  inboundOptIn: boolean;
  keywords: string;
  optedIn: number;
  unknown: number;
  optedOut: number;
}

export function ComplianceForm({ initial }: { initial: Initial }) {
  const [state, setState] = useState<ComplianceState>({});
  const [bulkState, setBulkState] = useState<BulkOptInState>({});
  const [isPending, startTransition] = useTransition();
  const [isBulkPending, startBulk] = useTransition();
  const [showBulk, setShowBulk] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Consent and compliance
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Who may receive marketing messages, and how people opt out.
        </p>
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

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Can receive marketing", value: initial.optedIn },
          { label: "Not confirmed", value: initial.unknown },
          { label: "Opted out", value: initial.optedOut },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
              {formatNumber(s.value)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      <form
        action={(formData) => {
          startTransition(async () => {
            setState(await saveComplianceSettings({}, formData));
          });
        }}
        className="space-y-5"
      >
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Default consent
          </h3>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input
              type="checkbox"
              name="defaultOptIn"
              defaultChecked={initial.defaultOptIn}
              className="mt-0.5 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              Tick the consent box automatically when adding or importing
              contacts
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                You can still untick it for any individual contact or import.
                Sensible when the people you add have already agreed — pilot
                sign-ups, customers who gave their number for updates.
              </span>
            </span>
          </label>

          {/* Kept separate from the setting above because it is a materially
              different claim about consent. */}
          <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <input
              type="checkbox"
              name="inboundOptIn"
              defaultChecked={initial.inboundOptIn}
              className="mt-0.5 rounded border-slate-300"
            />
            <span className="text-sm text-amber-900 dark:text-amber-200">
              Treat anyone who messages us as agreeing to marketing
              <span className="mt-0.5 block text-xs text-amber-800 dark:text-amber-300">
                This one carries real risk. Somebody asking &ldquo;do you
                deliver to Kondapur?&rdquo; would start receiving campaigns.
                That is the pattern that leads to blocks and reports, and a
                sustained drop in your quality rating reduces how many people
                WhatsApp lets you message each day.
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Opt-out keywords
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              When a customer sends one of these on its own, they stop
              receiving marketing immediately. Order and account updates still
              reach them.
            </p>
          </div>

          <Field label="Keywords" htmlFor="optOutKeywords" hint="comma separated">
            <Input
              id="optOutKeywords"
              name="optOutKeywords"
              defaultValue={initial.keywords}
              placeholder="STOP, UNSUBSCRIBE, REMOVE"
            />
            <p className="mt-1 text-xs text-slate-400">
              Matched against the whole message, so &ldquo;please don&rsquo;t
              stop sending offers&rdquo; does not opt someone out.
            </p>
          </Field>
        </section>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>

      {/* Applying consent retrospectively is a bigger decision than changing
          a default, so it is a separate, explicit action. */}
      {initial.unknown > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Existing contacts
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {formatNumber(initial.unknown)} contact
            {initial.unknown === 1 ? " has" : "s have"} no recorded consent, so
            marketing campaigns skip them. Changing the default above does not
            affect them.
          </p>

          {bulkState.success && (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              {bulkState.success}
            </p>
          )}
          {bulkState.error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {bulkState.error}
            </p>
          )}

          {showBulk ? (
            <form
              action={(formData) => {
                startBulk(async () => {
                  setBulkState(await optInExistingContacts({}, formData));
                  setShowBulk(false);
                });
              }}
              className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950"
            >
              <p className="text-sm text-amber-900 dark:text-amber-200">
                This marks all {formatNumber(initial.unknown)} of them as having
                agreed to marketing. Anyone who explicitly opted out is left
                alone.
              </p>
              <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                <input
                  type="checkbox"
                  name="confirm"
                  className="mt-0.5 rounded border-slate-300"
                />
                I confirm these people agreed to receive marketing from
                Uncanned.
              </label>

              <div className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" disabled={isBulkPending}>
                  {isBulkPending ? "Updating…" : "Mark all as opted in"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBulk(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setShowBulk(true)}
            >
              Mark them as opted in
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
