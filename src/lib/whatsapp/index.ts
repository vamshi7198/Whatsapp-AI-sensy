import { env } from "../env";
import { getMetaConfig } from "../settings";

import { MetaCloudProvider } from "./providers/meta";
import type { WhatsAppProvider } from "./provider";

export { ProviderNotConfiguredError } from "./provider";
export type { WhatsAppProvider } from "./provider";
export * from "./types";

/**
 * Resolves the configured provider, or null when WhatsApp is not connected.
 *
 * Returning null rather than throwing is deliberate: the application is
 * expected to run before credentials exist, and every caller must decide what
 * "not connected" means for its own screen. There is no mock provider here —
 * where credentials are missing the UI says so rather than simulating a send.
 */
export async function getProvider(): Promise<WhatsAppProvider | null> {
  const config = await getMetaConfig();
  if (!config) return null;

  return new MetaCloudProvider(config, env.META_APP_SECRET);
}

/**
 * Provider for webhook handling, which needs signature verification before
 * any credentials have been read from the database.
 */
export async function getWebhookProvider(): Promise<WhatsAppProvider | null> {
  return getProvider();
}
