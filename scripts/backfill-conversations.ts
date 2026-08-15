import "dotenv/config";

import { prisma } from "../src/lib/db";

/**
 * Links messages that were written without a conversation into their thread.
 *
 * Campaign and journey sends used to be stored with conversationId NULL, and
 * the inbox thread reads by conversation — so messages a customer genuinely
 * received were missing from their conversation, and an agent opening it saw a
 * gap where the message being replied to should be. Both senders now set it;
 * this repairs what they wrote before that.
 *
 * Creates a conversation for anyone who has none, because a campaign is often
 * the first thing ever sent to somebody. Nothing is deleted and no message is
 * re-sent — the only column written is the link itself.
 *
 * Safe to run more than once: the second run finds nothing left to do.
 *
 * Usage:  npx tsx scripts/backfill-conversations.ts
 */

async function main() {
  const orphans = await prisma.message.findMany({
    // Message.contactId is required, so every orphan has one to group by.
    where: { conversationId: null },
    select: { id: true, contactId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (orphans.length === 0) {
    console.log("\nNothing to do — every message is already in a thread.\n");
    return;
  }

  console.log(`\nFound ${orphans.length} message(s) with no conversation.\n`);

  const byContact = new Map<string, typeof orphans>();

  for (const message of orphans) {
    if (!message.contactId) continue;
    const list = byContact.get(message.contactId) ?? [];
    list.push(message);
    byContact.set(message.contactId, list);
  }

  let linked = 0;
  let created = 0;

  for (const [contactId, messages] of byContact) {
    const existing = await prisma.conversation.findUnique({
      where: { contactId },
      select: { id: true },
    });

    let conversationId = existing?.id;

    if (!conversationId) {
      // The newest of their messages is the best available "last activity".
      const newest = messages[messages.length - 1].createdAt;

      const conversation = await prisma.conversation.create({
        data: {
          contactId,
          status: "OPEN",
          lastMessageAt: newest,
          lastOutboundAt: newest,
          unreadCount: 0,
        },
        select: { id: true },
      });

      conversationId = conversation.id;
      created += 1;
    }

    const result = await prisma.message.updateMany({
      where: { id: { in: messages.map((m) => m.id) }, conversationId: null },
      data: { conversationId },
    });

    linked += result.count;
  }

  console.log(`Linked ${linked} message(s).`);
  console.log(`Created ${created} conversation(s) for contacts that had none.`);
  console.log("\nOpen the Inbox to see them in the thread.\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
