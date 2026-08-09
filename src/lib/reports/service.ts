import type { Prisma } from "@prisma/client";

import { prisma } from "../db";

/**
 * Cross-campaign reporting.
 *
 * Every rate is calculated against the honest denominator: delivery and read
 * rates are shares of what was actually *sent*, not of the audience that was
 * considered. Dividing by the audience would flatter every number, because
 * skipped contacts were never messaged.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeFromPreset(preset: string): DateRange {
  const to = new Date();
  const from = new Date();

  switch (preset) {
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
    case "all":
      from.setFullYear(2000);
      break;
    case "30d":
    default:
      from.setDate(from.getDate() - 30);
  }

  return { from, to };
}

export interface ReportTotals {
  campaigns: number;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  skipped: number;
}

export interface CampaignReportRow {
  id: string;
  name: string;
  status: string;
  templateName: string;
  category: string;
  createdAt: Date;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  repliedCount: number;
  skippedCount: number;
}

export async function getCampaignReport(range: DateRange): Promise<{
  totals: ReportTotals;
  campaigns: CampaignReportRow[];
}> {
  const where: Prisma.CampaignWhereInput = {
    createdAt: { gte: range.from, lte: range.to },
    // Drafts were never sent, so including them would drag every rate down.
    status: { notIn: ["DRAFT"] },
  };

  const [campaigns, aggregate] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        status: true,
        templateName: true,
        templateCategory: true,
        createdAt: true,
        totalRecipients: true,
        sentCount: true,
        deliveredCount: true,
        readCount: true,
        failedCount: true,
        repliedCount: true,
        skippedCount: true,
      },
    }),
    prisma.campaign.aggregate({
      where,
      _sum: {
        totalRecipients: true,
        sentCount: true,
        deliveredCount: true,
        readCount: true,
        failedCount: true,
        repliedCount: true,
        skippedCount: true,
      },
      _count: true,
    }),
  ]);

  return {
    totals: {
      campaigns: aggregate._count,
      recipients: aggregate._sum.totalRecipients ?? 0,
      sent: aggregate._sum.sentCount ?? 0,
      delivered: aggregate._sum.deliveredCount ?? 0,
      read: aggregate._sum.readCount ?? 0,
      failed: aggregate._sum.failedCount ?? 0,
      replied: aggregate._sum.repliedCount ?? 0,
      skipped: aggregate._sum.skippedCount ?? 0,
    },
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      templateName: c.templateName,
      category: c.templateCategory,
      createdAt: c.createdAt,
      totalRecipients: c.totalRecipients,
      sentCount: c.sentCount,
      deliveredCount: c.deliveredCount,
      readCount: c.readCount,
      failedCount: c.failedCount,
      repliedCount: c.repliedCount,
      skippedCount: c.skippedCount,
    })),
  };
}

export interface FailureReason {
  reason: string;
  count: number;
}

/**
 * Why messages failed, grouped and in plain English.
 *
 * Grouped on the human-readable message rather than the Meta error code,
 * because the person reading this needs to know what to change, not which
 * numeric code fired.
 */
export async function getFailureBreakdown(
  range: DateRange,
): Promise<FailureReason[]> {
  const failures = await prisma.message.groupBy({
    by: ["errorUserMessage"],
    where: {
      direction: "OUTBOUND",
      status: "FAILED",
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: true,
    orderBy: { _count: { errorUserMessage: "desc" } },
    take: 10,
  });

  return failures.map((f) => ({
    reason: f.errorUserMessage ?? "No reason recorded",
    count: f._count,
  }));
}

/** Why contacts were excluded before sending. */
export async function getSkipBreakdown(
  range: DateRange,
): Promise<FailureReason[]> {
  const skips = await prisma.campaignRecipient.groupBy({
    by: ["skipReason"],
    where: {
      status: "SKIPPED",
      skipReason: { not: null },
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: true,
    orderBy: { _count: { skipReason: "desc" } },
    take: 10,
  });

  const LABELS: Record<string, string> = {
    not_opted_in: "Had not agreed to receive marketing messages",
    marketing_opted_out: "Had asked to stop receiving marketing messages",
    invalid_number: "Number is not on WhatsApp",
    missing_variable: "Missing a value the template needed",
    campaign_cancelled: "Campaign was stopped before reaching them",
    contact_deleted: "Contact was deleted",
  };

  return skips.map((s) => ({
    reason: LABELS[s.skipReason ?? ""] ?? s.skipReason ?? "Unknown",
    count: s._count,
  }));
}

export interface InboxStats {
  conversations: number;
  inbound: number;
  outbound: number;
  openConversations: number;
  unread: number;
}

export async function getInboxStats(range: DateRange): Promise<InboxStats> {
  const [conversations, inbound, outbound, open, unreadAgg] = await Promise.all([
    prisma.conversation.count({
      where: { lastMessageAt: { gte: range.from, lte: range.to } },
    }),
    prisma.message.count({
      where: {
        direction: "INBOUND",
        createdAt: { gte: range.from, lte: range.to },
      },
    }),
    prisma.message.count({
      where: {
        direction: "OUTBOUND",
        createdAt: { gte: range.from, lte: range.to },
      },
    }),
    prisma.conversation.count({ where: { status: "OPEN" } }),
    prisma.conversation.aggregate({ _sum: { unreadCount: true } }),
  ]);

  return {
    conversations,
    inbound,
    outbound,
    openConversations: open,
    unread: unreadAgg._sum.unreadCount ?? 0,
  };
}

export interface ContactGrowth {
  total: number;
  addedInRange: number;
  optedIn: number;
  optedOut: number;
  bySource: Array<{ source: string; count: number }>;
}

export async function getContactGrowth(
  range: DateRange,
): Promise<ContactGrowth> {
  const [total, added, optedIn, optedOut, sources] = await Promise.all([
    prisma.contact.count({ where: { deletedAt: null } }),
    prisma.contact.count({
      where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
    }),
    prisma.contact.count({
      where: { deletedAt: null, optInStatus: "OPTED_IN", marketingOptOut: false },
    }),
    prisma.contact.count({ where: { deletedAt: null, marketingOptOut: true } }),
    prisma.contact.groupBy({
      by: ["source"],
      where: { deletedAt: null },
      _count: true,
      orderBy: { _count: { source: "desc" } },
      take: 8,
    }),
  ]);

  return {
    total,
    addedInRange: added,
    optedIn,
    optedOut,
    bySource: sources.map((s) => ({
      source: s.source ?? "added manually",
      count: s._count,
    })),
  };
}
