import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import { hashPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/db";

/**
 * Checks every page as each role.
 *
 * Role-specific breakage is easy to miss, because development happens as an
 * administrator who can see everything. A page that renders perfectly for an
 * admin can 500 for an agent if it reads something their role cannot.
 */

/** Override with TEST_BASE to check a build running on another port. */
const BASE = process.env.TEST_BASE ?? "http://localhost:3000";
const ROLES = ["ADMIN", "MANAGER", "AGENT"] as const;

const ROUTES = [
  "/",
  "/contacts",
  "/contacts/import",
  "/inbox",
  "/campaigns",
  "/campaigns/new",
  "/templates",
  "/templates/new",
  "/automations",
  "/reports",
  "/settings",
  "/settings/users",
  "/settings/whatsapp",
  "/settings/logs",
];

let problems = 0;

async function sessionFor(role: (typeof ROLES)[number]): Promise<string> {
  const email = `roletest_${role.toLowerCase()}@uncanned.test`;

  const user = await prisma.user.upsert({
    where: { email },
    update: { role, isActive: true },
    create: {
      email,
      name: `Role Test ${role}`,
      role,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      isActive: true,
    },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      sessionToken: createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expires: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  return token;
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@uncanned.test" } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log("Checking every page as each role\n");
  await cleanup();

  for (const role of ROLES) {
    const token = await sessionFor(role);
    console.log(`${role}`);

    for (const route of ROUTES) {
      const response = await fetch(`${BASE}${route}`, {
        headers: { cookie: `uncanned_session=${token}` },
        redirect: "manual",
      });

      const status = response.status;
      let note = "";

      if (status === 200) {
        const html = await response.text();

        // A page that renders but shows an error is worse than one that
        // redirects, because it looks like it worked.
        if (/Application error|Internal Server Error|digest/i.test(html)) {
          note = "  <-- PAGE RENDERED AN ERROR";
          problems += 1;
        } else if (html.length < 2000) {
          note = `  <-- suspiciously short (${html.length} bytes)`;
          problems += 1;
        }
      } else if (status === 307 || status === 302) {
        // Redirect is the correct response for a route this role may not see.
        note = "  (redirected - expected if not permitted)";
      } else {
        note = "  <-- UNEXPECTED";
        problems += 1;
      }

      console.log(`  ${String(status).padEnd(4)} ${route.padEnd(22)}${note}`);
    }

    console.log("");
  }

  await cleanup();
  console.log(
    problems === 0
      ? "No problems found."
      : `${problems} page(s) need attention.`,
  );

  await prisma.$disconnect();
  process.exit(problems === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
