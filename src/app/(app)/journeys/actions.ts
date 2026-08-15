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
 * Sets what starts a journey.
 *
 * Replaces the whole set rather than editing individual triggers: there are
 * only ever a handful, and a diff of them is more ways to go wrong than the
 * feature is worth.
 */
export async function saveTriggersAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("journey:manage");

    const versionId = String(formData.get("versionId") ?? "");
    const mode = String(formData.get("triggerMode") ?? "manual");

    const keywords = String(formData.get("keywords") ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (mode === "keyword" && keywords.length === 0) {
      return { error: "Add at least one word that should start this journey." };
    }

    // Only a draft, exactly as saveGraph already insists for the steps.
    //
    // This had no status check at all, so a stale tab holding a versionId that
    // has since been published could rewrite a LIVE journey's triggers — and
    // switching one to ANY_MESSAGE enrols every inbound sender and fires the
    // opening template at them, with no validation, no preview and no
    // confirmation. Triggers decide who gets messaged, so they belong behind
    // the same publish workflow as the steps they start.
    const version = await prisma.journeyVersion.findUnique({
      where: { id: versionId },
      select: { status: true, journeyId: true },
    });

    if (!version) return { error: "That journey no longer exists." };

    if (version.status !== "DRAFT") {
      return {
        error:
          "This version is live and cannot be changed. Make a new version to edit it.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.journeyTrigger.deleteMany({ where: { versionId } });

      if (mode === "keyword") {
        await tx.journeyTrigger.create({
          data: {
            versionId,
            type: "KEYWORD",
            config: {
              keywords,
              matchType:
                formData.get("matchType") === "exact" ? "exact" : "contains",
            },
          },
        });
      } else if (mode === "any") {
        await tx.journeyTrigger.create({
          data: { versionId, type: "ANY_MESSAGE", config: {} },
        });
      }
      // "manual" leaves none, so it starts only when someone sends it.
    });

    await audit(user, "journey.triggers", {
      entityType: "Journey",
      // The journey, not the version: entityType said "Journey" while the id
      // was a version's, so the row pointed at nothing that could be looked
      // up. The version is kept alongside, since it is what was edited.
      entityId: version.journeyId,
      metadata: { mode, keywords, versionId },
    });

    revalidatePath("/journeys");

    return {
      success:
        mode === "keyword"
          ? `Saved. Messaging any of: ${keywords.join(", ")} will start this journey.`
          : mode === "any"
            ? "Saved. Any incoming message from someone not already in a journey will start this one."
            : "Saved. This journey starts only when you send it.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change journeys." };
    }
    return { error: "Could not save what starts this journey." };
  }
}

/**
 * Turns a journey on or off.
 *
 * Not the same as unpublishing. Switching off stops NEW people entering while
 * leaving everyone already partway through to finish the conversation they
 * started — which is what someone means when they want a journey to stop.
 */
export async function toggleJourneyAction(
  _prev: JourneyState,
  formData: FormData,
): Promise<JourneyState> {
  try {
    const user = await requireApiAuth("journey:manage");

    const journeyId = String(formData.get("journeyId") ?? "");
    const isActive = formData.get("isActive") === "on";

    const journey = await prisma.journey.update({
      where: { id: journeyId },
      data: { isActive },
      select: { name: true },
    });

    await audit(user, isActive ? "journey.enable" : "journey.disable", {
      entityType: "Journey",
      entityId: journeyId,
      metadata: { name: journey.name },
    });

    revalidatePath("/journeys");

    const waiting = await prisma.journeySession.count({
      where: {
        journeyId,
        status: { in: ["ACTIVE", "WAITING_FOR_REPLY", "WAITING_UNTIL"] },
      },
    });

    return {
      success: isActive
        ? `"${journey.name}" is on. New customers can enter it again.`
        : `"${journey.name}" is off. Nobody new will enter it` +
          (waiting > 0
            ? `, and the ${waiting} already partway through will finish normally.`
            : "."),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change journeys." };
    }
    return { error: "Could not change that journey." };
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

    // Only a session still in flight is in the way, and it is CANCELLED rather
    // than deleted.
    //
    // This used to find any session at all and hard-delete it. Both
    // JourneyStepRun and JourneyEvent cascade from the session, so testing
    // against a number that belonged to a real customer erased the record of
    // which options that person had chosen — the answers the journey exists to
    // collect — along with the analytics built from them. The field is
    // free-text with no restriction to a test contact, so a mistyped digit was
    // all it took.
    //
    // Cancelling is enough now that the unique index only covers in-flight
    // sessions: a CANCELLED one no longer blocks re-entry, and their history
    // survives.
    const live = await prisma.journeySession.findFirst({
      where: {
        journeyId,
        contactId: contact.id,
        status: { in: ["ACTIVE", "WAITING_FOR_REPLY", "WAITING_UNTIL", "HANDED_OFF"] },
      },
      select: { id: true },
    });

    if (live) {
      await prisma.journeySession.update({
        where: { id: live.id },
        data: {
          status: "CANCELLED",
          endedReason: `Cancelled to re-test by ${user.name}`,
          completedAt: new Date(),
          currentStepId: null,
        },
      });
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
