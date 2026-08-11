import "dotenv/config";

import { runDueCampaigns } from "../src/lib/campaigns/sender";
import { prisma } from "../src/lib/db";
import { resumeDueSessions } from "../src/lib/journeys/engine";

/**
 * Starts campaigns whose scheduled time has arrived.
 *
 * Runs every few minutes from a Windows scheduled task (see
 * deploy/setup-scheduler.ps1) rather than from a timer inside the web process.
 * A timer dies with its process, so a campaign scheduled for 9am would
 * silently never send if the machine had restarted overnight — and nothing
 * would say so.
 *
 * A campaign whose time passed while the machine was off is sent late rather
 * than skipped. Late is recoverable; never sending is not.
 */

async function main() {
  /* --- Campaigns whose send time has arrived --------------------------- */

  const started = await runDueCampaigns();

  if (started.length === 0) {
    console.log("Campaigns: nothing due.");
  } else {
    console.log(
      `Campaigns: started ${started.length} scheduled campaign${started.length === 1 ? "" : "s"}:`,
    );

    for (const c of started) {
      const when = new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(c.scheduledAt);

      console.log(`  ${c.name} — ${c.recipients} recipients, due ${when}`);
    }
  }

  /* --- Journeys paused on a wait step ---------------------------------- */

  // A wait inside a journey needs something awake to end it. Nothing else on
  // this machine is, so it rides along with the campaign scheduler rather
  // than needing a second task to install and remember.
  const resumed = await resumeDueSessions();

  console.log(
    resumed === 0
      ? "Journeys:  nobody waiting."
      : `Journeys:  resumed ${resumed} conversation${resumed === 1 ? "" : "s"}.`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
