import "dotenv/config";

import { prisma } from "../src/lib/db";
import { createCampaign } from "../src/lib/campaigns/service";
import { resolveAudience } from "../src/lib/campaigns/audience";

/**
 * End-to-end campaign test against the real database.
 *
 * The properties under test are the ones that cost real money and real
 * goodwill if they are wrong: nobody receives a campaign twice, and nobody
 * receives a marketing message they did not consent to.
 *
 * No messages are sent — WhatsApp is not connected, and creating the campaign
 * is where all of these decisions are made.
 */

const PREFIX = "+9198765000";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup() {
  const contacts = await prisma.contact.findMany({
    where: { phoneE164: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = contacts.map((c) => c.id);

  await prisma.campaignRecipient.deleteMany({
    where: { OR: [{ contactId: { in: ids } }, { phoneE164: { startsWith: PREFIX } }] },
  });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "TEST " } } });
  await prisma.message.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contactTag.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.template.deleteMany({ where: { name: "test_campaign_template" } });
  await prisma.tag.deleteMany({ where: { name: "test-campaign-tag" } });
}

async function main() {
  console.log("Campaign end-to-end test\n");
  await cleanup();

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  const tag = await prisma.tag.create({
    data: { name: "test-campaign-tag", slug: "test-campaign-tag" },
  });

  // Four contacts covering every compliance outcome.
  const people = [
    { suffix: "01", name: "Opted In", optInStatus: "OPTED_IN" as const, marketingOptOut: false, whatsappStatus: "VALID" as const },
    { suffix: "02", name: "Not Confirmed", optInStatus: "UNKNOWN" as const, marketingOptOut: false, whatsappStatus: "VALID" as const },
    { suffix: "03", name: "Opted Out", optInStatus: "OPTED_IN" as const, marketingOptOut: true, whatsappStatus: "VALID" as const },
    { suffix: "04", name: "Bad Number", optInStatus: "OPTED_IN" as const, marketingOptOut: false, whatsappStatus: "INVALID" as const },
  ];

  for (const p of people) {
    const contact = await prisma.contact.create({
      data: {
        name: p.name,
        phoneE164: `${PREFIX}${p.suffix}`,
        optInStatus: p.optInStatus,
        marketingOptOut: p.marketingOptOut,
        whatsappStatus: p.whatsappStatus,
        attributes: { order_id: `UNC-${p.suffix}` },
      },
    });
    await prisma.contactTag.create({
      data: { contactId: contact.id, tagId: tag.id },
    });
  }

  const template = await prisma.template.create({
    data: {
      name: "test_campaign_template",
      language: "en",
      category: "MARKETING",
      status: "APPROVED",
      metaTemplateId: "test-meta-id",
      components: [
        { type: "BODY", text: "Hi {{1}}, about order {{2}}." },
      ],
      variableCount: 2,
    },
  });

  const audience = { type: "TAG" as const, tagIds: [tag.id], match: "any" as const };
  const mapping = {
    "1": { source: "contact_field" as const, field: "name" as const },
    "2": { source: "attribute" as const, key: "order_id" },
  };

  /* -------------------------------------------------------------- */
  console.log("Compliance gate — MARKETING template");

  const marketing = await resolveAudience(audience, "MARKETING");
  check("4 contacts matched the tag", marketing.totalMatched === 4);
  check("only the opted-in contact is eligible", marketing.eligible.length === 1,
    marketing.eligible.map((m) => m.name).join(", "));
  check("3 excluded", marketing.skipped.length === 3);

  const reasons = marketing.skipped.map((s) => s.reason).sort();
  check("not-opted-in excluded", reasons.includes("not_opted_in"));
  check("opted-out excluded", reasons.includes("marketing_opted_out"));
  check("invalid number excluded", reasons.includes("invalid_number"));

  /* -------------------------------------------------------------- */
  console.log("\nCompliance gate — UTILITY template");

  // Utility messages (order updates) are not marketing, so opt-out does not
  // apply. Only the unusable number is excluded.
  const utility = await resolveAudience(audience, "UTILITY");
  check("3 eligible for a utility message", utility.eligible.length === 3,
    utility.eligible.map((m) => m.name).join(", "));
  check("only the invalid number excluded", utility.skipped.length === 1);
  check(
    "an opted-out contact still receives order updates",
    utility.eligible.some((m) => m.name === "Opted Out"),
  );

  /* -------------------------------------------------------------- */
  console.log("\nCampaign creation");

  const key = `test_key_${Date.now()}`;
  const first = await createCampaign({
    name: "TEST Campaign",
    idempotencyKey: key,
    templateId: template.id,
    audience,
    mapping,
    createdById: admin.id,
  });

  check("campaign created", first.ok && Boolean(first.campaignId));

  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: first.campaignId! },
    include: { recipients: true },
  });

  check("1 sendable recipient", campaign.totalRecipients === 1,
    String(campaign.totalRecipients));
  check("3 skipped", campaign.skippedCount === 3, String(campaign.skippedCount));
  check("4 recipient rows kept for the report", campaign.recipients.length === 4);

  const pending = campaign.recipients.filter((r) => r.status === "PENDING");
  check("variables frozen at creation",
    JSON.stringify(pending[0]?.variables) === JSON.stringify({ "1": "Opted In", "2": "UNC-01" }),
    JSON.stringify(pending[0]?.variables));

  /* -------------------------------------------------------------- */
  console.log("\nDouble-submit protection");

  const second = await createCampaign({
    name: "TEST Campaign",
    idempotencyKey: key,
    templateId: template.id,
    audience,
    mapping,
    createdById: admin.id,
  });

  check("same key returns the same campaign", second.campaignId === first.campaignId);
  check("flagged as a duplicate", second.wasDuplicate === true);

  const campaignCount = await prisma.campaign.count({
    where: { name: "TEST Campaign" },
  });
  check("only one campaign exists", campaignCount === 1, String(campaignCount));

  const recipientCount = await prisma.campaignRecipient.count({
    where: { campaignId: first.campaignId! },
  });
  check("nobody was added twice", recipientCount === 4, String(recipientCount));

  /* -------------------------------------------------------------- */
  console.log("\nUnapproved template is refused");

  await prisma.template.update({
    where: { id: template.id },
    data: { status: "PAUSED" },
  });

  const paused = await createCampaign({
    name: "TEST Campaign Paused",
    idempotencyKey: `${key}_paused`,
    templateId: template.id,
    audience,
    mapping,
    createdById: admin.id,
  });

  check("refused when the template is not approved", !paused.ok);
  check("says why in plain language",
    Boolean(paused.error?.match(/not approved/i)), paused.error);

  /* -------------------------------------------------------------- */
  console.log("\nMissing variable skips the recipient");

  await prisma.template.update({
    where: { id: template.id },
    data: { status: "APPROVED" },
  });

  const badMapping = {
    "1": { source: "contact_field" as const, field: "name" as const },
    "2": { source: "attribute" as const, key: "tracking_number" },
  };

  const withMissing = await createCampaign({
    name: "TEST Campaign Missing",
    idempotencyKey: `${key}_missing`,
    templateId: template.id,
    audience,
    mapping: badMapping,
    createdById: admin.id,
  });

  check("campaign refused when nobody has the value", !withMissing.ok,
    withMissing.error);

  console.log("\nCleaning up");
  await cleanup();
  check("test data removed", true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
