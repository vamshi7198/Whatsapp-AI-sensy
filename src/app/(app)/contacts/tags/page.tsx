import Link from "next/link";

import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

import { TagManager } from "./_manager";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  const user = await requireAuth("tag:view");

  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { contacts: true } },
    },
  });

  // How many journeys and automations depend on each tag. Deleting one that
  // something is using breaks it silently, so the count is shown before the
  // delete button rather than after the damage.
  const [journeySteps, automationActions] = await Promise.all([
    prisma.journeyStep.findMany({
      where: { type: { in: ["ADD_TAG", "REMOVE_TAG"] } },
      select: { config: true },
    }),
    prisma.automationAction.findMany({
      where: { type: { in: ["ADD_TAG", "REMOVE_TAG"] } },
      select: { tagId: true },
    }),
  ]);

  const usedBy = new Map<string, number>();

  for (const step of journeySteps) {
    const tagId = (step.config as { tagId?: string } | null)?.tagId;
    if (tagId) usedBy.set(tagId, (usedBy.get(tagId) ?? 0) + 1);
  }

  for (const action of automationActions) {
    if (action.tagId) {
      usedBy.set(action.tagId, (usedBy.get(action.tagId) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/contacts"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← Back to contacts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Tags
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Labels for grouping people — who took a sample, who asked about
          wholesale, who to send the next offer to.
        </p>
      </div>

      <TagManager
        canManage={can(user, "tag:manage")}
        tags={tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          contacts: tag._count.contacts,
          usedInAutomation: usedBy.get(tag.id) ?? 0,
        }))}
      />
    </div>
  );
}
