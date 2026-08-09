"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Refreshes the page while templates are awaiting Meta's decision.
 *
 * Meta pushes status changes to our webhook, so the database updates on its
 * own — but a server-rendered page will not show that until it is re-fetched.
 * This polls only while something is actually pending, and stops once
 * everything has been decided, so an idle Templates page costs nothing.
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

    const timer = setInterval(() => {
      router.refresh();
      // Called from a timer, not during render, so this is safe.
      setCheckedAt(new Date());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [pendingCount, intervalMs, router]);

  if (pendingCount === 0) return null;

  return (
    <p className="text-xs text-slate-400">
      Checking WhatsApp for approval updates automatically
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
