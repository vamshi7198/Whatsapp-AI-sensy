import { Prisma } from "@prisma/client";
import type {
  JourneySession,
  JourneySessionStatus,
  JourneyStep,
} from "@prisma/client";

import { sanitiseVariableValue } from "../campaigns/audience";
import { prisma } from "../db";
import { getServiceWindow } from "../inbox/service";
import { maskPhone, moduleLogger } from "../logger";
import { getProvider } from "../whatsapp";
import { fit } from "../whatsapp/fit";
import { INTERACTIVE_LIMITS, TEXT_LIMITS } from "../whatsapp/types";
import { readContactField, writeContactField } from "./contact-fields";
import { checkOutboundUrl, renderUrl } from "./outbound-url";
import {
  optionsForStep,
  readAskQuestion,
  readCondition,
  readHandoff,
  readSendMedia,
  readSendMessage,
  readSendTemplate,
  readTag,
  readUpdateContact,
  readWait,
  readWebhook,
} from "./config";
import { render } from "./variables";
import { stepWaitsForReply } from "./types";

const log = moduleLogger("journeys");

/**
 * The journey engine: walking one customer through a branching conversation.
 *
 * Everything here runs unattended against real customers, so it is built to
 * stop rather than guess:
 *
 *  - A tap is acted on exactly once. Meta retries webhooks, and the second
 *    copy must not send the reply again.
 *  - A step that cannot be delivered ends the session with a reason, rather
 *    than leaving somebody waiting on a message that never comes.
 *  - The 24-hour window is checked before every free-form send, because an
 *    engine with no human watching will otherwise pile up failures.
 *  - A run is bounded, so a journey drawn as a circle cannot spin forever.
 */

/**
 * How many steps one run may execute before stopping.
 *
 * Validation refuses an obvious loop at publish time, but a loop can also be
 * created by a condition that never changes. This is the backstop that keeps
 * such a journey from sending a customer a hundred messages.
 */
const MAX_STEPS_PER_RUN = 25;

/**
 * The statuses that mean a session is still going, and so block a new one.
 *
 * Must stay identical to the predicate on the partial unique index in
 * migrations/20260815124500_journey_reentry. If the two drift, the database
 * and the application disagree about whether a contact may re-enter, and the
 * symptom is a P2002 surfacing as an unexplained failure.
 *
 * HANDED_OFF belongs here: a human has taken that conversation over, and
 * starting the automation again would have the bot talking across them.
 */
/**
 * A step failed for a reason that may not still be true in a few minutes.
 *
 * Thrown instead of a plain Error when Meta's own classification says the
 * failure is retryable — a 5xx, a dropped connection, a rate limit. Every
 * throw used to end the session FAILED regardless, so a one-minute Meta
 * outage abandoned people mid-conversation and, before the partial index
 * landed, barred them from that journey for good. The message shown even
 * said "This will retry automatically", which on that path was untrue.
 */
class RetryableStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableStepError";
  }
}

/**
 * Turns a refused send into the right kind of error.
 *
 * Meta's own classification decides: a 5xx, a dropped connection or a rate
 * limit becomes something the session can wait out, anything else ends it.
 * Note this is only reached for `accepted === false` — an "unknown" outcome
 * never comes here, because a send that may have gone out must never be
 * repeated.
 */
function sendFailure(error: { userMessage: string; retryable: boolean }): Error {
  return error.retryable
    ? new RetryableStepError(error.userMessage)
    : new Error(error.userMessage);
}

/**
 * Writes session state, but only while the session is still where this run
 * left it.
 *
 * runFrom read the session, checked it was ACTIVE, then wrote unconditionally.
 * A reply arriving in between could end the session — setting currentStepId to
 * null — and this loop would then write WAITING_FOR_REPLY straight over it,
 * leaving a session that is neither running nor finished: advanceSession
 * answers "no_current_step", resumeDueSessions never sees it, and the trigger
 * code reads it as "already partway through", which locks that contact out of
 * EVERY keyword-triggered journey, permanently.
 *
 * That is reachable today because option ids are `option_N` per step, so they
 * collide across steps and a stale tap on an older message drives the second
 * advance.
 *
 * Returns false when someone else moved first, which means: stop, do not write
 * anything else, and leave the newer state alone.
 */
async function writeIfUnchanged(
  sessionId: string,
  stepId: string,
  // Unchecked, so currentStepId can be set directly. It is a relation FK, and
  // Prisma keeps those out of the checked update-many input.
  data: Prisma.JourneySessionUncheckedUpdateManyInput,
): Promise<boolean> {
  const result = await prisma.journeySession.updateMany({
    where: { id: sessionId, status: "ACTIVE", currentStepId: stepId },
    data,
  });

  if (result.count === 0) {
    log.info(
      { sessionId, stepId },
      "Session moved on while this step was running — leaving the newer state alone",
    );
  }

  return result.count === 1;
}

/** How many times one step may fail retryably before the session gives up. */
const MAX_STEP_ATTEMPTS = 4;

/** Waits between those attempts: 2, 8, 32 minutes. */
function stepBackoffMs(attempt: number): number {
  return Math.min(2 * 60_000 * 4 ** (attempt - 1), 60 * 60_000);
}

const IN_FLIGHT: JourneySessionStatus[] = [
  "ACTIVE",
  "WAITING_FOR_REPLY",
  "WAITING_UNTIL",
  "HANDED_OFF",
];

export interface AdvanceResult {
  moved: boolean;
  reason?: string;
}

type SessionWithStep = JourneySession & { currentStep: JourneyStep | null };

/* -------------------------------------------------------------------------- */
/* Starting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Puts a contact into a journey and runs it until it needs them.
 *
 * Refuses rather than restarts if they are already in this journey: two
 * conversations from the same journey would talk over each other.
 */
export async function startJourney(input: {
  journeyId: string;
  contactId: string;
  /** Recorded so the operator can see what put them here. */
  trigger?: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const journey = await prisma.journey.findUnique({
    where: { id: input.journeyId },
    select: { liveVersionId: true, name: true, archivedAt: true, isActive: true },
  });

  if (!journey || journey.archivedAt) {
    return { ok: false, error: "That journey no longer exists." };
  }

  // Switched off. Existing conversations carry on — this only stops new
  // people entering, which is what an off switch should mean.
  if (!journey.isActive) {
    return {
      ok: false,
      error: "This journey is switched off, so nobody new can enter it.",
    };
  }

  if (!journey.liveVersionId) {
    return {
      ok: false,
      error: "That journey has not been published yet, so nobody can enter it.",
    };
  }

  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { deletedAt: true, marketingOptOut: true },
  });

  if (!contact || contact.deletedAt) {
    return { ok: false, error: "That contact no longer exists." };
  }

  const start = await prisma.journeyStep.findFirst({
    where: { versionId: journey.liveVersionId, type: "START" },
    select: { id: true },
  });

  if (!start) {
    return { ok: false, error: "That journey has no starting point." };
  }

  let sessionId: string;

  try {
    const session = await prisma.journeySession.create({
      data: {
        journeyId: input.journeyId,
        // Pinned now. Publishing a new version later leaves this customer on
        // the conversation they actually started.
        versionId: journey.liveVersionId,
        contactId: input.contactId,
        currentStepId: start.id,
        status: "ACTIVE",
        context: (input.trigger ? { _trigger: input.trigger } : {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    sessionId = session.id;
  } catch (error) {
    // Narrowed to the duplicate-key case. A bare catch reported a database
    // outage, a validation fault and a genuine duplicate identically, so the
    // one message an operator saw for any failure was a confident claim about
    // the contact that was usually untrue.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false,
        error: "This contact is already partway through this journey.",
      };
    }

    log.error(
      { journeyId: input.journeyId, err: error instanceof Error ? error.message : error },
      "Could not start journey session",
    );

    return {
      ok: false,
      error: "Could not start this journey. Please try again.",
    };
  }

  await runFrom(sessionId);
  return { ok: true, sessionId };
}

export interface AudienceStartResult {
  ok: boolean;
  error?: string;
  started: number;
  skipped: number;
  alreadyIn: number;
}

/**
 * Puts a whole audience into a journey.
 *
 * The bulk equivalent of startJourney, and it follows the same rules
 * campaigns do: marketing needs opt-in, an opt-out is honoured, and a
 * deleted contact is left alone.
 *
 * Sent one at a time rather than in parallel. WhatsApp throttles, and the
 * campaign sender already learned that lesson — going slowly is cheaper than
 * being rate-limited halfway through.
 */
export async function startJourneyForContacts(input: {
  journeyId: string;
  contactIds: string[];
  trigger?: string;
}): Promise<AudienceStartResult> {
  const result: AudienceStartResult = {
    ok: true,
    started: 0,
    skipped: 0,
    alreadyIn: 0,
  };

  const journey = await prisma.journey.findUnique({
    where: { id: input.journeyId },
    select: { liveVersionId: true },
  });

  if (!journey?.liveVersionId) {
    return {
      ...result,
      ok: false,
      error: "Publish this journey before sending it to anyone.",
    };
  }

  // The first step decides who can be reached at all. A free-form message
  // only reaches somebody who wrote in the last 24 hours, which is almost
  // nobody on a list — so this is refused up front rather than failing
  // silently for every recipient.
  const first = await firstSendingStep(journey.liveVersionId);

  if (first && first.type !== "SEND_TEMPLATE") {
    return {
      ...result,
      ok: false,
      error:
        "The first step must be a template. WhatsApp only allows a plain message within 24 hours of someone writing to you, so a journey that opens with one cannot reach a list.",
    };
  }

  for (const contactId of input.contactIds) {
    // Only an in-flight session blocks a new one. Without the status filter
    // this counted anyone who had ever been through the journey as alreadyIn
    // and skipped them before startJourney was reached, so the partial unique
    // index alone would not have fixed re-entry — this read gets there first.
    const existing = await prisma.journeySession.findFirst({
      where: { journeyId: input.journeyId, contactId, status: { in: IN_FLIGHT } },
      select: { id: true },
    });

    if (existing) {
      result.alreadyIn += 1;
      continue;
    }

    const started = await startJourney({
      journeyId: input.journeyId,
      contactId,
      trigger: input.trigger,
    });

    if (started.ok) result.started += 1;
    else result.skipped += 1;
  }

  log.info(
    { journeyId: input.journeyId, ...result },
    "Journey started for an audience",
  );

  return result;
}

/** The first step that actually sends something, following the arrows. */
async function firstSendingStep(
  versionId: string,
): Promise<{ id: string; type: string } | null> {
  const start = await prisma.journeyStep.findFirst({
    where: { versionId, type: "START" },
    select: { id: true },
  });

  if (!start) return null;

  let currentId: string | null = start.id;
  const seen = new Set<string>();

  // Bounded by seen: a journey drawn as a circle must not hang this.
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);

    const next: { toStepId: string } | null = await prisma.journeyLink.findFirst({
      where: { fromStepId: currentId, optionId: null },
      select: { toStepId: true },
    });

    if (!next) return null;

    const step: { id: string; type: string } | null =
      await prisma.journeyStep.findUnique({
        where: { id: next.toStepId },
        select: { id: true, type: true },
      });

    if (!step) return null;

    if (
      step.type === "SEND_TEMPLATE" ||
      step.type === "SEND_MESSAGE" ||
      step.type === "ASK_QUESTION" ||
      step.type === "SEND_MEDIA"
    ) {
      return step;
    }

    currentId = step.id;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Advancing on a reply                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Moves a waiting session on, given what the customer just did.
 *
 * externalId is the WhatsApp message id. It is recorded before anything else
 * happens, and the unique constraint on it is what makes a retried webhook a
 * no-op rather than a second reply to the customer.
 */
export async function advanceSession(input: {
  contactId: string;
  externalId: string;
  /** The id of the button or menu row tapped, if any. */
  optionId?: string;
  /** What they typed, for a question step or an unmatched reply. */
  text?: string;
}): Promise<AdvanceResult> {
  const session = await prisma.journeySession.findFirst({
    where: {
      contactId: input.contactId,
      status: { in: ["ACTIVE", "WAITING_FOR_REPLY"] },
    },
    include: { currentStep: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!session) return { moved: false, reason: "not_in_a_journey" };
  if (!session.currentStep) {
    return { moved: false, reason: "no_current_step" };
  }

  // Claim this message for this session. A retry loses the race and stops
  // here, which is the whole point.
  try {
    await prisma.journeyEvent.create({
      data: {
        sessionId: session.id,
        externalId: input.externalId,
        kind: input.optionId ? "option" : "text",
        // Kept for reporting. By the time anyone asks which option people
        // chose, the session has moved on and this is the only record.
        stepId: session.currentStepId,
        optionId: input.optionId,
      },
    });
  } catch {
    log.debug(
      { sessionId: session.id, externalId: input.externalId },
      "Reply already handled",
    );
    return { moved: false, reason: "already_handled" };
  }

  try {
    return await applyAdvance(session, input);
  } catch (error) {
    // The claim must not outlive the work it was guarding.
    //
    // It is written first so a retried webhook cannot reply to the customer
    // twice. But if anything after it threw, the row stayed — and the caller
    // swallows the throw and marks the webhook PROCESSED, while a redelivery
    // hits the unique key and returns "already handled". The record that
    // exists to make a retry safe was the thing preventing it, and the
    // customer's tap was lost with the session left waiting on a reply that
    // had already arrived.
    //
    // Released here so the next delivery — Meta retries for up to seven days —
    // or recoverUnprocessedEvents can try again.
    await prisma.journeyEvent
      .deleteMany({
        where: { sessionId: session.id, externalId: input.externalId },
      })
      .catch(() => undefined);

    log.error(
      {
        sessionId: session.id,
        externalId: input.externalId,
        err: error instanceof Error ? error.message : error,
      },
      "Advance failed after claiming the reply — claim released so it can be retried",
    );

    throw error;
  }
}

async function applyAdvance(
  session: SessionWithStep,
  input: {
    contactId: string;
    externalId: string;
    optionId?: string;
    text?: string;
  },
): Promise<AdvanceResult> {
  // Checked by the caller before the claim; repeated here so this function
  // stands on its own rather than on an assertion.
  const step = session.currentStep;
  if (!step) return { moved: false, reason: "no_current_step" };

  /* --- A question: keep the answer, then carry on ------------------------ */

  if (step.type === "ASK_QUESTION") {
    const config = readAskQuestion(step.config);
    const answer = input.text?.trim() ?? "";

    if (!answer) return { moved: false, reason: "empty_answer" };

    const context = {
      ...(session.context as Record<string, unknown>),
      [config.saveAs]: answer,
    };

    await prisma.journeySession.update({
      where: { id: session.id },
      data: { context: context as Prisma.InputJsonValue },
    });

    if (config.saveToContactField) {
      // Through the helper, which knows which names are real columns and puts
      // everything else in the attributes bag. Writing straight to a column
      // threw for any field that was not one of two, killing the step and
      // leaving the customer stuck.
      await writeContactField(
        session.contactId,
        config.saveToContactField,
        answer,
      ).catch((error) => {
        // Not worth ending a conversation over. The answer is already in the
        // session context and usable by later steps either way.
        log.warn(
          {
            sessionId: session.id,
            field: config.saveToContactField,
            err: error instanceof Error ? error.message : error,
          },
          "Could not save the answer to the contact — carrying on",
        );
      });
    }

    const next = await nextStepId(step.id, null);
    return finishAdvance(session, next);
  }

  /* --- An option: follow that option's arrow ----------------------------- */

  if (!input.optionId) {
    // They typed instead of tapping. Left where they are rather than guessed
    // at, so a tap a moment later still works.
    log.info(
      { sessionId: session.id, stepId: step.id },
      "Free text where an option was expected — waiting",
    );
    return { moved: false, reason: "expected_an_option" };
  }

  // Is this even one of the options they were offered here?
  //
  // A second tap is the ordinary case. The first one moves the session on, and
  // the second arrives carrying an option id belonging to the step they were
  // looking at rather than the one they are now on — so the lookup below finds
  // no arrow and the old code read that as a dead end and ended the session
  // FAILED. Tapping a button twice killed the conversation, and before the
  // partial index went in it barred that contact from the journey for good.
  //
  // Treated like the free-text case instead: leave them where they are.
  const offered = optionsForStep(step.type, step.config);

  if (!offered.some((option) => option.id === input.optionId)) {
    log.info(
      { sessionId: session.id, stepId: step.id, optionId: input.optionId },
      "Option is not one this step offered — most likely a second tap, ignoring",
    );
    return { moved: false, reason: "stale_option" };
  }

  const next = await nextStepId(step.id, input.optionId);

  if (!next) {
    // A button with nothing behind it. Validation refuses this at publish
    // time; reaching it means the journey was published before that existed.
    log.warn(
      { sessionId: session.id, stepId: step.id, optionId: input.optionId },
      "Option has no next step — ending the session",
    );

    await endSession(session.id, "FAILED", "That option had no next step.");
    return { moved: false, reason: "dead_end" };
  }

  return finishAdvance(session, next);
}

/**
 * Moves the session to the next step, but only if nothing else already has.
 *
 * The session is the unit of exclusion. Two taps dispatched by Meta as separate
 * POSTs are processed concurrently — the webhook route hands work to `after()`,
 * so they overlap inside one process — and both used to read ACTIVE, both
 * write, and both call runFrom. The customer received the same message twice
 * from the brand's number, the branch they actually chose was overwritten by
 * the other, and every send in that branch went out twice.
 *
 * The check on `status` at the top of runFrom is not enough: it is a read, and
 * two readers both see ACTIVE. This makes the transition itself the claim —
 * `updateMany` filtered on the state we read means exactly one of the two racing
 * writers matches a row, and the loser is told it moved nothing.
 *
 * An in-process lock would not do either: the scheduler is a separate process
 * and also drives this.
 */
async function finishAdvance(
  session: { id: string; currentStepId: string | null; status: JourneySessionStatus },
  nextId: string | null,
): Promise<AdvanceResult> {
  if (!nextId) {
    await endSession(session.id, "COMPLETED", "Reached the end.");
    return { moved: true, reason: "completed" };
  }

  const claimed = await prisma.journeySession.updateMany({
    where: {
      id: session.id,
      // The state this advance was decided from. If either has changed, another
      // tap got here first and already resolved this step.
      currentStepId: session.currentStepId,
      status: session.status,
    },
    data: { currentStepId: nextId, status: "ACTIVE" },
  });

  if (claimed.count === 0) {
    log.info(
      { sessionId: session.id, stepId: session.currentStepId },
      "Another reply advanced this session first — not running the step again",
    );
    return { moved: false, reason: "already_advanced" };
  }

  await runFrom(session.id);
  return { moved: true };
}

/** The step an arrow leads to, or null if there is no arrow. */
async function nextStepId(
  fromStepId: string,
  optionId: string | null,
): Promise<string | null> {
  const link = await prisma.journeyLink.findFirst({
    where: { fromStepId, optionId },
    select: { toStepId: true },
  });

  return link?.toStepId ?? null;
}

/* -------------------------------------------------------------------------- */
/* Running                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Executes steps until the journey needs the customer, waits, or ends.
 *
 * Bounded by MAX_STEPS_PER_RUN so a circular journey cannot message somebody
 * indefinitely.
 */
export async function runFrom(sessionId: string): Promise<void> {
  for (let executed = 0; executed < MAX_STEPS_PER_RUN; executed += 1) {
    const session = await prisma.journeySession.findUnique({
      where: { id: sessionId },
      include: { currentStep: true },
    });

    if (!session || !session.currentStep) return;
    if (session.status !== "ACTIVE") return;

    const step = session.currentStep;
    const options = optionsForStep(step.type, step.config);

    let outcome: StepOutcome;

    try {
      outcome = await executeStep(session, step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await recordRun(sessionId, step.id, "FAILED", message);

      if (error instanceof RetryableStepError) {
        // Counted from the runs already recorded, so no extra column is
        // needed and the count resets naturally when the session moves on.
        const attempts = await prisma.journeyStepRun.count({
          where: { sessionId, stepId: step.id, status: "FAILED" },
        });

        if (attempts < MAX_STEP_ATTEMPTS) {
          const resumeAt = new Date(Date.now() + stepBackoffMs(attempts));

          // Parked on the SAME step, flagged as a retry.
          //
          // WAITING_UNTIL is already swept by resumeDueSessions, but that
          // sweep moves PAST the current step before running on — correct for
          // a wait, and wrong here, where it would skip the send and carry on
          // as though the customer had been messaged. retryingStepId is what
          // tells the sweep to run this step again instead.
          await writeIfUnchanged(sessionId, step.id, {
            status: "WAITING_UNTIL",
            resumeAt,
            retryingStepId: step.id,
          });

          log.warn(
            { sessionId, stepId: step.id, attempts, resumeAt, err: message },
            "Journey step failed for a retryable reason — will try again",
          );
          return;
        }

        log.error(
          { sessionId, stepId: step.id, attempts },
          "Journey step still failing after every attempt — ending session",
        );
      }

      await endSession(sessionId, "FAILED", message);

      log.error(
        { sessionId, stepId: step.id, err: message },
        "Journey step failed",
      );
      return;
    }

    if (outcome.kind === "stop") {
      await endSession(sessionId, outcome.status, outcome.reason);
      return;
    }

    if (outcome.kind === "wait_for_reply") {
      await writeIfUnchanged(sessionId, step.id, {
        status: "WAITING_FOR_REPLY",
      });
      return;
    }

    if (outcome.kind === "wait_until") {
      await writeIfUnchanged(sessionId, step.id, {
        status: "WAITING_UNTIL",
        resumeAt: outcome.resumeAt,
      });
      return;
    }

    // Carry on. A step with options that reached here offers a choice, so it
    // waits; anything else follows its single arrow.
    if (stepWaitsForReply(step.type, options.length)) {
      await writeIfUnchanged(sessionId, step.id, {
        status: "WAITING_FOR_REPLY",
      });
      return;
    }

    const next = await nextStepId(step.id, outcome.optionId ?? null);

    if (!next) {
      await endSession(sessionId, "COMPLETED", "Reached the end.");
      return;
    }

    // Stops rather than looping on: if this did not win, a reply has already
    // moved the session somewhere else and continuing would run a step from a
    // conversation that no longer exists.
    if (!(await writeIfUnchanged(sessionId, step.id, { currentStepId: next }))) {
      return;
    }
  }

  // Ran out of steps. Almost certainly a loop, and stopping is kinder to the
  // customer than continuing.
  log.warn({ sessionId }, "Journey ran too long — stopping");
  await endSession(
    sessionId,
    "FAILED",
    "This journey went round in a circle and was stopped.",
  );
}

type StepOutcome =
  | { kind: "continue"; optionId?: string }
  | { kind: "wait_for_reply" }
  | { kind: "wait_until"; resumeAt: Date }
  | { kind: "stop"; status: "COMPLETED" | "FAILED" | "HANDED_OFF"; reason: string };

/* -------------------------------------------------------------------------- */
/* One step                                                                    */
/* -------------------------------------------------------------------------- */

async function executeStep(
  session: SessionWithStep,
  step: JourneyStep,
): Promise<StepOutcome> {
  const context = session.context as Record<string, unknown>;

  switch (step.type) {
    case "START":
      return { kind: "continue" };

    case "END":
      return { kind: "stop", status: "COMPLETED", reason: "Reached the end." };

    case "HANDOFF": {
      const config = readHandoff(step.config);

      await prisma.conversation.updateMany({
        where: { contactId: session.contactId },
        data: { status: "PENDING" },
      });

      await recordRun(session.id, step.id, "COMPLETED");

      return {
        kind: "stop",
        status: "HANDED_OFF",
        reason: config.note ?? "Passed to a person.",
      };
    }

    case "ADD_TAG": {
      const { tagId } = readTag(step.config);
      if (tagId) {
        await prisma.contactTag.createMany({
          data: [{ contactId: session.contactId, tagId }],
          skipDuplicates: true,
        });
      }
      await recordRun(session.id, step.id, "COMPLETED");
      return { kind: "continue" };
    }

    case "REMOVE_TAG": {
      const { tagId } = readTag(step.config);
      if (tagId) {
        await prisma.contactTag.deleteMany({
          where: { contactId: session.contactId, tagId },
        });
      }
      await recordRun(session.id, step.id, "COMPLETED");
      return { kind: "continue" };
    }

    case "UPDATE_CONTACT": {
      const config = readUpdateContact(step.config);
      const value = render(config.value, context);

      if (value) {
        await writeContactField(session.contactId, config.field, value);
      }

      await recordRun(session.id, step.id, "COMPLETED");
      return { kind: "continue" };
    }

    case "WAIT": {
      const { minutes } = readWait(step.config);
      await recordRun(session.id, step.id, "COMPLETED");
      return {
        kind: "wait_until",
        resumeAt: new Date(Date.now() + minutes * 60_000),
      };
    }

    case "CONDITION": {
      const matched = await evaluateCondition(session, step);
      await recordRun(session.id, step.id, "COMPLETED");
      return { kind: "continue", optionId: matched ? "yes" : "no" };
    }

    case "WEBHOOK": {
      await callWebhook(session, step, context);
      await recordRun(session.id, step.id, "COMPLETED");
      return { kind: "continue" };
    }

    case "SEND_TEMPLATE":
      return sendTemplateStep(session, step, context);

    case "SEND_MESSAGE":
    case "ASK_QUESTION":
    case "SEND_MEDIA":
      return sendConversationalStep(session, step, context);

    default:
      return { kind: "continue" };
  }
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

/** The contact and whether we may message them freely right now. */
async function sendContext(contactId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      phoneE164: true,
      name: true,
      email: true,
      deletedAt: true,
      marketingOptOut: true,
      conversation: { select: { id: true, lastInboundAt: true } },
    },
  });

  if (!contact || contact.deletedAt) {
    throw new Error("The contact was removed while the journey was running.");
  }

  return {
    contact,
    window: getServiceWindow(contact.conversation?.lastInboundAt ?? null),
  };
}

async function sendTemplateStep(
  session: SessionWithStep,
  step: JourneyStep,
  context: Record<string, unknown>,
): Promise<StepOutcome> {
  const config = readSendTemplate(step.config);
  const { contact } = await sendContext(session.contactId);

  const template = await prisma.template.findUnique({
    where: { id: config.templateId },
    select: { name: true, language: true, status: true, category: true },
  });

  if (!template) {
    throw new Error("The template this step sends has been deleted.");
  }

  if (template.status !== "APPROVED") {
    throw new Error(
      "The template this step sends is no longer approved by WhatsApp.",
    );
  }

  // The same rule campaigns follow. An engine sending unattended must not be
  // the thing that messages somebody who asked to stop.
  if (template.category === "MARKETING" && contact.marketingOptOut) {
    throw new Error(
      "This person has asked not to receive marketing messages.",
    );
  }

  const provider = await getProvider();
  if (!provider) throw new Error("WhatsApp is not connected.");

  // Cleaned, not checked. Meta refuses a template parameter containing a line
  // break, a tab, or four consecutive spaces, and a journey fills these in from
  // whatever the customer typed — an address written across two lines is the
  // normal way to write one. Campaigns validate the equivalent and report it,
  // because an operator is there to fix the column; here there is nobody to
  // tell, and the alternative to tidying the value is ending the conversation.
  const variables = Object.fromEntries(
    Object.entries(config.variables ?? {}).map(([k, v]) => [
      k,
      sanitiseVariableValue(
        render(v, { ...context, name: contact.name, email: contact.email }),
      ),
    ]),
  );

  const result = await provider.sendTemplateMessage({
    to: contact.phoneE164,
    templateName: template.name,
    languageCode: template.language,
    bodyVariables: variables,
  });

  if (result.accepted === false) {
    throw sendFailure(result.error);
  }

  const wamid = result.accepted === true ? result.externalMessageId : null;
  await recordSentMessage(session, step, contact.conversation?.id, wamid, "template");

  return { kind: "continue" };
}

/**
 * Fills in a template and trims the result to what the message type allows.
 *
 * Logged whenever it bites: a shortened message is not worth ending a
 * conversation over, but it is worth someone knowing the wording no longer
 * fits once a real answer is substituted into it.
 */
function renderFitted(
  template: string,
  variables: Record<string, unknown>,
  limit: number,
  field: string,
  sessionId: string,
): string {
  const result = fit(render(template, variables), limit);

  if (result.truncated) {
    log.warn(
      { sessionId, field, limit },
      "Message was longer than WhatsApp allows once variables were filled in, so it was shortened",
    );
  }

  return result.text;
}

async function sendConversationalStep(
  session: SessionWithStep,
  step: JourneyStep,
  context: Record<string, unknown>,
): Promise<StepOutcome> {
  const { contact, window } = await sendContext(session.contactId);

  // Free-form only works inside the window. Checked here rather than left to
  // Meta, so the session ends with an explanation instead of a rejection the
  // operator has to decode.
  if (!window.open) {
    throw new Error(
      "More than 24 hours have passed since this person last messaged, so a plain message cannot be sent. Use a template step here instead.",
    );
  }

  const provider = await getProvider();
  if (!provider) throw new Error("WhatsApp is not connected.");

  const variables = { ...context, name: contact.name, email: contact.email };

  if (step.type === "SEND_MEDIA") {
    const config = readSendMedia(step.config);

    const result = await provider.sendMediaMessage({
      to: contact.phoneE164,
      type: config.type,
      link: render(config.link, variables),
      ...(config.caption
        ? {
            caption: renderFitted(
              config.caption,
              variables,
              INTERACTIVE_LIMITS.MAX_BODY,
              "caption",
              session.id,
            ),
          }
        : {}),
      ...(config.filename ? { filename: config.filename } : {}),
    });

    if (result.accepted === false) throw sendFailure(result.error);

    const wamid = result.accepted === true ? result.externalMessageId : null;
    await recordSentMessage(session, step, contact.conversation?.id, wamid, config.type);

    return { kind: "continue" };
  }

  if (step.type === "ASK_QUESTION") {
    const config = readAskQuestion(step.config);
    const body = renderFitted(
      config.body,
      variables,
      TEXT_LIMITS.MAX_BODY,
      "body",
      session.id,
    );

    const result = await provider.sendTextMessage({
      to: contact.phoneE164,
      body,
    });

    if (result.accepted === false) throw sendFailure(result.error);

    const wamid = result.accepted === true ? result.externalMessageId : null;
    await recordSentMessage(session, step, contact.conversation?.id, wamid, "text", body);

    return { kind: "wait_for_reply" };
  }

  const config = readSendMessage(step.config);
  const options = config.options ?? [];

  // The ceiling depends on what this step turns into: a bare statement goes as
  // text and gets 4096 characters, whereas offering even one option makes it an
  // interactive message and drops the allowance to 1024.
  const body = renderFitted(
    config.body,
    variables,
    options.length === 0 ? TEXT_LIMITS.MAX_BODY : INTERACTIVE_LIMITS.MAX_BODY,
    "body",
    session.id,
  );

  // No choice offered: a statement, so the journey carries on.
  if (options.length === 0) {
    const result = await provider.sendTextMessage({ to: contact.phoneE164, body });
    if (result.accepted === false) throw sendFailure(result.error);

    const wamid = result.accepted === true ? result.externalMessageId : null;
    await recordSentMessage(session, step, contact.conversation?.id, wamid, "text", body);

    return { kind: "continue" };
  }

  // Buttons while they fit; a menu beyond that. Meta caps buttons at three,
  // and the builder warns at the point of adding a fourth — this is what
  // actually happens when it does.
  const result =
    options.length <= INTERACTIVE_LIMITS.MAX_BUTTONS
      ? await provider.sendButtonsMessage({
          to: contact.phoneE164,
          body,
          buttons: options.map((o) => ({ id: o.id, label: o.label })),
          ...(config.header
            ? {
                header: renderFitted(
                  config.header,
                  variables,
                  INTERACTIVE_LIMITS.MAX_HEADER,
                  "header",
                  session.id,
                ),
              }
            : {}),
          ...(config.footer
            ? { footer: fit(config.footer, INTERACTIVE_LIMITS.MAX_FOOTER).text }
            : {}),
        })
      : await provider.sendListMessage({
          to: contact.phoneE164,
          body,
          buttonLabel: config.menuLabel ?? "Choose an option",
          rows: options.map((o) => ({
            id: o.id,
            label: o.label,
            ...(o.description ? { description: o.description } : {}),
          })),
          ...(config.header
            ? {
                header: renderFitted(
                  config.header,
                  variables,
                  INTERACTIVE_LIMITS.MAX_HEADER,
                  "header",
                  session.id,
                ),
              }
            : {}),
          ...(config.footer
            ? { footer: fit(config.footer, INTERACTIVE_LIMITS.MAX_FOOTER).text }
            : {}),
        });

  if (result.accepted === false) throw sendFailure(result.error);

  const wamid = result.accepted === true ? result.externalMessageId : null;
  await recordSentMessage(session, step, contact.conversation?.id, wamid, "interactive", body);

  return { kind: "wait_for_reply" };
}

/* -------------------------------------------------------------------------- */
/* Conditions and webhooks                                                     */
/* -------------------------------------------------------------------------- */

async function evaluateCondition(
  session: SessionWithStep,
  step: JourneyStep,
): Promise<boolean> {
  const config = readCondition(step.config);
  const context = session.context as Record<string, unknown>;

  let actual: string | null = null;

  if (config.subject === "tag") {
    const has = await prisma.contactTag.count({
      where: { contactId: session.contactId, tagId: config.key },
    });
    actual = has > 0 ? "yes" : null;
  } else if (config.subject === "answer") {
    const value = context[config.key];
    actual = value === undefined || value === null ? null : String(value);
  } else {
    // Reads columns and attributes alike, so a condition on a field an
    // earlier step saved works. Selecting only name and email made every
    // other field read as absent, which quietly sent everyone down the
    // "no" branch rather than failing visibly.
    actual = await readContactField(session.contactId, config.key);
  }

  switch (config.operator) {
    case "exists":
      return actual !== null && actual !== "";
    case "not_exists":
      return actual === null || actual === "";
    case "is":
      return actual?.toLowerCase() === (config.value ?? "").toLowerCase();
    case "is_not":
      return actual?.toLowerCase() !== (config.value ?? "").toLowerCase();
    case "contains":
      return (actual ?? "")
        .toLowerCase()
        .includes((config.value ?? "").toLowerCase());
    default:
      return false;
  }
}

async function callWebhook(
  session: SessionWithStep,
  step: JourneyStep,
  context: Record<string, unknown>,
): Promise<void> {
  const config = readWebhook(step.config);
  if (!config.url) return;

  // Checked here, at the moment of the request — not only when the journey was
  // published. The address is built by filling in a customer's answers, so the
  // URL about to be fetched is not the URL that was validated.
  const target = checkOutboundUrl(renderUrl(config.url, { ...context }));

  if (!target.ok) {
    log.warn(
      { stepId: step.id, reason: target.reason },
      "Refused to call a web address from a journey",
    );
    return;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: session.contactId },
    select: { phoneE164: true, name: true, email: true },
  });

  const variables = { ...context, ...contact };

  const body = Object.fromEntries(
    Object.entries(config.body ?? {}).map(([k, v]) => [k, render(v, variables)]),
  );

  // Bounded, and failures do not end the journey: an external system being
  // slow or down should not strand a customer mid-conversation.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    await fetch(target.url as URL, {
      method: config.method,
      headers: { "Content-Type": "application/json" },
      ...(config.method === "POST" ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      // A redirect is a second address nobody validated, and following one is
      // how a blocked host gets reached anyway.
      redirect: "manual",
    });
  } catch (error) {
    log.warn(
      { stepId: step.id, err: error instanceof Error ? error.message : error },
      "Journey webhook call failed — continuing anyway",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/* Bookkeeping                                                                 */
/* -------------------------------------------------------------------------- */

async function recordSentMessage(
  session: SessionWithStep,
  step: JourneyStep,
  conversationId: string | undefined,
  wamid: string | null,
  type: string,
  body?: string,
): Promise<void> {
  const now = new Date();

  await prisma.message.create({
    data: {
      wamid,
      direction: "OUTBOUND",
      contactId: session.contactId,
      conversationId,
      type,
      body,
      payload: { journeySessionId: session.id, stepId: step.id } as Prisma.InputJsonValue,
      status: "SENT",
      sentAt: now,
      // A null wamid means Meta never confirmed this one — a reset connection,
      // or a 200 we could not read. The campaign sender and the inbox both say
      // so in exactly these words; a journey used to record it as a clean SENT,
      // so nothing distinguished a delivered message from one that may never
      // have gone out, and the session then waited for a reply to it.
      ...(wamid
        ? {}
        : {
            errorUserMessage:
              "WhatsApp did not confirm this message. It may or may not have been delivered.",
          }),
    },
  });

  if (conversationId) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now, lastOutboundAt: now },
    });
  }

  await recordRun(session.id, step.id, "COMPLETED", undefined, wamid);

  log.info(
    { sessionId: session.id, stepId: step.id, to: maskPhone("") },
    "Journey step sent",
  );
}

async function recordRun(
  sessionId: string,
  stepId: string,
  status: string,
  error?: string,
  wamid?: string | null,
): Promise<void> {
  await prisma.journeyStepRun.create({
    data: { sessionId, stepId, status, error, wamid: wamid ?? undefined },
  });
}

async function endSession(
  sessionId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "HANDED_OFF",
  reason: string,
): Promise<void> {
  await prisma.journeySession.update({
    where: { id: sessionId },
    data: {
      status,
      endedReason: reason,
      completedAt: new Date(),
      currentStepId: null,
    },
  });

  log.info({ sessionId, status, reason }, "Journey session ended");
}

/**
 * Resumes sessions whose wait has elapsed.
 *
 * Called by the same scheduled task that starts scheduled campaigns, because
 * nothing else on this machine is awake to fire a timer.
 */
export async function resumeDueSessions(): Promise<number> {
  const due = await prisma.journeySession.findMany({
    where: { status: "WAITING_UNTIL", resumeAt: { lte: new Date() } },
    select: { id: true, currentStepId: true, retryingStepId: true },
    take: 100,
  });

  let resumed = 0;

  for (const session of due) {
    // A step waiting to be tried again stays where it is; only a genuine WAIT
    // step is stepped past. Getting this backwards would skip a failed send
    // and carry on as though the customer had received it.
    const retrying =
      session.retryingStepId !== null &&
      session.retryingStepId === session.currentStepId;

    let next = session.currentStepId;

    if (!retrying) {
      next = session.currentStepId
        ? await nextStepId(session.currentStepId, null)
        : null;

      if (!next) {
        await endSession(session.id, "COMPLETED", "Reached the end.");
        continue;
      }
    }

    // Claimed, not just checked.
    //
    // Two scheduler passes can overlap — repair.ps1 unregisters the running
    // task and immediately registers one that fires at once, and repair.ps1 is
    // what the owner is told to run when things look wrong. Without a claim
    // both passes flipped the session to ACTIVE, both cleared the guard, and
    // both sent. Filtering on WAITING_UNTIL means exactly one wins.
    const claimed = await prisma.journeySession.updateMany({
      where: { id: session.id, status: "WAITING_UNTIL" },
      data: {
        currentStepId: next,
        status: "ACTIVE",
        resumeAt: null,
        retryingStepId: null,
      },
    });

    if (claimed.count === 0) continue;

    await runFrom(session.id);
    resumed += 1;
  }

  return resumed;
}
