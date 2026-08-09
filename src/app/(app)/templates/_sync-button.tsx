"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { runTemplateSync, type SyncState } from "./actions";

export function SyncButton({ disabled }: { disabled: boolean }) {
  const [state, setState] = useState<SyncState>({});
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        disabled={disabled || isPending}
        title={
          disabled ? "Connect WhatsApp in Settings first" : undefined
        }
        onClick={() =>
          startTransition(async () => setState(await runTemplateSync()))
        }
      >
        {isPending ? "Syncing…" : "Sync from WhatsApp"}
      </Button>

      {state.error && (
        <p
          role="alert"
          className="max-w-xs text-right text-xs text-red-600 dark:text-red-400"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="max-w-xs text-right text-xs text-emerald-600 dark:text-emerald-400">
          {state.success}
        </p>
      )}
    </div>
  );
}
