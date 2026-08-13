import { prisma } from "../db";

/**
 * Conversation reads for the inbox.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ServiceWindow {
  open: boolean;
  expiresAt: Date | null;
  /** Whole hours remaining, for the countdown label. */
  hoursLeft: number;
  minutesLeft: number;
}

/**
 * Whether free-form replies are currently allowed.
 *
 * Meta permits non-template messages only within 24 hours of the customer's
 * most recent message. Outside that window an approved template is required.
 * Computed from stored timestamps rather than trusted from the client, and
 * re-checked server-side before every send.
 */
export function getServiceWindow(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): ServiceWindow {
  if (!lastInboundAt) {
    return { open: false, expiresAt: null, hoursLeft: 0, minutesLeft: 0 };
  }

  const expiresAt = new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS);
  const remaining = expiresAt.getTime() - now.getTime();

  if (remaining <= 0) {
    return { open: false, expiresAt, hoursLeft: 0, minutesLeft: 0 };
  }

  return {
    open: true,
    expiresAt,
    hoursLeft: Math.floor(remaining / (60 * 60 * 1000)),
    minutesLeft: Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000)),
  };
}

export interface ConversationListItem {
  id: string;
  contactId: string;
  name: string | null;
  phoneE164: string;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  unreadCount: number;
  status: "OPEN" | "PENDING" | "CLOSED";
  preview: string | null;
  previewDirection: "INBOUND" | "OUTBOUND" | null;
  /**
   * Where an automated conversation has got to, when there is one.
   *
   * Shown so an agent does not reply into the middle of a journey's sentence,
   * and so a journey that asked for a person is visible to one.
   */
  journey: {
    name: string;
    step: string | null;
    needsPerson: boolean;
  } | null;
}

export async function listConversations(options: {
  search?: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<ConversationListItem[]> {
  const conversations = await prisma.conversation.findMany({
    where: {
      ...(options.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      ...(options.search
        ? {
            contact: {
              OR: [
                { name: { contains: options.search, mode: "insensitive" } },
                { phoneE164: { contains: options.search.replace(/[^\d]/g, "") } },
              ],
            },
          }
        : {}),
      contact: options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" } },
              { phoneE164: { contains: options.search.replace(/[^\d]/g, "") } },
            ],
            deletedAt: null,
          }
        : { deletedAt: null },
    },
    orderBy: { lastMessageAt: "desc" },
    take: options.limit ?? 100,
    select: {
      id: true,
      contactId: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      lastInboundAt: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, type: true, direction: true },
      },
    },
  });

  // Who is partway through a journey, and where.
  //
  // Without this an agent replies into a conversation with no idea a journey
  // is mid-sentence, and a journey that handed someone over tells nobody it
  // did. Fetched in one query rather than per conversation.
  const sessions = await prisma.journeySession.findMany({
    where: {
      contactId: { in: conversations.map((c) => c.contactId) },
      status: {
        in: ["ACTIVE", "WAITING_FOR_REPLY", "WAITING_UNTIL", "HANDED_OFF"],
      },
    },
    select: {
      contactId: true,
      status: true,
      journey: { select: { name: true } },
      currentStep: { select: { name: true } },
    },
  });

  const byContact = new Map(sessions.map((s) => [s.contactId, s]));

  return conversations.map((c) => {
    const session = byContact.get(c.contactId);

    return {
      id: c.id,
      contactId: c.contactId,
      name: c.contact.name,
      phoneE164: c.contact.phoneE164,
      lastMessageAt: c.lastMessageAt,
      lastInboundAt: c.lastInboundAt,
      unreadCount: c.unreadCount,
      status: c.status,
      preview: c.messages[0]?.body ?? (c.messages[0] ? `(${c.messages[0].type})` : null),
      previewDirection: c.messages[0]?.direction ?? null,
      journey: session
        ? {
            name: session.journey.name,
            step: session.currentStep?.name ?? null,
            /** True when a journey step deliberately asked for a person. */
            needsPerson: session.status === "HANDED_OFF",
          }
        : null,
    };
  });
}

export async function getConversation(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: {
        include: { tags: { include: { tag: true } } },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          direction: true,
          type: true,
          body: true,
          status: true,
          errorUserMessage: true,
          createdAt: true,
          readAt: true,
          deliveredAt: true,
          templateId: true,
          sentBy: { select: { name: true } },
        },
      },
    },
  });
}

export async function getUnreadTotal(): Promise<number> {
  const result = await prisma.conversation.aggregate({
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount ?? 0;
}
