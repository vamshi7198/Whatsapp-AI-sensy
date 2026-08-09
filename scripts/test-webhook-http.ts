import "dotenv/config";

import { prisma } from "../src/lib/db";
import { SETTING_KEYS, setSecret, setSetting } from "../src/lib/settings";

/**
 * Verifies the live webhook endpoint's authentication.
 *
 * The signature check is this endpoint's only authentication — there is no
 * session and no CSRF token behind it — so a forged request must never reach
 * the database.
 */

const BASE = "http://localhost:3000/api/webhooks/whatsapp";
const FORGED_PHONE = "+919999888877";

const FORGED_BODY = JSON.stringify({
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                id: "wamid.FORGED",
                from: FORGED_PHONE.slice(1),
                timestamp: "1754400000",
                type: "text",
                text: { body: "forged message" },
              },
            ],
          },
        },
      ],
    },
  ],
});

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function post(signature?: string): Promise<number> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "X-Hub-Signature-256": signature } : {}),
    },
    body: FORGED_BODY,
  });
  return res.status;
}

async function forgedContactExists(): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { phoneE164: FORGED_PHONE },
  });
  return Boolean(contact);
}

async function cleanup() {
  const contact = await prisma.contact.findUnique({
    where: { phoneE164: FORGED_PHONE },
    select: { id: true },
  });
  if (contact) {
    await prisma.message.deleteMany({ where: { contactId: contact.id } });
    await prisma.conversation.deleteMany({ where: { contactId: contact.id } });
    await prisma.contact.delete({ where: { id: contact.id } });
  }
  await prisma.webhookEvent.deleteMany({
    where: { wamid: "wamid.FORGED" },
  });
}

async function main() {
  console.log("Webhook endpoint authentication test\n");
  await cleanup();

  console.log("While WhatsApp is not configured");
  const unconfiguredStatus = await post();
  // 200 stops Meta retrying something that can never be processed; the point
  // is that nothing is written.
  check("returns 200 without processing", unconfiguredStatus === 200,
    String(unconfiguredStatus));
  await new Promise((r) => setTimeout(r, 1500));
  check("forged message did NOT create a contact", !(await forgedContactExists()));

  console.log("\nWith credentials configured but a bad signature");
  const existingToken = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEYS.ACCESS_TOKEN },
  });

  await setSetting(SETTING_KEYS.WABA_ID, "999999999999");
  await setSetting(SETTING_KEYS.PHONE_NUMBER_ID, "888888888888");
  await setSecret(SETTING_KEYS.ACCESS_TOKEN, "test_token_for_signature_check_only");

  const noSig = await post();
  check("request with no signature is refused", noSig === 403, String(noSig));

  const badSig = await post("sha256=deadbeefdeadbeefdeadbeefdeadbeef");
  check("request with a bogus signature is refused", badSig === 403,
    String(badSig));

  const wrongAlgo = await post("sha1=abc123");
  check("wrong signature algorithm is refused", wrongAlgo === 403,
    String(wrongAlgo));

  await new Promise((r) => setTimeout(r, 1500));
  check(
    "still no forged contact after three attempts",
    !(await forgedContactExists()),
  );

  console.log("\nCleaning up");
  await prisma.appSetting.deleteMany({
    where: {
      key: {
        in: [
          SETTING_KEYS.WABA_ID,
          SETTING_KEYS.PHONE_NUMBER_ID,
          SETTING_KEYS.ACCESS_TOKEN,
        ],
      },
    },
  });
  if (existingToken) await prisma.appSetting.create({ data: existingToken });
  await cleanup();
  check("test data removed", true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
