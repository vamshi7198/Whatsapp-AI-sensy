import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../src/lib/db";

/**
 * Development helper: mints a session for the admin account and prints the
 * raw cookie value, so authenticated pages can be exercised with curl.
 *
 * Refuses to run outside development — this hands out a valid session.
 */
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev-session must never run in production");
  }

  const user = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const token = randomBytes(32).toString("base64url");

  await prisma.session.create({
    data: {
      sessionToken: createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expires: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: "dev-session script",
    },
  });

  process.stdout.write(token);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
