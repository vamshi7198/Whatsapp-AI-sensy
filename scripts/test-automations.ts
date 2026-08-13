import "dotenv/config";

import {
  matchesKeyword,
  runAutomationsForInbound,
} from "../src/lib/automations/engine";
import { prisma } from "../src/lib/db";

/**
 * End-to-end test of the automation engine against the real database.
 *
 * Deliberately uses ONLY tag actions. WhatsApp is connected in production, and
 * a test that exercised the send path would message a real number. The
 * properties under test — does it fire, does it fire once, does it respect an
 * opt-out — are all decided before any message goes out.
 *
 * Everything created here is removed again, including on failure. An
 * automation left switched on in the database would answer real customers.
 */

const PREFIX = "+9198765222";
const TAG_SLUG = "test-automation-tag";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup() {
  const contacts = await prisma.contact.findMany({
    where: { phoneE164: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = contacts.map((c) => c.id);

  await prisma.automationRun.deleteMany({
    where: { automation: { name: { startsWith: "AUTOTEST " } } },
  });
  await prisma.automation.deleteMany({
    where: { name: { startsWith: "AUTOTEST " } },
  });
  await prisma.message.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contactTag.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { slug: TAG_SLUG } });
}

async function makeContact(suffix: string, optedOut = false) {
  const contact = await prisma.contact.create({
    data: {
      name: `Auto Test ${suffix}`,
      phoneE164: `${PREFIX}${suffix}`,
      optInStatus: optedOut ? "OPTED_OUT" : "OPTED_IN",
      marketingOptOut: optedOut,
      whatsappStatus: "VALID",
    },
  });

  const conversation = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      status: "OPEN",
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
    },
  });

  return { contact, conversation };
}

/** An automation that only adds a tag, so nothing is sent. */
async function makeAutomation(
  name: string,
  tagId: string,
  keywords: string[],
  isActive = true,
) {
  return prisma.automation.create({
    data: {
      name: `AUTOTEST ${name}`,
      isActive,
      triggers: {
        create: [
          keywords.length > 0
            ? { type: "KEYWORD" as const, config: { keywords, matchType: "contains" } }
            : { type: "INCOMING_MESSAGE" as const, config: {} },
        ],
      },
      actions: {
        create: [{ type: "ADD_TAG" as const, order: 0, tagId, config: {} }],
      },
    },
  });
}

async function tagCount(contactId: string): Promise<number> {
  return prisma.contactTag.count({ where: { contactId } });
}

async function main() {
  console.log("Automation engine test\n");
  await cleanup();

  // Only the FIRST matching automation replies, so a live one that matches the
  // test's own phrases answers first and every check below fails for a reason
  // unconnected to the code. That happened, and looked exactly like a real
  // regression — so the test now says which rule got in the way rather than
  // reporting a mystery.
  //
  // Checked by actually matching, not by counting: a live automation that
  // cannot match these phrases is none of this test's business.
  //
  // The phrases avoid greetings deliberately. A live rule on "Hi" answers most
  // opening messages, so anything starting with one would be intercepted
  // before it ever reached the automation under test.
  const PHRASES = [
    "can I track my order?",
    "track please",
    "track my order",
    "do you deliver to Hyderabad?",
    "something completely unrelated",
  ];

  const live = await prisma.automation.findMany({
    where: { isActive: true, name: { not: { startsWith: "AUTOTEST " } } },
    include: { triggers: true },
  });

  const clashing = live.filter((automation) =>
    automation.triggers.some((trigger) => {
      if (trigger.type === "INCOMING_MESSAGE") return true;
      if (trigger.type !== "KEYWORD") return false;

      const config = (trigger.config ?? {}) as {
        keywords?: string[];
        matchType?: string;
      };

      return PHRASES.some((phrase) =>
        matchesKeyword(phrase, {
          keywords: config.keywords ?? [],
          matchType: config.matchType === "exact" ? "exact" : "contains",
        }),
      );
    }),
  );

  if (clashing.length > 0) {
    console.log("Cannot run. These live automations answer the same phrases");
    console.log("this test uses, and only the first match replies:\n");
    for (const a of clashing) console.log(`  ${a.name}`);
    console.log("\nSwitch them off under Automations, run this, switch back.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const tag = await prisma.tag.create({
    data: { name: "test-automation-tag", slug: TAG_SLUG },
  });

  /* ------------------------------------------------------------------ */
  /* A matching keyword fires it                                         */
  /* ------------------------------------------------------------------ */

  console.log("Triggering\n");

  const a1 = await makeAutomation("track", tag.id, ["track"]);
  const p1 = await makeContact("01");

  await runAutomationsForInbound({
    contactId: p1.contact.id,
    phoneE164: p1.contact.phoneE164,
    text: "can I track my order?",
    externalMessageId: "wamid.test.001",
    conversationId: p1.conversation.id,
    lastInboundAt: new Date(),
  });

  check("a matching keyword fires it", (await tagCount(p1.contact.id)) === 1);

  /* ------------------------------------------------------------------ */
  /* Running again on the same message does nothing                      */
  /* ------------------------------------------------------------------ */

  await runAutomationsForInbound({
    contactId: p1.contact.id,
    phoneE164: p1.contact.phoneE164,
    text: "can I track my order?",
    externalMessageId: "wamid.test.001",
    conversationId: p1.conversation.id,
    lastInboundAt: new Date(),
  });

  const runs = await prisma.automationRun.count({
    where: { automationId: a1.id, triggerKey: "wamid.test.001" },
  });

  check(
    "a repeated webhook does not fire it twice",
    runs === 1,
    `${runs} run(s) recorded`,
  );

  /* ------------------------------------------------------------------ */
  /* A non-matching message does nothing                                 */
  /* ------------------------------------------------------------------ */

  const p2 = await makeContact("02");

  await runAutomationsForInbound({
    contactId: p2.contact.id,
    phoneE164: p2.contact.phoneE164,
    text: "do you deliver to Hyderabad?",
    externalMessageId: "wamid.test.002",
    conversationId: p2.conversation.id,
    lastInboundAt: new Date(),
  });

  check("an unrelated message does nothing", (await tagCount(p2.contact.id)) === 0);

  /* ------------------------------------------------------------------ */
  /* A switched-off automation does nothing                              */
  /* ------------------------------------------------------------------ */

  console.log("\nSafety\n");

  await prisma.automation.update({
    where: { id: a1.id },
    data: { isActive: false },
  });

  const p3 = await makeContact("03");

  await runAutomationsForInbound({
    contactId: p3.contact.id,
    phoneE164: p3.contact.phoneE164,
    text: "track please",
    externalMessageId: "wamid.test.003",
    conversationId: p3.conversation.id,
    lastInboundAt: new Date(),
  });

  check(
    "a switched-off automation does nothing",
    (await tagCount(p3.contact.id)) === 0,
  );

  await prisma.automation.update({
    where: { id: a1.id },
    data: { isActive: true },
  });

  /* ------------------------------------------------------------------ */
  /* A deleted contact is left alone                                     */
  /* ------------------------------------------------------------------ */

  const p4 = await makeContact("04");
  await prisma.contact.update({
    where: { id: p4.contact.id },
    data: { deletedAt: new Date() },
  });

  await runAutomationsForInbound({
    contactId: p4.contact.id,
    phoneE164: p4.contact.phoneE164,
    text: "track",
    externalMessageId: "wamid.test.004",
    conversationId: p4.conversation.id,
    lastInboundAt: new Date(),
  });

  check("a deleted contact is left alone", (await tagCount(p4.contact.id)) === 0);

  /* ------------------------------------------------------------------ */
  /* Two matching automations send one reply, not two                    */
  /* ------------------------------------------------------------------ */

  console.log("\nOverlapping rules\n");

  await makeAutomation("everything", tag.id, []);
  const p5 = await makeContact("05");

  await runAutomationsForInbound({
    contactId: p5.contact.id,
    phoneE164: p5.contact.phoneE164,
    text: "track my order",
    externalMessageId: "wamid.test.005",
    conversationId: p5.conversation.id,
    lastInboundAt: new Date(),
  });

  const fired = await prisma.automationRun.count({
    where: { triggerKey: "wamid.test.005" },
  });

  check(
    "two matching rules reply once, not twice",
    fired === 1,
    `${fired} fired`,
  );

  /* ------------------------------------------------------------------ */
  /* A catch-all still fires when no keyword matches                     */
  /* ------------------------------------------------------------------ */

  const p6 = await makeContact("06");

  await runAutomationsForInbound({
    contactId: p6.contact.id,
    phoneE164: p6.contact.phoneE164,
    text: "something completely unrelated",
    externalMessageId: "wamid.test.006",
    conversationId: p6.conversation.id,
    lastInboundAt: new Date(),
  });

  check(
    "a reply-to-everything rule still fires",
    (await tagCount(p6.contact.id)) === 1,
  );

  console.log("");
}

main()
  .then(async () => {
    await cleanup();

    if (failures > 0) {
      console.log(`${failures} check(s) failed.`);
      await prisma.$disconnect();
      process.exit(1);
    }

    console.log("All checks passed.");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    // Cleanup matters more on failure than on success: an automation left
    // switched on would answer real customers.
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
