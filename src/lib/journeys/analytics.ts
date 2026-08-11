import { prisma } from "../db";

import { optionsForStep } from "./config";

/**
 * What actually happened in a journey.
 *
 * The question worth answering is not "how many messages went out" — the
 * campaign report already covers that — but "of the people who said no, what
 * reason did they give". That is branch-level, and it is the thing a
 * conversation can tell you that a broadcast cannot.
 */

export interface JourneyTotals {
  started: number;
  completed: number;
  waitingForReply: number;
  waitingUntil: number;
  handedOff: number;
  failed: number;
  cancelled: number;
}

export interface BranchCounts {
  stepId: string;
  stepName: string;
  /** People who reached this step and were asked something. */
  asked: number;
  options: Array<{
    optionId: string;
    label: string;
    count: number;
    /** Share of those who answered, not of those who were asked. */
    share: number;
  }>;
  /** Reached the step but never answered. */
  noAnswer: number;
}

export async function getJourneyTotals(
  journeyId: string,
): Promise<JourneyTotals> {
  const rows = await prisma.journeySession.groupBy({
    by: ["status"],
    where: { journeyId },
    _count: true,
  });

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count]));

  return {
    started: rows.reduce((sum, r) => sum + r._count, 0),
    completed: byStatus.COMPLETED ?? 0,
    waitingForReply: byStatus.WAITING_FOR_REPLY ?? 0,
    waitingUntil: byStatus.WAITING_UNTIL ?? 0,
    handedOff: byStatus.HANDED_OFF ?? 0,
    failed: byStatus.FAILED ?? 0,
    cancelled: byStatus.CANCELLED ?? 0,
  };
}

/**
 * How people answered each question.
 *
 * Counted across every version of the journey, not just the live one: the
 * operator asking "how many said no" means since the beginning, not since the
 * last time they edited the wording.
 */
export async function getBranchCounts(
  journeyId: string,
): Promise<BranchCounts[]> {
  const versions = await prisma.journeyVersion.findMany({
    where: { journeyId },
    select: { id: true },
  });

  const versionIds = versions.map((v) => v.id);
  if (versionIds.length === 0) return [];

  const steps = await prisma.journeyStep.findMany({
    where: {
      versionId: { in: versionIds },
      type: { in: ["SEND_MESSAGE", "SEND_TEMPLATE", "CONDITION"] },
    },
    select: { id: true, name: true, type: true, config: true },
  });

  const asking = steps
    .map((step) => ({ ...step, options: optionsForStep(step.type, step.config) }))
    .filter((step) => step.options.length > 0);

  if (asking.length === 0) return [];

  const [answers, reached] = await Promise.all([
    prisma.journeyEvent.groupBy({
      by: ["stepId", "optionId"],
      where: { stepId: { in: asking.map((s) => s.id) }, optionId: { not: null } },
      _count: true,
    }),
    prisma.journeyStepRun.groupBy({
      by: ["stepId"],
      where: { stepId: { in: asking.map((s) => s.id) }, status: "COMPLETED" },
      _count: true,
    }),
  ]);

  const reachedByStep = new Map(reached.map((r) => [r.stepId, r._count]));

  return asking.map((step) => {
    const forStep = answers.filter((a) => a.stepId === step.id);
    const answered = forStep.reduce((sum, a) => sum + a._count, 0);
    const asked = reachedByStep.get(step.id) ?? answered;

    const options = step.options.map((option) => {
      const count =
        forStep.find((a) => a.optionId === option.id)?._count ?? 0;

      return {
        optionId: option.id,
        label: option.label,
        count,
        // Of those who answered. A share of everyone asked would make every
        // option look weak whenever many people simply never replied, which
        // is a different question and gets its own number.
        share: answered > 0 ? count / answered : 0,
      };
    });

    return {
      stepId: step.id,
      stepName: step.name,
      asked,
      options: options.sort((a, b) => b.count - a.count),
      noAnswer: Math.max(asked - answered, 0),
    };
  });
}

/** People currently partway through, for the operator to see and act on. */
export async function getActiveSessions(journeyId: string, limit = 50) {
  return prisma.journeySession.findMany({
    where: {
      journeyId,
      status: { in: ["ACTIVE", "WAITING_FOR_REPLY", "WAITING_UNTIL", "HANDED_OFF"] },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      updatedAt: true,
      resumeAt: true,
      contact: { select: { id: true, name: true, phoneE164: true } },
      currentStep: { select: { name: true } },
    },
  });
}
