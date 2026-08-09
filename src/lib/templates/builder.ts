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

export interface TemplateDraft {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  headerText?: string;
  bodyText: string;
  footerText?: string;
  /** Example value per positional variable, keyed by index: { "1": "Vamshi" } */
  examples: Record<string, string>;
}

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
