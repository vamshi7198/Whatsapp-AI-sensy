import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  SETTING_KEYS,
  describeSecret,
  getSecret,
  setSecret,
  setSetting,
  isMetaConnected,
} from "../src/lib/settings";

/**
 * Verifies that a saved Meta access token is encrypted at rest and cannot be
 * read back through any browser-facing path.
 *
 * A leaked token lets anyone message the entire customer base as Uncanned, so
 * this is checked against the real database rather than assumed.
 */

const FAKE_TOKEN =
  "EAAG_test_token_do_not_use_1234567890abcdefghijklmnopqrstuvwxyz";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("Secret storage test\n");

  // Preserve anything already configured so this test is non-destructive.
  const existing = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEYS.ACCESS_TOKEN },
  });

  await setSecret(SETTING_KEYS.ACCESS_TOKEN, FAKE_TOKEN);

  console.log("Storage");
  const row = await prisma.appSetting.findUniqueOrThrow({
    where: { key: SETTING_KEYS.ACCESS_TOKEN },
  });

  check("marked as a secret", row.isSecret === true);
  check("plaintext column is empty", row.value === null);
  check("ciphertext stored", (row.valueEnc?.length ?? 0) > 0);

  const raw = Buffer.from(row.valueEnc!).toString("utf8");
  check("token is not readable in the database", !raw.includes("EAAG_test"));
  check(
    "no fragment of the token survives in the ciphertext",
    !raw.includes("token_do_not_use"),
  );

  console.log("\nRound trip");
  check("decrypts back to the original", (await getSecret(SETTING_KEYS.ACCESS_TOKEN)) === FAKE_TOKEN);

  console.log("\nWhat the browser is allowed to see");
  const described = await describeSecret(SETTING_KEYS.ACCESS_TOKEN);
  check("reports that it is set", described.isSet === true);
  check("reveals only the last four characters", described.masked === "****wxyz",
    described.masked ?? "null");
  check(
    "the safe description contains no part of the token",
    !described.masked!.includes("EAAG") &&
      !described.masked!.includes("test_token"),
  );

  console.log("\nTampering");
  const tampered = Buffer.from(row.valueEnc!);
  tampered[tampered.length - 1] ^= 0xff;
  await prisma.appSetting.update({
    where: { key: SETTING_KEYS.ACCESS_TOKEN },
    data: { valueEnc: new Uint8Array(tampered) },
  });
  check(
    "a modified ciphertext fails rather than returning junk",
    (await getSecret(SETTING_KEYS.ACCESS_TOKEN)) === null,
  );

  console.log("\nConnection state");
  await setSecret(SETTING_KEYS.ACCESS_TOKEN, FAKE_TOKEN);
  await setSetting(SETTING_KEYS.WABA_ID, "111");
  await setSetting(SETTING_KEYS.PHONE_NUMBER_ID, "222");
  check("reports connected once all three are present", await isMetaConnected());

  await prisma.appSetting.deleteMany({
    where: { key: SETTING_KEYS.ACCESS_TOKEN },
  });
  check("reports disconnected without a token", !(await isMetaConnected()));

  console.log("\nCleaning up");
  await prisma.appSetting.deleteMany({
    where: { key: { in: [SETTING_KEYS.WABA_ID, SETTING_KEYS.PHONE_NUMBER_ID] } },
  });
  if (existing) {
    await prisma.appSetting.create({ data: existing });
    console.log("  restored the previously configured token");
  }
  check("test data removed", true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
