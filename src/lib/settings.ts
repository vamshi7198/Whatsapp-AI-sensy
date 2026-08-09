import { decryptSecret, encryptSecret, maskSecret } from "./crypto";
import { prisma } from "./db";
import { moduleLogger } from "./logger";

const log = moduleLogger("settings");

/**
 * Application settings, including the Meta access token.
 *
 * Non-secret values live in `AppSetting.value`. Secrets are AES-256-GCM
 * encrypted into `valueEnc` and are only ever decrypted server-side, inside
 * the provider. There is no code path that returns a decrypted secret to a
 * route handler response.
 */

export const SETTING_KEYS = {
  WABA_ID: "meta.waba_id",
  PHONE_NUMBER_ID: "meta.phone_number_id",
  API_VERSION: "meta.api_version",
  ACCESS_TOKEN: "meta.access_token",
  QUALITY_RATING: "meta.quality_rating",
  MESSAGING_TIER: "meta.messaging_tier",
  LAST_CONNECTION_OK: "meta.last_connection_ok",
  LAST_CONNECTION_ERROR: "meta.last_connection_error",
  OPT_OUT_KEYWORDS: "compliance.opt_out_keywords",
  DEFAULT_OPT_IN: "compliance.default_opt_in",
  SEND_RATE_MPS: "campaign.send_rate_mps",
  LARGE_THRESHOLD: "campaign.large_threshold",
  DEFAULT_TIMEZONE: "campaign.default_timezone",
} as const;

/** Meta supports each Graph API version for roughly two years. */
export const DEFAULT_API_VERSION = "v23.0";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  updatedById?: string,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value, isSecret: false, updatedById },
    create: { key, value, isSecret: false, updatedById },
  });
}

/** Stores a secret encrypted. The plaintext is never persisted. */
export async function setSecret(
  key: string,
  plaintext: string,
  updatedById?: string,
): Promise<void> {
  // Prisma's Bytes field wants Uint8Array<ArrayBuffer>; Node's Buffer is
  // typed over ArrayBufferLike, so convert at the boundary.
  const encrypted = encryptSecret(plaintext);
  const valueEnc = new Uint8Array(
    encrypted.buffer.slice(
      encrypted.byteOffset,
      encrypted.byteOffset + encrypted.byteLength,
    ) as ArrayBuffer,
  );

  await prisma.appSetting.upsert({
    where: { key },
    update: { valueEnc, value: null, isSecret: true, updatedById },
    create: { key, valueEnc, isSecret: true, updatedById },
  });
}

/**
 * Decrypts a secret. Server-side only — callers must never put the result in
 * a response body, a log line, or an error message.
 */
export async function getSecret(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row?.valueEnc) return null;

  try {
    return decryptSecret(Buffer.from(row.valueEnc));
  } catch (error) {
    // Almost always a changed or lost APP_ENCRYPTION_KEY.
    log.error(
      { key, err: error instanceof Error ? error.message : error },
      "Failed to decrypt secret",
    );
    return null;
  }
}

/**
 * Safe description of a secret for the UI: whether it is set and its last four
 * characters. This is the only shape a secret takes in an API response.
 */
export async function describeSecret(
  key: string,
): Promise<{ isSet: boolean; masked: string | null }> {
  const plaintext = await getSecret(key);
  return plaintext
    ? { isSet: true, masked: maskSecret(plaintext) }
    : { isSet: false, masked: null };
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
}

export interface MetaConfig {
  wabaId: string;
  phoneNumberId: string;
  apiVersion: string;
  accessToken: string;
}

/**
 * Full Meta configuration, or null when it is incomplete.
 *
 * Returning null rather than throwing lets callers show "not connected"
 * instead of an error — the app is expected to run before Meta is wired up.
 */
export async function getMetaConfig(): Promise<MetaConfig | null> {
  const [wabaId, phoneNumberId, apiVersion, accessToken] = await Promise.all([
    getSetting(SETTING_KEYS.WABA_ID),
    getSetting(SETTING_KEYS.PHONE_NUMBER_ID),
    getSetting(SETTING_KEYS.API_VERSION),
    getSecret(SETTING_KEYS.ACCESS_TOKEN),
  ]);

  if (!wabaId || !phoneNumberId || !accessToken) return null;

  return {
    wabaId,
    phoneNumberId,
    apiVersion: apiVersion || DEFAULT_API_VERSION,
    accessToken,
  };
}

/** Whether Meta is connected, without decrypting the token. */
export async function isMetaConnected(): Promise<boolean> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          SETTING_KEYS.WABA_ID,
          SETTING_KEYS.PHONE_NUMBER_ID,
          SETTING_KEYS.ACCESS_TOKEN,
        ],
      },
    },
    select: { key: true, value: true, valueEnc: true },
  });

  const present = new Set(
    rows.filter((r) => r.value || r.valueEnc).map((r) => r.key),
  );

  return (
    present.has(SETTING_KEYS.WABA_ID) &&
    present.has(SETTING_KEYS.PHONE_NUMBER_ID) &&
    present.has(SETTING_KEYS.ACCESS_TOKEN)
  );
}

export async function getOptOutKeywords(): Promise<string[]> {
  const raw = await getSetting(SETTING_KEYS.OPT_OUT_KEYWORDS);
  return (raw ?? "STOP,UNSUBSCRIBE,REMOVE")
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean);
}
