import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  normaliseFieldName,
  readContactField,
  writeContactField,
} from "../src/lib/journeys/contact-fields";

/**
 * Saving an answer onto a contact.
 *
 * The case that matters is "address". Contact has no such column, so a journey
 * asking for a delivery address wrote to a field that does not exist, threw,
 * and left the customer stuck at that step with no way forward — while the
 * builder happily offered "address" as a choice.
 */

const PHONE = "+919876544401";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup() {
  await prisma.contact.deleteMany({ where: { phoneE164: PHONE } });
}

async function main() {
  console.log("Contact field writing\n");
  await cleanup();

  const contact = await prisma.contact.create({
    data: { name: "Field Test", phoneE164: PHONE, optInStatus: "OPTED_IN" },
  });

  /* --- The one that used to throw -------------------------------------- */

  console.log("The address case\n");

  let threw = false;
  try {
    await writeContactField(contact.id, "address", "12 MG Road, Hyderabad");
  } catch (error) {
    threw = true;
    console.log(`      threw: ${error instanceof Error ? error.message : error}`);
  }

  check("saving an address does not throw", !threw);
  check(
    "and can be read back",
    (await readContactField(contact.id, "address")) === "12 MG Road, Hyderabad",
  );

  /* --- Real columns still go to columns --------------------------------- */

  console.log("\nColumns\n");

  await writeContactField(contact.id, "name", "Vamshi");
  await writeContactField(contact.id, "email", "v@uncanned.in");

  const row = await prisma.contact.findUniqueOrThrow({
    where: { id: contact.id },
    select: { name: true, email: true, attributes: true },
  });

  check("name goes to the column", row.name === "Vamshi");
  check("email goes to the column", row.email === "v@uncanned.in");

  const attrs = (row.attributes ?? {}) as Record<string, unknown>;
  check(
    "address goes to attributes, not a column",
    attrs.address === "12 MG Road, Hyderabad",
  );

  /* --- Anything else works too ------------------------------------------ */

  console.log("\nAny field name\n");

  await writeContactField(contact.id, "flavour", "Ginger");
  await writeContactField(contact.id, "pincode", "500081");

  check("a made-up field saves", (await readContactField(contact.id, "flavour")) === "Ginger");

  // The failure that would silently lose data: a later write wiping an
  // earlier one because the whole bag was replaced rather than merged.
  check(
    "saving one field does not wipe another",
    (await readContactField(contact.id, "address")) === "12 MG Road, Hyderabad" &&
      (await readContactField(contact.id, "pincode")) === "500081",
  );

  /* --- Things a customer's answer must never set ------------------------ */

  console.log("\nRefused\n");

  check("consent cannot be set by an answer", normaliseFieldName("optInStatus") === null);
  check("opt-out cannot be set by an answer", normaliseFieldName("marketingOptOut") === null);
  check("the phone number cannot be changed", normaliseFieldName("phoneE164") === null);
  check("the id cannot be changed", normaliseFieldName("id") === null);

  const refused = await writeContactField(contact.id, "marketingOptOut", "true");
  check("and writing one is refused rather than obeyed", refused === false);

  const after = await prisma.contact.findUniqueOrThrow({
    where: { id: contact.id },
    select: { marketingOptOut: true },
  });

  check("the contact is unchanged", after.marketingOptOut === false);

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
