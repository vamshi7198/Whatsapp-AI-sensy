/**
 * The step palette, in the operator's language.
 *
 * Labels here are what the person building a journey reads, so they describe
 * what happens to the customer rather than what the code does. "Ask a
 * question" rather than ASK_QUESTION; "Pass to a person" rather than HANDOFF.
 */

export type StepKind =
  | "START"
  | "SEND_TEMPLATE"
  | "SEND_MESSAGE"
  | "ASK_QUESTION"
  | "CONDITION"
  | "SEND_MEDIA"
  | "ADD_TAG"
  | "REMOVE_TAG"
  | "UPDATE_CONTACT"
  | "WAIT"
  | "WEBHOOK"
  | "HANDOFF"
  | "END";

export interface StepModel {
  id: string;
  type: StepKind;
  name: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
  /** A line of the message, shown on the box so the shape reads at a glance. */
  preview?: string;
}

export interface StepMeta {
  label: string;
  icon: string;
  /** One line, shown in the settings panel. */
  hint: string;
  defaultConfig: Record<string, unknown>;
}

export const STEP_LIBRARY: Record<StepKind, StepMeta> = {
  START: {
    label: "Start",
    icon: "▶",
    hint: "Where every conversation begins.",
    defaultConfig: {},
  },

  SEND_TEMPLATE: {
    label: "Send a template",
    icon: "📋",
    hint: "An approved template. Works even if they have not messaged recently, and is charged by WhatsApp.",
    defaultConfig: { templateId: "", variables: {}, options: [] },
  },

  SEND_MESSAGE: {
    label: "Send a message",
    icon: "💬",
    hint: "A plain message, free to send, but only within 24 hours of their last message. Add options to make it a question.",
    defaultConfig: { body: "", options: [], menuLabel: "Choose an option" },
  },

  ASK_QUESTION: {
    label: "Ask a question",
    icon: "❓",
    hint: "Ask for something typed, like an address, and keep the answer.",
    defaultConfig: { body: "", saveAs: "answer" },
  },

  CONDITION: {
    label: "Check something",
    icon: "🔀",
    hint: "Split the conversation on something already known, without asking.",
    defaultConfig: { subject: "tag", key: "", operator: "exists" },
  },

  SEND_MEDIA: {
    label: "Send a file",
    icon: "📎",
    hint: "An image, PDF or video — a lab report or a brochure.",
    defaultConfig: { type: "image", link: "", caption: "" },
  },

  ADD_TAG: {
    label: "Add a tag",
    icon: "🏷",
    hint: "Mark the contact, so you can find or message this group later.",
    defaultConfig: { tagId: "" },
  },

  REMOVE_TAG: {
    label: "Remove a tag",
    icon: "🏷",
    hint: "Take a tag off the contact.",
    defaultConfig: { tagId: "" },
  },

  UPDATE_CONTACT: {
    label: "Save a detail",
    icon: "✏",
    hint: "Write something into the contact's record.",
    defaultConfig: { field: "name", value: "" },
  },

  WAIT: {
    label: "Wait",
    icon: "⏱",
    hint: "Pause before the next step. After 24 hours only a template can be sent.",
    defaultConfig: { minutes: 60 },
  },

  WEBHOOK: {
    label: "Call a website",
    icon: "🔗",
    hint: "Send the details to another system. Advanced.",
    defaultConfig: { url: "", method: "POST", body: {} },
  },

  HANDOFF: {
    label: "Pass to a person",
    icon: "🙋",
    hint: "Stop the automation and flag the conversation in the Inbox.",
    defaultConfig: { note: "" },
  },

  END: {
    label: "End",
    icon: "⏹",
    hint: "Finish the conversation.",
    defaultConfig: {},
  },
};

export interface StepOptionModel {
  id: string;
  label: string;
  description?: string;
}

/** The choices a step offers, used to draw one outgoing point per choice. */
export function optionsOf(step: StepModel): StepOptionModel[] {
  if (step.type === "CONDITION") {
    return [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ];
  }

  if (step.type !== "SEND_MESSAGE" && step.type !== "SEND_TEMPLATE") return [];

  const raw = step.config.options;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (o): o is StepOptionModel =>
        Boolean(o) &&
        typeof o === "object" &&
        typeof (o as StepOptionModel).id === "string" &&
        typeof (o as StepOptionModel).label === "string",
    )
    .filter((o) => o.id && o.label);
}

/** A stable id from a label, so branches survive a rewording. */
export function optionIdFrom(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "option"
  );
}
