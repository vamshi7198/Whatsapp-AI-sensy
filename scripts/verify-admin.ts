import "dotenv/config";

import { verifyPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/db";

/**
 * Confirms an account's credentials work, without printing the password.
 *
 * Usage: npx tsx scripts/verify-admin.ts <email> <password>
 */
async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: npx tsx scripts/verify-admin.ts <email> <password>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  console.log(`account exists:      ${Boolean(user)}`);

  if (user) {
    console.log(`role:                ${user.role}`);
    console.log(`active:              ${user.isActive}`);
    console.log(
      `password works:      ${await verifyPassword(user.passwordHash, password)}`,
    );
    console.log(
      `stored as a hash:    ${user.passwordHash.startsWith("$argon2id$")}`,
    );
    console.log(
      `open sessions:       ${await prisma.session.count({ where: { userId: user.id } })}`,
    );
  }

  const oldAccount = await prisma.user.findUnique({
    where: { email: "admin@uncanned.in" },
  });
  console.log(`old address removed: ${oldAccount === null}`);

  const admins = await prisma.user.count({
    where: { role: "ADMIN", isActive: true },
  });
  console.log(`active admins:       ${admins}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
