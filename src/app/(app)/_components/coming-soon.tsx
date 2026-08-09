import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Placeholder for sections whose phase has not landed yet.
 *
 * Navigation links to these routes already, so without this the user hits a
 * 404 — which reads as a broken app rather than as unfinished work. It states
 * plainly what the screen will do and what it is waiting on.
 */
export function ComingSoon({
  title,
  phase,
  description,
  willDo,
  blockedBy,
}: {
  title: string;
  phase: string;
  description: string;
  willDo: string[];
  blockedBy?: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          Coming in {phase}
        </span>

        <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
          What this screen will do
        </h2>
        <ul className="mt-2 space-y-1.5">
          {willDo.map((item) => (
            <li
              key={item}
              className="flex gap-2 text-sm text-slate-600 dark:text-slate-400"
            >
              <span className="text-slate-300 dark:text-slate-600">•</span>
              {item}
            </li>
          ))}
        </ul>

        {blockedBy && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              <span className="font-medium">Waiting on:</span> {blockedBy}
            </p>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Link href="/contacts">
            <Button variant="secondary">Go to contacts</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
