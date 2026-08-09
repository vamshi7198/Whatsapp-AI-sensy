import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { isMetaConnected } from "@/lib/settings";

import { TemplateComposer } from "./_composer";

export const metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requireAuth("template:create");
  const connected = await isMetaConnected();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/templates"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to templates
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          New template
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          WhatsApp reviews every template before it can be sent. This usually
          takes a few minutes.
        </p>
      </div>

      {!connected ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected
          </p>
          <p className="mt-1 mb-3 text-sm text-amber-800 dark:text-amber-300">
            Templates are submitted to WhatsApp for approval, so the connection
            must be set up first.
          </p>
          <Link href="/settings/whatsapp">
            <Button variant="secondary" size="sm">
              Go to settings
            </Button>
          </Link>
        </div>
      ) : (
        <TemplateComposer />
      )}
    </div>
  );
}
