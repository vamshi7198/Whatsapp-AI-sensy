import "dotenv/config";

import { parseContactCsv } from "../src/lib/contacts/csv";
import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/contacts/schema";

/**
 * End-to-end import check against the real database, using a CSV containing
 * the mistakes that actually appear in exported contact lists.
 *
 * Cleans up after itself so it can be run repeatedly.
 */

const MESSY_CSV = [
  "Full Name,WhatsApp Number,E-Mail,Labels,order_id",
  "Vamshi,+919876543210,vamshi@email.com,pilot,UNC-1001", // clean
  "Rahul,9876543211,rahul@email.com,influencer;pilot,UNC-1002", // bare 10-digit
  "Priya,09876543212,priya@email.com,customer,UNC-1003", // leading zero
  "Arun,+91 98765 43213,arun@email.com,pilot,UNC-1004", // spaces
  "Duplicate,9876543210,dupe@email.com,customer,UNC-1005", // dupe of row 1
  "Broken,not-a-number,x@email.com,pilot,UNC-1006", // invalid phone
  "Excel,9.19877E+11,y@email.com,pilot,UNC-1007", // Excel mangled
  "NoEmail,+919876543214,,customer,UNC-1008", // blank email
  "BadEmail,+919876543215,not-an-email,pilot,UNC-1009", // invalid email
].join("\n");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("Import end-to-end test\n");

  const parsed = parseContactCsv(MESSY_CSV, {
    name: "Full Name",
    phone: "WhatsApp Number",
    email: "E-Mail",
    tags: "Labels",
  });

  console.log("Parsing");
  check("valid rows extracted", parsed.rows.length === 6, `${parsed.rows.length} rows`);
  check("duplicate collapsed", parsed.duplicatesInFile === 1);
  check(
    "invalid phone rejected",
    parsed.errors.some((e) => e.rawPhone === "not-a-number"),
  );
  check(
    "Excel scientific notation rejected",
    parsed.errors.some((e) => e.reason.includes("scientific notation")),
  );
  check(
    "invalid email warned but contact kept",
    parsed.errors.some((e) => e.reason.includes("still imported")) &&
      parsed.rows.some((r) => r.phoneE164 === "+919876543215"),
  );
  // Checked on a row that is NOT duplicated later in the file: row 1's phone
  // reappears at the end, so last-wins correctly replaces its attributes.
  const rahul = parsed.rows.find((r) => r.phoneE164 === "+919876543211");
  check(
    "unmapped column kept as attribute",
    rahul?.attributes.order_id === "UNC-1002",
    JSON.stringify(rahul?.attributes),
  );
  check(
    "last-wins also replaces attributes",
    parsed.rows.find((r) => r.phoneE164 === "+919876543210")?.attributes
      .order_id === "UNC-1005",
  );
  check(
    "all numbers normalised to E.164",
    parsed.rows.every((r) => /^\+91\d{10}$/.test(r.phoneE164)),
    parsed.rows.map((r) => r.phoneE164).join(" "),
  );
  check(
    "last-wins on duplicate",
    parsed.rows.find((r) => r.phoneE164 === "+919876543210")?.name ===
      "Duplicate",
  );

  console.log("\nWriting to database");
  const phones = parsed.rows.map((r) => r.phoneE164);
  await prisma.contact.deleteMany({ where: { phoneE164: { in: phones } } });

  const tagNames = [...new Set(parsed.rows.flatMap((r) => r.tags))];
  const tagIds = new Map<string, string>();
  for (const name of tagNames) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
    tagIds.set(name, tag.id);
  }

  for (const row of parsed.rows) {
    const contact = await prisma.contact.upsert({
      where: { phoneE164: row.phoneE164 },
      update: {},
      create: {
        name: row.name,
        phoneE164: row.phoneE164,
        phoneCountry: row.phoneCountry,
        email: row.email,
        source: "csv_import",
        attributes: row.attributes,
      },
    });
    if (row.tags.length) {
      await prisma.contactTag.createMany({
        data: row.tags
          .map((t) => tagIds.get(t))
          .filter((id): id is string => Boolean(id))
          .map((tagId) => ({ contactId: contact.id, tagId })),
        skipDuplicates: true,
      });
    }
  }

  const stored = await prisma.contact.count({
    where: { phoneE164: { in: phones } },
  });
  check("all rows persisted", stored === parsed.rows.length, `${stored} stored`);

  console.log("\nDuplicate prevention");
  // Re-running must not create a second copy — this is the property that stops
  // a customer receiving the same campaign twice.
  for (const row of parsed.rows) {
    await prisma.contact.upsert({
      where: { phoneE164: row.phoneE164 },
      update: { name: row.name },
      create: { name: row.name, phoneE164: row.phoneE164 },
    });
  }
  const afterReimport = await prisma.contact.count({
    where: { phoneE164: { in: phones } },
  });
  check("re-import created no duplicates", afterReimport === stored,
    `${afterReimport} after re-import`);

  let uniqueViolation = false;
  try {
    await prisma.contact.create({
      data: { name: "Clash", phoneE164: "+919876543210" },
    });
  } catch {
    uniqueViolation = true;
  }
  check("database rejects a duplicate number outright", uniqueViolation);

  console.log("\nConsent defaults");
  const sample = await prisma.contact.findUnique({
    where: { phoneE164: "+919876543211" },
  });
  check("imported contacts are NOT opted in", sample?.optInStatus === "UNKNOWN");
  check("marketing opt-out defaults false", sample?.marketingOptOut === false);

  console.log("\nCleaning up");
  await prisma.contact.deleteMany({ where: { phoneE164: { in: phones } } });
  const remaining = await prisma.contact.count({
    where: { phoneE164: { in: phones } },
  });
  check("test data removed", remaining === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
