import type { JourneyStepType } from "@prisma/client";

/**
 * What each kind of step is configured with.
 *
 * Stored as JSON on JourneyStep.config rather than as columns, because a
 * message step and a wait step have nothing in common and twenty mostly-null
 * columns would describe neither well. Every read goes through a guard in
 * config.ts — nothing here is trusted just because it is in the database.
 */

/** A tappable option. The id is what a link branches on, never the label. */
export interface StepOption {
  id: string;
  label: string;
  /** Shown under the label in a menu. Ignored for buttons. */
  description?: string;
}

/** Send an approved template. Works whether or not the window is open. */
export interface SendTemplateConfig {
  templateId: string;
  /** Values for the template's blanks, by position: {"1": "..."}. */
  variables?: Record<string, string>;
  /**
   * Options only for a template whose approved buttons are quick replies.
   * Meta sends no id for those, so the id here must equal the button text.
   */
  options?: StepOption[];
}

/**
 * Send a plain message, optionally with options.
 *
 * Free, but only deliverable within 24 hours of the customer's last message.
 * Options become buttons up to three, and a menu beyond that.
 */
export interface SendMessageConfig {
  body: string;
  options?: StepOption[];
  /** The button that opens the menu, when options overflow into a list. */
  menuLabel?: string;
  header?: string;
  footer?: string;
}

/** Ask for something and keep the answer. */
export interface AskQuestionConfig {
  body: string;
  /** Where the answer is stored, e.g. "flavour". Available later as a variable. */
  saveAs: string;
  /**
   * Also save it onto the contact, under this name.
   *
   * Any name. Known columns go to columns and everything else to the
   * attributes bag — restricting it to a fixed list meant the engine wrote to
   * a column that did not exist and stranded the customer at that step.
   */
  saveToContactField?: string;
}

export interface SendMediaConfig {
  type: "image" | "document" | "video";
  link: string;
  caption?: string;
  filename?: string;
}

export interface TagConfig {
  tagId: string;
}

export interface UpdateContactConfig {
  /**
   * Which detail to set, and the value, which may contain variables.
   *
   * Any name, for the same reason as AskQuestionConfig: a fixed list meant
   * choosing "address" wrote to a column that does not exist.
   */
  field: string;
  value: string;
}

/** Branch on something already known, without asking. */
export interface ConditionConfig {
  subject: "tag" | "answer" | "contact_field";
  /** Tag id, answer key, or contact field name. */
  key: string;
  operator: "is" | "is_not" | "contains" | "exists" | "not_exists";
  value?: string;
}

/** Pause, then carry on. */
export interface WaitConfig {
  minutes: number;
}

export interface WebhookConfig {
  url: string;
  method: "POST" | "GET";
  /** Sent as JSON. Values may contain variables. */
  body?: Record<string, string>;
}

export interface HandoffConfig {
  /** Shown to the agent picking the conversation up. */
  note?: string;
}

export type StepConfig =
  | SendTemplateConfig
  | SendMessageConfig
  | AskQuestionConfig
  | SendMediaConfig
  | TagConfig
  | UpdateContactConfig
  | ConditionConfig
  | WaitConfig
  | WebhookConfig
  | HandoffConfig
  | Record<string, never>;

/** Steps that stop and wait for the customer to do something. */
export const WAITING_STEPS: JourneyStepType[] = [
  "SEND_TEMPLATE",
  "SEND_MESSAGE",
  "ASK_QUESTION",
];

/** Steps that end the conversation. */
export const TERMINAL_STEPS: JourneyStepType[] = ["END", "HANDOFF"];

/**
 * Whether a step waits for a reply before moving on.
 *
 * A message with no options is a statement, not a question, so the journey
 * carries straight on to whatever follows it. Only a message that offers a
 * choice actually blocks.
 */
export function stepWaitsForReply(
  type: JourneyStepType,
  optionCount: number,
): boolean {
  if (type === "ASK_QUESTION") return true;
  if (type === "SEND_TEMPLATE" || type === "SEND_MESSAGE") {
    return optionCount > 0;
  }
  return false;
}
