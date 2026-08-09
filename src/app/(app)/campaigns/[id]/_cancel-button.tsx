"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { cancelCampaignAction, type CancelState } from "../actions";

export function CancelButton({ campaignId }: { campaignId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<CancelState>({});
  const [isPending, startTransition] = useTransition();

  if (state.success) {
    return (
      <p className="max-w-sm text-xs text-slate-600 dark:text-slate-400">
        {state.success}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
        Stop sending
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Stated plainly: WhatsApp cannot recall a delivered message, and
          promising otherwise would be a lie the operator acts on. */}
      <span className="text-xs text-slate-600 dark:text-slate-400">
        Stop the remaining messages? Ones already sent cannot be recalled.
      </span>
      <Button
        variant="danger"
        size="sm"
        disabled={isPending}
        onClick={() => {
          const formData = new FormData();
          formData.set("id", campaignId);
          startTransition(async () => {
            setState(await cancelCampaignAction({}, formData));
            setConfirming(false);
          });
        }}
      >
        {isPending ? "Stopping…" : "Yes, stop"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep sending
      </Button>
      {state.error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </div>
  );
}
