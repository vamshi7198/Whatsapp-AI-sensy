import "dotenv/config";

import {
  resumeStalledCampaigns,
  runDueCampaigns,
} from "../src/lib/campaigns/sender";
import { prisma } from "../src/lib/db";
import { resumeDueSessions } from "../src/lib/journeys/engine";
import { moduleLogger } from "../src/lib/logger";
import { SETTING_KEYS, setSetting } from "../src/lib/settings";
import {
  pruneWebhookEvents,
  recoverUnprocessedEvents,
} from "../src/lib/webhooks/processor";

/**
 * Starts campaigns whose scheduled time has arrived, and resumes journeys.
 *
 * Runs every few minutes from a Windows scheduled task (see deploy/repair.ps1)
 * rather than from a timer inside the web process. A timer dies with its
 * process, so a campaign scheduled for 9am would silently never send if the
 * machine had restarted overnight — and nothing would say so.
 *
 * A campaign whose time passed while the machine was off is sent late rather
 * than skipped. Late is recoverable; never sending is not.
 *
 * Everything here logs through pino, not console. This runs as a SYSTEM
 * scheduled task whose stdout Windows discards, so a console.error in the
 * crash handler wrote to nowhere: a scheduler throwing on every single pass
 * left no trace in logs/ at all, and the only symptom was that scheduled
 * things quietly stopped happening while every page kept loading perfectly.
 */

const log = moduleLogger("scheduler");

async function main() {
  const startedAt = Date.now();

  /* --- Anything left half-done by a restart ---------------------------- */

  // Runs first, and every few minutes rather than only on deploy. A message
  // stored but never applied, or a campaign interrupted mid-send, would
  // otherwise wait for someone to notice and redeploy — which during a
  // months-long unattended run means it waits forever.
  const recovered = await recoverUnprocessedEvents();

  if (recovered.processed > 0 || recovered.failed > 0) {
    log.info(
      { processed: recovered.processed, failed: recovered.failed },
      "Recovered stored webhook events",
    );
  }

  /* --- Journeys paused on a wait step ---------------------------------- */

  // Deliberately BEFORE campaign sending.
  //
  // A wait inside a journey needs something awake to end it, and nothing else
  // on this machine is. Running it after the campaigns meant a long send held
  // up every waiting conversation behind it — a customer promised a follow-up
  // in an hour got it whenever the campaign finished. Journeys are quick and
  // sending is not, so sending goes last.
  const resumed = await resumeDueSessions();

  if (resumed > 0) {
    log.info({ resumed }, "Resumed journey conversations");
  }

  /* --- Say that this ran, before the slow part -------------------------- */

  // Written here rather than at the end. /api/health reads it, and it is the
  // only thing that reveals a dead scheduler. Writing it after the sending
  // meant a perfectly healthy pass that spent forty minutes on a large
  // campaign showed up as "stalled 40m" — an alarm that cries wolf during
  // normal operation is worse than no alarm, because it teaches whoever
  // watches it to ignore the one time it is real.
  await setSetting(SETTING_KEYS.SCHEDULER_LAST_RUN, new Date().toISOString());

  /* --- Campaigns ------------------------------------------------------- */

  const resumedCampaigns = await resumeStalledCampaigns();

  if (resumedCampaigns.length > 0) {
    log.info(
      { count: resumedCampaigns.length },
      "Resumed campaigns interrupted part-way",
    );
  }

  const started = await runDueCampaigns();

  if (started.length > 0) {
    log.info(
      {
        count: started.length,
        campaigns: started.map((c) => ({
          name: c.name,
          recipients: c.recipients,
        })),
      },
      "Started scheduled campaigns",
    );
  }

  /* --- Housekeeping ----------------------------------------------------- */

  // Once a day is plenty, and doing it on every five-minute pass would be a
  // pointless delete against a growing table.
  if (new Date().getHours() === 3) {
    const pruned = await pruneWebhookEvents();
    if (pruned > 0) log.info({ pruned }, "Removed old webhook events");
  }

  // Written again now the pass is genuinely finished. The early write keeps
  // health honest during a long send; this one records how long it took, which
  // is what shows a pass creeping towards the five-minute cadence.
  await setSetting(SETTING_KEYS.SCHEDULER_LAST_RUN, new Date().toISOString());

  log.info({ durationMs: Date.now() - startedAt }, "Scheduler pass complete");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  // pino, not console. This is the line that matters most and it was the one
  // most certainly going nowhere.
  log.error(
    { err: error instanceof Error ? error.message : error },
    "Scheduler pass failed",
  );

  await prisma.$disconnect();
  process.exit(1);
});
