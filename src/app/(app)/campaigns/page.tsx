import { requireAuth } from "@/lib/auth/guards";

import { ComingSoon } from "../_components/coming-soon";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  await requireAuth("campaign:view");

  return (
    <ComingSoon
      title="Campaigns"
      phase="Phase 1c"
      description="Send an approved template to a group of contacts."
      willDo={[
        "Six-step wizard: name, audience, template, variable mapping, preview, confirm",
        "Preview the real message for five actual recipients before anything is sent",
        "Skip contacts who have not opted in, and show you exactly who and why",
        "Send through a queue so a large campaign never blocks the app",
        "Track delivered, read and failed per recipient, with plain-English failure reasons",
      ]}
      blockedBy="Templates, which need your Meta credentials first."
    />
  );
}
