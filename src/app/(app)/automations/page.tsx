import { requireAuth } from "@/lib/auth/guards";

import { ComingSoon } from "../_components/coming-soon";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
  await requireAuth("automation:view");

  return (
    <ComingSoon
      title="Automations"
      phase="Phase 3"
      description="Reply automatically when something happens."
      willDo={[
        'Send a template when a message contains a keyword, such as "track"',
        "Send a template when a contact gets a particular tag",
        "Add or remove tags automatically",
        "Every automation starts switched off, so nothing messages a customer until you turn it on",
      ]}
      blockedBy="Incoming messages, which arrive through the Meta webhook."
    />
  );
}
