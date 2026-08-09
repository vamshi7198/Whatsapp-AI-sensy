import { requireAuth } from "@/lib/auth/guards";

import { ComingSoon } from "../_components/coming-soon";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  await requireAuth("template:view");

  return (
    <ComingSoon
      title="Templates"
      phase="Phase 1b"
      description="Your approved WhatsApp message templates, synced from Meta."
      willDo={[
        "List every template on your WhatsApp Business Account with its category, language and approval status",
        "Show a WhatsApp-style preview of each template",
        "Sync automatically every 6 hours, and immediately when Meta changes a template's status",
        "Block any template that is not approved from ever being sent",
      ]}
      blockedBy="Your Meta credentials — WABA ID, Phone Number ID, App Secret and a System User access token."
    />
  );
}
