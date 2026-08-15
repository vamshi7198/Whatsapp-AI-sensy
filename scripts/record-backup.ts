import "dotenv/config";

import { prisma } from "../src/lib/db";
import { SETTING_KEYS, setSetting } from "../src/lib/settings";

/**
 * Records that a backup succeeded.
 *
 * Called by backup.ps1 after the file is safely written. Kept in the database
 * rather than inferred from the folder, so /api/health can report a stalled
 * backup without the web app needing to read the disk — and so the signal
 * survives someone tidying the backups folder.
 *
 * Pass --offsite when the file reached Drive. A run that fell back to local
 * storage still stamps LAST_BACKUP_AT, because a local backup is better than
 * none and it is true that a dump was taken — but it must not touch the
 * offsite timestamp, which is the one that means the data would survive losing
 * this laptop. Reporting them as the same thing is how a machine ends up with
 * a folder full of backups and nothing to restore from.
 */

async function main() {
  const offsite = process.argv.includes("--offsite");
  const now = new Date().toISOString();

  await setSetting(SETTING_KEYS.LAST_BACKUP_AT, now);

  if (offsite) {
    await setSetting(SETTING_KEYS.LAST_BACKUP_OFFSITE_AT, now);
  }

  console.log(offsite ? "Recorded (offsite)." : "Recorded (local only).");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  // Never fatal. A backup that succeeded but could not write a timestamp is
  // still a backup, and failing here would make backup.ps1 report failure.
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(0);
});
