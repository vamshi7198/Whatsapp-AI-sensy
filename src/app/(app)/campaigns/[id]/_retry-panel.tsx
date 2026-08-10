"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { RetryPreview } from "@/lib/campaigns/service";
import { formatNumber } from "@/lib/utils";

import { retryFailedAction, type RetryState } from "../actions";

/**
 * Resends a campaign to the people it could not reach.
 *
 * Every failure is offered for resend, whatever the cause: Meta bills on
 * delivery, so a message that failed cost nothing and costs nothing to try
 * again. The reasons are still broken down, because an operator who can see
 * that 60 of 100 failures are "not on WhatsApp" learns something about their
 * contact list that a bare count would hide.
 */
export function RetryPanel({
  campaignId,
  preview,
}: {
  campaignId: string;
  preview: RetryPreview;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<RetryState>({});
  const [isPending, startTransition] = useTransition();

  const { failedCount, permanentCount, reasons, previousRetries } = preview;

  if (state.campaignId) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
        <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
          {state.sending === undefined
            ? "That resend had already been started."
            : `Resending to ${formatNumber(state.sending)} ${state.sending === 1 ? "person" : "people"}.`}
        </p>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
          It runs as its own campaign so this report stays as a record of the
          first attempt.
        </p>
        <Button
          size="sm"
          className="mt-3"
          onClick={() => router.push(`/campaigns/${state.campaignId}`)}
        >
          Open the resend
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {formatNumber(failedCount)}{" "}
            {failedCount === 1 ? "message" : "messages"} did not get through
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            You can send to just these {failedCount === 1 ? "" : "people "}again.
            Everyone who already received it is left alone.
          </p>
        </div>

        {!confirming && !preview.blockedReason && (
          <Button size="sm" onClick={() => setConfirming(true)}>
            Resend to failed
          </Button>
        )}
      </div>

      {reasons.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3 dark:border-amber-900">
          {reasons.map((r) => (
            <li
              key={r.reason}
              className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-300"
            >
              <span className="min-w-10 font-semibold tabular-nums">
                {formatNumber(r.count)}
              </span>
              <span>{r.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Said once, quietly, as information rather than an obstacle. Failed
        messages are not billed, so there is no cost argument against trying —
        but a number that is not on WhatsApp will not be next week either, and
        the operator is better off fixing the contact than resending forever.
      */}
      {permanentCount > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          {formatNumber(permanentCount)} of these failed for a reason that is
          unlikely to change, such as the number not being on WhatsApp. Resending
          costs nothing — WhatsApp only charges for messages it delivers — but
          those are worth correcting in Contacts.
        </p>
      )}

      {previousRetries > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          You have already resent this campaign {previousRetries}{" "}
          {previousRetries === 1 ? "time" : "times"}.
        </p>
      )}

      {preview.blockedReason && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          {preview.blockedReason}
        </p>
      )}

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-200 pt-3 dark:border-amber-900">
          <span className="text-xs text-amber-900 dark:text-amber-300">
            Send this campaign again to {formatNumber(failedCount)}{" "}
            {failedCount === 1 ? "person" : "people"}?
          </span>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              const formData = new FormData();
              formData.set("id", campaignId);
              startTransition(async () => {
                setState(await retryFailedAction({}, formData));
                setConfirming(false);
              });
            }}
          >
            {isPending ? "Starting…" : "Yes, resend"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      )}

      {state.error && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </div>
  );
}
