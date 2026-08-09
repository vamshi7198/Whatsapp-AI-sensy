import "dotenv/config";

import { prisma } from "../src/lib/db";
import { estimateCampaignCost } from "../src/lib/campaigns/pricing";
import { formatCost } from "../src/lib/utils";

/**
 * Prepares a safe first send: marks a single contact as opted in so a
 * marketing template can reach them, and reports what a campaign to that one
 * person would cost.
 *
 * Deliberately does not create or send anything. The first real send should
 * go through the wizard, with its preview and confirmation gate, exactly as a
 * real campaign would — otherwise the first thing tested is not the thing the
 * team will actually use.
 *
 * Usage: npx tsx scripts/prepare-test-send.ts <phone-e164>
 */
async function main() {
  const phone = process.argv[2];

  if (!phone) {
    console.error("Usage: npx tsx scripts/prepare-test-send.ts +919876543210");
    process.exit(1);
  }

  const contact = await prisma.contact.findUnique({
    where: { phoneE164: phone },
  });

  if (!contact) {
    console.error(`No contact found with ${phone}.`);
    console.error("Message the business number first, or add them in Contacts.");
    process.exit(1);
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      optInStatus: "OPTED_IN",
      optInAt: new Date(),
      optInSource: "internal_test",
      marketingOptOut: false,
    },
  });

  console.log(`Marked as opted in: ${contact.name ?? phone}`);
  console.log("  (recorded as internal_test, so the reason is auditable)");

  const marketing = await estimateCampaignCost([phone], "MARKETING");
  const utility = await estimateCampaignCost([phone], "UTILITY");

  console.log("\nCost of a one-person campaign:");
  console.log(
    `  Marketing: ${marketing.totalCost !== null ? formatCost(marketing.totalCost, marketing.currency) : "no rate set"}`,
  );
  console.log(
    `  Utility:   ${utility.totalCost !== null ? formatCost(utility.totalCost, utility.currency) : "no rate set"}`,
  );

  const eligible = await prisma.contact.count({
    where: { deletedAt: null, optInStatus: "OPTED_IN", marketingOptOut: false },
  });

  console.log(
    `\n${eligible} contact(s) can currently receive marketing messages.`,
  );

  if (eligible > 1) {
    console.log(
      "  More than one - make sure the campaign audience is set to just yourself.",
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
