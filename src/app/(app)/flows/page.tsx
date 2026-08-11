import { requireAuth } from "@/lib/auth/guards";
import { FLOW_TEMPLATES } from "@/lib/flows/builder";
import { listFlows } from "@/lib/flows/service";
import { can } from "@/lib/rbac";

import { FlowManager } from "./_manager";

export const metadata = { title: "Forms" };

export default async function FlowsPage() {
  const user = await requireAuth("flow:view");
  const flows = await listFlows();

  return (
    <FlowManager
      canManage={can(user, "flow:manage")}
      flows={flows.map((f) => ({
        id: f.id,
        name: f.name,
        family: f.family,
        version: f.version,
        status: f.status,
        category: f.category,
        sends: f._count.sends,
        responses: f._count.responses,
        createdBy: f.createdBy?.name ?? null,
        createdAt: f.createdAt.toISOString(),
      }))}
      starters={Object.entries(FLOW_TEMPLATES).map(([key, t]) => ({
        key,
        label: t.label,
        category: t.category,
        definition: t.definition,
      }))}
    />
  );
}
