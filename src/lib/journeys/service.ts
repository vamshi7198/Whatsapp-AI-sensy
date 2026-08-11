import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { moduleLogger } from "../logger";
import { validateJourney, type ValidationResult } from "./validate";

const log = moduleLogger("journeys");

/**
 * Creating, saving and publishing journeys.
 *
 * The rule that shapes everything: a published version is never edited. An
 * edit produces a new draft version, and publishing that swaps which version
 * new customers enter. Anyone already partway through keeps the version they
 * started, so a change cannot rewrite a conversation in progress.
 */

export interface JourneyResult {
  ok: boolean;
  journeyId?: string;
  versionId?: string;
  error?: string;
  validation?: ValidationResult;
}

/** A step as the canvas sends it. Ids are the canvas's own until saved. */
export interface StepInput {
  id: string;
  type: Prisma.JourneyStepCreateManyVersionInput["type"];
  name: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
}

export interface LinkInput {
  fromStepId: string;
  optionId: string | null;
  toStepId: string;
}

export async function createJourney(input: {
  name: string;
  description?: string;
  createdById: string;
}): Promise<JourneyResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give this journey a name." };

  const journey = await prisma.journey.create({
    data: {
      name,
      description: input.description?.trim() || null,
      createdById: input.createdById,
      versions: {
        create: {
          version: 1,
          status: "DRAFT",
          createdById: input.createdById,
          // Every journey begins somewhere, and an empty canvas with no way
          // to start is a worse first impression than one box already there.
          steps: {
            create: [
              { type: "START", name: "Start", config: {}, x: 80, y: 200 },
            ],
          },
        },
      },
    },
    select: { id: true, versions: { select: { id: true } } },
  });

  log.info({ journeyId: journey.id, name }, "Journey created");

  return {
    ok: true,
    journeyId: journey.id,
    versionId: journey.versions[0]?.id,
  };
}

/**
 * Saves what the canvas is showing.
 *
 * Steps that already exist are UPDATED rather than replaced. Deleting and
 * recreating them was simpler, but it issued every step a new id on every
 * save, so a validation error could no longer be matched to the box that
 * caused it — the operator got a list of problems and no way to tell which
 * of four steps named "End" was meant.
 *
 * Returns the mapping from canvas ids to real ones, so the canvas can adopt
 * the ids of steps it has just created.
 */
export async function saveGraph(input: {
  versionId: string;
  steps: StepInput[];
  links: LinkInput[];
}): Promise<JourneyResult & { idMap?: Record<string, string> }> {
  const version = await prisma.journeyVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, status: true, journeyId: true },
  });

  if (!version) return { ok: false, error: "That journey no longer exists." };

  if (version.status !== "DRAFT") {
    return {
      ok: false,
      error:
        "This version is live and cannot be changed. Make a new version to edit it.",
    };
  }

  const idMap = new Map<string, string>();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.journeyStep.findMany({
      where: { versionId: version.id },
      select: { id: true },
    });

    const existingIds = new Set(existing.map((s) => s.id));
    const keptIds = new Set<string>();

    // Links are rebuilt wholesale. They are cheap, carry no identity of their
    // own, and reconciling them would be more error-prone than replacing.
    await tx.journeyLink.deleteMany({ where: { versionId: version.id } });

    for (const step of input.steps) {
      const isExisting = existingIds.has(step.id);

      const data = {
        type: step.type,
        name: step.name.trim() || "Untitled step",
        config: step.config as Prisma.InputJsonValue,
        x: Math.round(step.x),
        y: Math.round(step.y),
      };

      if (isExisting) {
        await tx.journeyStep.update({ where: { id: step.id }, data });
        idMap.set(step.id, step.id);
        keptIds.add(step.id);
      } else {
        const created = await tx.journeyStep.create({
          data: { versionId: version.id, ...data },
          select: { id: true },
        });

        idMap.set(step.id, created.id);
        keptIds.add(created.id);
      }
    }

    // Anything the operator removed from the canvas.
    const removed = [...existingIds].filter((id) => !keptIds.has(id));
    if (removed.length > 0) {
      await tx.journeyStep.deleteMany({ where: { id: { in: removed } } });
    }

    for (const link of input.links) {
      const from = idMap.get(link.fromStepId);
      const to = idMap.get(link.toStepId);

      // A line to a box deleted in the same edit. Dropped rather than failing
      // the save, since the canvas already shows it gone.
      if (!from || !to) continue;

      await tx.journeyLink.create({
        data: {
          versionId: version.id,
          fromStepId: from,
          optionId: link.optionId,
          toStepId: to,
        },
      });
    }
  });

  return {
    ok: true,
    versionId: version.id,
    journeyId: version.journeyId,
    idMap: Object.fromEntries(idMap),
  };
}

/** Checks a version without changing anything. */
export async function checkJourney(
  versionId: string,
): Promise<ValidationResult> {
  const [steps, links, approved] = await Promise.all([
    prisma.journeyStep.findMany({
      where: { versionId },
      select: { id: true, type: true, name: true, config: true },
    }),
    prisma.journeyLink.findMany({
      where: { versionId },
      select: { fromStepId: true, optionId: true, toStepId: true },
    }),
    prisma.template.findMany({
      where: { status: "APPROVED" },
      select: { id: true },
    }),
  ]);

  return validateJourney({
    steps,
    links,
    approvedTemplateIds: new Set(approved.map((t) => t.id)),
  });
}

/**
 * Makes a draft the version new customers enter.
 *
 * Refuses if validation finds errors: publishing a journey with a button that
 * leads nowhere means a real person taps it and never hears back.
 */
export async function publishJourney(
  versionId: string,
): Promise<JourneyResult> {
  const version = await prisma.journeyVersion.findUnique({
    where: { id: versionId },
    select: { id: true, journeyId: true, status: true },
  });

  if (!version) return { ok: false, error: "That journey no longer exists." };

  if (version.status === "PUBLISHED") {
    return { ok: false, error: "This version is already live." };
  }

  const validation = await checkJourney(versionId);

  if (!validation.ok) {
    return {
      ok: false,
      error: "Fix the problems below before publishing.",
      validation,
    };
  }

  await prisma.$transaction([
    // The previously live version is retired rather than deleted: sessions
    // still running on it need it to exist.
    prisma.journeyVersion.updateMany({
      where: { journeyId: version.journeyId, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    }),
    prisma.journeyVersion.update({
      where: { id: versionId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    }),
    prisma.journey.update({
      where: { id: version.journeyId },
      data: { liveVersionId: versionId },
    }),
  ]);

  log.info({ versionId, journeyId: version.journeyId }, "Journey published");
  return { ok: true, versionId, journeyId: version.journeyId, validation };
}

/**
 * Starts a new draft from the live version, for editing.
 *
 * Copying rather than reopening the live one is the whole point: customers
 * mid-conversation keep the version they started.
 */
export async function createDraftFrom(
  versionId: string,
  createdById: string,
): Promise<JourneyResult> {
  const source = await prisma.journeyVersion.findUnique({
    where: { id: versionId },
    include: { steps: true, links: true, triggers: true },
  });

  if (!source) return { ok: false, error: "That version no longer exists." };

  const existingDraft = await prisma.journeyVersion.findFirst({
    where: { journeyId: source.journeyId, status: "DRAFT" },
    select: { id: true },
  });

  // One draft at a time. Two would silently compete over which gets published.
  if (existingDraft) {
    return { ok: true, versionId: existingDraft.id, journeyId: source.journeyId };
  }

  const highest = await prisma.journeyVersion.findFirst({
    where: { journeyId: source.journeyId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const draft = await prisma.journeyVersion.create({
    data: {
      journeyId: source.journeyId,
      version: (highest?.version ?? 0) + 1,
      status: "DRAFT",
      createdById,
    },
    select: { id: true },
  });

  const idMap = new Map<string, string>();

  for (const step of source.steps) {
    const copy = await prisma.journeyStep.create({
      data: {
        versionId: draft.id,
        type: step.type,
        name: step.name,
        config: step.config as Prisma.InputJsonValue,
        x: step.x,
        y: step.y,
      },
      select: { id: true },
    });

    idMap.set(step.id, copy.id);
  }

  for (const link of source.links) {
    const from = idMap.get(link.fromStepId);
    const to = idMap.get(link.toStepId);
    if (!from || !to) continue;

    await prisma.journeyLink.create({
      data: {
        versionId: draft.id,
        fromStepId: from,
        optionId: link.optionId,
        toStepId: to,
      },
    });
  }

  for (const trigger of source.triggers) {
    await prisma.journeyTrigger.create({
      data: {
        versionId: draft.id,
        type: trigger.type,
        config: trigger.config as Prisma.InputJsonValue,
        isActive: trigger.isActive,
      },
    });
  }

  return { ok: true, versionId: draft.id, journeyId: source.journeyId };
}

export async function listJourneys() {
  return prisma.journey.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: { select: { name: true } },
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, status: true },
      },
      _count: { select: { sessions: true } },
    },
  });
}

/** A version's whole graph, for the canvas. */
export async function getVersionGraph(versionId: string) {
  return prisma.journeyVersion.findUnique({
    where: { id: versionId },
    include: {
      journey: { select: { id: true, name: true, description: true } },
      // Top-left first, so the order matches how the canvas reads.
      steps: { orderBy: [{ y: "asc" }, { x: "asc" }] },
      links: true,
      triggers: true,
    },
  });
}

/** The draft to edit, creating one from the live version if needed. */
export async function editableVersion(
  journeyId: string,
  userId: string,
): Promise<string | null> {
  const draft = await prisma.journeyVersion.findFirst({
    where: { journeyId, status: "DRAFT" },
    orderBy: { version: "desc" },
    select: { id: true },
  });

  if (draft) return draft.id;

  const live = await prisma.journeyVersion.findFirst({
    where: { journeyId, status: "PUBLISHED" },
    select: { id: true },
  });

  if (!live) return null;

  const result = await createDraftFrom(live.id, userId);
  return result.versionId ?? null;
}
