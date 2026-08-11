import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { listJourneys } from "@/lib/journeys/service";
import { can } from "@/lib/rbac";

import { JourneyList } from "./_list";

export const metadata = { title: "Journeys" };

export default async function JourneysPage() {
  const user = await requireAuth("journey:view");

  const journeys = await listJourneys();

  // How people are actually moving through each one. Counted per journey
  // rather than per version, since the operator thinks about the journey.
  const counts = await prisma.journeySession.groupBy({
    by: ["journeyId", "status"],
    _count: true,
  });

  const byJourney = new Map<string, Record<string, number>>();

  for (const row of counts) {
    const current = byJourney.get(row.journeyId) ?? {};
    current[row.status] = row._count;
    byJourney.set(row.journeyId, current);
  }

  return (
    <JourneyList
      canManage={can(user, "journey:manage")}
      journeys={journeys.map((j) => {
        const stats = byJourney.get(j.id) ?? {};
        const live = j.versions.find((v) => v.status === "PUBLISHED");
        const draft = j.versions.find((v) => v.status === "DRAFT");

        return {
          id: j.id,
          name: j.name,
          description: j.description,
          isLive: Boolean(live),
          liveVersion: live?.version ?? null,
          hasDraft: Boolean(draft),
          createdBy: j.createdBy?.name ?? null,
          total: j._count.sessions,
          waiting:
            (stats.WAITING_FOR_REPLY ?? 0) + (stats.WAITING_UNTIL ?? 0),
          completed: stats.COMPLETED ?? 0,
          failed: stats.FAILED ?? 0,
          handedOff: stats.HANDED_OFF ?? 0,
        };
      })}
    />
  );
}
