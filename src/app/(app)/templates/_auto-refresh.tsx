"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { runTemplateSync } from "./actions";

/**
 * Keeps the page current while templates await Meta's decision.
 *
 * Asks META, not just our own database. Refreshing alone only re-read what we
 * already had, and that only changes when Meta pushes a status webhook — so
 * if that webhook never arrived, the page would poll forever and show the
 * same "waiting" indefinitely while Meta had long since decided.
 *
 * Polls only while something is pending, and stops once everything has been
 * decided, so an idle Templates page costs nothing.
 */
export function AutoRefreshWhilePending({
  pendingCount,
  intervalMs = 15_000,
}: {
  pendingCount: number;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (pendingCount === 0) return;

    let cancelled = false;

    const timer = setInterval(async () => {
      // Pull from Meta first, then re-render from what that wrote.
      await runTemplateSync().catch(() => undefined);
      if (cancelled) return;

      router.refresh();
      // Called from a timer, not during render, so this is safe.
      setCheckedAt(new Date());
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingCount, intervalMs, router]);

  if (pendingCount === 0) return null;

  return (
    <p className="text-xs text-slate-400">
      Asking WhatsApp for approval updates every 15 seconds
      {checkedAt &&
        ` · last checked ${new Intl.DateTimeFormat("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "Asia/Kolkata",
        }).format(checkedAt)}`}
    </p>
  );
}
