"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Input } from "@/components/ui/field";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import type { ConversationListItem } from "@/lib/inbox/service";
import { cn } from "@/lib/utils";

/** WhatsApp-style relative time: "2m", "3h", "Mon", "12 Aug". */
function relativeTime(value: Date | null): string {
  if (!value) return "";

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      timeZone: "Asia/Kolkata",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function ConversationList({
  conversations,
  selectedId,
  search,
  unreadOnly,
}: {
  conversations: ConversationListItem[];
  selectedId?: string;
  search?: string;
  unreadOnly: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(search ?? "");
  const [, startTransition] = useTransition();

  function apply(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => router.push(`/inbox?${params.toString()}`));
  }

  return (
    <div className="flex max-h-150 flex-col">
      <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply({ q: query.trim() || undefined });
          }}
        >
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="text-sm"
          />
        </form>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => apply({ unread: undefined })}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition",
              !unreadOnly
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => apply({ unread: "1" })}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition",
              unreadOnly
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
          >
            Unread
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">
            {search || unreadOnly
              ? "No conversations match."
              : "No conversations yet."}
          </p>
        ) : (
          <ul>
            {conversations.map((c) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("c", c.id);

              return (
                <li key={c.id}>
                  <Link
                    href={`/inbox?${params.toString()}`}
                    className={cn(
                      "flex gap-3 border-b border-slate-100 px-3 py-2.5 transition dark:border-slate-800",
                      selectedId === c.id
                        ? "bg-emerald-50 dark:bg-emerald-950/40"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                    )}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      aria-hidden="true"
                    >
                      {(c.name ?? c.phoneE164).slice(0, 2).toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {c.name || formatPhoneForDisplay(c.phoneE164)}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {relativeTime(c.lastMessageAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {c.previewDirection === "OUTBOUND" && (
                            <span className="text-slate-400">You: </span>
                          )}
                          {c.preview ?? "No messages"}
                        </p>
                        {c.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-medium text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
