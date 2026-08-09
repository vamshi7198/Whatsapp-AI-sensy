import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getMetaConfig, SETTING_KEYS, setSetting } from "../src/lib/settings";

/**
 * Reads everything WhatsApp Manager's Phone Numbers page shows, via the API.
 *
 * The daily messaging limit matters for campaign planning: it caps how many
 * *unique* people can be messaged in 24 hours, separately from throughput.
 * Sending to more than the tier allows means the remainder simply fails.
 */

interface PhoneNumber {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  status?: string;
  name_status?: string;
  code_verification_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
  is_official_business_account?: boolean;
}

const TIER_MEANING: Record<string, string> = {
  TIER_50: "50 unique customers per day",
  TIER_250: "250 unique customers per day",
  TIER_1K: "1,000 unique customers per day",
  TIER_10K: "10,000 unique customers per day",
  TIER_100K: "100,000 unique customers per day",
  TIER_UNLIMITED: "Unlimited",
};

const QUALITY_MEANING: Record<string, string> = {
  GREEN: "High - no action needed",
  YELLOW: "Medium - some customers have blocked or reported messages",
  RED: "Low - sending limits may be reduced if this continues",
  UNKNOWN: "Not enough messages sent yet to rate",
};

async function main() {
  const config = await getMetaConfig();

  if (!config) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  const fields = [
    "id",
    "display_phone_number",
    "verified_name",
    "quality_rating",
    "messaging_limit_tier",
    "status",
    "name_status",
    "code_verification_status",
    "platform_type",
    "throughput",
    "is_official_business_account",
  ].join(",");

  const url =
    `https://graph.facebook.com/${config.apiVersion}/${config.wabaId}/phone_numbers` +
    `?fields=${fields}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  const body = (await response.json()) as {
    data?: PhoneNumber[];
    error?: { message?: string };
  };

  if (body.error) {
    console.log(`Meta returned an error: ${body.error.message}`);
    await prisma.$disconnect();
    return;
  }

  const numbers = body.data ?? [];
  console.log(`${numbers.length} phone number(s) on this account\n`);

  for (const n of numbers) {
    console.log(`${n.display_phone_number ?? "unknown"}`);
    console.log(`  Display name:        ${n.verified_name ?? "-"}`);
    console.log(
      `  Name status:         ${n.name_status ?? "-"}${
        n.name_status === "APPROVED" ? "  (shows to customers)" : ""
      }`,
    );
    console.log(`  Connection status:   ${n.status ?? "-"}`);
    console.log(
      `  Verification:        ${n.code_verification_status ?? "-"}`,
    );

    const quality = n.quality_rating ?? "UNKNOWN";
    console.log(
      `  Quality rating:      ${quality}  - ${QUALITY_MEANING[quality] ?? ""}`,
    );

    const tier = n.messaging_limit_tier ?? "unknown";
    console.log(
      `  Daily limit:         ${tier}${
        TIER_MEANING[tier] ? `  - ${TIER_MEANING[tier]}` : ""
      }`,
    );

    console.log(`  Throughput:          ${n.throughput?.level ?? "-"}`);
    console.log(
      `  Official account:    ${n.is_official_business_account ? "yes" : "no"}`,
    );
    console.log("");

    // Cached so the dashboard can warn without calling Meta on every load.
    if (n.id === config.phoneNumberId) {
      if (n.quality_rating) {
        await setSetting(SETTING_KEYS.QUALITY_RATING, n.quality_rating);
      }
      if (n.messaging_limit_tier) {
        await setSetting(SETTING_KEYS.MESSAGING_TIER, n.messaging_limit_tier);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* What this means for campaign sizes                                */
  /* ---------------------------------------------------------------- */

  const active = numbers.find((n) => n.id === config.phoneNumberId);
  const tier = active?.messaging_limit_tier;

  if (tier && TIER_MEANING[tier]) {
    const cap = Number(
      tier.replace("TIER_", "").replace("K", "000").replace("UNLIMITED", "0"),
    );

    const eligible = await prisma.contact.count({
      where: { deletedAt: null, optInStatus: "OPTED_IN", marketingOptOut: false },
    });

    console.log("What this means for you");
    console.log(`  Contacts who can receive marketing: ${eligible}`);

    if (cap > 0 && eligible > cap) {
      console.log(
        `  A campaign to everyone would exceed the daily limit of ${cap}.`,
      );
      console.log("  Split it across days, or the remainder will fail.");
    } else {
      console.log("  Your audience fits within the daily limit.");
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
