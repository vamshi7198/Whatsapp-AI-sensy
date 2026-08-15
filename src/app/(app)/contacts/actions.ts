"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import {
  bulkContactActionSchema,
  createContactSchema,
  createTagSchema,
  slugify,
  updateContactSchema,
} from "@/lib/contacts/schema";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";

export interface ActionState {
  error?: string;
  success?: string;
  /** Set when a duplicate is detected, so the UI can offer to open it. */
  duplicateContactId?: string;
}

/** Turns thrown errors into a message safe to show a non-technical user. */
function toActionState(error: unknown): ActionState {
  if (error instanceof ForbiddenError) {
    return { error: "You do not have permission to do that." };
  }
  // Never surface a raw database or stack message to the browser.
  return { error: "Something went wrong. Please try again." };
}

export async function createContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApiAuth("contact:create");

    const parsed = createContactSchema.safeParse({
      name: formData.get("name") || undefined,
      phone: formData.get("phone"),
      email: formData.get("email") || undefined,
      source: formData.get("source") || "manual",
      notes: formData.get("notes") || undefined,
      optedIn: formData.get("optedIn") === "on",
      optInSource: formData.get("optInSource") || undefined,
      tagIds: formData.getAll("tagIds").map(String).filter(Boolean),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
    }

    const data = parsed.data;

    // The unique constraint would catch this anyway, but checking first lets
    // us offer "open the existing contact" instead of a bare error.
    const existing = await prisma.contact.findUnique({
      where: { phoneE164: data.phone },
      select: { id: true, name: true, deletedAt: true },
    });

    if (existing && !existing.deletedAt) {
      return {
        error: `A contact with this number already exists${existing.name ? ` (${existing.name})` : ""}.`,
        duplicateContactId: existing.id,
      };
    }

    // A deleted contact is refused rather than quietly restored.
    //
    // The guard above only fired for rows that were NOT deleted, so adding a
    // number belonging to someone erased fell straight into the upsert, which
    // cleared deletedAt and stamped optInStatus OPTED_IN with optInAt of now.
    //
    // Not an attack — a deleted contact is invisible everywhere in the app, so
    // an agent re-adding someone they believe is new does this by accident and
    // manufactures a consent record dated today. That record is the evidence
    // the business would rely on to prove the person agreed to be messaged.
    //
    // Restoring is a real decision and needs the permission that deleting did.
    if (existing?.deletedAt) {
      return {
        error:
          "This number belongs to a contact that was deleted. Ask an administrator to restore it rather than adding it again — re-adding would record fresh marketing consent that was never given.",
      };
    }

    const contact = await prisma.contact.upsert({
      where: { phoneE164: data.phone },
      // Restores a previously soft-deleted contact rather than failing.
      update: {
        deletedAt: null,
        name: data.name,
        email: data.email,
        source: data.source,
        notes: data.notes,
        optInStatus: data.optedIn ? "OPTED_IN" : "UNKNOWN",
        optInAt: data.optedIn ? new Date() : null,
        optInSource: data.optedIn ? (data.optInSource ?? "manual") : null,
      },
      create: {
        name: data.name,
        phoneE164: data.phone,
        email: data.email,
        source: data.source,
        notes: data.notes,
        optInStatus: data.optedIn ? "OPTED_IN" : "UNKNOWN",
        optInAt: data.optedIn ? new Date() : null,
        optInSource: data.optedIn ? (data.optInSource ?? "manual") : null,
      },
    });

    if (data.tagIds.length) {
      await prisma.contactTag.createMany({
        data: data.tagIds.map((tagId) => ({
          contactId: contact.id,
          tagId,
          addedById: user.id,
        })),
        skipDuplicates: true,
      });
    }

    await audit(user, "contact.create", {
      entityType: "Contact",
      entityId: contact.id,
    });

    revalidatePath("/contacts");
    return { success: "Contact added." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function updateContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApiAuth("contact:edit");

    const parsed = updateContactSchema.safeParse({
      id: formData.get("id"),
      name: formData.get("name") || undefined,
      phone: formData.get("phone") || undefined,
      email: formData.get("email") || undefined,
      notes: formData.get("notes") || undefined,
      optedIn: formData.get("optedIn") === "on",
      tagIds: formData.getAll("tagIds").map(String).filter(Boolean),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
    }

    const { id, phone, optedIn, tagIds, ...rest } = parsed.data;

    const current = await prisma.contact.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, optInStatus: true },
    });
    if (!current) return { error: "Contact not found." };

    // Changing a number to one that already exists would violate the unique
    // constraint; catch it here to give a useful message.
    if (phone) {
      const clash = await prisma.contact.findFirst({
        where: { phoneE164: phone, id: { not: id }, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        return {
          error: "Another contact already uses this number.",
          duplicateContactId: clash.id,
        };
      }
    }

    const wasOptedIn = current.optInStatus === "OPTED_IN";

    await prisma.contact.update({
      where: { id },
      data: {
        ...rest,
        ...(phone ? { phoneE164: phone } : {}),
        ...(optedIn !== undefined
          ? {
              optInStatus: optedIn ? "OPTED_IN" : "UNKNOWN",
              // Only stamp the timestamp on an actual transition, so an
              // unrelated edit does not rewrite the consent record.
              ...(optedIn && !wasOptedIn
                ? { optInAt: new Date(), optInSource: "manual" }
                : {}),
            }
          : {}),
      },
    });

    // Tags are replaced wholesale to match what the form submitted: an
    // unticked box must actually remove the tag, not silently keep it.
    if (tagIds !== undefined) {
      await prisma.$transaction([
        prisma.contactTag.deleteMany({
          where: { contactId: id, tagId: { notIn: tagIds } },
        }),
        prisma.contactTag.createMany({
          data: tagIds.map((tagId) => ({
            contactId: id,
            tagId,
            addedById: user.id,
          })),
          skipDuplicates: true,
        }),
      ]);
    }

    await audit(user, "contact.update", {
      entityType: "Contact",
      entityId: id,
    });

    revalidatePath("/contacts");
    revalidatePath(`/contacts/${id}`);
    return { success: "Contact updated." };
  } catch (error) {
    return toActionState(error);
  }
}

/** Soft-deletes a single contact from its detail page. */
export async function deleteContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApiAuth("contact:delete");
    const id = String(formData.get("id") ?? "");

    const contact = await prisma.contact.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, phoneE164: true },
    });

    if (!contact) return { error: "That contact no longer exists." };

    // Soft delete: campaign reports must stay accurate afterwards, and a
    // deleted contact who messages again should rejoin their own history.
    await prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await audit(user, "contact.delete", {
      entityType: "Contact",
      entityId: id,
      metadata: { name: contact.name },
    });

    revalidatePath("/contacts");
    return { success: "Contact deleted." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function bulkContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const action = String(formData.get("action"));

    // Deletion is a separate, higher permission than tagging.
    const user = await requireApiAuth(
      action === "delete" ? "contact:delete" : "contact:edit",
    );

    const parsed = bulkContactActionSchema.safeParse({
      contactIds: formData.getAll("contactIds").map(String),
      action,
      tagId: formData.get("tagId") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid selection" };
    }

    const { contactIds, tagId } = parsed.data;

    switch (parsed.data.action) {
      case "delete": {
        // Soft delete: campaign reports must stay accurate after removal.
        const result = await prisma.contact.updateMany({
          where: { id: { in: contactIds }, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        await audit(user, "contact.bulk_delete", {
          entityType: "Contact",
          metadata: { count: result.count },
        });

        revalidatePath("/contacts");
        return {
          success: `${result.count} contact${result.count === 1 ? "" : "s"} deleted.`,
        };
      }

      case "addTag": {
        if (!tagId) return { error: "Choose a tag first." };

        const result = await prisma.contactTag.createMany({
          data: contactIds.map((contactId) => ({
            contactId,
            tagId,
            addedById: user.id,
          })),
          skipDuplicates: true,
        });

        await audit(user, "contact.bulk_add_tag", {
          metadata: { count: result.count, tagId },
        });

        revalidatePath("/contacts");
        return { success: `Tag added to ${result.count} contact(s).` };
      }

      case "removeTag": {
        if (!tagId) return { error: "Choose a tag first." };

        const result = await prisma.contactTag.deleteMany({
          where: { contactId: { in: contactIds }, tagId },
        });

        await audit(user, "contact.bulk_remove_tag", {
          metadata: { count: result.count, tagId },
        });

        revalidatePath("/contacts");
        return { success: `Tag removed from ${result.count} contact(s).` };
      }

      default:
        return { error: "Unsupported action." };
    }
  } catch (error) {
    return toActionState(error);
  }
}

export async function createTag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApiAuth("tag:manage");

    const parsed = createTagSchema.safeParse({
      name: formData.get("name"),
      color: formData.get("color") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid tag" };
    }

    const name = parsed.data.name.toLowerCase();
    const existing = await prisma.tag.findUnique({ where: { name } });
    if (existing) return { error: "That tag already exists." };

    const tag = await prisma.tag.create({
      data: { name, slug: slugify(name), color: parsed.data.color },
    });

    await audit(user, "tag.create", { entityType: "Tag", entityId: tag.id });

    revalidatePath("/contacts");
    return { success: `Tag "${name}" created.` };
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * Where a tag is still referred to, in plain words.
 *
 * Journey steps and triggers keep tag ids inside JSON config, which no foreign
 * key can watch, so this reads them out and looks. Automation actions do have a
 * real column — but it is ON DELETE SET NULL, which silently disarms the action
 * rather than preventing the delete, so it needs checking too.
 */
async function tagReferences(tagId: string): Promise<string[]> {
  // Searched as text rather than by JSON path, because the id lives under a
  // different key depending on the step: ADD_TAG and REMOVE_TAG keep it in
  // `tagId`, a CONDITION on a tag keeps it in `key`. A fixed path would miss
  // whichever one it was not written for, and a guard that silently finds
  // nothing is worse than none — it reads as "safe to delete".
  //
  // Prisma's string_contains was the obvious choice and is wrong here: it
  // matches JSON string VALUES, not the serialised document, so it found
  // nothing at all. scripts/test-tag-references.ts is what caught that and is
  // what will catch it again.
  //
  // Tag ids are cuids, so a false positive from a substring match is not a
  // practical concern.
  const like = `%${tagId}%`;

  const [stepRows, triggerRows, actions] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "JourneyStep"
       WHERE config::text LIKE ${like}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "JourneyTrigger"
       WHERE config::text LIKE ${like}
    `,
    prisma.automationAction.count({ where: { tagId } }),
  ]);

  const steps = stepRows[0]?.count ?? 0;
  const triggers = triggerRows[0]?.count ?? 0;

  const uses: string[] = [];

  if (steps > 0) {
    uses.push(`${steps} journey step${steps === 1 ? "" : "s"}`);
  }
  if (triggers > 0) {
    uses.push(`${triggers} journey trigger${triggers === 1 ? "" : "s"}`);
  }
  if (actions > 0) {
    uses.push(`${actions} automation action${actions === 1 ? "" : "s"}`);
  }

  return uses;
}

export async function deleteTag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApiAuth("tag:manage");
    const id = String(formData.get("id"));
    if (!id) return { error: "Tag not specified." };

    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return { error: "Tag not found." };

    // Refused while anything still points at it.
    //
    // Journey and trigger configs hold tag ids inside JSON with no foreign
    // key, so the database cannot protect this and deleting produced three
    // different silent failures at once: an ADD_TAG step throws and ends the
    // session; a CONDITION on the tag quietly returns nothing, so EVERYONE
    // takes the "no" branch and the journey keeps running as though that were
    // the answer; and an automation action has its tagId set to null, so it is
    // skipped while the run still records COMPLETED.
    //
    // None of those announce themselves. Checking first is the only thing that
    // does.
    const uses = await tagReferences(id);

    if (uses.length > 0) {
      return {
        error: `"${tag.name}" is still used by ${uses.join(" and ")}. Remove it there first, or leave the tag in place — an unused tag costs nothing.`,
      };
    }

    // Cascade removes the ContactTag rows; the contacts themselves are
    // untouched.
    await prisma.tag.delete({ where: { id } });

    await audit(user, "tag.delete", {
      entityType: "Tag",
      entityId: id,
      metadata: { name: tag.name },
    });

    revalidatePath("/contacts");
    return { success: `Tag "${tag.name}" deleted.` };
  } catch (error) {
    return toActionState(error);
  }
}
