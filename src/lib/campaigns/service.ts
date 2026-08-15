// Value import, not type-only: the error classes are used at runtime to tell a
// lost race on a unique key from a genuine failure.
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { moduleLogger } from "../logger";
import { getTemplateHeaderMediaType } from "../templates/service";
import { classifyStoredError } from "../whatsapp/errors";
import {
  resolveAudience,
  resolveVariables,
  type AudienceFilter,
  type VariableMapping,
} from "./audience";

const log = moduleLogger("campaigns");

/**
 * Has this campaign stopped sending of its own accord?
 *
 * Anything else — DRAFT, SCHEDULED, QUEUED, RUNNING — may still send, so a
 * PENDING recipient there means "not yet" rather than "never reached".
 */
export function isStopped(status: string): boolean {
  return ["COMPLETED", "PARTIALLY_FAILED", "FAILED", "CANCELLED"].includes(
    status,
  );
}

/**
 * Campaign creation and expansion.
 *
 * The expensive part — turning an audience into one frozen row per recipient —
 * happens once, at creation. Variables are resolved and stored at that moment
 * so that what the operator previewed is exactly what gets sent, even if a
 * contact is edited while the campaign is queued.
 */

export interface CreateCampaignInput {
  name: string;
  idempotencyKey: string;
  templateId: string;
  audience: AudienceFilter;
  mapping: VariableMapping;
  createdById: string;
  /** Required when the template's header is an image, video or document. */
  headerMediaUrl?: string;
  headerMediaType?: string;
  /** Send later instead of now. Interpreted in Asia/Kolkata. */
  scheduledAt?: Date;
}

export interface CreateCampaignResult {
  ok: boolean;
  campaignId?: string;
  error?: string;
  /** True when this key already produced a campaign — a double submit. */
  wasDuplicate?: boolean;
}

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  // Clicking Send twice, or refreshing and resubmitting, must resolve to the
  // same campaign rather than messaging everyone a second time.
  const existing = await prisma.campaign.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });

  if (existing) {
    log.info({ campaignId: existing.id }, "Duplicate submit ignored");
    return { ok: true, campaignId: existing.id, wasDuplicate: true };
  }

  const template = await prisma.template.findUnique({
    where: { id: input.templateId },
  });

  if (!template) return { ok: false, error: "That template no longer exists." };

  // First of three approval checks. The others are at enqueue and immediately
  // before the API call, because Meta can pause a template mid-campaign.
  if (template.status !== "APPROVED") {
    return {
      ok: false,
      error:
        "That template is not approved by WhatsApp, so it cannot be sent.",
    };
  }

  // A media-header template without a file is rejected by Meta for every
  // recipient. Refusing here turns that into one clear message instead of a
  // campaign that fails entirely.
  const requiredMedia = getTemplateHeaderMediaType(template.components);
  if (requiredMedia && !input.headerMediaUrl) {
    return {
      ok: false,
      error: `This template needs ${requiredMedia === "image" ? "an image" : `a ${requiredMedia}`} at the top. Upload one and try again.`,
    };
  }

  const resolved = await resolveAudience(input.audience, template.category);

  if (resolved.eligible.length === 0) {
    return {
      ok: false,
      error:
        resolved.totalMatched === 0
          ? "No contacts match this audience."
          : "Every contact in this audience was excluded. Check the skipped list.",
    };
  }

  // Recipients whose variables cannot be resolved are skipped rather than sent
  // a message with a blank in it.
  const recipients: Prisma.CampaignRecipientCreateManyCampaignInput[] = [];
  const skippedForVariables: string[] = [];

  for (const member of resolved.eligible) {
    const { values, missing } = resolveVariables(member, input.mapping);

    if (missing.length > 0) {
      skippedForVariables.push(member.contactId);
      recipients.push({
        contactId: member.contactId,
        phoneE164: member.phoneE164,
        name: member.name,
        variables: values as Prisma.InputJsonValue,
        status: "SKIPPED",
        skipReason: "missing_variable",
      });
      continue;
    }

    recipients.push({
      contactId: member.contactId,
      phoneE164: member.phoneE164,
      name: member.name,
      variables: values as Prisma.InputJsonValue,
      status: "PENDING",
    });
  }

  for (const { member, reason } of resolved.skipped) {
    recipients.push({
      contactId: member.contactId,
      phoneE164: member.phoneE164,
      name: member.name,
      variables: {},
      status: "SKIPPED",
      skipReason: reason,
    });
  }

  const sendable = recipients.filter((r) => r.status === "PENDING").length;
  const skippedCount = recipients.length - sendable;

  // Checked after variable resolution, not just after the compliance gate: a
  // mapping that nobody can satisfy would otherwise create a queued campaign
  // that sends to nobody and sits there looking like it is working.
  if (sendable === 0) {
    return {
      ok: false,
      error:
        skippedForVariables.length > 0
          ? "Nobody has a value for one of the blanks in this template, so there is nothing to send. Check the values step."
          : "Every contact in this audience was excluded, so there is nothing to send.",
    };
  }

  // The findUnique above is an optimisation, not the guard. Everything between
  // it and this insert — loading the template, resolving the audience, checking
  // every recipient's variables — can take hundreds of milliseconds on a large
  // list, so two clicks can both find nothing and both arrive here. The unique
  // key is what actually decides it; losing that race means the other click
  // already built this campaign, which is a success, not a failure.
  let campaign: { id: string };

  try {
    campaign = await prisma.campaign.create({
      data: {
        name: input.name,
        idempotencyKey: input.idempotencyKey,
        // SCHEDULED is left alone by the sender until its time arrives.
        status: input.scheduledAt ? "SCHEDULED" : "QUEUED",
        scheduledAt: input.scheduledAt,
        templateId: template.id,
        templateName: template.name,
        templateLanguage: template.language,
        templateCategory: template.category,
        audienceType: input.audience.type,
        audienceFilter: input.audience as unknown as Prisma.InputJsonValue,
        variableMapping: input.mapping as unknown as Prisma.InputJsonValue,
        headerMediaUrl: input.headerMediaUrl,
        headerMediaType: requiredMedia ?? input.headerMediaType,
        totalRecipients: sendable,
        skippedCount,
        createdById: input.createdById,
        // The unique (campaignId, phoneE164) constraint means a contact cannot
        // appear twice even if the audience selection overlapped.
        recipients: { createMany: { data: recipients, skipDuplicates: true } },
      },
      select: { id: true },
    });
  } catch (error) {
    // Lost the race on the unique key: the other click already created it.
    //
    // Without this the second click surfaced "The campaign could not be
    // started. Please try again." for a campaign that had in fact started and
    // was already messaging people. Following that instruction reloads the
    // page, which mints a fresh idempotency key, and the next click sends the
    // whole audience a second time — so the missing catch turned a harmless
    // duplicate into a real double-send, at double the cost.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await prisma.campaign.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });

      if (winner) {
        log.info({ campaignId: winner.id }, "Duplicate submit lost the race");
        return { ok: true, campaignId: winner.id, wasDuplicate: true };
      }
    }

    throw error;
  }

  log.info(
    {
      campaignId: campaign.id,
      sendable,
      skipped: skippedCount,
      missingVariables: skippedForVariables.length,
    },
    "Campaign created",
  );

  return { ok: true, campaignId: campaign.id };
}

/* -------------------------------------------------------------------------- */
/* Resending to the people a campaign could not reach                          */
/* -------------------------------------------------------------------------- */

export interface RetryReasonGroup {
  reason: string;
  count: number;
  /** Informational: a reason that will almost certainly fail again. */
  permanent: boolean;
}

export interface RetryPreview {
  /** How many recipients a resend would attempt. */
  failedCount: number;
  /** Of those, how many failed for a reason that will not change. */
  permanentCount: number;
  reasons: RetryReasonGroup[];
  /** Resends already made from this campaign. */
  previousRetries: number;
  /** Set when a resend is not possible right now. */
  blockedReason?: string;
}

/**
 * Summarises what a resend would do, for the confirmation step.
 *
 * Meta bills on delivery, so a failed message costs nothing and every failure
 * is worth retrying. The permanent/temporary split is shown so the operator
 * knows what to expect, not to stop them.
 */
export async function getRetryPreview(campaignId: string): Promise<RetryPreview> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true, templateId: true },
  });

  const empty: RetryPreview = {
    failedCount: 0,
    permanentCount: 0,
    reasons: [],
    previousRetries: 0,
  };

  if (!campaign) return { ...empty, blockedReason: "Campaign not found." };

  const [failed, neverAttempted, previousRetries] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where: { campaignId, status: "FAILED" },
      select: {
        message: { select: { errorCode: true, errorUserMessage: true } },
      },
    }),
    // Recipients a halt never got to.
    //
    // All four stop paths in sender.ts — cancelled, WhatsApp not configured,
    // template no longer approved, auth error — set the campaign's status and
    // return without touching recipients, so everyone not yet reached stays
    // PENDING rather than FAILED. Counting only FAILED meant those people were
    // invisible here and the screen said "Nothing failed in this campaign, so
    // there is nothing to resend" about a campaign that had messaged half its
    // audience. There was no path left in the app to reach the other half.
    //
    // Only counted once the campaign has stopped: PENDING on a live campaign
    // just means "not yet".
    isStopped(campaign.status)
      ? prisma.campaignRecipient.count({
          where: { campaignId, status: "PENDING" },
        })
      : Promise.resolve(0),
    prisma.campaign.count({ where: { retryOfCampaignId: campaignId } }),
  ]);

  // Group by the plain-English reason the operator already sees in the list.
  const groups = new Map<string, RetryReasonGroup>();
  let permanentCount = 0;

  for (const recipient of failed) {
    // classifyStoredError, not classifyError: a code read back from the
    // database may be an HTTP status Meta gave us instead of a real code.
    const code = recipient.message?.errorCode;
    const permanent = code ? !classifyStoredError(code).retryable : false;
    if (permanent) permanentCount += 1;

    const reason =
      recipient.message?.errorUserMessage ??
      "WhatsApp did not say why this message failed.";

    const existing = groups.get(reason);
    if (existing) existing.count += 1;
    else groups.set(reason, { reason, count: 1, permanent });
  }

  if (neverAttempted > 0) {
    groups.set("never-attempted", {
      reason:
        "Sending stopped before these people were reached, so nothing was tried for them.",
      count: neverAttempted,
      permanent: false,
    });
  }

  let blockedReason: string | undefined;

  if (["QUEUED", "RUNNING", "SCHEDULED"].includes(campaign.status)) {
    blockedReason =
      "This campaign is still sending. Wait until it finishes, so the list of failures is final.";
  } else if (failed.length + neverAttempted === 0) {
    blockedReason = "Nothing failed in this campaign, so there is nothing to resend.";
  }

  return {
    failedCount: failed.length + neverAttempted,
    permanentCount,
    reasons: [...groups.values()].sort((a, b) => b.count - a.count),
    previousRetries,
    blockedReason,
  };
}

/**
 * Creates a new campaign aimed only at the recipients this one failed to reach.
 *
 * A separate campaign rather than reopening the original, because the original
 * report is a record of what happened and rewriting it would destroy the
 * history of what was spent and delivered.
 *
 * FAILED recipients are copied, and so are PENDING ones once the campaign has
 * stopped: every halt in sender.ts returns without touching recipients, so
 * anyone sending never reached is left PENDING rather than FAILED. Excluding
 * them left no way to reach the rest of an audience after a halt.
 *
 * Still deliberately excluded:
 *  - SENT recipients, including the ones flagged needsReconciliation, where a
 *    message may already have reached the customer.
 *  - SKIPPED recipients, who were excluded on purpose — opted out, no opt-in,
 *    or missing a value the template needs.
 */
export async function createRetryCampaign(
  campaignId: string,
  createdById: string,
  /**
   * Idempotency key from the page that offered the button, so a double-click
   * resolves to one campaign. Omit it and the attempt-number fallback applies,
   * which cannot survive genuine concurrency — see below.
   */
  callerKey?: string,
): Promise<CreateCampaignResult> {
  const parent = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      templateId: true,
      templateName: true,
      templateLanguage: true,
      templateCategory: true,
      audienceFilter: true,
      variableMapping: true,
      headerMediaUrl: true,
      headerMediaType: true,
    },
  });

  if (!parent) return { ok: false, error: "That campaign no longer exists." };

  // A campaign still in flight has an incomplete failure list, and resending
  // now would miss the ones that fail in the next minute.
  if (["QUEUED", "RUNNING", "SCHEDULED"].includes(parent.status)) {
    return {
      ok: false,
      error:
        "This campaign is still sending. Wait until it finishes before resending to the failures.",
    };
  }

  // Meta can pause or reject a template between the two sends, in which case
  // every message in the resend would fail identically.
  if (parent.templateId) {
    const template = await prisma.template.findUnique({
      where: { id: parent.templateId },
      select: { status: true },
    });

    if (template && template.status !== "APPROVED") {
      return {
        ok: false,
        error:
          "This template is no longer approved by WhatsApp, so it cannot be sent again.",
      };
    }
  }

  const failed = await prisma.campaignRecipient.findMany({
    where: {
      campaignId,
      // PENDING is included because the campaign has stopped — checked above,
      // where anything still QUEUED, RUNNING or SCHEDULED is refused. On a
      // stopped campaign PENDING means sending never got this far, which is
      // exactly the person a resend exists to reach.
      status: { in: ["FAILED", "PENDING"] },
      // Belt and braces. A timed-out send is recorded as SENT, so it should
      // never appear here — but a duplicate message to a real customer is bad
      // enough to be worth guarding twice.
      needsReconciliation: false,
    },
    select: {
      contactId: true,
      phoneE164: true,
      name: true,
      variables: true,
    },
  });

  if (failed.length === 0) {
    return {
      ok: false,
      error: "Nothing failed in this campaign, so there is nothing to resend.",
    };
  }

  const attempt = (await prisma.campaign.count({
    where: { retryOfCampaignId: campaignId },
  })) + 1;

  // A key minted when the page rendered, when the caller has one.
  //
  // The fallback below cannot make concurrent clicks collide, and the comment
  // that used to sit here claimed otherwise: the attempt number is counted
  // from the very rows a resend creates, so if the first click commits before
  // the second counts, the second computes attempt + 1, gets a different key,
  // and creates a second campaign. The failed contacts are then messaged
  // twice. Two clicks from one page now carry one key and collide by
  // construction, which is the same thing the campaign wizard does.
  const idempotencyKey = callerKey ?? `retry:${campaignId}:${attempt}`;

  const existing = await prisma.campaign.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });

  if (existing) {
    log.info({ campaignId: existing.id }, "Duplicate resend ignored");
    return { ok: true, campaignId: existing.id, wasDuplicate: true };
  }

  try {
    const retry = await prisma.campaign.create({
      data: {
        name: `${parent.name} — resend ${attempt}`,
        idempotencyKey,
        status: "QUEUED",
        retryOfCampaignId: campaignId,
        templateId: parent.templateId,
        templateName: parent.templateName,
        templateLanguage: parent.templateLanguage,
        templateCategory: parent.templateCategory,
        // The audience is this exact list of people, not a rule that could
        // resolve to somebody else when it runs.
        audienceType: "SELECTED",
        audienceFilter: {
          type: "SELECTED",
          contactIds: failed
            .map((r) => r.contactId)
            .filter((id): id is string => id !== null),
        } as unknown as Prisma.InputJsonValue,
        variableMapping: parent.variableMapping as Prisma.InputJsonValue,
        headerMediaUrl: parent.headerMediaUrl,
        headerMediaType: parent.headerMediaType,
        totalRecipients: failed.length,
        createdById,
        recipients: {
          createMany: {
            data: failed.map((r) => ({
              contactId: r.contactId,
              phoneE164: r.phoneE164,
              name: r.name,
              // Reused exactly as first sent, so the customer receives the
              // message that was intended even if the contact changed since.
              variables: r.variables as Prisma.InputJsonValue,
              status: "PENDING" as const,
            })),
            skipDuplicates: true,
          },
        },
      },
      select: { id: true },
    });

    log.info(
      { campaignId: retry.id, retryOf: campaignId, recipients: failed.length },
      "Resend campaign created",
    );

    return { ok: true, campaignId: retry.id };
  } catch (error) {
    // Lost the race on the unique key: the other click already created it.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await prisma.campaign.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });

      if (winner) return { ok: true, campaignId: winner.id, wasDuplicate: true };
    }

    throw error;
  }
}

export async function listCampaigns() {
  return prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      templateName: true,
      templateCategory: true,
      totalRecipients: true,
      sentCount: true,
      deliveredCount: true,
      readCount: true,
      failedCount: true,
      skippedCount: true,
      repliedCount: true,
      createdAt: true,
      completedAt: true,
      createdBy: { select: { name: true } },
    },
  });
}

export async function getCampaign(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      template: { select: { components: true } },
    },
  });
}

export async function getCampaignRecipients(
  campaignId: string,
  options: { status?: string; page?: number; pageSize?: number } = {},
) {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 50, 200);

  const where: Prisma.CampaignRecipientWhereInput = {
    campaignId,
    ...(options.status ? { status: options.status as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        phoneE164: true,
        status: true,
        skipReason: true,
        repliedAt: true,
        createdAt: true,
        updatedAt: true,
        message: {
          select: {
            sentAt: true,
            deliveredAt: true,
            readAt: true,
            failedAt: true,
            errorUserMessage: true,
          },
        },
      },
    }),
    prisma.campaignRecipient.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

/**
 * Stops a running campaign.
 *
 * Only messages not yet sent are cancelled — WhatsApp cannot recall a
 * delivered message, and the UI says so plainly.
 */
export async function cancelCampaign(id: string): Promise<number> {
  const cancelled = await prisma.campaignRecipient.updateMany({
    where: { campaignId: id, status: { in: ["PENDING", "QUEUED"] } },
    data: { status: "SKIPPED", skipReason: "campaign_cancelled" },
  });

  await prisma.campaign.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      skippedCount: { increment: cancelled.count },
    },
  });

  log.info({ campaignId: id, cancelled: cancelled.count }, "Campaign cancelled");
  return cancelled.count;
}
