import Link from "next/link";

import { requireAuth } from "@/lib/auth/guards";

import { ImportWizard } from "./_wizard";

export const metadata = { title: "Import contacts" };

export default async function ImportPage() {
  await requireAuth("contact:import");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/contacts"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to contacts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Import contacts
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload a CSV file. Nothing is imported until you have reviewed what
          will happen.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
