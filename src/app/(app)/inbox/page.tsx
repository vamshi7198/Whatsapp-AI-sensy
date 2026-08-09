import { requireAuth } from "@/lib/auth/guards";

import { ComingSoon } from "../_components/coming-soon";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireAuth("inbox:view");

  return (
    <ComingSoon
      title="Inbox"
      phase="Phase 2"
      description="Chat with customers the way you would in WhatsApp."
      willDo={[
        "Conversation list on the left, the chat thread on the right",
        "Type and send a reply directly, like normal WhatsApp",
        "Show how long is left in the 24-hour reply window, and offer an approved template once it closes",
        "Unread counts, search, and customer details beside the conversation",
      ]}
      blockedBy="The Meta webhook, which delivers incoming messages. That needs your credentials and a public web address for this app."
    />
  );
}
