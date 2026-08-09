import "dotenv/config";

import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { getMetaConfig, SETTING_KEYS, setSetting } from "../src/lib/settings";
import { MetaCloudProvider } from "../src/lib/whatsapp/providers/meta";

/**
 * Reports whether the saved Meta access token expires, and what it can do.
 *
 * Meta hands out two very different tokens that look identical: the temporary
 * one on the API Setup page (24 hours) and a System User token (permanent).
 * Saving the wrong one means the platform silently stops sending tomorrow
 * morning, so this asks Meta directly rather than assuming.
 *
 * Usage: npx tsx scripts/check-token.ts
 */

interface DebugTokenResponse {
  data?: {
    app_id?: string;
    type?: string;
    application?: string;
    data_access_expires_at?: number;
    expires_at?: number;
    is_valid?: boolean;
    scopes?: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
  error?: { message?: string; code?: number };
}

function formatWhen(unix: number): string {
  const date = new Date(unix * 1000);
  const days = Math.round((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return `${date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (${days} days from now)`;
}

async function main() {
  const config = await getMetaConfig();

  if (!config) {
    console.log("No token saved yet. Add it in Settings > WhatsApp connection.");
    await prisma.$disconnect();
    return;
  }

  console.log("Checking the saved token with Meta\n");

  /* ---------------------------------------------------------------- */
  /* 1. Does it expire?                                                */
  /* ---------------------------------------------------------------- */

  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    console.log("  ! Cannot check expiry: META_APP_ID/META_APP_SECRET missing");
  } else {
    // The app access token is literally "<app-id>|<app-secret>".
    const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
    const url =
      `https://graph.facebook.com/${config.apiVersion}/debug_token` +
      `?input_token=${encodeURIComponent(config.accessToken)}` +
      `&access_token=${encodeURIComponent(appToken)}`;

    const response = await fetch(url);
    const body = (await response.json()) as DebugTokenResponse;

    if (body.error) {
      console.log(`  ! Meta rejected the check: ${body.error.message}`);
    } else if (body.data) {
      const d = body.data;

      console.log("Token");
      console.log(`  Valid:        ${d.is_valid ? "yes" : "NO"}`);
      console.log(`  Type:         ${d.type ?? "unknown"}`);

      // expires_at of 0 means "never" — the answer we want.
      if (d.expires_at === 0 || d.expires_at === undefined) {
        console.log("  Expires:      NEVER");
        console.log("                Nothing to renew. This is correct.");
      } else {
        console.log(`  Expires:      ${formatWhen(d.expires_at)}`);
        console.log(
          "                WRONG TOKEN TYPE - sending will stop when this lapses.",
        );
      }

      const scopes = d.scopes ?? [];
      const needed = [
        "whatsapp_business_messaging",
        "whatsapp_business_management",
      ];

      console.log("\nPermissions");
      for (const scope of needed) {
        const has = scopes.includes(scope);
        console.log(`  ${has ? "yes" : "NO "}  ${scope}`);
      }

      const extra = scopes.filter((s) => !needed.includes(s));
      if (extra.length) {
        console.log(`  (also granted: ${extra.join(", ")})`);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 2. Does it actually work?                                         */
  /* ---------------------------------------------------------------- */

  console.log("\nLive connection");
  const provider = new MetaCloudProvider(config, env.META_APP_SECRET);

  const [phone, account] = await Promise.all([
    provider.getPhoneNumber(),
    provider.getBusinessAccount(),
  ]);

  if (!phone) {
    console.log("  FAILED - Meta rejected these credentials.");
  } else {
    console.log(`  Business:     ${account?.name ?? "unknown"}`);
    console.log(`  Number:       ${phone.displayPhoneNumber}`);
    console.log(`  Display name: ${phone.verifiedName}`);
    console.log(`  Quality:      ${phone.qualityRating ?? "not reported"}`);
    console.log(`  Daily limit:  ${phone.messagingLimitTier ?? "not reported"}`);

    if (phone.qualityRating) {
      await setSetting(SETTING_KEYS.QUALITY_RATING, phone.qualityRating);
    }
    if (phone.messagingLimitTier) {
      await setSetting(SETTING_KEYS.MESSAGING_TIER, phone.messagingLimitTier);
    }
    await setSetting(SETTING_KEYS.LAST_CONNECTION_OK, new Date().toISOString());
  }

  /* ---------------------------------------------------------------- */
  /* 3. Can it read templates?                                         */
  /* ---------------------------------------------------------------- */

  console.log("\nTemplates");
  try {
    const page = await provider.getTemplates();
    console.log(`  Found ${page.items.length} template(s)`);
    for (const t of page.items.slice(0, 15)) {
      console.log(
        `    ${t.status.padEnd(9)} ${t.category.padEnd(15)} ${t.name} (${t.language})`,
      );
    }
    if (page.items.length > 15) {
      console.log(`    ... and ${page.items.length - 15} more`);
    }
  } catch (error) {
    console.log(
      `  Could not read templates: ${error instanceof Error ? error.message : error}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
