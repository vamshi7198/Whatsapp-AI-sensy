import "dotenv/config";

import {
  resumeStalledCampaigns,
  runDueCampaigns,
} from "../src/lib/campaigns/sender";
import { prisma } from "../src/lib/db";
import { resumeDueSessions } from "../src/lib/journeys/engine";
import { SETTING_KEYS, setSetting } from "../src/lib/settings";
import {
  pruneWebhookEvents,
  recoverUnprocessedEvents,
} from "../src/lib/webhooks/processor";

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
  /* --- Anything left half-done by a restart ---------------------------- */

  // Runs first, and every few minutes rather than only on deploy. A message
  // stored but never applied, or a campaign interrupted mid-send, would
  // otherwise wait for someone to notice and redeploy — which during a
  // months-long unattended run means it waits forever.
  const recovered = await recoverUnprocessedEvents();

  if (recovered.processed > 0 || recovered.failed > 0) {
    console.log(
      `Recovered:  ${recovered.processed} message(s) applied` +
        (recovered.failed > 0 ? `, ${recovered.failed} failed` : ""),
    );
  }

  const resumedCampaigns = await resumeStalledCampaigns();

  if (resumedCampaigns.length > 0) {
    console.log(
      `Resumed:    ${resumedCampaigns.length} campaign(s) interrupted part-way`,
    );
  }

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

  /* --- Housekeeping ----------------------------------------------------- */

  // Once a day is plenty, and doing it on every five-minute pass would be a
  // pointless delete against a growing table.
  if (new Date().getHours() === 3) {
    const pruned = await pruneWebhookEvents();
    if (pruned > 0) console.log(`Tidied:     removed ${pruned} old event(s).`);
  }

  /* --- Say that this ran ----------------------------------------------- */

  // Written last, so it means "a whole pass completed" rather than "a pass
  // started". /api/health reads it, and it is the only thing that reveals a
  // dead scheduler — every page keeps working perfectly without one.
  await setSetting(SETTING_KEYS.SCHEDULER_LAST_RUN, new Date().toISOString());

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
