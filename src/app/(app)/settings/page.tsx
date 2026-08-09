import { requireAuth } from "@/lib/auth/guards";

import { ComingSoon } from "../_components/coming-soon";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAuth("settings:view");

  return (
    <ComingSoon
      title="Settings"
      phase="Phase 1b"
      description="Connect your WhatsApp Business account and manage your team."
      willDo={[
        "WhatsApp connection: WABA ID, Phone Number ID, API version and access token",
        "Test connection, so you know the credentials work before sending anything",
        "Team members and their roles",
        "Opt-out keywords and consent settings",
        "Messaging price table, so cost estimates stay accurate without a code change",
        "Activity log of everything sent, delivered and failed",
      ]}
      blockedBy="Nothing — this is the next screen being built. Your access token will be encrypted and never shown again after saving."
    />
  );
}
