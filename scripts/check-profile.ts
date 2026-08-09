import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getProvider } from "../src/lib/whatsapp";

/**
 * Shows the public business profile as it currently stands on Meta, and which
 * fields customers would see as blank.
 */
async function main() {
  const provider = await getProvider();

  if (!provider) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  const [profile, phone] = await Promise.all([
    provider.getBusinessProfile(),
    provider.getPhoneNumber(),
  ]);

  if (!profile) {
    console.log("Could not read the business profile from Meta.");
    await prisma.$disconnect();
    return;
  }

  console.log("What customers currently see\n");
  console.log(`  Display name:   ${phone?.verifiedName || "(none)"}`);
  console.log(`  Number:         ${phone?.displayPhoneNumber ?? "-"}`);
  console.log(
    `  Profile photo:  ${profile.profilePictureUrl ? "set" : "NOT SET"}`,
  );
  console.log(`  Status line:    ${profile.about || "NOT SET"}`);
  console.log(`  Description:    ${profile.description || "NOT SET"}`);
  console.log(`  Industry:       ${profile.vertical || "NOT SET"}`);
  console.log(`  Email:          ${profile.email || "NOT SET"}`);
  console.log(`  Address:        ${profile.address || "NOT SET"}`);

  const websites = profile.websites ?? [];
  console.log(
    `  Links:          ${websites.length ? websites.join(", ") : "NOT SET"}`,
  );

  const missing = [
    !profile.profilePictureUrl && "profile photo",
    !profile.about && "status line",
    !profile.description && "description",
    websites.length === 0 && "website link",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log("");
    console.log(`  Missing: ${missing.join(", ")}`);
    console.log(
      "  These are what make a message look like a real business rather",
    );
    console.log("  than an unknown number.");
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
