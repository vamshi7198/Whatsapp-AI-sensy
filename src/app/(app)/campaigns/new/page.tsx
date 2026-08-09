import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { listTags } from "@/lib/contacts/service";
import { isMetaConnected } from "@/lib/settings";
import { listSendableTemplates } from "@/lib/templates/service";
import { getTemplateBody } from "@/lib/templates/service";
import { prisma } from "@/lib/db";

import { CampaignWizard } from "./_wizard";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  await requireAuth("campaign:create");

  const [templates, tags, connected, attributeKeys] = await Promise.all([
    listSendableTemplates(),
    listTags(),
    isMetaConnected(),
    getAttributeKeys(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/campaigns"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          New campaign
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Nothing is sent until you review who will receive it and confirm.
        </p>
      </div>

      {!connected ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected
          </p>
          <p className="mt-1 mb-3 text-sm text-amber-800 dark:text-amber-300">
            An administrator needs to connect your WhatsApp Business account
            before any campaign can be sent.
          </p>
          <Link href="/settings/whatsapp">
            <Button variant="secondary" size="sm">
              Go to settings
            </Button>
          </Link>
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            No approved templates
          </p>
          <p className="mt-1 mb-3 text-sm text-amber-800 dark:text-amber-300">
            WhatsApp requires an approved template before you can message people
            who have not written to you first. Sync your templates, or create one
            in WhatsApp Manager and wait for approval.
          </p>
          <Link href="/templates">
            <Button variant="secondary" size="sm">
              Go to templates
            </Button>
          </Link>
        </div>
      ) : (
        <CampaignWizard
          idempotencyKey={`cmp_${randomUUID()}`}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            variableCount: t.variableCount,
            body: getTemplateBody(t.components),
            components: t.components,
          }))}
          tags={tags.map((t) => ({
            id: t.id,
            name: t.name,
            contactCount: t.contactCount,
          }))}
          attributeKeys={attributeKeys}
        />
      )}
    </div>
  );
}

/**
 * Extra CSV columns available as template variables.
 *
 * Sampled from recent contacts rather than scanned across the whole table,
 * which would be a full sequential scan on every page load for a list that is
 * only a convenience.
 */
async function getAttributeKeys(): Promise<string[]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: { attributes: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  const keys = new Set<string>();
  for (const c of contacts) {
    if (c.attributes && typeof c.attributes === "object") {
      for (const key of Object.keys(c.attributes)) keys.add(key);
    }
  }

  return [...keys].sort();
}
