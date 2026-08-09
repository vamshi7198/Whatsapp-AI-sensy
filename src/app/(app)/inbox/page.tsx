import { requireAuth } from "@/lib/auth/guards";
import {
  getConversation,
  getServiceWindow,
  listConversations,
} from "@/lib/inbox/service";
import { isMetaConnected } from "@/lib/settings";

import { ConversationList } from "./_components/conversation-list";
import { ConversationThread } from "./_components/conversation-thread";
import { InboxEmpty } from "./_components/inbox-empty";

export const metadata = { title: "Inbox" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuth("inbox:view");
  const params = await searchParams;

  const search = typeof params.q === "string" ? params.q : undefined;
  const unreadOnly = params.unread === "1";
  const selectedId = typeof params.c === "string" ? params.c : undefined;

  const [conversations, connected] = await Promise.all([
    listConversations({ search, unreadOnly }),
    isMetaConnected(),
  ]);

  const selected = selectedId ? await getConversation(selectedId) : null;
  const window = selected
    ? getServiceWindow(selected.lastInboundAt)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Inbox
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Reply to customers the way you would in WhatsApp.
          </p>
        </div>
      </div>

      {!connected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            WhatsApp is not connected yet
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Incoming messages will appear here once an administrator connects
            your WhatsApp Business account and this app is reachable from the
            internet.
          </p>
        </div>
      )}

      <div className="grid gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[320px_1fr] dark:border-slate-800 dark:bg-slate-900">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          search={search}
          unreadOnly={unreadOnly}
        />

        <div className="min-h-125 border-t border-slate-200 lg:border-t-0 lg:border-l dark:border-slate-800">
          {selected && window ? (
            <ConversationThread
              conversation={{
                id: selected.id,
                contactId: selected.contactId,
                name: selected.contact.name,
                phoneE164: selected.contact.phoneE164,
                marketingOptOut: selected.contact.marketingOptOut,
                tags: selected.contact.tags.map((t) => t.tag.name),
                unreadCount: selected.unreadCount,
              }}
              messages={selected.messages}
              window={{
                open: window.open,
                hoursLeft: window.hoursLeft,
                minutesLeft: window.minutesLeft,
              }}
              canSend={connected}
            />
          ) : (
            <InboxEmpty hasConversations={conversations.length > 0} />
          )}
        </div>
      </div>
    </div>
  );
}
