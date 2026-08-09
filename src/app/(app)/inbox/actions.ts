"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getServiceWindow } from "@/lib/inbox/service";
import { maskPhone, moduleLogger } from "@/lib/logger";
import { ForbiddenError } from "@/lib/rbac";
import { getProvider } from "@/lib/whatsapp";

const log = moduleLogger("inbox");

export interface ReplyState {
  error?: string;
  success?: boolean;
}

const replySchema = z.object({
  conversationId: z.string().min(1),
  body: z
    .string()
    .trim()
    .min(1, "Type a message first")
    .max(4096, "That message is too long for WhatsApp"),
});

/**
 * Sends a free-form reply.
 *
 * The 24-hour service window is re-checked here, server-side, immediately
 * before calling Meta. The UI disabling the box is a convenience; this is the
 * control. Without it, a stale tab could attempt a send that Meta would reject
 * and that would count as a failure against the account.
 */
export async function sendReply(
  _prev: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  try {
    const user = await requireApiAuth("inbox:reply");

    const parsed = replySchema.safeParse({
      conversationId: formData.get("conversationId"),
      body: formData.get("body"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid message" };
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: parsed.data.conversationId },
      include: { contact: true },
    });

    if (!conversation) return { error: "That conversation no longer exists." };

    const window = getServiceWindow(conversation.lastInboundAt);
    if (!window.open) {
      return {
        error:
          "You can only send a free message within 24 hours of the customer's last reply. Send an approved template instead.",
      };
    }

    const provider = await getProvider();
    if (!provider) {
      return {
        error:
          "WhatsApp is not connected yet. An administrator can set it up in Settings.",
      };
    }

    const result = await provider.sendTextMessage({
      to: conversation.contact.phoneE164,
      body: parsed.data.body,
    });

    if (result.accepted === false) {
      log.warn(
        { to: maskPhone(conversation.contact.phoneE164), code: result.error.code },
        "Reply rejected by WhatsApp",
      );
      return { error: result.error.userMessage };
    }

    const now = new Date();

    // A timed-out send is recorded rather than retried: whether Meta took it is
    // unknowable, and a duplicate message to a real customer is worse than an
    // uncertain record.
    const wamid =
      result.accepted === true ? result.externalMessageId : null;

    await prisma.$transaction([
      prisma.message.create({
        data: {
          wamid,
          direction: "OUTBOUND",
          contactId: conversation.contactId,
          conversationId: conversation.id,
          sentById: user.id,
          type: "text",
          body: parsed.data.body,
          payload: { text: { body: parsed.data.body } },
          status: "SENT",
          sentAt: now,
          ...(result.accepted === "unknown"
            ? {
                errorUserMessage:
                  "WhatsApp did not confirm this message. It may or may not have been delivered.",
              }
            : {}),
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastOutboundAt: now, status: "OPEN" },
      }),
      prisma.contact.update({
        where: { id: conversation.contactId },
        data: { lastContactedAt: now },
      }),
    ]);

    await audit(user, "inbox.reply", {
      entityType: "Conversation",
      entityId: conversation.id,
    });

    revalidatePath("/inbox");
    return { success: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to reply." };
    }
    log.error(
      { err: error instanceof Error ? error.message : error },
      "Reply failed",
    );
    return { error: "The message could not be sent. Please try again." };
  }
}

/** Clears the unread badge and sends a read receipt where possible. */
export async function markConversationRead(
  conversationId: string,
): Promise<void> {
  try {
    await requireApiAuth("inbox:view");

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, unreadCount: true },
    });

    if (!conversation || conversation.unreadCount === 0) return;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });

    // Best effort: the customer seeing blue ticks is a nicety, and a failure
    // here must not stop the inbox working.
    const provider = await getProvider();
    if (provider) {
      const lastInbound = await prisma.message.findFirst({
        where: {
          conversationId,
          direction: "INBOUND",
          wamid: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: { wamid: true },
      });

      if (lastInbound?.wamid) {
        await provider.markMessageAsRead(lastInbound.wamid).catch(() => false);
      }
    }

    revalidatePath("/inbox");
  } catch {
    // Marking as read is not worth surfacing an error for.
  }
}
