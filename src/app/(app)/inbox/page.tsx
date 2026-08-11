import Link from "next/link";

import { requireAuth } from "@/lib/auth/guards";
import {
  getConversation,
  getServiceWindow,
  listConversations,
} from "@/lib/inbox/service";
import { listSendableFlows } from "@/lib/flows/service";
import { isMetaConnected } from "@/lib/settings";
import { cn } from "@/lib/utils";

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

  const [conversations, connected, forms] = await Promise.all([
    listConversations({ search, unreadOnly }),
    isMetaConnected(),
    // Drafts are included: a form has to be testable on a real phone before
    // it is published, and publishing cannot be undone.
    listSendableFlows(),
  ]);

  // Back to the list on mobile, keeping whatever search or filter was applied
  // so closing a conversation does not undo the user's place.
  const backParams = new URLSearchParams();
  if (search) backParams.set("q", search);
  if (unreadOnly) backParams.set("unread", "1");
  const backQuery = backParams.toString();
  const backHref = backQuery ? `/inbox?${backQuery}` : "/inbox";

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

      {/*
        On a phone there is not room for the list and the thread at once, so it
        behaves the way WhatsApp does: the list fills the screen, and opening a
        conversation replaces it. On a laptop both are visible side by side.
      */}
      <div className="grid gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[320px_1fr] dark:border-slate-800 dark:bg-slate-900">
        <div className={selected ? "hidden lg:block" : "block"}>
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            search={search}
            unreadOnly={unreadOnly}
          />
        </div>

        <div
          className={cn(
            "min-h-125 border-slate-200 lg:block lg:border-t-0 lg:border-l dark:border-slate-800",
            selected ? "block" : "hidden border-t",
          )}
        >
          {selected && (
            <Link
              href={backHref}
              className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 lg:hidden dark:border-slate-800 dark:text-slate-300"
            >
              <span aria-hidden="true">←</span>
              All conversations
            </Link>
          )}

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
              forms={forms}
            />
          ) : (
            <InboxEmpty hasConversations={conversations.length > 0} />
          )}
        </div>
      </div>
    </div>
  );
}
