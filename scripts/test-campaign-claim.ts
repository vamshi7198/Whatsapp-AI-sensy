import "dotenv/config";

import { prisma } from "../src/lib/db";

/**
 * Proves the send loop still finds the people it is supposed to send to.
 *
 * sendCampaignBatch now claims recipients PENDING → QUEUED before sending, and
 * then re-reads only what the claim won. That is the right shape — it stops a
 * crash mid-send being re-sent ten minutes later as a duplicate — but it fails
 * in a direction worth testing: if the claim or the re-read is wrong, the batch
 * finds nobody and returns, and the campaign simply never sends. Silently.
 *
 * Runs the exact query sequence from the sender against the real database,
 * without a provider, so nothing is sent. Everything it creates is removed.
 *
 * Usage:  npx tsx scripts/test-campaign-claim.ts
 */

const MAX_ATTEMPTS = 5;

let failures = 0;

function check(name: string, passed: boolean, detail = "") {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function main() {
  console.log("\nCampaign recipient claim\n");

  const stamp = Date.now();

  const template = await prisma.template.findFirst({
    where: { status: "APPROVED" },
    select: { id: true, name: true, language: true, category: true },
  });

  if (!template) {
    console.log("  SKIP  no approved template to attach a campaign to.\n");
    return;
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: `zz-claim-${stamp}`,
      idempotencyKey: `zz-claim-${stamp}`,
      status: "QUEUED",
      templateId: template.id,
      templateName: template.name,
      templateLanguage: template.language,
      templateCategory: template.category,
      createdById: (await prisma.user.findFirst({ select: { id: true } }))!.id,
      audienceType: "SELECTED",
      audienceFilter: {},
      variableMapping: {},
      totalRecipients: 3,
      recipients: {
        createMany: {
          data: [
            { phoneE164: `+9999222${stamp.toString().slice(-6)}`, name: "A", variables: {} },
            { phoneE164: `+9999333${stamp.toString().slice(-6)}`, name: "B", variables: {} },
            // Already used every attempt: must NOT be picked up.
            {
              phoneE164: `+9999444${stamp.toString().slice(-6)}`,
              name: "C",
              variables: {},
              attemptCount: MAX_ATTEMPTS,
            },
          ],
        },
      },
    },
    select: { id: true },
  });

  try {
    /* --- exactly what sendCampaignBatch does --------------------------- */

    const candidates = await prisma.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        status: "PENDING",
        attemptCount: { lt: MAX_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true },
    });

    check(
      "the batch finds the sendable recipients",
      candidates.length === 2,
      `${candidates.length} of 2 (the third has used every attempt)`,
    );

    await prisma.campaignRecipient.updateMany({
      where: { id: { in: candidates.map((c) => c.id) }, status: "PENDING" },
      data: { status: "QUEUED" },
    });

    const claimed = await prisma.campaignRecipient.findMany({
      where: { id: { in: candidates.map((c) => c.id) }, status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });

    // The failure that would silently stop every campaign.
    check(
      "the re-read returns what the claim won",
      claimed.length === 2,
      `${claimed.length} claimed`,
    );

    check(
      "claimed recipients still carry what a send needs",
      claimed.every((r) => r.phoneE164 && r.variables !== null),
    );

    /* --- a second pass must not take the same people ------------------- */

    const second = await prisma.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        status: "PENDING",
        attemptCount: { lt: MAX_ATTEMPTS },
      },
      select: { id: true },
    });

    check(
      "an overlapping pass finds nobody already claimed",
      second.length === 0,
      `${second.length} left PENDING`,
    );

    /* --- a deferred retry is skipped until it is due ------------------- */

    await prisma.campaignRecipient.updateMany({
      where: { id: claimed[0].id },
      data: { status: "PENDING", nextAttemptAt: new Date(Date.now() + 60_000) },
    });

    const notYetDue = await prisma.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        status: "PENDING",
        attemptCount: { lt: MAX_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
    });

    check("a recipient waiting out a backoff is skipped", notYetDue.length === 0);

    await prisma.campaignRecipient.updateMany({
      where: { id: claimed[0].id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });

    const nowDue = await prisma.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        status: "PENDING",
        attemptCount: { lt: MAX_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
    });

    check("and picked up again once it is due", nowDue.length === 1);
  } finally {
    await prisma.campaign.delete({ where: { id: campaign.id } });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(
      failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
