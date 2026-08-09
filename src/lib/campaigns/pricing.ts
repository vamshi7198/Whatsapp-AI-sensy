import type { TemplateCategory } from "@prisma/client";

import { prisma } from "../db";

/**
 * Cost estimation for a campaign.
 *
 * Rates live in the database, never in code, so a Meta price change is a
 * settings edit rather than a deployment. Rates are versioned by
 * effectiveFrom, so changing today's price does not rewrite the recorded cost
 * of past campaigns.
 *
 * Since 1 July 2025 Meta bills per delivered message by category and market.
 * Service messages — replies inside the 24-hour customer service window — are
 * free, which is why the inbox costs nothing to run.
 */

export interface CostEstimate {
  /** Null when no rate is configured, so the UI can say so rather than
   *  showing a confident zero. */
  totalCost: number | null;
  currency: string;
  ratePerMessage: number | null;
  recipientCount: number;
  category: TemplateCategory;
  /** True when the fallback "*" rate was used rather than a country rate. */
  usedFallbackRate: boolean;
}

/** ISO country from an E.164 number, by dialling-code prefix. */
function countryFromPhone(e164: string): string {
  const digits = e164.replace(/^\+/, "");

  // Only the codes that matter for Uncanned today. Everything else falls back
  // to the "*" rate, which is the honest answer rather than a guess.
  if (digits.startsWith("91")) return "IN";
  if (digits.startsWith("1")) return "US";
  if (digits.startsWith("44")) return "GB";
  if (digits.startsWith("971")) return "AE";
  if (digits.startsWith("65")) return "SG";
  if (digits.startsWith("61")) return "AU";

  return "*";
}

async function findRate(
  countryCode: string,
  category: TemplateCategory,
): Promise<{ rate: number; currency: string; fallback: boolean } | null> {
  const now = new Date();

  const where = {
    category,
    effectiveFrom: { lte: now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
  };

  const exact = await prisma.pricingRate.findFirst({
    where: { ...where, countryCode },
    orderBy: { effectiveFrom: "desc" },
  });

  if (exact) {
    return {
      rate: Number(exact.ratePerMessage),
      currency: exact.currency,
      fallback: false,
    };
  }

  const fallback = await prisma.pricingRate.findFirst({
    where: { ...where, countryCode: "*" },
    orderBy: { effectiveFrom: "desc" },
  });

  if (fallback) {
    return {
      rate: Number(fallback.ratePerMessage),
      currency: fallback.currency,
      fallback: true,
    };
  }

  return null;
}

/**
 * Estimates the cost of sending to a set of numbers.
 *
 * Grouped by country because rates differ sharply — an Indian marketing
 * message costs a fraction of a German one, and averaging them would be
 * misleading.
 */
export async function estimateCampaignCost(
  phoneNumbers: string[],
  category: TemplateCategory,
): Promise<CostEstimate> {
  const byCountry = new Map<string, number>();
  for (const phone of phoneNumbers) {
    const country = countryFromPhone(phone);
    byCountry.set(country, (byCountry.get(country) ?? 0) + 1);
  }

  let total = 0;
  let currency = "USD";
  let usedFallback = false;
  let anyRateFound = false;
  let singleRate: number | null = null;

  for (const [country, count] of byCountry) {
    const rate = await findRate(country, category);
    if (!rate) continue;

    anyRateFound = true;
    total += rate.rate * count;
    currency = rate.currency;
    if (rate.fallback) usedFallback = true;
    singleRate = byCountry.size === 1 ? rate.rate : null;
  }

  return {
    totalCost: anyRateFound ? total : null,
    currency,
    ratePerMessage: singleRate,
    recipientCount: phoneNumbers.length,
    category,
    usedFallbackRate: usedFallback,
  };
}

// formatCost lives in lib/utils.ts: this module imports Prisma, and a client
// component importing it would pull the database client into the browser.
