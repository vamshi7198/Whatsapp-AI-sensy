import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { env } from "../env";
import { maskPhone, moduleLogger } from "../logger";
import { getProvider } from "../whatsapp";
import { LOCAL_ERRORS } from "../whatsapp/errors";

const log = moduleLogger("sender");

/**
 * Campaign sending.
 *
 * The hard part is not the API call — it is exactly-once behaviour across a
 * crash. Every decision here favours under-reporting over sending a real
 * customer the same message twice.
 *
 * Rate limits observed (verified against Meta's current documentation):
 *  - Throughput: 80 messages/second by default per business phone number. We
 *    default to 20, configurable. Being throttled costs more than sending
 *    slightly slower.
 *  - Pair rate: about one message per 6 seconds to the same recipient.
 *  - Messaging tier: caps unique recipients per 24 hours, separately.
 */

const MAX_ATTEMPTS = 5;

/** Exponential backoff with jitter, in milliseconds. */
function backoffMs(attempt: number): number {
  const base = Math.min(5_000 * 2 ** (attempt - 1), 30 * 60_000);
  return base + Math.floor(Math.random() * 1_000);
}

export interface SendBatchResult {
  attempted: number;
  sent: number;
  failed: number;
  retryable: number;
  paused: boolean;
  pauseReason?: string;
}

/**
 * Sends one batch of a campaign's pending recipients.
 *
 * Batching rather than one long loop means a crash loses at most one batch,
 * and the campaign resumes from the database rather than from memory.
 */
export async function sendCampaignBatch(
  campaignId: string,
  batchSize = 50,
): Promise<SendBatchResult> {
  const result: SendBatchResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    retryable: 0,
    paused: false,
  };

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      templateName: true,
      templateLanguage: true,
      templateId: true,
      headerMediaUrl: true,
      headerMediaType: true,
    },
  });

  if (!campaign) return result;

  if (campaign.status === "CANCELLED") {
    result.paused = true;
    result.pauseReason = "Campaign was cancelled";
    return result;
  }

  const provider = await getProvider();
  if (!provider) {
    result.paused = true;
    result.pauseReason = LOCAL_ERRORS.NOT_CONFIGURED.userMessage;
    return result;
  }

  // Third and final approval check, immediately before sending. Meta can pause
  // a template mid-campaign, and this is the check that catches it.
  if (campaign.templateId) {
    const template = await prisma.template.findUnique({
      where: { id: campaign.templateId },
      select: { status: true },
    });

    if (template && template.status !== "APPROVED") {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "FAILED" },
      });

      result.paused = true;
      result.pauseReason =
        "The template is no longer approved by WhatsApp, so sending stopped.";
      log.error(
        { campaignId, templateStatus: template.status },
        "Campaign halted: template no longer approved",
      );
      return result;
    }
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING", attemptCount: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  if (recipients.length === 0) return result;

  await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ["QUEUED", "SCHEDULED"] } },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const delayMs = Math.max(1, Math.floor(1000 / env.SEND_RATE_LIMIT_MPS));

  for (const recipient of recipients) {
    result.attempted += 1;

    // Compliance is re-checked here, not only at expansion. A customer who
    // replies STOP while a campaign is running must not receive the message
    // still sitting in the queue.
    if (recipient.contactId) {
      const contact = await prisma.contact.findUnique({
        where: { id: recipient.contactId },
        select: { marketingOptOut: true, deletedAt: true },
      });

      const isMarketing =
        (
          await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { templateCategory: true },
          })
        )?.templateCategory === "MARKETING";

      if (contact?.deletedAt || (isMarketing && contact?.marketingOptOut)) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SKIPPED",
            skipReason: contact?.deletedAt
              ? "contact_deleted"
              : "marketing_opted_out",
          },
        });
        continue;
      }
    }

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { attemptCount: { increment: 1 } },
    });

    const sendResult = await provider.sendTemplateMessage({
      to: recipient.phoneE164,
      templateName: campaign.templateName,
      languageCode: campaign.templateLanguage,
      bodyVariables: recipient.variables as Record<string, string>,
      // Sent as a link rather than an uploaded id, so a campaign repeated
      // weeks later still works after Meta has expired uploaded media.
      ...(campaign.headerMediaUrl && campaign.headerMediaType
        ? {
            headerMedia: {
              type: campaign.headerMediaType as
                | "image"
                | "video"
                | "document",
              link: campaign.headerMediaUrl,
            },
          }
        : {}),
    });

    if (sendResult.accepted === true) {
      await recordAccepted(
        campaignId,
        recipient.id,
        recipient.contactId,
        sendResult.externalMessageId,
      );
      result.sent += 1;
    } else if (sendResult.accepted === "unknown") {
      // The request was written but no response arrived. Whether Meta took it
      // is unknowable, so it is recorded as sent-but-unconfirmed and never
      // retried: a duplicate message to a real customer is the worse outcome.
      await recordAccepted(
        campaignId,
        recipient.id,
        recipient.contactId,
        null,
        true,
      );
      result.sent += 1;
      log.warn(
        { recipientId: recipient.id, to: maskPhone(recipient.phoneE164) },
        "Send outcome unknown — flagged for reconciliation, not retried",
      );
    } else {
      const error = sendResult.error;

      // A dead token will fail every remaining message identically. Pausing
      // the campaign is better than burning through the queue.
      if (error.isAuthError) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "PARTIALLY_FAILED" },
        });

        result.paused = true;
        result.pauseReason = error.userMessage;
        log.error({ campaignId, code: error.code }, "Campaign paused: auth error");
        return result;
      }

      if (error.retryable && recipient.attemptCount + 1 < MAX_ATTEMPTS) {
        // Left PENDING so the next batch picks it up after the backoff.
        result.retryable += 1;
        await new Promise((r) => setTimeout(r, backoffMs(recipient.attemptCount + 1)));
      } else {
        await recordFailure(campaignId, recipient, error);
        result.failed += 1;
      }
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  await finaliseIfComplete(campaignId);
  return result;
}

async function recordAccepted(
  campaignId: string,
  recipientId: string,
  contactId: string | null,
  wamid: string | null,
  needsReconciliation = false,
): Promise<void> {
  const now = new Date();

  await prisma.$transaction([
    prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "SENT", needsReconciliation },
    }),
    prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    }),
    ...(contactId
      ? [
          prisma.message.create({
            data: {
              wamid,
              direction: "OUTBOUND",
              contactId,
              campaignRecipientId: recipientId,
              type: "template",
              payload: {} as Prisma.InputJsonValue,
              status: "SENT",
              sentAt: now,
              ...(needsReconciliation
                ? {
                    errorUserMessage:
                      "WhatsApp did not confirm this message. It may or may not have been delivered.",
                  }
                : {}),
            },
          }),
          prisma.contact.update({
            where: { id: contactId },
            data: { lastContactedAt: now },
          }),
        ]
      : []),
  ]);
}

async function recordFailure(
  campaignId: string,
  recipient: { id: string; contactId: string | null },
  error: { code: string; userMessage: string; technicalDetail?: string },
): Promise<void> {
  const now = new Date();

  await prisma.$transaction([
    prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED" },
    }),
    prisma.campaign.update({
      where: { id: campaignId },
      data: { failedCount: { increment: 1 } },
    }),
    ...(recipient.contactId
      ? [
          prisma.message.create({
            data: {
              direction: "OUTBOUND",
              contactId: recipient.contactId,
              campaignRecipientId: recipient.id,
              type: "template",
              payload: {} as Prisma.InputJsonValue,
              status: "FAILED",
              failedAt: now,
              errorCode: error.code,
              errorUserMessage: error.userMessage,
              errorDetail: error.technicalDetail,
            },
          }),
        ]
      : []),
  ]);
}

/** Marks a campaign complete once nothing is left pending. */
async function finaliseIfComplete(campaignId: string): Promise<void> {
  const pending = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ["PENDING", "QUEUED"] } },
  });

  if (pending > 0) return;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { sentCount: true, failedCount: true, status: true },
  });

  if (!campaign || campaign.status === "CANCELLED") return;

  // "Partially failed" is more honest than "completed" when some messages did
  // not go out, and it is what an operator needs to see on the list page.
  const status =
    campaign.failedCount > 0
      ? campaign.sentCount > 0
        ? "PARTIALLY_FAILED"
        : "FAILED"
      : "COMPLETED";

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status, completedAt: new Date() },
  });

  log.info({ campaignId, status }, "Campaign finished");
}

/** Runs batches until the campaign is done or something pauses it. */
export async function runCampaign(campaignId: string): Promise<void> {
  for (;;) {
    const result = await sendCampaignBatch(campaignId);

    if (result.paused) {
      log.warn({ campaignId, reason: result.pauseReason }, "Campaign paused");
      return;
    }

    if (result.attempted === 0) return;
  }
}
