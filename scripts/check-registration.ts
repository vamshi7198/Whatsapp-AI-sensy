import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getMetaConfig } from "../src/lib/settings";

/**
 * Reports how the phone number is currently registered with Meta.
 *
 * Matters because a number can live on the Cloud API or in the WhatsApp
 * Business app, and moving it between the two is not a neutral action. This
 * shows which side it is on before anyone changes anything.
 */

interface PhoneNumber {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
  quality_rating?: string;
  platform_type?: string;
  throughput?: { level?: string };
  name_status?: string;
  status?: string;
  messaging_limit_tier?: string;
  is_on_biz_app?: boolean;
  error?: { message?: string; code?: number };
}

async function main() {
  const config = await getMetaConfig();

  if (!config) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  const fields = [
    "id",
    "display_phone_number",
    "verified_name",
    "code_verification_status",
    "quality_rating",
    "platform_type",
    "throughput",
    "name_status",
    "status",
    "messaging_limit_tier",
  ].join(",");

  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );

  const number = (await response.json()) as PhoneNumber;

  if (number.error) {
    console.log(`Meta returned an error: ${number.error.message}`);
    await prisma.$disconnect();
    return;
  }

  console.log("Phone number registration\n");
  console.log(`  Number:               ${number.display_phone_number ?? "-"}`);
  console.log(`  Display name:         ${number.verified_name ?? "-"}`);
  console.log(`  Name status:          ${number.name_status ?? "-"}`);
  console.log(`  Registered on:        ${number.platform_type ?? "not reported"}`);
  console.log(`  Verification:         ${number.code_verification_status ?? "-"}`);
  console.log(`  Connection status:    ${number.status ?? "-"}`);
  console.log(`  Quality rating:       ${number.quality_rating ?? "-"}`);
  console.log(`  Messaging tier:       ${number.messaging_limit_tier ?? "-"}`);
  console.log(`  Throughput:           ${number.throughput?.level ?? "-"}`);

  console.log("\nWhat this means\n");

  if (number.platform_type === "CLOUD_API") {
    console.log("  This number is registered on the Cloud API.");
    console.log("  That is what this app uses to send and receive.");
    console.log("");
    console.log("  Registering the same number in the WhatsApp Business app");
    console.log("  is a migration, not a second login. Do not attempt it");
    console.log("  without checking what it does to this registration first.");
  } else if (number.platform_type === "ON_PREMISE") {
    console.log("  This number is on the On-Premises API, not the Cloud API.");
  } else if (number.platform_type === "NOT_APPLICABLE") {
    console.log("  Meta reports this number is not on a messaging platform.");
    console.log("  If sending currently works, re-check the Phone Number ID.");
  } else {
    console.log(`  Meta reported platform type: ${number.platform_type ?? "nothing"}.`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
