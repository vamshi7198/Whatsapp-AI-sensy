import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/db";
import { can } from "../src/lib/rbac";

/**
 * Phase 0 verification against the real database.
 *
 * Exercises the parts of the login path that a curl request cannot reach:
 * password verification against the seeded hash, the session token lifecycle,
 * and that RBAC decisions match the user actually stored in Postgres.
 */

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("Phase 0 verification\n");

  console.log("Database");
  const tableCount = await prisma.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  check("schema applied", Number(tableCount[0].count) >= 20,
    `${tableCount[0].count} tables`);

  console.log("\nSeeded admin");
  const email = process.env.SEED_ADMIN_EMAIL!;
  const password = process.env.SEED_ADMIN_PASSWORD!;
  const admin = await prisma.user.findUnique({ where: { email } });

  check("admin exists", Boolean(admin), email);
  if (!admin) throw new Error("Cannot continue without the admin user");

  check("role is ADMIN", admin.role === "ADMIN");
  check("account is active", admin.isActive);
  check(
    "password is not stored in plaintext",
    admin.passwordHash !== password && admin.passwordHash.startsWith("$argon2id$"),
  );

  console.log("\nPassword verification");
  check("correct password verifies", await verifyPassword(admin.passwordHash, password));
  check("wrong password rejected", !(await verifyPassword(admin.passwordHash, password + "x")));
  check("empty password rejected", !(await verifyPassword(admin.passwordHash, "")));

  const rehashed = await hashPassword(password);
  check("hashing is salted (same input, different hash)", rehashed !== admin.passwordHash);

  console.log("\nSession lifecycle");
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const session = await prisma.session.create({
    data: {
      sessionToken: tokenHash,
      userId: admin.id,
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  check("session created", Boolean(session.id));

  const stored = await prisma.session.findUnique({
    where: { sessionToken: tokenHash },
    include: { user: true },
  });
  check("session resolves to the user", stored?.user.email === email);
  check(
    "raw token is NOT stored (only its hash)",
    stored?.sessionToken !== rawToken && stored?.sessionToken === tokenHash,
  );

  await prisma.session.delete({ where: { id: session.id } });
  const afterDelete = await prisma.session.findUnique({
    where: { sessionToken: tokenHash },
  });
  check("session revocation is immediate", afterDelete === null);

  console.log("\nRBAC against the stored user");
  check("admin can configure WhatsApp", can(admin, "settings:whatsapp"));
  check("admin can delete campaigns", can(admin, "campaign:delete"));
  check(
    "a deactivated admin is denied",
    !can({ ...admin, isActive: false }, "dashboard:view"),
  );

  console.log("\nCompliance defaults");
  const optInDefault = await prisma.appSetting.findUnique({
    where: { key: "compliance.default_opt_in" },
  });
  check(
    "new contacts are NOT opted in by default",
    optInDefault?.value === "false",
  );

  const keywords = await prisma.appSetting.findUnique({
    where: { key: "compliance.opt_out_keywords" },
  });
  check(
    "opt-out keywords seeded",
    keywords?.value === "STOP,UNSUBSCRIBE,REMOVE",
    keywords?.value ?? undefined,
  );

  console.log("\nIdempotency constraints");
  const constraints = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'Campaign_idempotencyKey_key',
        'CampaignRecipient_campaignId_phoneE164_key',
        'WebhookEvent_dedupeKey_key',
        'Contact_phoneE164_key',
        'Message_wamid_key'
      )`;
  const found = new Set(constraints.map((c) => c.indexname));
  for (const name of [
    "Campaign_idempotencyKey_key",
    "CampaignRecipient_campaignId_phoneE164_key",
    "WebhookEvent_dedupeKey_key",
    "Contact_phoneE164_key",
    "Message_wamid_key",
  ]) {
    check(name, found.has(name));
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) FAILED.`,
  );

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("Verification error:", error);
  await prisma.$disconnect();
  process.exit(1);
});
