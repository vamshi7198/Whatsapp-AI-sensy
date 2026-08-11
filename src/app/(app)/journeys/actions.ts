"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { resolveAudience } from "@/lib/campaigns/audience";
import { startJourney, startJourneyForContacts } from "@/lib/journeys/engine";
import {
  checkJourney,
  createJourney,
  editableVersion,
  publishJourney,
  saveGraph,
  type LinkInput,
  type StepInput,
} from "@/lib/journeys/service";
import type { ValidationResult } from "@/lib/journeys/validate";
import { ForbiddenError } from "@/lib/rbac";

export interface JourneyState {
  error?: string;
  success?: string;
  journeyId?: string;
  versionId?: string;
  validation?: ValidationResult;
  /** Canvas id to saved id, so newly created steps adopt their real ones. */
  idMap?: Record<string, string>;
}

export async function createJourneyAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("journey:manage");

    const result = await createJourney({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      createdById: user.id,
    });

    if (!result.ok) return { error: result.error };

    await audit(user, "journey.create", {
      entityType: "Journey",
      entityId: result.journeyId,
    });

    revalidatePath("/journeys");
    return { journeyId: result.journeyId, versionId: result.versionId };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to build journeys." };
    }
    return { error: "Could not create that journey." };
  }
}

/** Saves the canvas. Called on demand, not on every drag. */
export async function saveGraphAction(input: {
  versionId: string;
  steps: StepInput[];
  links: LinkInput[];
}): Promise<JourneyState> {
  try {
    await requireApiAuth("journey:manage");

    const result = await saveGraph(input);
    if (!result.ok) return { error: result.error };

    // Reported alongside the save so problems surface while the operator is
    // still looking at the thing that caused them, not at publish time.
    const validation = await checkJourney(input.versionId);

    revalidatePath("/journeys");

    return {
      success: "Saved.",
      validation,
      versionId: input.versionId,
      idMap: result.idMap,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to edit journeys." };
    }
    return { error: "Could not save. Please try again." };
  }
}

export async function publishJourneyAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("journey:manage");
    const versionId = String(formData.get("versionId") ?? "");

    const result = await publishJourney(versionId);

    if (!result.ok) {
      return { error: result.error, validation: result.validation };
    }

    await audit(user, "journey.publish", {
      entityType: "Journey",
      entityId: result.journeyId,
      metadata: { versionId },
    });

    revalidatePath("/journeys");

    return {
      success:
        "Live. New customers now enter this version; anyone already partway through carries on with the old one.",
      journeyId: result.journeyId,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to publish journeys." };
    }
    return { error: "Could not publish that journey." };
  }
}

export async function newDraftAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("journey:manage");
    const journeyId = String(formData.get("journeyId") ?? "");

    const versionId = await editableVersion(journeyId, user.id);

    if (!versionId) {
      return { error: "That journey has nothing to edit yet." };
    }

    revalidatePath("/journeys");
    return { versionId, journeyId };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to edit journeys." };
    }
    return { error: "Could not open that journey for editing." };
  }
}

/**
 * Starts a journey for everyone in an audience.
 *
 * The same compliance gate campaigns use, because this messages exactly the
 * same people for the same commercial reason and the rules do not change
 * because the message happens to have buttons on it.
 */
export async function startForAudienceAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("campaign:send");

    const journeyId = String(formData.get("journeyId") ?? "");
    const tagId = String(formData.get("tagId") ?? "");
    const confirmed = formData.get("confirmed") === "on";

    if (!confirmed) {
      return { error: "Tick the confirmation box before starting." };
    }

    const journey = await prisma.journey.findUnique({
      where: { id: journeyId },
      select: { name: true, liveVersionId: true },
    });

    if (!journey) return { error: "That journey no longer exists." };

    if (!journey.liveVersionId) {
      return { error: "Publish this journey before sending it to anyone." };
    }

    // Category decides the compliance rule, and it comes from the template the
    // journey opens with rather than being asked for separately.
    const templateStep = await prisma.journeyStep.findFirst({
      where: { versionId: journey.liveVersionId, type: "SEND_TEMPLATE" },
      select: { config: true },
    });

    const templateId = templateStep
      ? String((templateStep.config as { templateId?: string })?.templateId ?? "")
      : "";

    const template = templateId
      ? await prisma.template.findUnique({
          where: { id: templateId },
          select: { category: true },
        })
      : null;

    const resolved = await resolveAudience(
      tagId ? { type: "TAG", tagIds: [tagId] } : { type: "ALL_CONTACTS" },
      template?.category ?? "MARKETING",
    );

    if (resolved.eligible.length === 0) {
      return {
        error:
          resolved.totalMatched === 0
            ? "No contacts match that group."
            : "Everyone in that group was excluded — check who has agreed to receive messages.",
      };
    }

    const result = await startJourneyForContacts({
      journeyId,
      contactIds: resolved.eligible.map((m) => m.contactId),
      trigger: `sent by ${user.name}`,
    });

    if (!result.ok) return { error: result.error };

    await audit(user, "journey.start_audience", {
      entityType: "Journey",
      entityId: journeyId,
      metadata: { started: result.started, tagId: tagId || null },
    });

    revalidatePath("/journeys");

    return {
      success:
        `Started for ${result.started} ${result.started === 1 ? "person" : "people"}.` +
        (result.alreadyIn > 0
          ? ` ${result.alreadyIn} were already partway through and were left alone.`
          : "") +
        (result.skipped > 0 ? ` ${result.skipped} could not be started.` : ""),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to send to an audience." };
    }
    return { error: "Could not start the journey." };
  }
}

/**
 * Sends a journey to one person, for testing.
 *
 * Deliberately one contact at a time and never an audience: the single worst
 * accident available here is testing a half-built conversation on the whole
 * contact list.
 */
export async function testJourneyAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("journey:manage");

    const journeyId = String(formData.get("journeyId") ?? "");
    const phone = String(formData.get("phone") ?? "").trim();

    if (!phone) return { error: "Enter the number to test with." };

    const contact = await prisma.contact.findFirst({
      where: { phoneE164: phone.startsWith("+") ? phone : `+${phone}`, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!contact) {
      return {
        error:
          "No contact has that number. Add them under Contacts first, so the test uses a real record.",
      };
    }

    const existing = await prisma.journeySession.findFirst({
      where: { journeyId, contactId: contact.id },
      select: { id: true },
    });

    // A previous test left them partway through, and the engine refuses a
    // second entry. Clearing it is what "test again" means.
    if (existing) {
      await prisma.journeySession.delete({ where: { id: existing.id } });
    }

    const result = await startJourney({
      journeyId,
      contactId: contact.id,
      trigger: `test by ${user.name}`,
    });

    if (!result.ok) return { error: result.error };

    await audit(user, "journey.test", {
      entityType: "Journey",
      entityId: journeyId,
      metadata: { contactId: contact.id },
    });

    return {
      success: `Started for ${contact.name ?? phone}. Check WhatsApp on that phone.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to test journeys." };
    }
    return { error: "Could not start the test." };
  }
}
