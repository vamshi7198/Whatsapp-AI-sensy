import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { moduleLogger } from "../logger";
import {
  resolveAudience,
  resolveVariables,
  type AudienceFilter,
  type VariableMapping,
} from "./audience";

const log = moduleLogger("campaigns");

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

  const campaign = await prisma.campaign.create({
    data: {
      name: input.name,
      idempotencyKey: input.idempotencyKey,
      status: "QUEUED",
      templateId: template.id,
      templateName: template.name,
      templateLanguage: template.language,
      templateCategory: template.category,
      audienceType: input.audience.type,
      audienceFilter: input.audience as unknown as Prisma.InputJsonValue,
      variableMapping: input.mapping as unknown as Prisma.InputJsonValue,
      totalRecipients: sendable,
      skippedCount,
      createdById: input.createdById,
      // The unique (campaignId, phoneE164) constraint means a contact cannot
      // appear twice even if the audience selection overlapped.
      recipients: { createMany: { data: recipients, skipDuplicates: true } },
    },
    select: { id: true },
  });

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
