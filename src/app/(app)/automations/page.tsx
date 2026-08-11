import { requireAuth } from "@/lib/auth/guards";
import { getRecentRuns, listAutomations } from "@/lib/automations/service";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

import { AutomationManager } from "./_manager";

export const metadata = { title: "Automations" };

/** Plain description of what fires an automation. */
function describeTrigger(
  triggers: Array<{ type: string; config: unknown }>,
): string {
  const keyword = triggers.find((t) => t.type === "KEYWORD");

  if (keyword) {
    const config = (keyword.config ?? {}) as {
      keywords?: string[];
      matchType?: string;
    };
    const words = (config.keywords ?? []).join(", ");

    return config.matchType === "contains"
      ? `A message mentioning: ${words}`
      : `A message that is exactly: ${words}`;
  }

  return "Any message a customer sends";
}

export default async function AutomationsPage() {
  const user = await requireAuth("automation:view");

  const [automations, runs, templates] = await Promise.all([
    listAutomations(),
    getRecentRuns(20),
    prisma.template.findMany({
      // Only templates an automatic reply can actually send: approved, and
      // with no blanks, since there is no campaign behind it to fill them in.
      where: { status: "APPROVED", variableCount: 0 },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, language: true },
    }),
  ]);

  return (
    <AutomationManager
      canManage={can(user, "automation:manage")}
      automations={automations.map((a) => ({
        id: a.id,
        name: a.name,
        isActive: a.isActive,
        trigger: describeTrigger(a.triggers),
        replyKind:
          a.actions[0]?.type === "SEND_TEMPLATE"
            ? ("template" as const)
            : ("text" as const),
        replyText:
          a.actions[0]?.type === "SEND_TEMPLATE"
            ? (a.actions[0]?.template?.name ?? "a template that was deleted")
            : ((a.actions[0]?.config as { body?: string } | null)?.body ?? ""),
        runCount: a.runCount,
        lastRunAt: a.lastRunAt?.toISOString() ?? null,
        createdBy: a.createdBy?.name ?? null,
      }))}
      runs={runs.map((r) => ({
        id: r.id,
        automationName: r.automation.name,
        contactName: r.contact?.name ?? r.contact?.phoneE164 ?? "Unknown",
        status: r.status,
        error: r.error,
        at: r.createdAt.toISOString(),
      }))}
      templates={templates}
    />
  );
}
