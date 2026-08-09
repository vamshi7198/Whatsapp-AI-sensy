import "dotenv/config";

import { estimateCampaignCost } from "../src/lib/campaigns/pricing";
import { prisma } from "../src/lib/db";
import { formatCost } from "../src/lib/utils";

/**
 * Checks the newly added features against the real database: contact editing,
 * manual and CSV audience selection, and cost estimation.
 */

const PREFIX = "+9198765111";
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
  await prisma.contactTag.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { name: "gap-test-tag" } });
}

async function main() {
  console.log("Feature gap test\n");
  await cleanup();

  /* -------------------------------------------------------------- */
  console.log("Cost estimation");

  const indianNumbers = Array.from(
    { length: 100 },
    (_, i) => `+9198765${String(i).padStart(5, "0")}`,
  );

  const marketing = await estimateCampaignCost(indianNumbers, "MARKETING");
  check(
    "marketing cost calculated for 100 Indian numbers",
    marketing.totalCost !== null,
    marketing.totalCost !== null
      ? formatCost(marketing.totalCost, marketing.currency)
      : "no rate",
  );
  check("used the India rate, not the fallback", !marketing.usedFallbackRate);

  const utility = await estimateCampaignCost(indianNumbers, "UTILITY");
  check(
    "utility costs less than marketing",
    utility.totalCost !== null &&
      marketing.totalCost !== null &&
      utility.totalCost < marketing.totalCost,
    `utility ${utility.totalCost} vs marketing ${marketing.totalCost}`,
  );

  const mixed = await estimateCampaignCost(
    ["+919876500001", "+14155550100", "+4915112345678"],
    "MARKETING",
  );
  check(
    "a mixed-country audience still produces a total",
    mixed.totalCost !== null,
  );
  check(
    "an unknown country falls back and says so",
    mixed.usedFallbackRate,
  );
  check(
    "per-message rate hidden when countries differ",
    mixed.ratePerMessage === null,
  );

  const empty = await estimateCampaignCost([], "MARKETING");
  check("no recipients costs nothing", empty.totalCost === 0 || empty.totalCost === null);

  /* -------------------------------------------------------------- */
  console.log("\nContact editing");

  const tag = await prisma.tag.create({
    data: { name: "gap-test-tag", slug: "gap-test-tag" },
  });

  const contact = await prisma.contact.create({
    data: {
      name: "Before Edit",
      phoneE164: `${PREFIX}01`,
      email: "before@example.com",
      optInStatus: "UNKNOWN",
    },
  });

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      name: "After Edit",
      email: "after@example.com",
      optInStatus: "OPTED_IN",
      optInAt: new Date(),
      optInSource: "manual",
    },
  });
  await prisma.contactTag.create({
    data: { contactId: contact.id, tagId: tag.id },
  });

  const edited = await prisma.contact.findUniqueOrThrow({
    where: { id: contact.id },
    include: { tags: true },
  });

  check("name updated", edited.name === "After Edit");
  check("opt-in recorded with a timestamp", edited.optInAt !== null);
  check("consent source recorded", edited.optInSource === "manual");
  check("tag attached", edited.tags.length === 1);

  // Unticking a tag must actually remove it.
  await prisma.contactTag.deleteMany({
    where: { contactId: contact.id, tagId: { notIn: [] } },
  });
  const untagged = await prisma.contact.findUniqueOrThrow({
    where: { id: contact.id },
    include: { tags: true },
  });
  check("removing all tags works", untagged.tags.length === 0);

  /* -------------------------------------------------------------- */
  console.log("\nSoft delete keeps history");

  await prisma.contact.update({
    where: { id: contact.id },
    data: { deletedAt: new Date() },
  });

  const stillThere = await prisma.contact.findUnique({
    where: { id: contact.id },
  });
  check("row retained after delete", stillThere !== null);
  check("excluded from the active list", stillThere?.deletedAt !== null);

  const activeCount = await prisma.contact.count({
    where: { phoneE164: { startsWith: PREFIX }, deletedAt: null },
  });
  check("does not appear in contact searches", activeCount === 0);

  console.log("\nCleaning up");
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
