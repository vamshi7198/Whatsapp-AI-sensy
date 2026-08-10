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

/* -------------------------------------------------------------------------- */
/* What a message actually cost                                                */
/* -------------------------------------------------------------------------- */

/**
 * Maps Meta's billing category to ours.
 *
 * Meta reports how it actually billed a message, which is not always the
 * template's own category — it re-categorises in some cases, and that is the
 * number that reaches the invoice. Returning null means Meta charged nothing:
 * a service reply inside the 24-hour window, or a free-tier message.
 */
function metaCategoryToOurs(category: string | null): TemplateCategory | null {
  switch (category?.toLowerCase()) {
    case "marketing":
      return "MARKETING";
    case "utility":
      return "UTILITY";
    case "authentication":
    case "authentication_international":
      return "AUTHENTICATION";
    // "service" and "referral_conversion" are not charged.
    default:
      return null;
  }
}

/**
 * Works out and stores what one message cost, once WhatsApp has delivered it.
 *
 * Meta bills per message delivered, and the delivery webhook says which
 * category it billed under — but never an amount. So the category comes from
 * Meta and the rate comes from our own table, which is the most accurate
 * figure obtainable through the API.
 *
 * Safe to call more than once: a message that already has a cost is left
 * alone, so a replayed webhook cannot inflate the campaign total.
 */
export async function recordMessageCost(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      estimatedCost: true,
      pricingCategory: true,
      billable: true,
      contact: { select: { phoneE164: true } },
      campaignRecipient: {
        select: { campaignId: true, campaign: { select: { templateCategory: true } } },
      },
    },
  });

  if (!message) return;

  // Already costed. Meta retries webhooks, so this is the guard that keeps a
  // replay from being counted twice.
  if (message.estimatedCost !== null) return;

  // Meta said explicitly that it is not charging for this one.
  if (message.billable === false) {
    await prisma.message.update({
      where: { id: messageId },
      data: { estimatedCost: 0 },
    });
    return;
  }

  // Meta's own category first: it reflects how the message was actually
  // billed. The campaign's template category is the fallback for a message
  // whose webhook arrived without a pricing block.
  const category =
    metaCategoryToOurs(message.pricingCategory) ??
    (message.pricingCategory
      ? null
      : (message.campaignRecipient?.campaign.templateCategory ?? null));

  if (category === null) {
    // A free message — a service reply inside the 24-hour window. Recorded as
    // zero rather than left blank, so "not yet costed" stays distinguishable
    // from "cost nothing".
    await prisma.message.update({
      where: { id: messageId },
      data: { estimatedCost: 0 },
    });
    return;
  }

  const rate = await findRate(countryFromPhone(message.contact.phoneE164), category);

  // No rate configured for this country and category. Left null deliberately:
  // a zero here would quietly understate the bill, and the spend page says
  // how many messages it could not price.
  if (!rate) return;

  await prisma.$transaction([
    prisma.message.update({
      where: { id: messageId },
      data: { estimatedCost: rate.rate },
    }),
    ...(message.campaignRecipient
      ? [
          prisma.campaign.update({
            where: { id: message.campaignRecipient.campaignId },
            data: {
              actualCost: { increment: rate.rate },
              currency: rate.currency,
            },
          }),
        ]
      : []),
  ]);
}

// formatCost lives in lib/utils.ts: this module imports Prisma, and a client
// component importing it would pull the database client into the browser.
