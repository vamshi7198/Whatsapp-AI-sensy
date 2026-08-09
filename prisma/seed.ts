import "dotenv/config";

import { hashPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/db";

/**
 * Seeds the minimum a fresh install needs to be usable:
 *  - one ADMIN account
 *  - the tags from the brief
 *  - default opt-out keywords and compliance settings
 *  - a starting pricing table (rates are DATA, editable in Settings — this is
 *    a starting point, never the source of truth)
 *
 * Everything is idempotent, so re-running never duplicates rows.
 */

const DEFAULT_TAGS = [
  { name: "pilot", color: "#3B82F6" },
  { name: "customer", color: "#10B981" },
  { name: "influencer", color: "#8B5CF6" },
  { name: "hyderabad", color: "#F59E0B" },
  { name: "bengaluru", color: "#F59E0B" },
  { name: "feedback_pending", color: "#EF4444" },
  { name: "feedback_completed", color: "#10B981" },
  { name: "shipping_pending", color: "#6366F1" },
];

/**
 * Starting pricing rows. Meta moved to per-message billing on 1 July 2025:
 * Marketing, Utility and Authentication are billed per delivered message by
 * category and market; Service messages are free inside the 24-hour customer
 * service window.
 *
 * These are approximate starting values for India and a global fallback, to be
 * corrected in Settings against your actual Meta invoices. They are seeded so
 * cost estimation has something to read, not because they are authoritative.
 */
const DEFAULT_PRICING = [
  { countryCode: "IN", category: "MARKETING" as const, ratePerMessage: "0.0099" },
  { countryCode: "IN", category: "UTILITY" as const, ratePerMessage: "0.0040" },
  { countryCode: "IN", category: "AUTHENTICATION" as const, ratePerMessage: "0.0035" },
  { countryCode: "*", category: "MARKETING" as const, ratePerMessage: "0.0250" },
  { countryCode: "*", category: "UTILITY" as const, ratePerMessage: "0.0100" },
  { countryCode: "*", category: "AUTHENTICATION" as const, ratePerMessage: "0.0100" },
];

const DEFAULT_SETTINGS: Array<{ key: string; value: string }> = [
  { key: "compliance.opt_out_keywords", value: "STOP,UNSUBSCRIBE,REMOVE" },
  // New contacts are NOT opted in by default. Consent is never inferred from a
  // phone number existing.
  { key: "compliance.default_opt_in", value: "false" },
  { key: "campaign.send_rate_mps", value: "20" },
  { key: "campaign.large_threshold", value: "500" },
  { key: "campaign.default_timezone", value: "Asia/Kolkata" },
  { key: "meta.api_version", value: "v23.0" },
  { key: "pricing.currency", value: "USD" },
];

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Uncanned Admin";

  if (!email || !password) {
    console.log(
      "  ! Skipping admin: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env",
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  = Admin already exists: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      isActive: true,
    },
  });

  console.log(`  + Admin created: ${email}`);
  console.log("    Change this password immediately after first login.");
}

async function seedTags() {
  for (const tag of DEFAULT_TAGS) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      update: {},
      create: {
        name: tag.name,
        slug: tag.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        color: tag.color,
      },
    });
  }
  console.log(`  + ${DEFAULT_TAGS.length} tags ready`);
}

async function seedPricing() {
  for (const rate of DEFAULT_PRICING) {
    const existing = await prisma.pricingRate.findFirst({
      where: {
        countryCode: rate.countryCode,
        category: rate.category,
        tierMinVolume: null,
        effectiveTo: null,
      },
    });

    if (existing) continue;

    await prisma.pricingRate.create({
      data: {
        countryCode: rate.countryCode,
        category: rate.category,
        currency: "USD",
        ratePerMessage: rate.ratePerMessage,
        note: "Seeded starting value — verify against your Meta invoices.",
      },
    });
  }
  console.log(`  + Pricing table ready (${DEFAULT_PRICING.length} rates)`);
}

async function seedSettings() {
  for (const setting of DEFAULT_SETTINGS) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value, isSecret: false },
    });
  }
  console.log(`  + ${DEFAULT_SETTINGS.length} default settings ready`);
}

async function main() {
  console.log("Seeding Uncanned WhatsApp...");
  await seedAdmin();
  await seedTags();
  await seedPricing();
  await seedSettings();
  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
