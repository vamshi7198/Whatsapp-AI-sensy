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
 */

async function main() {
  await setSetting(SETTING_KEYS.LAST_BACKUP_AT, new Date().toISOString());
  console.log("Recorded.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  // Never fatal. A backup that succeeded but could not write a timestamp is
  // still a backup, and failing here would make backup.ps1 report failure.
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(0);
});
