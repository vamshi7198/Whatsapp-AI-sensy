import type { TemplateCategory } from "@prisma/client";

import { prisma } from "../db";
import { moduleLogger } from "../logger";

/**
 * What messages cost.
 *
 * Rates live in the database, never in code, so a Meta price change is a
 * settings edit rather than a deployment. Rates are versioned by
 * effectiveFrom, so changing today's price does not rewrite the recorded cost
 * of past campaigns.
 *
 * Since 1 July 2025 Meta bills per delivered message by category and market.
 * Meta reports which category it billed under, but never an amount — no
 * webhook and no Graph API endpoint returns a currency figure. So spend is
 * always Meta's count multiplied by our own rate table, and the rates have to
 * be kept matching the invoice for the totals to be right.
 *
 * Two dates worth knowing, both from Meta:
 *  - Rates only change on quarter boundaries (1 Jan / Apr / Jul / Oct).
 *  - From 1 October 2026 Meta begins charging for service messages — inbox
 *    replies inside the 24-hour window — and for utility templates sent
 *    inside an open window. Both are free before then. Until Meta publishes
 *    those rates, such messages are reported as unpriced rather than guessed.
 */

const log = moduleLogger("pricing");

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
    // Flat rate only. Without this, adding a volume-tier row later would make
    // a single message pick up the high-volume price, because the ordering
    // below cannot tell the two kinds of row apart.
    tierMinVolume: null,
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
 * What Meta's billing category means for us.
 *
 * "free" and "unknown" are deliberately different. Free is a fact — Meta said
 * it charged nothing. Unknown means Meta used a category we do not have a rate
 * for, and recording that as free would quietly understate the bill with
 * nothing on screen to say so.
 */
type BillingOutcome =
  | { kind: "charged"; category: TemplateCategory }
  | { kind: "free" }
  | { kind: "unknown" };

function metaCategoryToOurs(category: string | null): BillingOutcome {
  switch (category?.toLowerCase()) {
    case "marketing":
      return { kind: "charged", category: "MARKETING" };
    case "utility":
      return { kind: "charged", category: "UTILITY" };
    case "authentication":
    // Meta's own reference spells this with a hyphen under pricing.category
    // and with an underscore under conversation.origin.type. Both are matched
    // because missing one would silently record the message as free.
    case "authentication-international":
    case "authentication_international":
      return { kind: "charged", category: "AUTHENTICATION" };

    // Referral conversions are not charged.
    case "referral_conversion":
      return { kind: "free" };

    // Service replies — the inbox — are free while Meta says so, and Meta says
    // so per message via the billable flag, which is checked before this runs.
    // Meta begins charging for them on 1 October 2026, and reaching here with
    // billable set means that has happened. Reported as unpriced rather than
    // guessed at, so the spend page says the total is short instead of being
    // quietly wrong.
    case "service":
    case "marketing_lite":
    default:
      return { kind: "unknown" };
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
  // billed, which is not always the template's own category.
  const outcome: BillingOutcome = message.pricingCategory
    ? metaCategoryToOurs(message.pricingCategory)
    : // No pricing block at all. Fall back to what we sent, which is right
      // for a campaign and unknowable for anything else.
      message.campaignRecipient
      ? {
          kind: "charged",
          category: message.campaignRecipient.campaign.templateCategory,
        }
      : { kind: "unknown" };

  if (outcome.kind === "free") {
    // Recorded as zero rather than left blank, so "cost nothing" stays
    // distinguishable from "not yet costed".
    await prisma.message.update({
      where: { id: messageId },
      data: { estimatedCost: 0 },
    });
    return;
  }

  // A category we have no rate for. Left unpriced deliberately — a zero here
  // would understate the bill with nothing on screen to say so, and the spend
  // page counts these and says the total is short.
  if (outcome.kind === "unknown") {
    log.warn(
      { messageId, category: message.pricingCategory },
      "WhatsApp billed a category we have no rate for — left unpriced",
    );
    return;
  }

  const rate = await findRate(
    countryFromPhone(message.contact.phoneE164),
    outcome.category,
  );

  // No rate configured for this country and category — also left unpriced,
  // for the same reason.
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
