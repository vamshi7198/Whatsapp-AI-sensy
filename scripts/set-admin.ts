import "dotenv/config";

import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { prisma } from "../src/lib/db";

/**
 * Changes an administrator's email address and password.
 *
 * Exists because the app has a change-password screen but no change-email
 * screen, and the seeded account was created with a placeholder address.
 *
 * Usage:
 *   npx tsx scripts/set-admin.ts <current-email> <new-email> <new-password>
 */
async function main() {
  const [currentEmail, newEmail, newPassword] = process.argv.slice(2);

  if (!currentEmail || !newEmail || !newPassword) {
    console.error(
      "Usage: npx tsx scripts/set-admin.ts <current-email> <new-email> <new-password>",
    );
    process.exit(1);
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    console.error(strengthError);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: currentEmail.toLowerCase() },
  });

  if (!user) {
    console.error(`No account found with ${currentEmail}`);
    process.exit(1);
  }

  const normalisedEmail = newEmail.toLowerCase().trim();

  if (normalisedEmail !== user.email) {
    const clash = await prisma.user.findUnique({
      where: { email: normalisedEmail },
    });
    if (clash) {
      console.error(`${normalisedEmail} is already in use by another account.`);
      process.exit(1);
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email: normalisedEmail,
      passwordHash: await hashPassword(newPassword),
      failedLogins: 0,
      lockedUntil: null,
    },
  });

  // Changing credentials must sign out anyone already holding a session for
  // this account — that is the whole point of database-backed sessions.
  const revoked = await prisma.session.deleteMany({ where: { userId: user.id } });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      actorEmail: normalisedEmail,
      action: "user.credentials_change",
      entityType: "User",
      entityId: user.id,
      // The password itself is never written to the audit log.
      metadata: { from: user.email, to: normalisedEmail, method: "script" },
    },
  });

  console.log("Administrator updated.");
  console.log(`  Email:    ${user.email}  ->  ${normalisedEmail}`);
  console.log(`  Password: changed`);
  console.log(`  Sessions revoked: ${revoked.count}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
