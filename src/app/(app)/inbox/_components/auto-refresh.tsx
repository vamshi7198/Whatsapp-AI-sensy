"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the Inbox current while it sits open.
 *
 * A chat inbox is left open all day — that is how it is used. Inbound messages
 * landed in the database and nothing told the page, so new messages, unread
 * badges and delivery ticks stayed invisible until someone thought to reload.
 * The operator watched a screen that looked quiet while a customer waited.
 *
 * Unlike the Templates poller this only re-renders from our own database; there
 * is nothing to ask Meta for, because inbound messages arrive by webhook.
 *
 * Paused while the tab is hidden. The Inbox is the screen most likely to be
 * left open in a background tab for hours, and polling one of those is pure
 * waste — the visibility listener also fires an immediate refresh on return,
 * so coming back to the tab shows current state rather than a stale page for
 * up to another interval.
 */
export function InboxAutoRefresh({ intervalMs = 12_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        router.refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}
