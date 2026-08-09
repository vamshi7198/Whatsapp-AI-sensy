import type { TemplateComponent } from "../whatsapp/types";

/**
 * Builds the component array Meta expects when creating a template.
 *
 * The rule that catches people out: if the text contains {{1}}, Meta requires
 * an example value for it. Submit without examples and the template is
 * rejected, often with a message that does not mention examples at all.
 *
 * Verified against Meta's template creation documentation, August 2026.
 */

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

export interface TemplateDraft {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  headerText?: string;
  bodyText: string;
  footerText?: string;
  /** Example value per positional variable, keyed by index: { "1": "Vamshi" } */
  examples: Record<string, string>;
  buttons?: TemplateButton[];
}

/**
 * Meta's button limits, verified against current documentation (August 2026).
 *
 * Exceeding any of these is rejected at submission with an error that does not
 * name the limit, so they are checked here instead.
 */
export const BUTTON_LIMITS = {
  TOTAL: 10,
  QUICK_REPLY: 10,
  URL: 2,
  PHONE_NUMBER: 1,
  TEXT_LENGTH: 25,
} as const;

/** Positional placeholders in order of first appearance. */
export function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const indexes = matches.map((m) => m.replace(/[^\d]/g, ""));
  return [...new Set(indexes)].sort((a, b) => Number(a) - Number(b));
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Meta's own rules, checked before submission.
 *
 * Catching these here turns a rejection that arrives hours later into an
 * inline message while the user is still writing.
 */
export function validateTemplateDraft(draft: TemplateDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Name: lowercase letters, numbers and underscores only.
  if (!draft.name.trim()) {
    issues.push({ field: "name", message: "Give the template a name." });
  } else if (!/^[a-z0-9_]+$/.test(draft.name)) {
    issues.push({
      field: "name",
      message:
        "Use only lowercase letters, numbers and underscores — for example order_shipped.",
    });
  } else if (draft.name.length > 512) {
    issues.push({ field: "name", message: "That name is too long." });
  }

  if (!draft.bodyText.trim()) {
    issues.push({ field: "bodyText", message: "Write the message text." });
  } else if (draft.bodyText.length > 1024) {
    issues.push({
      field: "bodyText",
      message: `Message is ${draft.bodyText.length} characters. WhatsApp allows 1024.`,
    });
  }

  if (draft.headerText && draft.headerText.length > 60) {
    issues.push({
      field: "headerText",
      message: `Heading is ${draft.headerText.length} characters. WhatsApp allows 60.`,
    });
  }

  if (draft.footerText && draft.footerText.length > 60) {
    issues.push({
      field: "footerText",
      message: `Footer is ${draft.footerText.length} characters. WhatsApp allows 60.`,
    });
  }

  const variables = extractVariables(draft.bodyText);

  // Meta requires an example for every variable, and rejects the template
  // outright without them.
  for (const index of variables) {
    if (!draft.examples[index]?.trim()) {
      issues.push({
        field: `example_${index}`,
        message: `Give an example of what {{${index}}} will contain.`,
      });
    }
  }

  // Numbering must start at 1 and not skip — Meta rejects {{1}} followed by
  // {{3}}, and the error it returns does not explain why.
  const numbers = variables.map(Number);
  for (let i = 0; i < numbers.length; i += 1) {
    if (numbers[i] !== i + 1) {
      issues.push({
        field: "bodyText",
        message: `Numbering must run 1, 2, 3 with no gaps. Found {{${numbers[i]}}} where {{${i + 1}}} was expected.`,
      });
      break;
    }
  }

  issues.push(...validateButtons(draft.buttons ?? []));

  // A variable at the very start or end is rejected by Meta because it can
  // render as an empty message.
  const trimmed = draft.bodyText.trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed)) {
    issues.push({
      field: "bodyText",
      message:
        "The message cannot begin with a variable. Add some text before it, such as “Hi”.",
    });
  }
  if (/\{\{\s*\d+\s*\}\}$/.test(trimmed)) {
    issues.push({
      field: "bodyText",
      message:
        "The message cannot end with a variable. Add some text after it.",
    });
  }

  return issues;
}

/**
 * Checks Meta's button rules.
 *
 * The grouping rule is the one nobody expects: quick replies and the other
 * types must each be contiguous. Interleaving them is rejected with an
 * "invalid combination" error that does not say what was invalid.
 */
export function validateButtons(
  buttons: TemplateButton[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (buttons.length === 0) return issues;

  if (buttons.length > BUTTON_LIMITS.TOTAL) {
    issues.push({
      field: "buttons",
      message: `WhatsApp allows at most ${BUTTON_LIMITS.TOTAL} buttons. You have ${buttons.length}.`,
    });
  }

  const counts = {
    QUICK_REPLY: buttons.filter((b) => b.type === "QUICK_REPLY").length,
    URL: buttons.filter((b) => b.type === "URL").length,
    PHONE_NUMBER: buttons.filter((b) => b.type === "PHONE_NUMBER").length,
  };

  if (counts.URL > BUTTON_LIMITS.URL) {
    issues.push({
      field: "buttons",
      message: `At most ${BUTTON_LIMITS.URL} website buttons are allowed. You have ${counts.URL}.`,
    });
  }

  if (counts.PHONE_NUMBER > BUTTON_LIMITS.PHONE_NUMBER) {
    issues.push({
      field: "buttons",
      message: `Only ${BUTTON_LIMITS.PHONE_NUMBER} call button is allowed. You have ${counts.PHONE_NUMBER}.`,
    });
  }

  // Quick replies must sit together, and so must the rest. Two blocks only.
  if (counts.QUICK_REPLY > 0 && counts.QUICK_REPLY < buttons.length) {
    const groups: string[] = [];
    for (const button of buttons) {
      const group = button.type === "QUICK_REPLY" ? "quick" : "action";
      if (groups[groups.length - 1] !== group) groups.push(group);
    }

    if (groups.length > 2) {
      issues.push({
        field: "buttons",
        message:
          "Keep the quick reply buttons together and the link or call buttons together. WhatsApp does not allow them to alternate.",
      });
    }
  }

  buttons.forEach((button, i) => {
    const position = i + 1;

    if (!button.text.trim()) {
      issues.push({
        field: `button_${i}_text`,
        message: `Button ${position} needs a label.`,
      });
    } else if (button.text.length > BUTTON_LIMITS.TEXT_LENGTH) {
      issues.push({
        field: `button_${i}_text`,
        message: `Button ${position} label is ${button.text.length} characters. WhatsApp allows ${BUTTON_LIMITS.TEXT_LENGTH}.`,
      });
    }

    if (button.type === "URL") {
      if (!button.url.trim()) {
        issues.push({
          field: `button_${i}_url`,
          message: `Button ${position} needs a web address.`,
        });
      } else if (!/^https?:\/\/.+/i.test(button.url.trim())) {
        issues.push({
          field: `button_${i}_url`,
          message: `Button ${position}: the address must start with https://`,
        });
      }
    }

    if (button.type === "PHONE_NUMBER" && !button.phoneNumber.trim()) {
      issues.push({
        field: `button_${i}_phone`,
        message: `Button ${position} needs a phone number.`,
      });
    }
  });

  return issues;
}

/** Assembles the components array for Meta's create-template endpoint. */
export function buildTemplateComponents(
  draft: TemplateDraft,
): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (draft.headerText?.trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: draft.headerText.trim(),
    });
  }

  const variables = extractVariables(draft.bodyText);

  const body: TemplateComponent = {
    type: "BODY",
    text: draft.bodyText.trim(),
  };

  if (variables.length > 0) {
    // body_text is an array of arrays: one inner array per example set. One
    // set is enough, and is what Meta's own examples use.
    body.example = {
      body_text: [variables.map((index) => draft.examples[index]?.trim() ?? "")],
    };
  }

  components.push(body);

  if (draft.footerText?.trim()) {
    components.push({ type: "FOOTER", text: draft.footerText.trim() });
  }

  const buttons = draft.buttons ?? [];
  if (buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((button) => {
        if (button.type === "URL") {
          return {
            type: "URL",
            text: button.text.trim(),
            url: button.url.trim(),
          };
        }
        if (button.type === "PHONE_NUMBER") {
          return {
            type: "PHONE_NUMBER",
            text: button.text.trim(),
            phone_number: button.phoneNumber.trim(),
          };
        }
        return { type: "QUICK_REPLY", text: button.text.trim() };
      }),
    });
  }

  return components;
}

/** Suggests a valid template name from free text the user typed. */
export function suggestTemplateName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
