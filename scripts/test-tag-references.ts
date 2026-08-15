import "dotenv/config";

import { prisma } from "../src/lib/db";

/**
 * Proves a tag still in use cannot be deleted.
 *
 * Deleting one used to succeed and fail three different silent ways at once:
 * an ADD_TAG step throws and ends the session; a CONDITION on the tag quietly
 * matches nothing, so EVERYONE takes the "no" branch while the journey carries
 * on as though that were the answer; and an automation action has its tagId
 * set to null by the cascade, so it is skipped while the run still records
 * COMPLETED.
 *
 * Journey and trigger configs hold tag ids inside JSON with no foreign key, so
 * the check is a JSON containment query — and a query like that failing to
 * match is indistinguishable from "nothing uses this tag". That is the thing
 * worth testing: not that the guard exists, but that it actually sees.
 *
 * Runs against the real database and removes everything it creates.
 *
 * Usage:  npx tsx scripts/test-tag-references.ts
 */

let failures = 0;

/**
 * The same query the delete guard uses: a text search over the JSON column.
 *
 * Deliberately mirrors tagReferences rather than calling it, because that lives
 * in a "use server" module. If the two ever diverge, the checks below stop
 * describing the guard — which is the failure this file exists to catch, so
 * keeping them in step matters.
 */
async function countJsonRefs(
  table: "JourneyStep" | "JourneyTrigger",
  id: string,
): Promise<number> {
  const like = `%${id}%`;

  const rows =
    table === "JourneyStep"
      ? await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM "JourneyStep"
           WHERE config::text LIKE ${like}
        `
      : await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM "JourneyTrigger"
           WHERE config::text LIKE ${like}
        `;

  return rows[0]?.count ?? 0;
}

function check(name: string, passed: boolean, detail = "") {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function main() {
  console.log("\nTag references\n");

  const stamp = Date.now();

  const tag = await prisma.tag.create({
    data: { name: `zz-tagref-${stamp}`, slug: `zz-tagref-${stamp}` },
    select: { id: true, name: true },
  });

  const journey = await prisma.journey.create({
    data: { name: `zz-tagref-${stamp}`, createdById: null },
    select: { id: true },
  });

  const version = await prisma.journeyVersion.create({
    data: { journeyId: journey.id, version: 1, status: "DRAFT" },
    select: { id: true },
  });

  try {
    // Exactly how the builder stores it: the tag id inside the step's JSON.
    const step = await prisma.journeyStep.create({
      data: {
        versionId: version.id,
        name: "Tag them",
        type: "ADD_TAG",
        config: { tagId: tag.id },
        x: 0,
        y: 0,
      },
      select: { id: true },
    });

    const stepHits = await countJsonRefs("JourneyStep", tag.id);

    check(
      "a tag id inside a step's JSON config is found",
      stepHits === 1,
      `${stepHits} match(es)`,
    );

    // A different id must NOT match, or the guard would refuse every delete
    // and be just as useless in the other direction.
    const otherHits = await countJsonRefs(
      "JourneyStep",
      `${tag.id}-not-this-one`,
    );

    check("an unrelated id does not match", otherHits === 0);

    await prisma.journeyTrigger.create({
      data: {
        versionId: version.id,
        type: "TAG_ADDED",
        config: { tagId: tag.id },
      },
    });

    const triggerHits = await countJsonRefs("JourneyTrigger", tag.id);

    check(
      "a tag id inside a trigger's JSON config is found",
      triggerHits === 1,
      `${triggerHits} match(es)`,
    );

    // Removing the step must make it deletable again, so the guard releases.
    await prisma.journeyStep.delete({ where: { id: step.id } });

    const afterRemoval = await countJsonRefs("JourneyStep", tag.id);

    check("the reference clears once the step is gone", afterRemoval === 0);
  } finally {
    await prisma.journey.delete({ where: { id: journey.id } });
    await prisma.tag.delete({ where: { id: tag.id } });
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
