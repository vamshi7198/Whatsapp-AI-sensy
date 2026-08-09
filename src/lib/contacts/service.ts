import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import type { ContactFilter } from "./schema";

/**
 * Contact data access.
 *
 * Kept separate from server actions so the same queries serve the UI, the CSV
 * export, the campaign audience resolver and (later) the public API without
 * being reimplemented three times with subtly different filters — which is how
 * a campaign ends up targeting the wrong people.
 */

export const CONTACT_LIST_SELECT = {
  id: true,
  name: true,
  phoneE164: true,
  phoneCountry: true,
  email: true,
  source: true,
  optInStatus: true,
  marketingOptOut: true,
  whatsappStatus: true,
  lastContactedAt: true,
  createdAt: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.ContactSelect;

export type ContactListItem = Prisma.ContactGetPayload<{
  select: typeof CONTACT_LIST_SELECT;
}>;

/** Builds the Prisma filter shared by the list view, export and bulk actions. */
export function buildContactWhere(
  filter: Partial<ContactFilter>,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { deletedAt: null };

  if (filter.search) {
    const term = filter.search.trim();
    // Phone search tolerates the user typing spaces, dashes or a leading +.
    const digits = term.replace(/[^\d]/g, "");

    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      ...(digits.length >= 3
        ? [{ phoneE164: { contains: digits } }]
        : []),
    ];
  }

  if (filter.tagIds?.length) {
    where.tags = { some: { tagId: { in: filter.tagIds } } };
  }

  if (filter.optInStatus) where.optInStatus = filter.optInStatus;
  if (filter.marketingOptOut !== undefined) {
    where.marketingOptOut = filter.marketingOptOut;
  }
  if (filter.source) where.source = filter.source;

  return where;
}

export async function listContacts(filter: ContactFilter) {
  const where = buildContactWhere(filter);

  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: CONTACT_LIST_SELECT,
      orderBy: { [filter.sortBy]: filter.sortDir },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    items,
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
  };
}

export async function getContact(id: string) {
  return prisma.contact.findFirst({
    where: { id, deletedAt: null },
    include: {
      tags: { include: { tag: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          direction: true,
          type: true,
          body: true,
          status: true,
          errorUserMessage: true,
          createdAt: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
        },
      },
      campaignRecipients: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          skipReason: true,
          createdAt: true,
          campaign: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function listTags() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      _count: { select: { contacts: true } },
    },
  });

  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    color: t.color,
    contactCount: t._count.contacts,
  }));
}

/** Distinct non-null sources, for the filter dropdown. */
export async function listContactSources(): Promise<string[]> {
  const rows = await prisma.contact.findMany({
    where: { deletedAt: null, source: { not: null } },
    distinct: ["source"],
    select: { source: true },
    take: 50,
  });

  return rows
    .map((r) => r.source)
    .filter((s): s is string => Boolean(s))
    .sort();
}

/**
 * Counts used by the dashboard and by campaign audience previews.
 *
 * `marketingEligible` is the number that actually matters before a marketing
 * campaign: opted in, not opted out, and not soft-deleted.
 */
export async function getContactCounts() {
  const [total, optedIn, optedOut, marketingEligible] = await Promise.all([
    prisma.contact.count({ where: { deletedAt: null } }),
    prisma.contact.count({
      where: { deletedAt: null, optInStatus: "OPTED_IN" },
    }),
    prisma.contact.count({ where: { deletedAt: null, marketingOptOut: true } }),
    prisma.contact.count({
      where: {
        deletedAt: null,
        optInStatus: "OPTED_IN",
        marketingOptOut: false,
      },
    }),
  ]);

  return { total, optedIn, optedOut, marketingEligible };
}
