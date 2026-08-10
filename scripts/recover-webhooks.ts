import "dotenv/config";

import { resumeStalledCampaigns } from "../src/lib/campaigns/sender";
import { prisma } from "../src/lib/db";
import { recoverUnprocessedEvents } from "../src/lib/webhooks/processor";

/**
 * Picks up work the app was in the middle of when it last stopped.
 *
 * Two things can be left half-done by a restart:
 *
 *  1. A webhook whose payload was stored but never applied. The route writes
 *     the raw event before answering Meta, so the message survives, but it
 *     would not reach the inbox on its own.
 *
 *  2. A campaign that was still sending. Sending runs inside the web process,
 *     so a restart leaves the campaign marked RUNNING with recipients still
 *     waiting and nothing alive to send them.
 *
 * Runs on every deploy and restart (see deploy/update.ps1). Safe to run at any
 * time and safe to run twice.
 */

async function recoverMessages() {
  const pendingBefore = await prisma.webhookEvent.count({
    where: { status: { in: ["RECEIVED", "PROCESSING"] } },
  });

  if (pendingBefore === 0) {
    console.log("Messages:  nothing waiting.");
    return;
  }

  console.log(
    `Found ${pendingBefore} received message${pendingBefore === 1 ? "" : "s"} that were never applied. Recovering...\n`,
  );

  const result = await recoverUnprocessedEvents();

  console.log(`  Recovered:  ${result.processed}`);
  if (result.failed > 0) {
    console.log(`  Failed:     ${result.failed}`);
    console.log(
      "\nFailed events are kept in the database, so nothing is lost.",
    );
    console.log("Their error is recorded against each event row.");
  }

  /* ------------------------------------------------------------------ */
  /* Warn about anything close to Meta's 7-day retry limit               */
  /* ------------------------------------------------------------------ */

  // Meta retries an undelivered webhook for up to 7 days and then discards it
  // permanently — there is no replay API and no way to fetch history later.
  // Anything already this old means the app has been unreachable for a while.
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

  const nearlyExpired = await prisma.webhookEvent.count({
    where: { receivedAt: { lt: sixDaysAgo }, status: "FAILED" },
  });

  if (nearlyExpired > 0) {
    console.log(
      `\nWarning: ${nearlyExpired} event(s) are more than 6 days old and still unprocessed.`,
    );
    console.log(
      "Meta stops retrying after 7 days. Investigate these before then.",
    );
  }
}

async function resumeCampaigns() {
  // Only campaigns that have gone quiet are restarted, so running this while
  // one is genuinely mid-send does not start a second sender for it.
  const resumed = await resumeStalledCampaigns();

  if (resumed.length === 0) {
    console.log("Campaigns: none were interrupted.");
    return;
  }

  console.log(
    `Campaigns: restarted ${resumed.length} that stopped part-way through.\n`,
  );

  for (const c of resumed) {
    console.log(`  ${c.name} — ${c.pending} left to send`);
  }
}

async function main() {
  console.log("Checking for unfinished work\n");

  await recoverMessages();
  await resumeCampaigns();

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
