import type { Prisma } from "@prisma/client";

import { prisma } from "../db";

/**
 * What has actually been spent on WhatsApp messages.
 *
 * Every figure here is built from messages WhatsApp confirmed it delivered,
 * priced at the rate in force when they were sent. Meta's API reports the
 * category it billed under but never an amount, so this is the closest thing
 * to a bill the platform can produce — and it will match the Meta invoice
 * exactly as long as the rates in Settings match it.
 *
 * Messages with no configured rate are counted separately rather than treated
 * as free, because a total that quietly omits them reads as complete when it
 * is not.
 */

export interface SpendTotals {
  currency: string;
  total: number;
  messages: number;
  /** Delivered messages that no rate covered, so are missing from the total. */
  unpriced: number;
  /** Delivered and confirmed free by WhatsApp, e.g. a service reply. */
  free: number;
}

export interface CampaignSpend {
  id: string;
  name: string;
  templateCategory: string;
  createdAt: Date;
  delivered: number;
  cost: number;
  currency: string;
  isRetry: boolean;
}

export interface MonthlySpend {
  month: string;
  total: number;
  messages: number;
}

export interface CategorySpend {
  category: string;
  total: number;
  messages: number;
}

/**
 * Turns a window in days into a cutoff date.
 *
 * Lives here rather than in the page because reading the clock during render
 * is not allowed — the same render must produce the same result.
 */
function cutoff(days?: number): Date | undefined {
  if (!days) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** The currency to present in, taken from the rates actually in use. */
async function activeCurrency(): Promise<string> {
  const rate = await prisma.pricingRate.findFirst({
    where: { effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
    select: { currency: true },
  });

  return rate?.currency ?? "INR";
}

/** Delivered outbound messages — the ones WhatsApp charges for. */
function deliveredWhere(days?: number): Prisma.MessageWhereInput {
  const since = cutoff(days);

  return {
    direction: "OUTBOUND",
    status: { in: ["DELIVERED", "READ"] },
    ...(since ? { createdAt: { gte: since } } : {}),
  };
}

export async function getSpendTotals(days?: number): Promise<SpendTotals> {
  const where = deliveredWhere(days);

  const [priced, pricedCount, unpriced, free, currency] = await Promise.all([
    prisma.message.aggregate({
      where: { ...where, estimatedCost: { gt: 0 } },
      _sum: { estimatedCost: true },
    }),
    prisma.message.count({ where: { ...where, estimatedCost: { gt: 0 } } }),
    prisma.message.count({ where: { ...where, estimatedCost: null } }),
    prisma.message.count({ where: { ...where, estimatedCost: 0 } }),
    activeCurrency(),
  ]);

  return {
    currency,
    total: Number(priced._sum?.estimatedCost ?? 0),
    messages: pricedCount,
    unpriced,
    free,
  };
}

/** Spend per campaign, most expensive first. */
export async function getSpendByCampaign(
  limit = 50,
  days?: number,
): Promise<CampaignSpend[]> {
  const since = cutoff(days);

  const campaigns = await prisma.campaign.findMany({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_FAILED", "FAILED", "RUNNING"] },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      templateCategory: true,
      createdAt: true,
      deliveredCount: true,
      actualCost: true,
      currency: true,
      retryOfCampaignId: true,
    },
  });

  return campaigns
    .map((c) => ({
      id: c.id,
      name: c.name,
      templateCategory: c.templateCategory,
      createdAt: c.createdAt,
      delivered: c.deliveredCount,
      cost: Number(c.actualCost ?? 0),
      currency: c.currency ?? "INR",
      isRetry: c.retryOfCampaignId !== null,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Spend per calendar month.
 *
 * Grouped in SQL rather than in JavaScript: pulling every message row into
 * memory to add them up would not survive the first busy month.
 */
export async function getSpendByMonth(months = 12): Promise<MonthlySpend[]> {
  const rows = await prisma.$queryRaw<
    Array<{ month: Date; total: number | null; messages: bigint }>
  >`
    SELECT
      date_trunc('month', "createdAt" AT TIME ZONE 'Asia/Kolkata') AS month,
      SUM("estimatedCost")                                          AS total,
      COUNT(*)                                                      AS messages
    FROM "Message"
    WHERE "direction" = 'OUTBOUND'
      AND "status" IN ('DELIVERED', 'READ')
      AND "estimatedCost" IS NOT NULL
      AND "estimatedCost" > 0
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${months}
  `;

  return rows.map((r) => ({
    month: new Intl.DateTimeFormat("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(r.month),
    total: Number(r.total ?? 0),
    messages: Number(r.messages),
  }));
}

/** Spend split by what WhatsApp charged it as. */
export async function getSpendByCategory(
  days?: number,
): Promise<CategorySpend[]> {
  const rows = await prisma.message.groupBy({
    by: ["pricingCategory"],
    where: { ...deliveredWhere(days), estimatedCost: { gt: 0 } },
    _sum: { estimatedCost: true },
    _count: true,
  });

  return rows
    .map((r) => ({
      // Meta did not say, so it was priced from the campaign's own template
      // category instead.
      category: r.pricingCategory ?? "Not reported by WhatsApp",
      total: Number(r._sum.estimatedCost ?? 0),
      messages: r._count,
    }))
    .sort((a, b) => b.total - a.total);
}
