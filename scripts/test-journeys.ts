import "dotenv/config";

import { advanceSession, startJourney } from "../src/lib/journeys/engine";
import { prisma } from "../src/lib/db";

/**
 * End-to-end test of the journey engine against the real database.
 *
 * Builds the branching conversation the brand actually described — a message
 * with two buttons, each leading somewhere different, one branch continuing
 * into a four-option question — and walks fake contacts through it.
 *
 * NOTHING IS SENT, and that is enforced rather than hoped for: every test
 * contact's 24-hour window is deliberately closed, so the engine refuses to
 * send before it ever calls Meta. Sending to made-up numbers would fail
 * delivery, cost nothing, and quietly damage the number's quality rating —
 * which is a bad way to pay for a test.
 *
 * Branching is exercised by parking a session at a step directly, which is
 * what a customer tapping a button leaves behind anyway.
 *
 * Everything created here is removed again, including on failure. A journey
 * left published would answer real customers.
 */

const PREFIX = "+9198765333";
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

  await prisma.journeySession.deleteMany({
    where: { journey: { name: { startsWith: "JTEST " } } },
  });
  await prisma.journey.updateMany({
    where: { name: { startsWith: "JTEST " } },
    data: { liveVersionId: null },
  });
  await prisma.journey.deleteMany({ where: { name: { startsWith: "JTEST " } } });
  await prisma.contactTag.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.message.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { slug: { startsWith: "jtest-" } } });
}

async function main() {
  console.log("Journey engine test\n");
  await cleanup();

  /* ------------------------------------------------------------------ */
  /* Tags to mark where somebody ended up                                */
  /* ------------------------------------------------------------------ */

  const tagNames = ["interested", "fee-high", "not-for-me", "wants-info"];
  const tags: Record<string, string> = {};

  for (const name of tagNames) {
    const tag = await prisma.tag.create({
      data: { name: `jtest-${name}`, slug: `jtest-${name}` },
    });
    tags[name] = tag.id;
  }

  /* ------------------------------------------------------------------ */
  /* The journey                                                         */
  /* ------------------------------------------------------------------ */

  const journey = await prisma.journey.create({
    data: { name: "JTEST Pilot Sampling" },
  });

  const version = await prisma.journeyVersion.create({
    data: { journeyId: journey.id, version: 1, status: "PUBLISHED" },
  });

  async function step(
    type: Parameters<typeof prisma.journeyStep.create>[0]["data"]["type"],
    name: string,
    config: object = {},
  ) {
    return prisma.journeyStep.create({
      data: { versionId: version.id, type, name, config },
    });
  }

  const start = await step("START", "Start");

  // Stands in for the opening template. Two options, so it waits for a tap.
  const ask = await step("SEND_MESSAGE", "Would you like a free sample?", {
    body: "Would you like to claim your free Uncanned sample?",
    options: [
      { id: "claim_sample", label: "Yes please" },
      { id: "not_interested", label: "Not interested" },
    ],
  });

  const tagInterested = await step("ADD_TAG", "Tag interested", {
    tagId: tags.interested,
  });
  const endYes = await step("END", "End (claimed)");

  // Four options, which is past the three-button cap, so this one goes out
  // as a menu rather than buttons.
  const reason = await step("SEND_MESSAGE", "Why not?", {
    body: "Could you tell us why?",
    menuLabel: "Choose a reason",
    options: [
      { id: "fee_high", label: "Delivery fee is high" },
      { id: "not_interested_product", label: "Not for me" },
      { id: "not_soda", label: "Not a fan of soda" },
      { id: "more_info", label: "I need more information" },
    ],
  });

  const tagFee = await step("ADD_TAG", "Tag fee", { tagId: tags["fee-high"] });
  const tagNotForMe = await step("ADD_TAG", "Tag not for me", {
    tagId: tags["not-for-me"],
  });
  const tagInfo = await step("ADD_TAG", "Tag wants info", {
    tagId: tags["wants-info"],
  });
  const endNo = await step("END", "End (declined)");

  async function link(from: string, optionId: string | null, to: string) {
    await prisma.journeyLink.create({
      data: { versionId: version.id, fromStepId: from, optionId, toStepId: to },
    });
  }

  await link(start.id, null, ask.id);
  await link(ask.id, "claim_sample", tagInterested.id);
  await link(ask.id, "not_interested", reason.id);
  await link(tagInterested.id, null, endYes.id);
  await link(reason.id, "fee_high", tagFee.id);
  await link(reason.id, "not_interested_product", tagNotForMe.id);
  await link(reason.id, "not_soda", tagNotForMe.id);
  await link(reason.id, "more_info", tagInfo.id);
  await link(tagFee.id, null, endNo.id);
  await link(tagNotForMe.id, null, endNo.id);
  await link(tagInfo.id, null, endNo.id);

  await prisma.journey.update({
    where: { id: journey.id },
    data: { liveVersionId: version.id },
  });

  console.log("Built a journey with 2 branches and a 4-option question\n");

  /* ------------------------------------------------------------------ */
  /* Walking people through it                                           */
  /* ------------------------------------------------------------------ */

  async function makeContact(suffix: string) {
    const contact = await prisma.contact.create({
      data: {
        name: `Journey Test ${suffix}`,
        phoneE164: `${PREFIX}${suffix}`,
        optInStatus: "OPTED_IN",
        whatsappStatus: "VALID",
      },
    });

    // The window is deliberately CLOSED. The engine checks it before every
    // free-form send, so it stops there and never calls Meta — which is what
    // keeps this test from messaging made-up numbers.
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);

    await prisma.conversation.create({
      data: {
        contactId: contact.id,
        status: "OPEN",
        lastInboundAt: yesterday,
        lastMessageAt: yesterday,
      },
    });

    return contact;
  }

  async function tagsOn(contactId: string): Promise<string[]> {
    const rows = await prisma.contactTag.findMany({
      where: { contactId },
      select: { tag: { select: { slug: true } } },
    });
    return rows.map((r) => r.tag.slug).sort();
  }

  async function sessionOf(contactId: string) {
    return prisma.journeySession.findFirst({
      where: { contactId },
      include: { currentStep: true },
    });
  }

  console.log("Starting\n");

  const p1 = await makeContact("01");
  const started = await startJourney({
    journeyId: journey.id,
    contactId: p1.id,
  });

  const s1 = await sessionOf(p1.id);

  check("a session is created", Boolean(started.sessionId), started.error ?? "");

  // Stopping here is the correct outcome, and the reason must say so in words
  // an operator can act on rather than reporting a Meta rejection.
  check(
    "it refuses to send outside the 24-hour window",
    s1?.status === "FAILED" && Boolean(s1.endedReason?.includes("24 hours")),
    `status ${s1?.status}: ${s1?.endedReason ?? "no reason"}`,
  );

  const sentAnything = await prisma.message.count({
    where: { contact: { phoneE164: { startsWith: PREFIX } }, direction: "OUTBOUND" },
  });

  check("and sends nothing at all", sentAnything === 0, `${sentAnything} sent`);

  /*
    p1's session ended FAILED just above, so entering again is now allowed.

    This check used to assert the opposite, because the unique index carried no
    status predicate — it meant "once ever" while its comment said "once at a
    time". Journeys were single-use per contact for good: re-running one next
    quarter reached nobody who took part the first time, and any session that
    ended FAILED after a transient Meta error barred that person permanently.
    Refusing re-entry was the bug, not the guarantee.
  */
  const reEnter = await startJourney({
    journeyId: journey.id,
    contactId: p1.id,
  });

  check("entering again after a session ended is allowed", reEnter.ok);

  // The other half — that a contact cannot be in the same journey twice AT
  // ONCE — cannot be shown here, because this journey's first step fails
  // immediately on the closed service window, so the session just created is
  // already terminal. scripts/test-journey-reentry.ts holds a session open and
  // checks it there.

  // Left tidy for the checks that follow.
  await prisma.journeySession.updateMany({
    where: { contactId: p1.id, status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
    data: { status: "CANCELLED", currentStepId: null },
  });

  /* ------------------------------------------------------------------ */
  /* Branching                                                           */
  /* ------------------------------------------------------------------ */

  console.log("\nBranching\n");

  /** Puts a contact at a step, waiting, without going through a send. */
  async function park(contactId: string, stepId: string) {
    await prisma.journeySession.updateMany({
      where: { contactId },
      data: { currentStepId: stepId, status: "WAITING_FOR_REPLY" },
    });
  }

  const p2 = await makeContact("02");
  await startJourney({ journeyId: journey.id, contactId: p2.id });
  await park(p2.id, ask.id);

  await advanceSession({
    contactId: p2.id,
    externalId: "wamid.j.001",
    optionId: "claim_sample",
  });

  check(
    "yes leads to the interested branch",
    (await tagsOn(p2.id)).includes("jtest-interested"),
    (await tagsOn(p2.id)).join(", ") || "no tags",
  );

  const s2 = await sessionOf(p2.id);
  check("and completes", s2?.status === "COMPLETED", `status ${s2?.status}`);

  const p3 = await makeContact("03");
  await startJourney({ journeyId: journey.id, contactId: p3.id });
  await park(p3.id, reason.id);

  await advanceSession({
    contactId: p3.id,
    externalId: "wamid.j.002",
    optionId: "fee_high",
  });

  check(
    "the fee reason lands on its own tag",
    (await tagsOn(p3.id)).includes("jtest-fee-high"),
    (await tagsOn(p3.id)).join(", ") || "no tags",
  );

  // Two options deliberately share a destination — a real journey often
  // treats several reasons the same way.
  const p4 = await makeContact("04");
  await startJourney({ journeyId: journey.id, contactId: p4.id });
  await park(p4.id, reason.id);

  await advanceSession({
    contactId: p4.id,
    externalId: "wamid.j.003",
    optionId: "not_soda",
  });

  check(
    "two options can share a destination",
    (await tagsOn(p4.id)).includes("jtest-not-for-me"),
  );

  /* ------------------------------------------------------------------ */
  /* Not repeating itself                                                */
  /* ------------------------------------------------------------------ */

  console.log("\nRetries and stray replies\n");

  const p5 = await makeContact("05");
  await startJourney({ journeyId: journey.id, contactId: p5.id });
  await park(p5.id, ask.id);

  await advanceSession({
    contactId: p5.id,
    externalId: "wamid.j.repeat",
    optionId: "claim_sample",
  });

  const afterFirst = await prisma.journeyStepRun.count({
    where: { session: { contactId: p5.id } },
  });

  // The same webhook again, exactly as Meta would retry it.
  const second = await advanceSession({
    contactId: p5.id,
    externalId: "wamid.j.repeat",
    optionId: "claim_sample",
  });

  const afterSecond = await prisma.journeyStepRun.count({
    where: { session: { contactId: p5.id } },
  });

  check(
    "a repeated webhook does nothing",
    !second.moved && afterFirst === afterSecond,
    `${afterFirst} then ${afterSecond} steps`,
  );

  const p6 = await makeContact("06");
  await startJourney({ journeyId: journey.id, contactId: p6.id });
  await park(p6.id, ask.id);

  const typed = await advanceSession({
    contactId: p6.id,
    externalId: "wamid.j.text",
    text: "hello?",
  });

  const s6 = await sessionOf(p6.id);

  check(
    "typing instead of tapping leaves them where they are",
    !typed.moved && s6?.status === "WAITING_FOR_REPLY",
    `${typed.reason}, status ${s6?.status}`,
  );

  const p7 = await makeContact("07");
  await startJourney({ journeyId: journey.id, contactId: p7.id });
  await park(p7.id, ask.id);

  const unknown = await advanceSession({
    contactId: p7.id,
    externalId: "wamid.j.unknown",
    optionId: "a_button_that_does_not_exist",
  });

  const s7 = await sessionOf(p7.id);

  /*
    An option id this step never offered leaves the customer where they are.

    This check used to expect the session to END here, and the id it sends —
    "a_button_that_does_not_exist" — is not a button with a missing arrow, it
    is an id belonging to no option at all. That is what a second tap looks
    like: the first tap moves the session on, and the second arrives carrying
    an id from the step the customer had been looking at rather than the one
    they are now on.

    Ending the session for that meant tapping a WhatsApp button twice killed
    the conversation — and until the index gained a status predicate, barred
    that contact from the journey for good. A genuine dead end, an option this
    step DOES offer with no arrow behind it, still ends the session; validation
    refuses to publish one, so it only happens on a journey published before
    that check existed.
  */
  check(
    "an option this step never offered is ignored, not fatal",
    !unknown.moved &&
      unknown.reason === "stale_option" &&
      s7?.status === "WAITING_FOR_REPLY",
    `${unknown.reason}, status ${s7?.status}`,
  );

  /* ------------------------------------------------------------------ */
  /* Versions                                                            */
  /* ------------------------------------------------------------------ */

  console.log("\nVersions\n");

  const v2 = await prisma.journeyVersion.create({
    data: { journeyId: journey.id, version: 2, status: "PUBLISHED" },
  });

  await prisma.journey.update({
    where: { id: journey.id },
    data: { liveVersionId: v2.id },
  });

  const s3 = await sessionOf(p3.id);
  check(
    "someone already in the journey stays on the version they started",
    s3?.versionId === version.id,
    s3?.versionId === v2.id ? "moved to v2" : "stayed on v1",
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
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
