import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { PricingForm } from "./_form";

export const metadata = { title: "Message rates" };

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

export default async function PricingPage() {
  await requireAuth("settings:pricing");

  const now = new Date();

  const [current, history] = await Promise.all([
    prisma.pricingRate.findMany({
      where: {
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: [{ countryCode: "asc" }, { category: "asc" }],
    }),
    prisma.pricingRate.findMany({
      where: { effectiveTo: { not: null } },
      orderBy: { effectiveTo: "desc" },
      take: 20,
    }),
  ]);

  // How many delivered messages could not be priced. A silent gap here would
  // make the spend page look complete when it is understating the bill.
  const unpriced = await prisma.message.count({
    where: {
      direction: "OUTBOUND",
      status: { in: ["DELIVERED", "READ"] },
      estimatedCost: null,
    },
  });

  return (
    <PricingForm
      current={current.map((r) => ({
        id: r.id,
        countryCode: r.countryCode,
        category: r.category,
        currency: r.currency,
        ratePerMessage: Number(r.ratePerMessage),
        effectiveFrom: r.effectiveFrom.toISOString(),
        note: r.note,
      }))}
      history={history.map((r) => ({
        id: r.id,
        countryCode: r.countryCode,
        category: r.category,
        currency: r.currency,
        ratePerMessage: Number(r.ratePerMessage),
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
      }))}
      categories={[...CATEGORIES]}
      unpricedCount={unpriced}
    />
  );
}
