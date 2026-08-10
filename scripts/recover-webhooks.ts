import "dotenv/config";

import { prisma } from "../src/lib/db";
import { recoverUnprocessedEvents } from "../src/lib/webhooks/processor";

/**
 * Applies webhook events that were received and stored but never acted on.
 *
 * The webhook route writes the raw payload to the database before it answers
 * Meta, then applies it a moment later. If the machine loses power in that
 * gap, the payload survives but the message never reaches the inbox. This
 * closes that gap.
 *
 * Runs on every deploy and restart (see deploy/update.ps1). It is safe to run
 * at any time and safe to run twice — applying an event again lands on the
 * same result.
 */

async function main() {
  const pendingBefore = await prisma.webhookEvent.count({
    where: { status: { in: ["RECEIVED", "PROCESSING"] } },
  });

  if (pendingBefore === 0) {
    console.log("No unprocessed messages. Nothing to recover.");
    await prisma.$disconnect();
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

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
