"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * What a page shows when something inside it throws.
 *
 * Without this file Next.js renders its own error screen — a stack trace in
 * development, and in production a bare "Application error: a server-side
 * exception has occurred" with a digest and no navigation. Either way the
 * person is stranded on a page with no way back into the app, and nothing tells
 * them whether their data is affected.
 *
 * Deliberately does not show the message. A thrown error can carry a query, a
 * phone number, or a fragment of a token, and this screen is reachable by
 * anyone using the app. The digest is enough to find the real error in the
 * server log, which is where the detail belongs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next.js has already logged this server-side; this covers the client half.
    console.error("Page error", error.digest ?? "", error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        Something went wrong on this page
      </h1>

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Nothing you have saved is affected. Try again, and if it keeps happening
        the reference below will help find the cause.
      </p>

      <div className="mt-6 flex items-center justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/"
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          Go to the dashboard
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-slate-400">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
