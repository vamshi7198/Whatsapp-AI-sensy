import { createHash } from "node:crypto";

import type { MessageStatus, Prisma } from "@prisma/client";

import { runAutomationsForInbound } from "../automations/engine";
import { recordMessageCost } from "../campaigns/pricing";
import { recordFlowResponse } from "../flows/service";
import { env } from "../env";
import { advanceSession } from "../journeys/engine";
import { startJourneyFromMessage } from "../journeys/triggers";
import { prisma } from "../db";
import { maskPhone, moduleLogger } from "../logger";
import { getInboundOptIn, getOptOutKeywords } from "../settings";
import { parseMetaWebhook } from "../whatsapp/providers/meta/mappers";
import type { NormalisedWebhookEvent } from "../whatsapp/types";

const log = moduleLogger("webhook-processor");

/**
 * Applies normalised webhook events to the database.
 *
 * Two properties this code must guarantee, because Meta provides neither:
 *
 *  1. Idempotency. Meta retries on any slow or non-2xx response, so the same
 *     event arrives more than once. Handled by a unique dedupeKey plus status
 *     transitions that are safe to repeat.
 *
 *  2. Order independence. Meta can deliver `read` before `delivered`. Statuses
 *     therefore only ever advance, so any arrival order converges on the same
 *     final state without locking.
 */

/** Higher wins. FAILED is terminal and never downgraded. */
const STATUS_RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Stable key for an event, so a replay is stored and applied once. */
export function buildDedupeKey(event: NormalisedWebhookEvent): string {
  const parts =
    event.kind === "status_update"
      ? ["status", event.externalMessageId, event.status, String(event.timestamp.getTime())]
      : event.kind === "inbound_message"
        ? ["inbound", event.externalMessageId]
        : event.kind === "template_status"
          ? ["template", event.templateName, event.language, event.status]
          : event.kind === "quality_update"
            ? ["quality", event.phoneNumber, event.qualityRating ?? "", event.messagingTier ?? ""]
            : ["unknown", JSON.stringify(event.raw).slice(0, 500)];

  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export interface ProcessResult {
  processed: number;
  duplicates: number;
  failed: number;
}

export interface StoreResult {
  /** Events newly written and awaiting processing. */
  stored: NormalisedWebhookEvent[];
  duplicates: number;
}

/**
 * Writes the raw events to the database. Nothing else.
 *
 * Called BEFORE responding 200 to Meta, and this ordering is deliberate.
 * Meta discards an event once it receives a 200, and offers no replay API —
 * so acknowledging before the payload is durably stored would mean a crash in
 * that instant loses a customer message for good.
 *
 * It stays fast because it only inserts: no lookups, no counters, no
 * downstream writes. Those happen afterwards, off the request path.
 */
export async function storeWebhookEvents(
  events: NormalisedWebhookEvent[],
  signatureValid: boolean,
  /**
   * The whole webhook body, exactly as Meta sent it.
   *
   * Stored rather than the single event's inner object, because recovery has
   * to re-parse this and the parser needs the full envelope. Storing only the
   * inner message made recovery silently find nothing — the payload was
   * there, but unreadable by the only thing that would ever read it.
   */
  rawPayload?: unknown,
): Promise<StoreResult> {
  const stored: NormalisedWebhookEvent[] = [];
  let duplicates = 0;

  for (const event of events) {
    const created = await prisma.webhookEvent.createMany({
      data: [
        {
          dedupeKey: buildDedupeKey(event),
          eventType: event.kind,
          wamid: "externalMessageId" in event ? event.externalMessageId : null,
          payload: (rawPayload ?? event.raw) as Prisma.InputJsonValue,
          signatureValid,
        },
      ],
      // A Meta retry lands here and is dropped, which is the whole point.
      skipDuplicates: true,
    });

    if (created.count === 0) duplicates += 1;
    else stored.push(event);
  }

  return { stored, duplicates };
}

/**
 * Applies already-stored events to contacts, conversations and campaigns.
 *
 * Runs after the response to Meta. If it fails, the raw payload is already
 * safe in WebhookEvent and the row is marked FAILED, so nothing is lost and
 * the cause is visible in the activity log.
 */
export async function applyStoredEvents(
  events: NormalisedWebhookEvent[],
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, duplicates: 0, failed: 0 };

  for (const event of events) {
    const dedupeKey = buildDedupeKey(event);

    try {
      await applyEvent(event);

      await prisma.webhookEvent.update({
        where: { dedupeKey },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      result.processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ kind: event.kind, err: message }, "Failed to apply event");

      await prisma.webhookEvent
        .update({
          where: { dedupeKey },
          // Counted so recovery can retry a few times and then stop, rather
          // than either giving up at once or retrying a broken event forever.
          data: {
            status: "FAILED",
            error: message,
            attemptCount: { increment: 1 },
          },
        })
        .catch(() => undefined);

      result.failed += 1;
    }
  }

  return result;
}

/**
 * Store then apply, in one call. Used by tests and by the recovery job;
 * the webhook route splits the two around its response to Meta.
 */
export async function processWebhookEvents(
  events: NormalisedWebhookEvent[],
  signatureValid: boolean,
): Promise<ProcessResult> {
  const { stored, duplicates } = await storeWebhookEvents(
    events,
    signatureValid,
  );

  const applied = await applyStoredEvents(stored);
  return { ...applied, duplicates };
}

/**
 * Re-applies events that were stored but never processed.
 *
 * Covers the case where the machine died between storing an event and acting
 * on it: the payload survived, so the message can still reach the inbox.
 * Safe to run repeatedly — applying an event twice converges on the same
 * state.
 */
/** How many times a failed event is retried before it is left alone. */
const MAX_RECOVERY_ATTEMPTS = 5;

/**
 * Deletes webhook events older than the configured retention.
 *
 * WEBHOOK_RETENTION_DAYS has been declared since the beginning and read by
 * nothing, so the table only ever grew — and the Activity log groups over the
 * whole of it on every page load. Left alone for five months it becomes the
 * slowest page in the app for no reason anyone would guess.
 *
 * Only events that have been dealt with are removed. Anything still awaiting
 * work stays regardless of age, because deleting it would be the silent
 * message loss everything else here exists to prevent.
 */
export async function pruneWebhookEvents(): Promise<number> {
  const cutoff = new Date(
    Date.now() - env.WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { count } = await prisma.webhookEvent.deleteMany({
    where: {
      receivedAt: { lt: cutoff },
      status: { in: ["PROCESSED", "IGNORED"] },
    },
  });

  if (count > 0) {
    log.info(
      { removed: count, olderThanDays: env.WEBHOOK_RETENTION_DAYS },
      "Pruned old webhook events",
    );
  }

  return count;
}

export async function recoverUnprocessedEvents(): Promise<ProcessResult> {
  const pending = await prisma.webhookEvent.findMany({
    where: {
      signatureValid: true,
      OR: [
        // Stored but never applied — the machine died in between.
        { status: { in: ["RECEIVED", "PROCESSING"] } },
        // Applied and threw. Retried a few times rather than abandoned:
        // the usual causes are transient — the database was briefly
        // unreachable, a contact was mid-write — and a customer's message
        // sitting FAILED forever is exactly the silent loss this whole
        // pipeline exists to prevent. Bounded, so a genuinely malformed
        // event stops rather than being retried every five minutes for
        // months.
        {
          status: "FAILED",
          attemptCount: { lt: MAX_RECOVERY_ATTEMPTS },
        },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: 500,
  });

  if (pending.length === 0) {
    return { processed: 0, duplicates: 0, failed: 0 };
  }

  // Claimed before any work, so two overlapping runs cannot both apply them.
  //
  // PROCESSING existed in the enum and was read in two places but written by
  // nobody, so the claim it was designed for had never been implemented. The
  // five-minute scheduled task and a manual `npm run recover` — which
  // update.ps1 runs on every deploy — can easily overlap. The strong guards
  // held, so nobody received a duplicate message, but unreadCount,
  // repliedCount, the delivery counters and estimated spend all drifted.
  //
  // Row at a time, filtered on the exact status just read: a batch updateMany
  // would say how many it claimed but not WHICH, leaving no way to tell the
  // rows this run owns from the ones another run took a moment earlier. A
  // row abandoned as PROCESSING by a run that died is picked up again,
  // because it is selected above and its own status still matches.
  //
  // Also makes the PROCESSING count on /api/health mean something rather
  // than being permanently zero.
  const mine: typeof pending = [];

  for (const row of pending) {
    const won = await prisma.webhookEvent.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: "PROCESSING" },
    });

    if (won.count === 1) mine.push(row);
  }

  if (mine.length === 0) {
    return { processed: 0, duplicates: 0, failed: 0 };
  }

  log.warn(
    { found: pending.length, claimed: mine.length },
    "Found stored events that were never applied — recovering",
  );

  // Only the events actually awaiting work. One stored payload can contain
  // several events, and the others already ran — re-applying them would be
  // harmless but wasteful, and would make the recovered count a lie.
  const wanted = new Set(mine.map((row) => row.dedupeKey));
  const seen = new Set<string>();
  const events: NormalisedWebhookEvent[] = [];

  for (const row of mine) {
    for (const event of parseMetaWebhook(row.payload)) {
      const key = buildDedupeKey(event);
      if (!wanted.has(key) || seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }

  if (events.length < mine.length) {
    // Rows written before the payload fix hold only the inner message, which
    // this parser cannot read. Nothing is lost — the row is still there — but
    // it cannot be replayed, and saying so is better than a silent zero.
    log.warn(
      { pending: mine.length, readable: events.length },
      "Some stored events could not be re-read and were not recovered",
    );
  }

  return applyStoredEvents(events);
}

async function applyEvent(event: NormalisedWebhookEvent): Promise<void> {
  switch (event.kind) {
    case "inbound_message":
      return applyInboundMessage(event);
    case "status_update":
      return applyStatusUpdate(event);
    case "template_status":
      return applyTemplateStatus(event);
    case "quality_update":
      return applyQualityUpdate(event);
    default:
      log.debug({ kind: event.kind }, "Ignoring unrecognised event");
  }
}

/* ------------------------------------------------------------------ */
/* Inbound messages                                                    */
/* ------------------------------------------------------------------ */

async function applyInboundMessage(
  event: Extract<NormalisedWebhookEvent, { kind: "inbound_message" }>,
): Promise<void> {
  // A message from an unknown number creates the contact. Whether that counts
  // as marketing consent is a business decision, set in Settings and off by
  // default: an enquiry is not agreement to receive campaigns.
  const treatInboundAsConsent = await getInboundOptIn();

  const contact = await prisma.contact.upsert({
    where: { phoneE164: event.from },
    update: {
      lastInboundAt: event.timestamp,
      whatsappStatus: "VALID",
      // Restored here, unlike on CSV import, and the difference is who acted.
      // This person just messaged the business themselves, so having their
      // conversation appear is what they expect; a row in a spreadsheet is not
      // an act by the customer at all.
      //
      // Note what is NOT set: optInStatus and marketingOptOut are untouched, so
      // getting back in touch restores the conversation without restoring
      // permission to market at them.
      deletedAt: null,
      // Only fill a blank name; never overwrite a curated one with a
      // WhatsApp profile name.
      ...(event.contactName ? {} : {}),
    },
    create: {
      phoneE164: event.from,
      name: event.contactName,
      source: "inbound",
      whatsappStatus: "VALID",
      lastInboundAt: event.timestamp,
      ...(treatInboundAsConsent
        ? {
            optInStatus: "OPTED_IN",
            optInAt: event.timestamp,
            // Recorded precisely, so the basis for consent is auditable
            // rather than indistinguishable from someone ticking a box.
            optInSource: "inbound_message_auto",
          }
        : {}),
    },
  });

  if (!contact.name && event.contactName) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { name: event.contactName },
    });
  }

  const windowExpiry = new Date(event.timestamp.getTime() + SERVICE_WINDOW_MS);

  // Note what is NOT here any more: unreadCount.
  //
  // Everything in this upsert is an absolute write, so running it twice leaves
  // the same result. The unread increment was not, and it sat before the
  // message insert that dedupes — so a redelivered webhook, or the recovery
  // sweep re-running a stored event, bumped the badge again for a message
  // already in the thread. It is applied below, once the insert has proved
  // this message is genuinely new.
  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: {
      status: "OPEN",
      lastMessageAt: event.timestamp,
      lastInboundAt: event.timestamp,
      serviceWindowExpiresAt: windowExpiry,
    },
    create: {
      contactId: contact.id,
      status: "OPEN",
      lastMessageAt: event.timestamp,
      lastInboundAt: event.timestamp,
      serviceWindowExpiresAt: windowExpiry,
      unreadCount: 0,
    },
  });

  const inserted = await prisma.message.createMany({
    data: [
      {
        wamid: event.externalMessageId,
        direction: "INBOUND",
        contactId: contact.id,
        conversationId: conversation.id,
        type: event.type,
        body: event.text,
        payload: event.raw as Prisma.InputJsonValue,
        // Inbound messages are received, not delivered by us. DELIVERED is the
        // closest honest state and keeps the status column meaningful.
        status: "DELIVERED",
        deliveredAt: event.timestamp,
        createdAt: event.timestamp,
      },
    ],
    skipDuplicates: true,
  });

  // Counted once per message that was actually new.
  //
  // Deliberately NOT an early return for everything below. Meta redelivers for
  // up to seven days and recoverUnprocessedEvents replays stored events on
  // purpose, and a replay usually happens precisely because the first attempt
  // failed part-way — so the journey advance and the automations further down
  // still need to run. They carry their own idempotency (JourneyEvent and
  // AutomationRun unique keys); the unread badge does not, which is why only
  // this one is gated.
  const isNew = inserted.count === 1;

  if (isNew) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 } },
    });
  } else {
    log.debug(
      { wamid: event.externalMessageId },
      "Inbound message already recorded — re-applying the rest in case it did not finish",
    );
  }

  await handleOptOutKeyword(event, contact.id);
  await recordCampaignReply(contact.id, event.timestamp);

  // A completed in-chat form. Filed against the send it came from, which is
  // the only way to know who it belongs to — Meta does not include the form's
  // id in the response, only the token we generated when sending.
  if (event.flowResponse) {
    await recordFlowResponse({
      token: event.flowResponse.flowToken,
      contactId: contact.id,
      answers: event.flowResponse.answers,
      wamid: event.externalMessageId,
    }).catch((error) => {
      // The answers are already on the stored message either way, so a
      // failure here loses nothing that cannot be recovered.
      log.error(
        { err: error instanceof Error ? error.message : error },
        "Could not file a form response",
      );
    });
  }

  log.info(
    { from: maskPhone(event.from), type: event.type },
    "Inbound message stored",
  );

  // A journey in progress gets the reply first. Somebody halfway through a
  // conversation must not also receive a keyword auto-reply talking over it,
  // so an advanced journey suppresses automations for this message.
  let handledByJourney = false;

  try {
    const advanced = await advanceSession({
      contactId: contact.id,
      externalId: event.externalMessageId,
      optionId: event.reply?.id,
      text: event.text,
    });

    handledByJourney = advanced.moved;
  } catch (error) {
    log.error(
      { err: error instanceof Error ? error.message : error },
      "Journey advance threw — the message itself was still stored",
    );
  }

  if (handledByJourney) return;

  // Nobody mid-journey, so this message might start one. Tried before keyword
  // auto-replies, because a customer who says "sample" should get the
  // conversation rather than a one-line reply and a conversation at once.
  try {
    const startedJourney = await startJourneyFromMessage({
      contactId: contact.id,
      text: event.text ?? null,
      externalId: event.externalMessageId,
    });

    if (startedJourney) return;
  } catch (error) {
    log.error(
      { err: error instanceof Error ? error.message : error },
      "Journey trigger threw — the message itself was still stored",
    );
  }

  // Last, and deliberately after the opt-out check, so a customer who just
  // said STOP is not answered by a robot. Failures are contained here: an
  // automation that breaks must never cost us the message itself, which is
  // already safely stored above.
  try {
    await runAutomationsForInbound({
      contactId: contact.id,
      phoneE164: event.from,
      text: event.text ?? null,
      externalMessageId: event.externalMessageId,
      conversationId: conversation.id,
      lastInboundAt: event.timestamp,
    });
  } catch (error) {
    log.error(
      { err: error instanceof Error ? error.message : error },
      "Automations threw — the message itself was still stored",
    );
  }
}

/**
 * Honours STOP / UNSUBSCRIBE / REMOVE immediately.
 *
 * Matching is on the whole trimmed message, not a substring: "please don't
 * stop sending offers" must not opt someone out.
 */
async function handleOptOutKeyword(
  event: Extract<NormalisedWebhookEvent, { kind: "inbound_message" }>,
  contactId: string,
): Promise<void> {
  if (!event.text) return;

  const keywords = await getOptOutKeywords();
  const normalised = event.text.trim().toUpperCase().replace(/[.!]+$/, "");

  if (!keywords.includes(normalised)) return;

  // One audit row per message, however many times that message arrives.
  //
  // The flag is an absolute write and re-applying it changes nothing, but the
  // audit row was created unconditionally — so a redelivered webhook, or the
  // recovery sweep, filed a second record of the same request. That trail is
  // what proves the customer asked to stop, and duplicates in it make it
  // harder to read exactly when someone is relying on it.
  const alreadyRecorded = await prisma.optOut.findFirst({
    where: { contactId, sourceMessageId: event.externalMessageId },
    select: { id: true },
  });

  // The flag and the audit trail are written together: the flag is what the
  // send query reads, the trail is what proves the request if challenged.
  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contactId },
      data: {
        marketingOptOut: true,
        marketingOptOutAt: event.timestamp,
        optInStatus: "OPTED_OUT",
      },
    }),
    ...(alreadyRecorded
      ? []
      : [
          prisma.optOut.create({
            data: {
              contactId,
              phoneE164: event.from,
              scope: "MARKETING",
              keyword: normalised,
              reason: "Customer replied with an opt-out keyword",
              sourceMessageId: event.externalMessageId,
              createdAt: event.timestamp,
            },
          }),
        ]),
  ]);

  log.info(
    { contactId, keyword: normalised },
    "Contact opted out of marketing",
  );
}

/** Counts a reply against a campaign the contact recently received. */
async function recordCampaignReply(
  contactId: string,
  at: Date,
): Promise<void> {
  const sevenDaysAgo = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      contactId,
      repliedAt: null,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      createdAt: { gte: sevenDaysAgo },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, campaignId: true },
  });

  if (!recipient) return;

  // repliedAt is set once, so later messages in the same conversation do not
  // keep inflating the campaign's reply count.
  //
  // The comment above has always said that; the code did not do it. The read
  // and the write sat in separate transactions with no guard on the write, so
  // two messages arriving close together both found repliedAt null and both
  // incremented — and a replayed webhook did the same. The filter is now on
  // the write itself, which is the only place it can actually hold.
  const claimed = await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, repliedAt: null },
    data: { repliedAt: at },
  });

  if (claimed.count === 0) return;

  await prisma.campaign.update({
    where: { id: recipient.campaignId },
    data: { repliedCount: { increment: 1 } },
  });
}

/* ------------------------------------------------------------------ */
/* Delivery status                                                     */
/* ------------------------------------------------------------------ */

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

async function applyStatusUpdate(
  event: Extract<NormalisedWebhookEvent, { kind: "status_update" }>,
): Promise<void> {
  const next = STATUS_MAP[event.status];
  if (!next) return;

  const message = await prisma.message.findUnique({
    where: { wamid: event.externalMessageId },
    select: {
      id: true,
      status: true,
      contactId: true,
      campaignRecipientId: true,
    },
  });

  if (!message) {
    // Meta can deliver a status before our own send transaction commits. The
    // event is stored, so it stays visible in Logs rather than vanishing.
    log.warn(
      { wamid: event.externalMessageId, status: event.status },
      "Status update for an unknown message",
    );
    return;
  }

  // Monotonic: never regress READ back to DELIVERED on an out-of-order replay.
  if (STATUS_RANK[next] <= STATUS_RANK[message.status]) {
    log.debug(
      { wamid: event.externalMessageId, from: message.status, to: next },
      "Ignoring out-of-order status",
    );
    return;
  }

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === "SENT" ? { sentAt: event.timestamp } : {}),
      ...(next === "DELIVERED" ? { deliveredAt: event.timestamp } : {}),
      ...(next === "READ" ? { readAt: event.timestamp } : {}),
      ...(next === "FAILED"
        ? {
            failedAt: event.timestamp,
            errorCode: event.error?.code,
            errorDetail: event.error?.technicalDetail,
            errorUserMessage: event.error?.userMessage,
          }
        : {}),
      ...(event.pricingCategory
        ? { pricingCategory: event.pricingCategory }
        : {}),
      ...(event.billable !== undefined ? { billable: event.billable } : {}),
    },
  });

  // A permanent recipient failure is real evidence the number is unusable.
  if (next === "FAILED" && event.error?.code === "131026") {
    await prisma.contact.update({
      where: { id: message.contactId },
      data: { whatsappStatus: "INVALID" },
    });
  }

  if (next !== "FAILED") {
    await prisma.contact.update({
      where: { id: message.contactId },
      data: { whatsappStatus: "VALID" },
    });
  }

  // Meta bills on delivery, so this is the moment a cost becomes real. READ is
  // included because an out-of-order webhook can carry us past DELIVERED
  // without ever processing it, and recordMessageCost only ever prices a
  // message once.
  if (next === "DELIVERED" || next === "READ") {
    await recordMessageCost(message.id);
  }

  if (message.campaignRecipientId) {
    await updateCampaignCounters(message.campaignRecipientId, next, event.timestamp);
  }
}

/**
 * Advances the recipient's status and increments the campaign's counters.
 *
 * Counters are denormalised so the dashboard never aggregates over millions of
 * message rows, and each is incremented exactly once because the caller only
 * reaches here on a genuine forward transition.
 */
async function updateCampaignCounters(
  recipientId: string,
  status: MessageStatus,
  at: Date,
): Promise<void> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, campaignId: true, status: true },
  });

  if (!recipient) return;

  const RECIPIENT_RANK: Record<string, number> = {
    PENDING: 0,
    QUEUED: 1,
    SENT: 2,
    DELIVERED: 3,
    READ: 4,
    FAILED: 5,
    SKIPPED: 5,
  };

  if (RECIPIENT_RANK[status] <= RECIPIENT_RANK[recipient.status]) return;

  const counter =
    status === "SENT"
      ? "sentCount"
      : status === "DELIVERED"
        ? "deliveredCount"
        : status === "READ"
          ? "readCount"
          : status === "FAILED"
            ? "failedCount"
            : null;

  await prisma.$transaction([
    prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: status as never, updatedAt: at },
    }),
    ...(counter
      ? [
          prisma.campaign.update({
            where: { id: recipient.campaignId },
            data: { [counter]: { increment: 1 } },
          }),
        ]
      : []),
  ]);
}

/* ------------------------------------------------------------------ */
/* Template and account status                                         */
/* ------------------------------------------------------------------ */

async function applyTemplateStatus(
  event: Extract<NormalisedWebhookEvent, { kind: "template_status" }>,
): Promise<void> {
  if (!event.templateName) return;

  const updated = await prisma.template.updateMany({
    where: {
      name: event.templateName,
      ...(event.language ? { language: event.language } : {}),
    },
    data: {
      status: event.status,
      rejectedReason: event.reason,
      lastSyncedAt: new Date(),
    },
  });

  log.info(
    { template: event.templateName, status: event.status, updated: updated.count },
    "Template status updated",
  );
}

async function applyQualityUpdate(
  event: Extract<NormalisedWebhookEvent, { kind: "quality_update" }>,
): Promise<void> {
  const writes = [];

  if (event.qualityRating) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: "meta.quality_rating" },
        update: { value: event.qualityRating },
        create: { key: "meta.quality_rating", value: event.qualityRating },
      }),
    );
  }

  if (event.messagingTier) {
    writes.push(
      prisma.appSetting.upsert({
        where: { key: "meta.messaging_tier" },
        update: { value: event.messagingTier },
        create: { key: "meta.messaging_tier", value: event.messagingTier },
      }),
    );
  }

  if (writes.length) await prisma.$transaction(writes);

  log.warn(
    { quality: event.qualityRating, tier: event.messagingTier },
    "WhatsApp account quality changed",
  );
}
