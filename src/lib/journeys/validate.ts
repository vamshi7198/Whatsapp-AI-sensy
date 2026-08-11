import type { JourneyLink, JourneyStep } from "@prisma/client";

import { optionsForStep } from "./config";
import { readSendMessage, readSendTemplate, readWait } from "./config";
import { INTERACTIVE_LIMITS } from "../whatsapp/types";

/**
 * Checking a journey before it can go live.
 *
 * The audience is somebody who is not a developer and who will not see the
 * consequence of a mistake until a customer does. So every problem names the
 * step it is in and says what to do, and anything that would strand a real
 * person is an error rather than a warning.
 */

export interface Problem {
  /** Which step it is in, so the canvas can point at it. */
  stepId?: string;
  stepName?: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Must be fixed before publishing. */
  errors: Problem[];
  /** Worth knowing, but not blocking. */
  warnings: Problem[];
}

export interface GraphForValidation {
  steps: Array<
    Pick<JourneyStep, "id" | "type" | "name" | "config">
  >;
  links: Array<Pick<JourneyLink, "fromStepId" | "optionId" | "toStepId">>;
  /** Approved template ids, for checking template steps can actually send. */
  approvedTemplateIds: Set<string>;
}

export function validateJourney(graph: GraphForValidation): ValidationResult {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  const { steps, links } = graph;
  const byId = new Map(steps.map((s) => [s.id, s]));

  const problem = (step: { id: string; name: string }, message: string) => ({
    stepId: step.id,
    stepName: step.name,
    message,
  });

  /* --- The shape --------------------------------------------------------- */

  const starts = steps.filter((s) => s.type === "START");

  if (starts.length === 0) {
    errors.push({ message: "This journey has no starting point." });
  } else if (starts.length > 1) {
    errors.push({
      message: "This journey has more than one starting point. Keep only one.",
    });
  }

  if (!steps.some((s) => s.type === "END" || s.type === "HANDOFF")) {
    warnings.push({
      message:
        "Nothing here ends the conversation. Add an End step so it finishes tidily.",
    });
  }

  /* --- Every option needs somewhere to go -------------------------------- */

  const linkedOptions = new Set(
    links.map((l) => `${l.fromStepId}::${l.optionId ?? ""}`),
  );

  for (const step of steps) {
    const options = optionsForStep(step.type, step.config);

    for (const option of options) {
      if (!linkedOptions.has(`${step.id}::${option.id}`)) {
        // The single most common way to strand a customer: they tap, and
        // nothing happens, forever.
        errors.push(
          problem(
            step,
            `"${option.label}" has no next step. Draw a line from it to whatever should happen.`,
          ),
        );
      }
    }

    // A step that asks nothing still needs a way onward, unless it ends.
    const ends = step.type === "END" || step.type === "HANDOFF";
    const hasPlainLink = linkedOptions.has(`${step.id}::`);

    if (!ends && options.length === 0 && !hasPlainLink) {
      errors.push(
        problem(step, "This step has no next step, so the conversation stops here."),
      );
    }
  }

  /* --- Nothing floating unreachable -------------------------------------- */

  if (starts.length === 1) {
    const reachable = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];

    while (queue.length > 0) {
      const current = queue.shift() as string;

      for (const link of links.filter((l) => l.fromStepId === current)) {
        if (!reachable.has(link.toStepId)) {
          reachable.add(link.toStepId);
          queue.push(link.toStepId);
        }
      }
    }

    for (const step of steps) {
      if (!reachable.has(step.id)) {
        errors.push(
          problem(
            step,
            "Nothing leads here, so no customer will ever see it. Connect it or remove it.",
          ),
        );
      }
    }
  }

  /* --- Each step's own settings ------------------------------------------ */

  for (const step of steps) {
    switch (step.type) {
      case "SEND_MESSAGE": {
        const config = readSendMessage(step.config);

        if (!config.body.trim()) {
          errors.push(problem(step, "This message has no words in it."));
        }

        const options = config.options ?? [];

        if (options.length > INTERACTIVE_LIMITS.MAX_LIST_ROWS) {
          errors.push(
            problem(
              step,
              `WhatsApp shows at most ${INTERACTIVE_LIMITS.MAX_LIST_ROWS} options. Remove some, or split this into two steps.`,
            ),
          );
        }

        if (options.length > INTERACTIVE_LIMITS.MAX_BUTTONS) {
          // Not a mistake, but it changes what the customer sees, and finding
          // that out from a screenshot later is worse than being told now.
          warnings.push(
            problem(
              step,
              `With more than ${INTERACTIVE_LIMITS.MAX_BUTTONS} options these appear as a menu the customer opens, not as buttons.`,
            ),
          );
        }

        for (const option of options) {
          const cap =
            options.length <= INTERACTIVE_LIMITS.MAX_BUTTONS
              ? INTERACTIVE_LIMITS.MAX_BUTTON_LABEL
              : INTERACTIVE_LIMITS.MAX_LIST_ROW_TITLE;

          if (option.label.length > cap) {
            errors.push(
              problem(
                step,
                `"${option.label}" is too long — WhatsApp allows ${cap} characters here.`,
              ),
            );
          }
        }
        break;
      }

      case "SEND_TEMPLATE": {
        const config = readSendTemplate(step.config);

        if (!config.templateId) {
          errors.push(problem(step, "No template has been chosen for this step."));
        } else if (!graph.approvedTemplateIds.has(config.templateId)) {
          errors.push(
            problem(
              step,
              "The template here is not approved by WhatsApp, so this step cannot send.",
            ),
          );
        }
        break;
      }

      case "ASK_QUESTION": {
        const config = step.config as { body?: string; saveAs?: string } | null;

        if (!config?.body?.trim()) {
          errors.push(problem(step, "This question has no words in it."));
        }
        if (!config?.saveAs?.trim()) {
          warnings.push(
            problem(step, "The answer is not being saved anywhere."),
          );
        }
        break;
      }

      case "WAIT": {
        const { minutes } = readWait(step.config);

        if (minutes >= 24 * 60) {
          // After a day the window has closed, so whatever follows must be a
          // template or it will fail at send time for everybody.
          const next = links.find(
            (l) => l.fromStepId === step.id && l.optionId === null,
          );
          const after = next ? byId.get(next.toStepId) : undefined;

          if (after && after.type === "SEND_MESSAGE") {
            errors.push(
              problem(
                step,
                `Waiting ${Math.round(minutes / 60)} hours means the free reply window has closed. "${after.name}" must be a template step, or it will fail for everyone.`,
              ),
            );
          }
        }
        break;
      }

      case "ADD_TAG":
      case "REMOVE_TAG": {
        const config = step.config as { tagId?: string } | null;
        if (!config?.tagId) {
          errors.push(problem(step, "No tag has been chosen for this step."));
        }
        break;
      }

      case "WEBHOOK": {
        const config = step.config as { url?: string } | null;

        if (!config?.url?.trim()) {
          errors.push(problem(step, "This step has no web address to call."));
        } else if (!/^https:\/\//i.test(config.url)) {
          errors.push(
            problem(step, "The web address must start with https:// ."),
          );
        }
        break;
      }

      default:
        break;
    }
  }

  /* --- Circles ----------------------------------------------------------- */

  // Only a warning: a loop can be deliberate, and the engine stops one that
  // runs away. Silently allowing it would still be wrong.
  if (hasCycle(steps, links)) {
    warnings.push({
      message:
        "This journey can go round in a circle. That is allowed, but it stops itself after 25 steps.",
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function hasCycle(
  steps: GraphForValidation["steps"],
  links: GraphForValidation["links"],
): boolean {
  const outgoing = new Map<string, string[]>();

  for (const link of links) {
    outgoing.set(link.fromStepId, [
      ...(outgoing.get(link.fromStepId) ?? []),
      link.toStepId,
    ]);
  }

  const visited = new Set<string>();
  const onPath = new Set<string>();

  function walk(id: string): boolean {
    if (onPath.has(id)) return true;
    if (visited.has(id)) return false;

    visited.add(id);
    onPath.add(id);

    for (const next of outgoing.get(id) ?? []) {
      if (walk(next)) return true;
    }

    onPath.delete(id);
    return false;
  }

  return steps.some((step) => walk(step.id));
}
