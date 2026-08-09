import "dotenv/config";

import { prisma } from "../src/lib/db";

/**
 * Changes a user's display name.
 *
 * The app has no rename screen yet; the name shown in the top bar and on
 * "sent by" labels comes from here.
 *
 * Usage: npx tsx scripts/set-user-name.ts <email> "<full name>"
 */
async function main() {
  const [email, name] = process.argv.slice(2);

  if (!email || !name) {
    console.error('Usage: npx tsx scripts/set-user-name.ts <email> "Full Name"');
    process.exit(1);
  }

  const user = await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { name: name.trim() },
    select: { email: true, name: true },
  });

  console.log(`Updated: ${user.email} is now shown as "${user.name}"`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
