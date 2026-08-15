import "dotenv/config";

import { prisma } from "../src/lib/db";

/**
 * Proves two simultaneous replies cannot both advance one session.
 *
 * Meta dispatches two taps as two separate POSTs, and the webhook route hands
 * the work to after(), so they are processed concurrently inside one process.
 * Both used to read the session as ACTIVE, both wrote, and both ran the next
 * step: the customer got the same message twice from the brand's number, and
 * the branch they actually chose was overwritten by the other one.
 *
 * Checking `status === "ACTIVE"` first does not help — that is a read, and both
 * readers see ACTIVE. The transition itself has to be the claim, which is what
 * the conditional updateMany in finishAdvance does.
 *
 * This exercises that claim against the real database, because the guarantee
 * being tested is the database's. It never contacts WhatsApp, so no message is
 * sent. Everything it creates is removed again, including on failure.
 *
 * Usage:  npx tsx scripts/test-journey-concurrency.ts
 */

let failures = 0;

function check(name: string, passed: boolean, detail = "") {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function main() {
  console.log("\nJourney concurrency\n");

  const version = await prisma.journeyVersion.findFirst({
    where: { steps: { some: {} } },
    select: {
      id: true,
      journeyId: true,
      steps: { select: { id: true }, take: 2 },
    },
  });

  if (!version || version.steps.length < 2) {
    console.log("  SKIP  need a journey version with at least two steps.\n");
    return;
  }

  const [stepA, stepB] = version.steps;

  const contact = await prisma.contact.create({
    data: {
      phoneE164: `+9999111${Date.now().toString().slice(-6)}`,
      name: "Concurrency test",
      source: "test-journey-concurrency",
    },
    select: { id: true },
  });

  try {
    const session = await prisma.journeySession.create({
      data: {
        journeyId: version.journeyId,
        versionId: version.id,
        contactId: contact.id,
        currentStepId: stepA.id,
        status: "WAITING_FOR_REPLY",
      },
      select: { id: true, currentStepId: true, status: true },
    });

    // Both taps decided from the same observed state, exactly as two
    // concurrent webhook deliveries would.
    const claim = () =>
      prisma.journeySession.updateMany({
        where: {
          id: session.id,
          currentStepId: session.currentStepId,
          status: session.status,
        },
        data: { currentStepId: stepB.id, status: "ACTIVE" },
      });

    const [first, second] = await Promise.all([claim(), claim()]);
    const winners = [first, second].filter((r) => r.count === 1).length;

    check(
      "exactly one of two simultaneous advances claims the session",
      winners === 1,
      `${winners} winner(s)`,
    );

    // The loser must be told it changed nothing, which is what stops it
    // calling runFrom and sending the step's message a second time.
    check(
      "the loser is told it moved nothing",
      [first, second].some((r) => r.count === 0),
    );

    // A third attempt from the now-stale state must also fail, so a webhook
    // redelivered later cannot replay the step.
    const late = await claim();
    check("a late replay of the same state claims nothing", late.count === 0);

    const after = await prisma.journeySession.findUnique({
      where: { id: session.id },
      select: { currentStepId: true },
    });

    check("the session advanced exactly once", after?.currentStepId === stepB.id);
  } finally {
    await prisma.contact.delete({ where: { id: contact.id } });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(
      failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
