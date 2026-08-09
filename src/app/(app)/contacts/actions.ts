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
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
    }

    const { id, phone, optedIn, ...rest } = parsed.data;

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
