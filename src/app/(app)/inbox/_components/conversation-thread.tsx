"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";
import { cn } from "@/lib/utils";

import { sendFlowAction } from "../../flows/actions";
import { markConversationRead, sendReply } from "../actions";

interface ThreadMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  status: string;
  errorUserMessage: string | null;
  createdAt: Date;
  readAt: Date | null;
  deliveredAt: Date | null;
  templateId: string | null;
  sentBy: { name: string } | null;
}

interface ConversationSummary {
  id: string;
  contactId: string;
  name: string | null;
  phoneE164: string;
  marketingOptOut: boolean;
  tags: string[];
  unreadCount: number;
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatDay(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

/** WhatsApp-style ticks. Failure is shown as text, never a colour alone. */
function StatusTicks({ status }: { status: string }) {
  if (status === "FAILED") {
    return <span className="text-[11px] text-red-600">Not delivered</span>;
  }
  if (status === "READ") return <span className="text-[11px] text-sky-500">✓✓</span>;
  if (status === "DELIVERED") return <span className="text-[11px] text-slate-400">✓✓</span>;
  if (status === "SENT") return <span className="text-[11px] text-slate-400">✓</span>;
  return <span className="text-[11px] text-slate-300">○</span>;
}

export function ConversationThread({
  conversation,
  messages,
  window: serviceWindow,
  canSend,
  forms,
}: {
  conversation: ConversationSummary;
  messages: ThreadMessage[];
  window: { open: boolean; hoursLeft: number; minutesLeft: number };
  canSend: boolean;
  /** Forms that can be sent to this person right now. */
  forms: Array<{ id: string; name: string; status: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Scroll to the newest message, as a chat app should.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Clearing the unread badge is a side effect of opening the thread; it
  // touches the server and the WhatsApp read receipt, not local state.
  useEffect(() => {
    if (conversation.unreadCount > 0) {
      void markConversationRead(conversation.id);
    }
  }, [conversation.id, conversation.unreadCount]);

  // Day separators are derived up front rather than by mutating a variable
  // during render, which would behave inconsistently across re-renders.
  const dayLabels = messages.map((m, i) => {
    const day = formatDay(m.createdAt);
    return i === 0 || day !== formatDay(messages[i - 1].createdAt) ? day : null;
  });

  return (
    <div className="flex h-full max-h-150 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          aria-hidden="true"
        >
          {(conversation.name ?? conversation.phoneE164).slice(0, 2).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {conversation.name || "Unnamed contact"}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {formatPhoneForDisplay(conversation.phoneE164)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {conversation.marketingOptOut && (
            <Badge tone="red">Opted out of marketing</Badge>
          )}
          {conversation.tags.slice(0, 2).map((t) => (
            <Badge key={t} tone="blue">
              {t}
            </Badge>
          ))}
          <Link
            href={`/contacts/${conversation.contactId}`}
            className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400"
          >
            Details
          </Link>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-1 overflow-y-auto bg-slate-50 px-4 py-3 dark:bg-slate-950/40"
      >
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            No messages in this conversation yet.
          </p>
        )}

        {messages.map((m, i) => {
          const dayLabel = dayLabels[i];
          const outbound = m.direction === "OUTBOUND";

          return (
            <div key={m.id}>
              {dayLabel && (
                <p className="my-3 text-center text-[11px] text-slate-400">
                  {dayLabel}
                </p>
              )}

              <div
                className={cn("flex", outbound ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm",
                    outbound
                      ? "rounded-br-sm bg-emerald-100 text-slate-900 dark:bg-emerald-900 dark:text-emerald-50"
                      : "rounded-bl-sm bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100",
                  )}
                >
                  {m.templateId && (
                    <p className="mb-0.5 text-[10px] font-medium tracking-wide text-slate-400 uppercase">
                      Template
                    </p>
                  )}

                  <p className="break-words whitespace-pre-wrap">
                    {m.body || `(${m.type})`}
                  </p>

                  {m.errorUserMessage && (
                    <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                      {m.errorUserMessage}
                    </p>
                  )}

                  <div className="mt-0.5 flex items-center justify-end gap-1.5">
                    {outbound && m.sentBy && (
                      <span className="text-[10px] text-slate-400">
                        {m.sentBy.name}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">
                      {formatTime(m.createdAt)}
                    </span>
                    {outbound && <StatusTicks status={m.status} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {!canSend ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            WhatsApp is not connected, so replies cannot be sent yet.
          </p>
        ) : serviceWindow.open ? (
          <>
            <form
              ref={formRef}
              action={(formData) => {
                setError(null);
                formData.set("conversationId", conversation.id);
                startTransition(async () => {
                  const result = await sendReply({}, formData);
                  if (result.error) setError(result.error);
                  else formRef.current?.reset();
                });
              }}
              className="flex gap-2"
            >
              <input
                name="body"
                required
                maxLength={4096}
                autoComplete="off"
                placeholder="Type a message"
                className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <Button type="submit" disabled={isPending} className="rounded-full px-5">
                {isPending ? "Sending…" : "Send"}
              </Button>
            </form>

            {/*
              Forms can only be sent inside the window, so the option belongs
              here rather than on a toolbar that would sometimes be dead.
            */}
            {forms.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400">Send a form:</span>

                {forms.map((form) => (
                  <Button
                    key={form.id}
                    variant="secondary"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      setError(null);
                      const formData = new FormData();
                      formData.set("flowId", form.id);
                      formData.set("contactId", conversation.contactId);
                      formData.set("body", form.name);
                      formData.set("buttonText", "Open form");

                      startTransition(async () => {
                        const result = await sendFlowAction({}, formData);
                        if (result.error) setError(result.error);
                      });
                    }}
                  >
                    {form.name}
                    {form.status === "DRAFT" && (
                      <span className="ml-1 text-[10px] opacity-70">draft</span>
                    )}
                  </Button>
                ))}
              </div>
            )}

            <p className="mt-1.5 text-center text-[11px] text-slate-400">
              {serviceWindow.hoursLeft > 0
                ? `${serviceWindow.hoursLeft}h ${serviceWindow.minutesLeft}m left to reply freely`
                : `${serviceWindow.minutesLeft}m left to reply freely`}
            </p>
          </>
        ) : (
          /* Outside the 24-hour window Meta only permits approved templates.
             Explained in plain language rather than shown as an error. */
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              You can&rsquo;t send a free message right now
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              WhatsApp only allows free replies within 24 hours of the
              customer&rsquo;s last message. Send an approved template to start
              the conversation again.
            </p>
            <Link href="/templates">
              <Button variant="secondary" size="sm" className="mt-2">
                Choose a template
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
