import "dotenv/config";

import { prisma } from "../src/lib/db";

/**
 * Proves a contact can go through a journey again once the last one ended.
 *
 * The old index was UNIQUE("journeyId","contactId") with no predicate, so it
 * meant "once ever" while its comment said "once at a time". A contact who
 * finished a journey, or whose session ended FAILED after a transient Meta
 * error, was barred from it permanently — which quietly turned every temporary
 * fault into a permanent one and made re-running a journey next quarter reach
 * nobody who took part the first time.
 *
 * Runs against the real database on purpose. The thing being tested IS the
 * index predicate, and a mock cannot be wrong about it in the way that
 * matters. Everything it creates is removed again, including on failure.
 *
 * Usage:  npx tsx scripts/test-journey-reentry.ts
 */

const IN_FLIGHT = ["ACTIVE", "WAITING_FOR_REPLY", "WAITING_UNTIL", "HANDED_OFF"];

let failures = 0;

function check(name: string, passed: boolean, detail = "") {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function main() {
  console.log("\nJourney re-entry\n");

  /* --- The index itself --------------------------------------------------- */

  // Prisma cannot express a partial unique index, so `prisma migrate dev` will
  // offer to drop this one. If that ever gets accepted, re-entry silently
  // breaks again and every test below would still pass on an empty database.
  // Checking the predicate directly is the only thing that catches it.
  const [index] = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
    `SELECT indexdef FROM pg_indexes
      WHERE tablename = 'JourneySession'
        AND indexname = 'JourneySession_journeyId_contactId_active_key'`,
  );

  check("the partial unique index exists", Boolean(index));

  if (index) {
    const predicate = index.indexdef.slice(index.indexdef.indexOf("WHERE"));
    const covers = IN_FLIGHT.every((s) => predicate.includes(s));

    check("it covers exactly the in-flight statuses", covers, predicate);
    check(
      "it does NOT cover terminal statuses",
      !["COMPLETED", "FAILED", "CANCELLED"].some((s) => predicate.includes(s)),
    );
  }

  const stale = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'JourneySession'
        AND indexname = 'JourneySession_journeyId_contactId_key'`,
  );

  check("the old unconditional unique index is gone", stale.length === 0);

  /* --- The behaviour ------------------------------------------------------ */

  const journey = await prisma.journey.findFirst({
    where: { liveVersionId: { not: null } },
    select: { id: true, liveVersionId: true, name: true },
  });

  if (!journey?.liveVersionId) {
    console.log("\n  SKIP  no published journey to test against.\n");
    return;
  }

  const contact = await prisma.contact.create({
    data: {
      // A number in the reserved TEST-NET range for documentation, so this can
      // never collide with a real contact or be messaged by accident.
      phoneE164: `+9999000${Date.now().toString().slice(-6)}`,
      name: "Re-entry test",
      source: "test-journey-reentry",
    },
    select: { id: true },
  });

  try {
    const base = {
      journeyId: journey.id,
      versionId: journey.liveVersionId,
      contactId: contact.id,
    };

    const first = await prisma.journeySession.create({
      data: { ...base, status: "ACTIVE" },
      select: { id: true },
    });

    // While the first is live, a second must be refused.
    let refused = false;
    try {
      await prisma.journeySession.create({ data: { ...base, status: "ACTIVE" } });
    } catch {
      refused = true;
    }

    check("a second session is refused while the first is in flight", refused);

    // Ending it must free the contact to enter again — the whole point.
    await prisma.journeySession.update({
      where: { id: first.id },
      data: { status: "COMPLETED", completedAt: new Date(), currentStepId: null },
    });

    let second: { id: string } | null = null;
    try {
      second = await prisma.journeySession.create({
        data: { ...base, status: "ACTIVE" },
        select: { id: true },
      });
    } catch (error) {
      check(
        "a contact can re-enter after COMPLETED",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }

    if (second) check("a contact can re-enter after COMPLETED", true);

    // FAILED is the one that matters most: a transient Meta error ended the
    // session, and the contact must not be barred for it.
    if (second) {
      await prisma.journeySession.update({
        where: { id: second.id },
        data: { status: "FAILED", completedAt: new Date(), currentStepId: null },
      });

      let third = false;
      try {
        await prisma.journeySession.create({ data: { ...base, status: "ACTIVE" } });
        third = true;
      } catch {
        third = false;
      }

      check("a contact can re-enter after FAILED", third);
    }

    const total = await prisma.journeySession.count({
      where: { journeyId: journey.id, contactId: contact.id },
    });

    check("all three sessions coexist as history", total === 3, `${total} rows`);
  } finally {
    // Sessions cascade from the contact.
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
