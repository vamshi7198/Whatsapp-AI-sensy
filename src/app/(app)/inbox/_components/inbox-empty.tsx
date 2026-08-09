export function InboxEmpty({
  hasConversations,
}: {
  hasConversations: boolean;
}) {
  return (
    <div className="flex h-full min-h-125 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl dark:bg-slate-800"
          aria-hidden="true"
        >
          💬
        </div>

        {hasConversations ? (
          <>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Choose a conversation
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Pick someone from the list to read and reply to their messages.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No conversations yet
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              When a customer messages your WhatsApp number, the conversation
              will appear here and you can reply directly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
