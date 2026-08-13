import type { Prisma } from "@prisma/client";

import { prisma } from "../db";

/**
 * Writing an answer onto a contact.
 *
 * Contact has real columns for only a couple of things — name and email — and
 * an attributes bag for everything else. A journey step that wrote straight to
 * a column therefore threw the moment anyone chose a field that was not one of
 * those two, which killed the step and left the customer stuck mid-conversation
 * with no way forward. "What is your delivery address?" is the most obvious
 * journey anyone would build, and it was the one that broke.
 *
 * So there are no forbidden field names here. Known columns go to columns;
 * everything else joins the attributes bag, where it is equally usable as a
 * template variable and equally visible on the contact.
 */

/** Fields that are real columns rather than attributes. */
const COLUMNS = new Set(["name", "email", "notes"]);

/** Anything that would collide with a column or confuse the writer. */
const RESERVED = new Set([
  "id",
  "phoneE164",
  "phoneCountry",
  "optInStatus",
  "marketingOptOut",
  "whatsappStatus",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "attributes",
]);

/** A field name safe to store, or null if it must not be written. */
export function normaliseFieldName(raw: string): string | null {
  const field = raw.trim();
  if (!field) return null;

  // Consent and identity are never set by a customer's answer. Someone could
  // otherwise build a journey that opts people in by asking them a question.
  if (RESERVED.has(field)) return null;

  return field;
}

/**
 * Saves an answer against a contact.
 *
 * Returns false when the field was refused, so the caller can carry on rather
 * than treating it as a failure worth ending the conversation over.
 */
export async function writeContactField(
  contactId: string,
  field: string,
  value: string,
): Promise<boolean> {
  const name = normaliseFieldName(field);
  if (!name) return false;

  if (COLUMNS.has(name)) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { [name]: value },
    });
    return true;
  }

  // Merged rather than replaced: a journey saving a flavour must not wipe the
  // address a previous journey saved.
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { attributes: true },
  });

  const existing =
    contact?.attributes && typeof contact.attributes === "object" && !Array.isArray(contact.attributes)
      ? (contact.attributes as Record<string, unknown>)
      : {};

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      attributes: { ...existing, [name]: value } as Prisma.InputJsonValue,
    },
  });

  return true;
}

/** Reads a field back, wherever it lives. Used by condition steps. */
export async function readContactField(
  contactId: string,
  field: string,
): Promise<string | null> {
  const name = normaliseFieldName(field);
  if (!name) return null;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { name: true, email: true, notes: true, attributes: true },
  });

  if (!contact) return null;

  if (COLUMNS.has(name)) {
    const value = (contact as Record<string, unknown>)[name];
    return typeof value === "string" ? value : null;
  }

  const attributes =
    contact.attributes && typeof contact.attributes === "object" && !Array.isArray(contact.attributes)
      ? (contact.attributes as Record<string, unknown>)
      : {};

  const value = attributes[name];
  return value === null || value === undefined ? null : String(value);
}
