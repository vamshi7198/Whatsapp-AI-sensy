import type { Prisma, TemplateCategory } from "@prisma/client";

import { prisma } from "../db";

/**
 * Audience resolution and the compliance gate.
 *
 * This is the code that decides who receives a campaign, so it is deliberately
 * explicit about who is excluded and why. Every skip is reported to the
 * operator before sending — compliance that hides its decisions is not
 * trustworthy, and "why did only 453 of 500 go out?" must have an answer.
 */

export type AudienceType =
  | "ALL_CONTACTS"
  | "TAG"
  | "TAGS"
  | "SELECTED"
  | "CSV_UPLOAD";

export interface AudienceFilter {
  type: AudienceType;
  tagIds?: string[];
  /** For TAGS: whether a contact needs every tag or any of them. */
  match?: "any" | "all";
  contactIds?: string[];
}

export type SkipReason =
  | "not_opted_in"
  | "marketing_opted_out"
  | "invalid_number"
  | "missing_variable";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  not_opted_in: "Has not agreed to receive marketing messages",
  marketing_opted_out: "Asked to stop receiving marketing messages",
  invalid_number: "Number is not on WhatsApp",
  missing_variable: "Missing a value needed by the template",
};

export interface AudienceMember {
  contactId: string;
  phoneE164: string;
  name: string | null;
  email: string | null;
  attributes: Record<string, string>;
  tags: string[];
}

export interface ResolvedAudience {
  eligible: AudienceMember[];
  skipped: Array<{ member: AudienceMember; reason: SkipReason }>;
  totalMatched: number;
}

function buildWhere(filter: AudienceFilter): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { deletedAt: null };

  switch (filter.type) {
    case "TAG":
    case "TAGS": {
      const tagIds = filter.tagIds ?? [];
      if (tagIds.length === 0) break;

      if (filter.match === "all" && tagIds.length > 1) {
        // Every tag must be present, so each becomes its own condition.
        where.AND = tagIds.map((tagId) => ({ tags: { some: { tagId } } }));
      } else {
        where.tags = { some: { tagId: { in: tagIds } } };
      }
      break;
    }

    case "SELECTED":
      where.id = { in: filter.contactIds ?? [] };
      break;

    case "ALL_CONTACTS":
    case "CSV_UPLOAD":
    default:
      break;
  }

  return where;
}

/** Counts contacts matching the audience, before compliance filtering. */
export async function countAudience(filter: AudienceFilter): Promise<number> {
  if (
    (filter.type === "TAG" || filter.type === "TAGS") &&
    !filter.tagIds?.length
  ) {
    return 0;
  }
  if (filter.type === "SELECTED" && !filter.contactIds?.length) return 0;

  return prisma.contact.count({ where: buildWhere(filter) });
}

/**
 * Resolves the audience and applies the compliance gate.
 *
 * Marketing rules differ from utility rules, and that difference is Meta's,
 * not ours: an order-shipped notification is not marketing, so opt-out does
 * not apply to it. The template's category decides, and the operator cannot
 * override it.
 */
export async function resolveAudience(
  filter: AudienceFilter,
  category: TemplateCategory,
): Promise<ResolvedAudience> {
  const contacts = await prisma.contact.findMany({
    where: buildWhere(filter),
    select: {
      id: true,
      name: true,
      phoneE164: true,
      email: true,
      attributes: true,
      optInStatus: true,
      marketingOptOut: true,
      whatsappStatus: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });

  const eligible: AudienceMember[] = [];
  const skipped: ResolvedAudience["skipped"] = [];
  const isMarketing = category === "MARKETING";

  for (const contact of contacts) {
    const member: AudienceMember = {
      contactId: contact.id,
      phoneE164: contact.phoneE164,
      name: contact.name,
      email: contact.email,
      attributes: (contact.attributes as Record<string, string>) ?? {},
      tags: contact.tags.map((t) => t.tag.name),
    };

    // A number Meta has already told us is not on WhatsApp is excluded
    // regardless of category — sending would only produce another failure.
    if (contact.whatsappStatus === "INVALID") {
      skipped.push({ member, reason: "invalid_number" });
      continue;
    }

    if (isMarketing) {
      if (contact.marketingOptOut) {
        skipped.push({ member, reason: "marketing_opted_out" });
        continue;
      }
      // Consent is required, never inferred from the contact existing.
      if (contact.optInStatus !== "OPTED_IN") {
        skipped.push({ member, reason: "not_opted_in" });
        continue;
      }
    }

    eligible.push(member);
  }

  return { eligible, skipped, totalMatched: contacts.length };
}

/* ------------------------------------------------------------------ */
/* Variable mapping                                                    */
/* ------------------------------------------------------------------ */

export type VariableSource =
  | { source: "contact_field"; field: "name" | "phone" | "email" }
  | { source: "attribute"; key: string }
  | { source: "fixed"; value: string };

/** Mapping of positional template variable -> where its value comes from. */
export type VariableMapping = Record<string, VariableSource>;

/**
 * Resolves one recipient's variable values.
 *
 * Returns null for a value that cannot be resolved, so the caller can skip
 * that recipient rather than send a message with a blank in it.
 */
export function resolveVariables(
  member: AudienceMember,
  mapping: VariableMapping,
): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const [index, source] of Object.entries(mapping)) {
    let value: string | null | undefined;

    switch (source.source) {
      case "contact_field":
        value =
          source.field === "name"
            ? member.name
            : source.field === "phone"
              ? member.phoneE164
              : member.email;
        break;
      case "attribute":
        value = member.attributes[source.key];
        break;
      case "fixed":
        value = source.value;
        break;
    }

    const trimmed = value?.trim();
    if (!trimmed) {
      missing.push(index);
    } else {
      values[index] = trimmed;
    }
  }

  return { values, missing };
}

/**
 * Meta rejects template parameters containing newlines, tabs, or four or more
 * consecutive spaces, and enforces a length limit.
 *
 * Validated at mapping time rather than send time: a violation discovered
 * during sending fails every message in the campaign identically, which is a
 * miserable way to learn a contact's name has a line break in it.
 */
export const MAX_VARIABLE_LENGTH = 1024;

export function validateVariableValue(value: string): string | null {
  if (value.length > MAX_VARIABLE_LENGTH) {
    return `Too long (${value.length} characters, maximum ${MAX_VARIABLE_LENGTH})`;
  }
  if (/[\n\r]/.test(value)) return "Contains a line break";
  if (/\t/.test(value)) return "Contains a tab";
  if (/ {4,}/.test(value)) return "Contains four or more spaces in a row";
  return null;
}
