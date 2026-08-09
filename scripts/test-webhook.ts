import "dotenv/config";

import { prisma } from "../src/lib/db";
import { processWebhookEvents } from "../src/lib/webhooks/processor";
import type { NormalisedWebhookEvent } from "../src/lib/whatsapp/types";

/**
 * End-to-end webhook test against the real database.
 *
 * Covers the two properties Meta does not provide and that this system must
 * guarantee itself: idempotency under retries, and correctness when statuses
 * arrive out of order.
 */

const PHONE = "+919999000011";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const at = (iso: string) => new Date(iso);

function inbound(text: string, id: string, when: string): NormalisedWebhookEvent {
  return {
    kind: "inbound_message",
    externalMessageId: id,
    from: PHONE,
    contactName: "Webhook Test",
    type: "text",
    text,
    timestamp: at(when),
    raw: { id, text: { body: text } },
  };
}

async function cleanup() {
  const contact = await prisma.contact.findUnique({
    where: { phoneE164: PHONE },
    select: { id: true },
  });

  if (contact) {
    await prisma.message.deleteMany({ where: { contactId: contact.id } });
    await prisma.optOut.deleteMany({ where: { contactId: contact.id } });
    await prisma.conversation.deleteMany({ where: { contactId: contact.id } });
    await prisma.contact.delete({ where: { id: contact.id } });
  }

  await prisma.webhookEvent.deleteMany({
    where: { wamid: { startsWith: "wamid.TEST" } },
  });
}

async function main() {
  console.log("Webhook end-to-end test\n");
  await cleanup();

  /* -------------------------------------------------------------- */
  console.log("Inbound message creates contact and conversation");

  await processWebhookEvents(
    [inbound("Where is my order?", "wamid.TEST1", "2026-08-09T10:00:00Z")],
    true,
  );

  const contact = await prisma.contact.findUnique({
    where: { phoneE164: PHONE },
    include: { conversation: true, messages: true },
  });

  check("contact created", Boolean(contact));
  check("marked as a valid WhatsApp number", contact?.whatsappStatus === "VALID");
  check("source recorded as inbound", contact?.source === "inbound");
  // Messaging us is not consent to receive marketing.
  check("NOT opted in to marketing", contact?.optInStatus === "UNKNOWN");
  check("conversation created", Boolean(contact?.conversation));
  check("unread count is 1", contact?.conversation?.unreadCount === 1);
  check("message stored", contact?.messages.length === 1);
  check(
    "24-hour window expiry set correctly",
    contact?.conversation?.serviceWindowExpiresAt?.toISOString() ===
      "2026-08-10T10:00:00.000Z",
  );

  /* -------------------------------------------------------------- */
  console.log("\nReplayed webhook is ignored");

  await processWebhookEvents(
    [inbound("Where is my order?", "wamid.TEST1", "2026-08-09T10:00:00Z")],
    true,
  );

  const afterReplay = await prisma.contact.findUnique({
    where: { phoneE164: PHONE },
    include: { conversation: true, messages: true },
  });

  check("no duplicate message", afterReplay?.messages.length === 1,
    `${afterReplay?.messages.length} messages`);
  check(
    "unread count not double-incremented",
    afterReplay?.conversation?.unreadCount === 1,
    String(afterReplay?.conversation?.unreadCount),
  );

  /* -------------------------------------------------------------- */
  console.log("\nOut-of-order status updates");

  const outbound = await prisma.message.create({
    data: {
      wamid: "wamid.TESTOUT",
      direction: "OUTBOUND",
      contactId: contact!.id,
      conversationId: contact!.conversation!.id,
      type: "text",
      body: "It ships tomorrow.",
      payload: {},
      status: "QUEUED",
    },
  });

  const statusEvent = (
    s: "sent" | "delivered" | "read",
    when: string,
  ): NormalisedWebhookEvent => ({
    kind: "status_update",
    externalMessageId: "wamid.TESTOUT",
    recipient: PHONE,
    status: s,
    timestamp: at(when),
    raw: { status: s },
  });

  // Meta can deliver read before delivered. Arriving backwards must still
  // converge on READ.
  await processWebhookEvents([statusEvent("read", "2026-08-09T10:05:00Z")], true);
  await processWebhookEvents([statusEvent("delivered", "2026-08-09T10:04:00Z")], true);
  await processWebhookEvents([statusEvent("sent", "2026-08-09T10:03:00Z")], true);

  const finalMessage = await prisma.message.findUnique({
    where: { id: outbound.id },
  });

  check("status settled on READ", finalMessage?.status === "READ",
    finalMessage?.status);
  check("readAt recorded", finalMessage?.readAt !== null);
  check(
    "a later out-of-order status did not downgrade it",
    finalMessage?.status !== "DELIVERED" && finalMessage?.status !== "SENT",
  );

  /* -------------------------------------------------------------- */
  console.log("\nOpt-out keyword handling");

  await processWebhookEvents(
    [inbound("STOP", "wamid.TEST2", "2026-08-09T11:00:00Z")],
    true,
  );

  const optedOut = await prisma.contact.findUnique({
    where: { phoneE164: PHONE },
    include: { optOuts: true },
  });

  check("marketing opt-out flag set", optedOut?.marketingOptOut === true);
  check("opt-in status updated", optedOut?.optInStatus === "OPTED_OUT");
  check("audit trail row written", optedOut?.optOuts.length === 1);
  check("keyword recorded", optedOut?.optOuts[0]?.keyword === "STOP");

  /* -------------------------------------------------------------- */
  console.log("\nOpt-out matching is exact, not substring");

  await prisma.contact.update({
    where: { id: contact!.id },
    data: { marketingOptOut: false, optInStatus: "UNKNOWN" },
  });

  await processWebhookEvents(
    [
      inbound(
        "please don't stop sending me offers",
        "wamid.TEST3",
        "2026-08-09T11:30:00Z",
      ),
    ],
    true,
  );

  const notOptedOut = await prisma.contact.findUnique({
    where: { phoneE164: PHONE },
  });

  check(
    "a sentence containing 'stop' does NOT opt the customer out",
    notOptedOut?.marketingOptOut === false,
  );

  /* -------------------------------------------------------------- */
  console.log("\nUnknown message status is stored, not lost");

  const result = await processWebhookEvents(
    [
      {
        kind: "status_update",
        externalMessageId: "wamid.TESTNOTFOUND",
        recipient: PHONE,
        status: "delivered",
        timestamp: at("2026-08-09T12:00:00Z"),
        raw: {},
      },
    ],
    true,
  );

  check("processed without throwing", result.failed === 0);
  const stored = await prisma.webhookEvent.findFirst({
    where: { wamid: "wamid.TESTNOTFOUND" },
  });
  check("event still recorded for debugging", Boolean(stored));

  /* -------------------------------------------------------------- */
  console.log("\nCleaning up");
  await cleanup();
  check("test data removed", true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
