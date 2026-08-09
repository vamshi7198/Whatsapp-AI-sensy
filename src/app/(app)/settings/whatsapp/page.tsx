import { requireAuth } from "@/lib/auth/guards";
import { env } from "@/lib/env";
import {
  DEFAULT_API_VERSION,
  SETTING_KEYS,
  describeSecret,
  getSetting,
} from "@/lib/settings";

import { WhatsAppSettingsForm } from "./_form";

export const metadata = { title: "WhatsApp connection" };

export default async function WhatsAppSettingsPage() {
  await requireAuth("settings:whatsapp");

  const [
    wabaId,
    phoneNumberId,
    apiVersion,
    token,
    lastOk,
    quality,
    tier,
    forwardUrl,
    forwardEnabled,
  ] = await Promise.all([
    getSetting(SETTING_KEYS.WABA_ID),
    getSetting(SETTING_KEYS.PHONE_NUMBER_ID),
    getSetting(SETTING_KEYS.API_VERSION),
    // Only "is it set" and the last four characters ever leave the server.
    describeSecret(SETTING_KEYS.ACCESS_TOKEN),
    getSetting(SETTING_KEYS.LAST_CONNECTION_OK),
    getSetting(SETTING_KEYS.QUALITY_RATING),
    getSetting(SETTING_KEYS.MESSAGING_TIER),
    getSetting(SETTING_KEYS.WEBHOOK_FORWARD_URL),
    getSetting(SETTING_KEYS.WEBHOOK_FORWARD_ENABLED),
  ]);

  return (
    <WhatsAppSettingsForm
      initial={{
        wabaId: wabaId ?? "",
        phoneNumberId: phoneNumberId ?? "",
        apiVersion: apiVersion ?? DEFAULT_API_VERSION,
        tokenIsSet: token.isSet,
        tokenMasked: token.masked,
        lastConnectionOk: lastOk,
        qualityRating: quality,
        messagingTier: tier,
        appSecretConfigured: Boolean(env.META_APP_SECRET),
        webhookUrl: `${env.APP_URL}/api/webhooks/whatsapp`,
        verifyTokenConfigured: Boolean(env.META_WEBHOOK_VERIFY_TOKEN),
        forwardUrl,
        forwardEnabled: forwardEnabled === "true",
      }}
    />
  );
}
