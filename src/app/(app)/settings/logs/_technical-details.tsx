"use client";

import { useState } from "react";

/**
 * Hides raw payloads and error codes behind a click.
 *
 * The plain-English explanation is always visible; this is the escape hatch
 * for whoever has to work out what actually happened. Administrators only —
 * the page itself is already gated on logs:view.
 */
export function TechnicalDetails({ data }: { data: string }) {
  const [open, setOpen] = useState(false);

  if (!data) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
      >
        {open ? "Hide technical details" : "View technical details"}
      </button>

      {open && (
        <pre className="mt-1 max-h-64 max-w-lg overflow-auto rounded-lg bg-slate-100 p-2 text-[11px] whitespace-pre-wrap text-slate-700 dark:bg-slate-950 dark:text-slate-300">
          {data}
        </pre>
      )}
    </div>
  );
}
