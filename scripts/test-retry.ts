import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  createRetryCampaign,
  getRetryPreview,
} from "../src/lib/campaigns/service";

/**
 * End-to-end test of resending to a campaign's failed recipients.
 *
 * The properties under test are the ones that cost real money or real goodwill
 * if they are wrong:
 *   - Someone who already received the message is never sent it again.
 *   - A send whose outcome is unknown is never retried, because it may have
 *     arrived.
 *   - Someone deliberately skipped stays skipped.
 *   - Two clicks produce one resend, not two.
 *
 * No messages are sent. Every decision under test is made at creation time.
 */

const PREFIX = "+9198765111";
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

  await prisma.message.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.campaignRecipient.deleteMany({
    where: { phoneE164: { startsWith: PREFIX } },
  });
  // Children first: a retry points at its parent.
  await prisma.campaign.deleteMany({
    where: { name: { startsWith: "RETRYTEST " }, retryOfCampaignId: { not: null } },
  });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "RETRYTEST " } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.template.deleteMany({ where: { name: "test_retry_template" } });
}

async function main() {
  console.log("Campaign resend test\n");
  await cleanup();

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  const template = await prisma.template.create({
    data: {
      name: "test_retry_template",
      language: "en",
      category: "MARKETING",
      status: "APPROVED",
      components: [
        { type: "BODY", text: "Hello {{1}}" },
      ] as never,
    },
  });

  /* ------------------------------------------------------------------ */
  /* One campaign covering every recipient outcome                       */
  /* ------------------------------------------------------------------ */

  const people = [
    { suffix: "01", name: "Delivered Fine", status: "SENT" as const, recon: false, errorCode: null },
    { suffix: "02", name: "Rate Limited", status: "FAILED" as const, recon: false, errorCode: "130429" },
    { suffix: "03", name: "Not On WhatsApp", status: "FAILED" as const, recon: false, errorCode: "131026" },
    { suffix: "04", name: "Opted Out Skip", status: "SKIPPED" as const, recon: false, errorCode: null },
    { suffix: "05", name: "Outcome Unknown", status: "SENT" as const, recon: true, errorCode: null },
  ];

  const campaign = await prisma.campaign.create({
    data: {
      name: "RETRYTEST original",
      idempotencyKey: `retrytest-${Date.now()}`,
      status: "PARTIALLY_FAILED",
      templateId: template.id,
      templateName: template.name,
      templateLanguage: "en",
      templateCategory: "MARKETING",
      audienceType: "ALL_CONTACTS",
      audienceFilter: { type: "ALL_CONTACTS" },
      variableMapping: {},
      totalRecipients: people.length,
      failedCount: 2,
      createdById: admin.id,
    },
  });

  for (const p of people) {
    const contact = await prisma.contact.create({
      data: {
        name: p.name,
        phoneE164: `${PREFIX}${p.suffix}`,
        optInStatus: "OPTED_IN",
        marketingOptOut: false,
        whatsappStatus: "VALID",
      },
    });

    const recipient = await prisma.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        name: p.name,
        variables: { "1": p.name },
        status: p.status,
        needsReconciliation: p.recon,
        skipReason: p.status === "SKIPPED" ? "marketing_opted_out" : null,
      },
    });

    if (p.errorCode) {
      await prisma.message.create({
        data: {
          direction: "OUTBOUND",
          contactId: contact.id,
          campaignRecipientId: recipient.id,
          type: "template",
          payload: {},
          status: "FAILED",
          errorCode: p.errorCode,
          errorUserMessage:
            p.errorCode === "131026"
              ? "This number is not registered on WhatsApp, so the message could not be delivered."
              : "Too many messages sent too quickly.",
        },
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* The preview                                                         */
  /* ------------------------------------------------------------------ */

  console.log("Preview\n");
  const preview = await getRetryPreview(campaign.id);

  check("counts both failures", preview.failedCount === 2, `got ${preview.failedCount}`);
  check(
    "identifies the permanent one",
    preview.permanentCount === 1,
    `got ${preview.permanentCount}`,
  );
  check("groups by reason", preview.reasons.length === 2, `got ${preview.reasons.length}`);
  check("nothing blocking", preview.blockedReason === undefined, preview.blockedReason ?? "");

  /* ------------------------------------------------------------------ */
  /* The resend                                                          */
  /* ------------------------------------------------------------------ */

  console.log("\nResend\n");
  const result = await createRetryCampaign(campaign.id, admin.id);
  check("resend created", result.ok && Boolean(result.campaignId), result.error ?? "");

  if (!result.campaignId) {
    console.log("\nCannot continue without a resend campaign.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const copied = await prisma.campaignRecipient.findMany({
    where: { campaignId: result.campaignId },
    select: { phoneE164: true, name: true, status: true, variables: true },
    orderBy: { phoneE164: "asc" },
  });

  const copiedPhones = copied.map((r) => r.phoneE164);

  check("copies exactly the two failures", copied.length === 2, `got ${copied.length}`);
  check(
    "includes the temporary failure",
    copiedPhones.includes(`${PREFIX}02`),
  );
  check(
    "includes the permanent failure too (Meta does not bill failures)",
    copiedPhones.includes(`${PREFIX}03`),
  );
  check(
    "does NOT resend to someone who received it",
    !copiedPhones.includes(`${PREFIX}01`),
  );
  check(
    "does NOT resend to a skipped contact",
    !copiedPhones.includes(`${PREFIX}04`),
  );
  check(
    "does NOT resend where the outcome was unknown",
    !copiedPhones.includes(`${PREFIX}05`),
  );
  check(
    "freezes the original variables",
    copied.every((r) => (r.variables as Record<string, string>)["1"] === r.name),
  );
  check("all queued to send", copied.every((r) => r.status === "PENDING"));

  const retry = await prisma.campaign.findUniqueOrThrow({
    where: { id: result.campaignId },
    select: {
      retryOfCampaignId: true,
      totalRecipients: true,
      templateName: true,
      status: true,
    },
  });

  check("links back to the original", retry.retryOfCampaignId === campaign.id);
  check("counts only the copied recipients", retry.totalRecipients === 2);
  check("reuses the same template", retry.templateName === template.name);

  /* ------------------------------------------------------------------ */
  /* Clicking twice                                                      */
  /* ------------------------------------------------------------------ */

  console.log("\nClicking twice\n");

  const [a, b] = await Promise.all([
    createRetryCampaign(campaign.id, admin.id),
    createRetryCampaign(campaign.id, admin.id),
  ]);

  check(
    "two simultaneous clicks resolve to one campaign",
    a.campaignId === b.campaignId,
    `${a.campaignId} vs ${b.campaignId}`,
  );

  const totalRetries = await prisma.campaign.count({
    where: { retryOfCampaignId: campaign.id },
  });

  // The first resend, plus one from the pair of simultaneous clicks.
  check("only two resends exist in total", totalRetries === 2, `got ${totalRetries}`);

  /* ------------------------------------------------------------------ */
  /* Refusing while still sending                                        */
  /* ------------------------------------------------------------------ */

  console.log("\nWhile still sending\n");

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING" },
  });

  const running = await createRetryCampaign(campaign.id, admin.id);
  check("refuses while the campaign is still sending", !running.ok, running.error ?? "");

  const runningPreview = await getRetryPreview(campaign.id);
  check(
    "preview explains why",
    Boolean(runningPreview.blockedReason),
    runningPreview.blockedReason ?? "",
  );

  /* ------------------------------------------------------------------ */

  console.log("");
  await cleanup();

  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("All checks passed.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
