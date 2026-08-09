import "dotenv/config";

import { prisma } from "../src/lib/db";
import { SETTING_KEYS, setSetting } from "../src/lib/settings";

/**
 * Stores the non-secret Meta identifiers.
 *
 * Only the IDs — the access token is deliberately not settable here. It is
 * entered through Settings in the app, where it is encrypted immediately and
 * never displayed again, so it does not end up in a shell history or a script
 * argument.
 *
 * Usage: npx tsx scripts/set-meta-ids.ts <wabaId> <phoneNumberId> [apiVersion]
 */
async function main() {
  const [wabaId, phoneNumberId, apiVersion = "v23.0"] = process.argv.slice(2);

  if (!wabaId || !phoneNumberId) {
    console.error(
      "Usage: npx tsx scripts/set-meta-ids.ts <wabaId> <phoneNumberId> [apiVersion]",
    );
    process.exit(1);
  }

  if (!/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) {
    console.error("Both IDs should be numbers only.");
    process.exit(1);
  }

  await setSetting(SETTING_KEYS.WABA_ID, wabaId);
  await setSetting(SETTING_KEYS.PHONE_NUMBER_ID, phoneNumberId);
  await setSetting(SETTING_KEYS.API_VERSION, apiVersion);

  console.log("Saved:");
  console.log(`  WhatsApp Business Account ID  ${wabaId}`);
  console.log(`  Phone number ID               ${phoneNumberId}`);
  console.log(`  API version                   ${apiVersion}`);
  console.log("");
  console.log("Still needed: the access token, entered in Settings.");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
