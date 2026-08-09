import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  getDefaultOptIn,
  getInboundOptIn,
  getOptOutKeywords,
} from "@/lib/settings";

import { ComplianceForm } from "./_form";

export const metadata = { title: "Consent and compliance" };

export default async function CompliancePage() {
  await requireAuth("settings:compliance");

  const [defaultOptIn, inboundOptIn, keywords, counts] = await Promise.all([
    getDefaultOptIn(),
    getInboundOptIn(),
    getOptOutKeywords(),
    prisma.contact.groupBy({
      by: ["optInStatus"],
      where: { deletedAt: null },
      _count: true,
    }),
  ]);

  const byStatus = Object.fromEntries(
    counts.map((c) => [c.optInStatus, c._count]),
  );

  const optedOut = await prisma.contact.count({
    where: { deletedAt: null, marketingOptOut: true },
  });

  return (
    <ComplianceForm
      initial={{
        defaultOptIn,
        inboundOptIn,
        keywords: keywords.join(", "),
        optedIn: byStatus.OPTED_IN ?? 0,
        unknown: byStatus.UNKNOWN ?? 0,
        optedOut,
      }}
    />
  );
}
