"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { formatNumber } from "@/lib/utils";

import { saveRate, type PricingState } from "./actions";

interface Rate {
  id: string;
  countryCode: string;
  category: string;
  currency: string;
  ratePerMessage: number;
  effectiveFrom: string;
  note?: string | null;
}

interface HistoricRate extends Rate {
  effectiveTo: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  AUTHENTICATION: "Authentication",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function countryLabel(code: string): string {
  if (code === "*") return "Everywhere else";
  if (code === "IN") return "India";
  return code;
}

export function PricingForm({
  current,
  history,
  categories,
  unpricedCount,
}: {
  current: Rate[];
  history: HistoricRate[];
  categories: string[];
  unpricedCount: number;
}) {
  const [state, setState] = useState<PricingState>({});
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{
    countryCode: string;
    category: string;
  } | null>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      setState(await saveRate({}, formData));
      setEditing(null);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Message rates
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          What WhatsApp charges you per message. Used to work out what each
          campaign cost.
        </p>
      </div>

      {/*
        Said plainly because it is the single most important caveat on every
        cost figure in this app: Meta's API reports which category it billed a
        message under, but never the amount. The rates below are what turn that
        into money.
      */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        WhatsApp tells us which messages it charged for, but not the price. Copy
        the rates from your Meta invoice here and every cost in this app will
        match your bill.
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

      {unpricedCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {formatNumber(unpricedCount)} delivered message
          {unpricedCount === 1 ? " has" : "s have"} no rate to price
          {unpricedCount === 1 ? " it" : " them"}, so your spend total is lower
          than your real bill. Add the missing rate below.
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Current rates                                                     */}
      {/* ---------------------------------------------------------------- */}

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Rates in use now
          </h3>
        </div>

        {current.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            No rates set yet. Add your India rates below and campaign costs
            start appearing.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Where</th>
                  <th className="px-4 py-2.5 font-medium">Message type</th>
                  <th className="px-4 py-2.5 font-medium">Per message</th>
                  <th className="px-4 py-2.5 font-medium">In use since</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {current.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">
                      {countryLabel(r.countryCode)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {CATEGORY_LABELS[r.category] ?? r.category}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-900 dark:text-slate-100">
                      {r.currency} {r.ratePerMessage.toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {formatDate(r.effectiveFrom)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            countryCode: r.countryCode,
                            category: r.category,
                          })
                        }
                      >
                        Change
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Add or change                                                     */}
      {/* ---------------------------------------------------------------- */}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {editing ? "Change a rate" : "Add a rate"}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Changing a rate applies from today onwards. Campaigns already sent
          keep the price they were billed at.
        </p>

        <form action={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Where" htmlFor="countryCode">
            <Select
              id="countryCode"
              name="countryCode"
              defaultValue={editing?.countryCode ?? "IN"}
            >
              <option value="IN">India</option>
              <option value="*">Everywhere else</option>
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
              <option value="AE">United Arab Emirates</option>
              <option value="SG">Singapore</option>
              <option value="AU">Australia</option>
            </Select>
          </Field>

          <Field label="Message type" htmlFor="category">
            <Select
              id="category"
              name="category"
              defaultValue={editing?.category ?? "MARKETING"}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c] ?? c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Currency" htmlFor="currency">
            <Select id="currency" name="currency" defaultValue="INR">
              <option value="INR">INR — Indian Rupees</option>
              <option value="USD">USD — US Dollars</option>
            </Select>
          </Field>

          <Field
            label="Price per message"
            htmlFor="ratePerMessage"
            hint="Copy this from your Meta invoice. Four decimal places is fine."
          >
            <Input
              id="ratePerMessage"
              name="ratePerMessage"
              type="text"
              inputMode="decimal"
              placeholder="0.7846"
              required
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Note (optional)"
              htmlFor="note"
              hint="For example: from the July 2026 invoice."
            >
              <Input id="note" name="note" type="text" maxLength={200} />
            </Field>
          </div>

          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save rate"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Previous rates                                                    */}
      {/* ---------------------------------------------------------------- */}

      {history.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Previous rates
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Kept so past campaigns still show what they actually cost.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {history.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                      {countryLabel(r.countryCode)} ·{" "}
                      {CATEGORY_LABELS[r.category] ?? r.category}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-400">
                      {r.currency} {r.ratePerMessage.toFixed(4)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatDate(r.effectiveFrom)} to {formatDate(r.effectiveTo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
