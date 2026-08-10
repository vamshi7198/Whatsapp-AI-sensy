import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getMetaConfig } from "../src/lib/settings";

/**
 * Works out who controls the WhatsApp Business Account.
 *
 * If the display name cannot be edited, it is almost always one of:
 *  - the account is owned by a different business portfolio
 *  - a previous provider still holds partner access to it
 *  - this user's role on the asset is too limited
 *
 * These look identical from the UI, so this asks Meta directly.
 */

interface BusinessInfo {
  id?: string;
  name?: string;
}

interface WabaDetails {
  id?: string;
  name?: string;
  account_review_status?: string;
  business_verification_status?: string;
  owner_business_info?: BusinessInfo;
  on_behalf_of_business_info?: BusinessInfo & { status?: string };
  primary_funding_id?: string;
  purchase_order_number?: string;
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
    "name",
    "account_review_status",
    "business_verification_status",
    "owner_business_info",
    "on_behalf_of_business_info",
    "primary_funding_id",
  ].join(",");

  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.wabaId}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );

  const waba = (await response.json()) as WabaDetails;

  if (waba.error) {
    console.log(`Meta returned an error: ${waba.error.message}`);
    await prisma.$disconnect();
    return;
  }

  console.log("WhatsApp Business Account\n");
  console.log(`  Name:                 ${waba.name ?? "-"}`);
  console.log(`  ID:                   ${waba.id ?? "-"}`);
  console.log(`  Review status:        ${waba.account_review_status ?? "-"}`);
  console.log(
    `  Business verified:    ${waba.business_verification_status ?? "-"}`,
  );

  console.log("\nOwnership");
  console.log(
    `  Owned by:             ${waba.owner_business_info?.name ?? "not reported"}` +
      (waba.owner_business_info?.id ? `  (${waba.owner_business_info.id})` : ""),
  );

  // "On behalf of" means another business - typically a previous provider -
  // still holds a share of this account.
  if (waba.on_behalf_of_business_info?.id) {
    console.log(
      `  Shared with:          ${waba.on_behalf_of_business_info.name ?? "unknown"}` +
        `  (${waba.on_behalf_of_business_info.id})`,
    );
    console.log(
      `  Sharing status:       ${waba.on_behalf_of_business_info.status ?? "-"}`,
    );
    console.log("");
    console.log(
      "  Another business still has access to this WhatsApp account.",
    );
    console.log(
      "  If that is a previous provider, they may control the display name",
    );
    console.log("  and would need to release it.");
  } else {
    console.log("  Shared with:          nobody");
  }

  /* ---------------------------------------------------------------- */
  /* Who else can act on this account                                  */
  /* ---------------------------------------------------------------- */

  const sharedResponse = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.wabaId}/assigned_users?fields=id,name,tasks`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );

  const shared = (await sharedResponse.json()) as {
    data?: Array<{ id?: string; name?: string; tasks?: string[] }>;
    error?: { message?: string };
  };

  console.log("\nPeople with access");
  if (shared.error) {
    console.log(`  Could not read: ${shared.error.message}`);
  } else if (!shared.data?.length) {
    console.log("  None reported");
  } else {
    for (const u of shared.data) {
      console.log(
        `  ${u.name ?? u.id}  -  ${(u.tasks ?? []).join(", ") || "no tasks listed"}`,
      );
    }
    console.log("");
    console.log(
      "  MANAGE is the level needed to change the display name.",
    );
  }

  console.log("\nDirect link to this account in WhatsApp Manager:");
  console.log(
    `  https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${config.wabaId}`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
