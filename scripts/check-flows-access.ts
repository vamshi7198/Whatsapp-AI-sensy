import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getMetaConfig } from "../src/lib/settings";

/**
 * Reports whether this account could use WhatsApp Flows.
 *
 * Flows management needs whatsapp_business_management on top of the messaging
 * permission used for everything else. Without it every Flows call fails with
 * a permissions error that reads like a bug, so it is worth knowing before
 * anyone writes code against it.
 */

interface FlowSummary {
  id?: string;
  name?: string;
  status?: string;
  categories?: string[];
}

async function main() {
  const config = await getMetaConfig();

  if (!config) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  console.log("WhatsApp Flows readiness\n");

  /* ------------------------------------------------------------------ */
  /* What the token is allowed to do                                     */
  /* ------------------------------------------------------------------ */

  const debug = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/debug_token?input_token=${config.accessToken}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );

  const debugJson = (await debug.json()) as {
    data?: { scopes?: string[]; expires_at?: number; is_valid?: boolean };
    error?: { message?: string };
  };

  const scopes = debugJson.data?.scopes ?? [];

  if (debugJson.error) {
    console.log(`  Could not read the token: ${debugJson.error.message}`);
  } else {
    console.log("  Permissions on this token:");
    for (const scope of scopes) console.log(`    - ${scope}`);

    const hasManagement = scopes.includes("whatsapp_business_management");
    console.log("");
    console.log(
      `  Can manage Flows: ${hasManagement ? "yes" : "NO — whatsapp_business_management is missing"}`,
    );

    if (!hasManagement) {
      console.log("");
      console.log("  To add it: Meta Business Settings > System Users >");
      console.log("  your system user > Add Assets / Generate New Token, and");
      console.log("  tick whatsapp_business_management alongside");
      console.log("  whatsapp_business_messaging. Then update the token in");
      console.log("  Settings > WhatsApp connection.");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Try the actual endpoint                                             */
  /* ------------------------------------------------------------------ */

  console.log("\n  Asking Meta for the Flows on this account...");

  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.wabaId}/flows`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );

  const json = (await response.json()) as {
    data?: FlowSummary[];
    error?: { message?: string; code?: number };
  };

  if (json.error) {
    console.log(`  Refused: ${json.error.message}`);
    console.log("");
    console.log("  This is the call every Flows feature depends on, so it");
    console.log("  has to succeed before any of it can be built.");
  } else {
    const flows = json.data ?? [];
    console.log(`  Allowed. ${flows.length} flow(s) exist.\n`);

    for (const flow of flows) {
      console.log(
        `    ${flow.name ?? flow.id} — ${flow.status ?? "unknown"}` +
          (flow.categories?.length ? `  (${flow.categories.join(", ")})` : ""),
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
