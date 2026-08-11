/**
 * Builds Flow JSON — the screen definition WhatsApp renders as an in-chat form.
 *
 * Deliberately not a general-purpose builder. Meta's format supports branching,
 * multiple screens and live data exchange; all of that needs a hosted endpoint,
 * RSA keys and health checks. A single-screen form needs none of it, and covers
 * what a small brand actually asks for: a feedback survey, an address, an
 * enquiry form.
 *
 * The version is not guessed. Meta rejects an unsupported one at upload, its
 * published examples are years out of date, and scripts/discover-flow-version.ts
 * establishes what this account really accepts by asking it.
 */

/** Confirmed against the live account on 11 August 2026. */
export const FLOW_JSON_VERSION = "7.3";

export type FieldType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multiple_choice"
  | "dropdown"
  | "date";

export interface FlowField {
  /** Identifier the answer comes back under. Lower-case, no spaces. */
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** For the choice types. Ignored otherwise. */
  options?: string[];
  helperText?: string;
}

export interface FlowDefinition {
  title: string;
  /** Shown above the fields. Optional. */
  heading?: string;
  fields: FlowField[];
  submitLabel: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const MAX_FIELDS = 20;
/** Meta's own cap on a screen title. */
const MAX_TITLE = 80;

/** A name safe to use as a Flow field identifier. */
export function toFieldName(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  // Meta requires an identifier, and a label of only punctuation would leave
  // nothing behind.
  return cleaned || "field";
}

/**
 * Checks a form before it goes anywhere near Meta.
 *
 * Meta validates on upload and returns line numbers into generated JSON the
 * operator never sees, so catching problems here is the difference between
 * "add options to the Size question" and an unreadable parser error.
 */
export function validateFlow(definition: FlowDefinition): ValidationResult {
  const errors: string[] = [];

  if (!definition.title.trim()) {
    errors.push("Give the form a title — the customer sees it at the top.");
  }

  if (definition.title.length > MAX_TITLE) {
    errors.push(`The title must be ${MAX_TITLE} characters or fewer.`);
  }

  if (!definition.submitLabel.trim()) {
    errors.push("Give the submit button some words.");
  }

  if (definition.fields.length === 0) {
    errors.push("Add at least one question.");
  }

  if (definition.fields.length > MAX_FIELDS) {
    errors.push(
      `A single form can hold ${MAX_FIELDS} questions. Split it into two, or remove some.`,
    );
  }

  const seen = new Set<string>();

  for (const field of definition.fields) {
    if (!field.label.trim()) {
      errors.push("Every question needs a label.");
      continue;
    }

    if (seen.has(field.name)) {
      // Two fields with the same name silently overwrite each other in the
      // response, losing an answer with nothing to show it happened.
      errors.push(
        `Two questions would be saved under the same name ("${field.name}"). Reword one of them.`,
      );
    }
    seen.add(field.name);

    const needsOptions =
      field.type === "single_choice" ||
      field.type === "multiple_choice" ||
      field.type === "dropdown";

    if (needsOptions) {
      const options = (field.options ?? []).filter((o) => o.trim());

      if (options.length < 2) {
        errors.push(`"${field.label}" needs at least two choices.`);
      }

      if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
        errors.push(`"${field.label}" has the same choice listed twice.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

interface Component {
  type: string;
  [key: string]: unknown;
}

function toComponent(field: FlowField): Component {
  const options = (field.options ?? [])
    .filter((o) => o.trim())
    .map((o) => ({ id: toFieldName(o), title: o }));

  const base = {
    name: field.name,
    label: field.label,
    required: field.required,
    ...(field.helperText ? { "helper-text": field.helperText } : {}),
  };

  switch (field.type) {
    case "long_text":
      return { type: "TextArea", ...base };

    case "single_choice":
      return { type: "RadioButtonsGroup", ...base, "data-source": options };

    case "multiple_choice":
      return { type: "CheckboxGroup", ...base, "data-source": options };

    case "dropdown":
      return { type: "Dropdown", ...base, "data-source": options };

    case "date":
      return { type: "DatePicker", ...base };

    case "short_text":
    default:
      return { type: "TextInput", ...base, "input-type": "text" };
  }
}

/**
 * Turns a form definition into the JSON Meta expects.
 *
 * The answers come back keyed by the payload built here, so those keys are the
 * contract between what is sent and what is read back.
 */
export function buildFlowJson(definition: FlowDefinition): unknown {
  const inputs = definition.fields.map(toComponent);

  // Every field is referenced explicitly. Meta returns exactly what the
  // payload names, so a field missing here is an answer silently lost.
  const payload = Object.fromEntries(
    definition.fields.map((f) => [f.name, `\${form.${f.name}}`]),
  );

  const children: Component[] = [
    ...(definition.heading
      ? [{ type: "TextHeading", text: definition.heading }]
      : []),
    {
      type: "Form",
      name: "form",
      children: [
        ...inputs,
        {
          type: "Footer",
          label: definition.submitLabel,
          "on-click-action": { name: "complete", payload },
        },
      ],
    },
  ];

  return {
    version: FLOW_JSON_VERSION,
    screens: [
      {
        id: "FORM",
        title: definition.title,
        // Single screen, so it is also the last one. Without terminal:true
        // Meta rejects the flow as having no way to finish.
        terminal: true,
        layout: { type: "SingleColumnLayout", children },
      },
    ],
  };
}

/** Ready-made starting points, so nobody begins from an empty screen. */
export const FLOW_TEMPLATES: Record<
  string,
  { label: string; category: string; definition: FlowDefinition }
> = {
  feedback: {
    label: "Feedback survey",
    category: "SURVEY",
    definition: {
      title: "How did we do?",
      heading: "Thanks for choosing Uncanned — two quick questions.",
      submitLabel: "Send feedback",
      fields: [
        {
          name: "rating",
          label: "How would you rate your order?",
          type: "single_choice",
          required: true,
          options: ["Loved it", "It was fine", "Not great"],
        },
        {
          name: "comments",
          label: "Anything you would like to tell us?",
          type: "long_text",
          required: false,
        },
      ],
    },
  },

  address: {
    label: "Delivery address",
    category: "OTHER",
    definition: {
      title: "Where should we deliver?",
      submitLabel: "Save address",
      fields: [
        { name: "full_name", label: "Full name", type: "short_text", required: true },
        { name: "address", label: "Address", type: "long_text", required: true },
        { name: "city", label: "City", type: "short_text", required: true },
        { name: "pincode", label: "PIN code", type: "short_text", required: true },
      ],
    },
  },

  enquiry: {
    label: "Enquiry form",
    category: "CONTACT_US",
    definition: {
      title: "How can we help?",
      submitLabel: "Send",
      fields: [
        { name: "full_name", label: "Your name", type: "short_text", required: true },
        {
          name: "topic",
          label: "What is it about?",
          type: "dropdown",
          required: true,
          options: ["My order", "Stockists", "Wholesale", "Something else"],
        },
        { name: "message", label: "Your message", type: "long_text", required: true },
      ],
    },
  },
};
