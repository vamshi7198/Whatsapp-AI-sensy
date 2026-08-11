import type { JourneyStepType } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import type {
  AskQuestionConfig,
  ConditionConfig,
  HandoffConfig,
  SendMediaConfig,
  SendMessageConfig,
  SendTemplateConfig,
  StepOption,
  TagConfig,
  UpdateContactConfig,
  WaitConfig,
  WebhookConfig,
} from "./types";

/**
 * Reading a step's configuration back out of the database.
 *
 * Every one of these treats the stored JSON as untrusted. It was written by a
 * previous version of this code, possibly a previous version of the app, and a
 * step whose config has drifted must degrade to something harmless rather than
 * throw halfway through a customer's conversation.
 */

/**
 * Takes unknown rather than JsonValue on purpose: it is called both on a
 * column and on values dug out of one, which TypeScript has already widened.
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Options, with anything malformed dropped rather than half-read. */
export function readOptions(value: Prisma.JsonValue | null): StepOption[] {
  const raw = asRecord(value).options;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const options: StepOption[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;

    const id = asString(record.id).trim();
    const label = asString(record.label).trim();
    if (!id || !label) continue;

    // A duplicate id would make the branch ambiguous — the link table cannot
    // hold two arrows for the same option anyway.
    if (seen.has(id)) continue;
    seen.add(id);

    options.push({
      id,
      label,
      ...(typeof record.description === "string"
        ? { description: record.description }
        : {}),
    });
  }

  return options;
}

export function readSendTemplate(
  value: Prisma.JsonValue | null,
): SendTemplateConfig {
  const raw = asRecord(value);
  const variables = asRecord(raw.variables);

  return {
    templateId: asString(raw.templateId),
    variables: Object.fromEntries(
      Object.entries(variables)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    ),
    options: readOptions(value),
  };
}

export function readSendMessage(
  value: Prisma.JsonValue | null,
): SendMessageConfig {
  const raw = asRecord(value);

  return {
    body: asString(raw.body),
    options: readOptions(value),
    menuLabel: asString(raw.menuLabel, "Choose an option"),
    ...(typeof raw.header === "string" ? { header: raw.header } : {}),
    ...(typeof raw.footer === "string" ? { footer: raw.footer } : {}),
  };
}

export function readAskQuestion(
  value: Prisma.JsonValue | null,
): AskQuestionConfig {
  const raw = asRecord(value);
  const field = asString(raw.saveToContactField);

  return {
    body: asString(raw.body),
    // A blank key would silently discard the answer, so it gets a name.
    saveAs: asString(raw.saveAs) || "answer",
    ...(field === "name" || field === "email" || field === "address"
      ? { saveToContactField: field }
      : {}),
  };
}

export function readSendMedia(value: Prisma.JsonValue | null): SendMediaConfig {
  const raw = asRecord(value);
  const type = asString(raw.type);

  return {
    type: type === "document" || type === "video" ? type : "image",
    link: asString(raw.link),
    ...(typeof raw.caption === "string" ? { caption: raw.caption } : {}),
    ...(typeof raw.filename === "string" ? { filename: raw.filename } : {}),
  };
}

export function readTag(value: Prisma.JsonValue | null): TagConfig {
  return { tagId: asString(asRecord(value).tagId) };
}

export function readUpdateContact(
  value: Prisma.JsonValue | null,
): UpdateContactConfig {
  const raw = asRecord(value);
  const field = asString(raw.field);

  return {
    field: field === "email" || field === "address" ? field : "name",
    value: asString(raw.value),
  };
}

export function readCondition(value: Prisma.JsonValue | null): ConditionConfig {
  const raw = asRecord(value);
  const subject = asString(raw.subject);
  const operator = asString(raw.operator);

  const OPERATORS = ["is", "is_not", "contains", "exists", "not_exists"] as const;

  return {
    subject:
      subject === "answer" || subject === "contact_field" ? subject : "tag",
    key: asString(raw.key),
    operator: (OPERATORS as readonly string[]).includes(operator)
      ? (operator as ConditionConfig["operator"])
      : "is",
    ...(typeof raw.value === "string" ? { value: raw.value } : {}),
  };
}

export function readWait(value: Prisma.JsonValue | null): WaitConfig {
  const minutes = asRecord(value).minutes;
  const parsed = typeof minutes === "number" ? Math.floor(minutes) : 0;

  // Bounded on both sides: zero would be a step that does nothing, and a wait
  // of years would leave a session sitting in the table forever.
  return { minutes: Math.min(Math.max(parsed, 1), 60 * 24 * 30) };
}

export function readWebhook(value: Prisma.JsonValue | null): WebhookConfig {
  const raw = asRecord(value);
  const body = asRecord(raw.body);

  return {
    url: asString(raw.url),
    method: asString(raw.method) === "GET" ? "GET" : "POST",
    body: Object.fromEntries(
      Object.entries(body)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    ),
  };
}

export function readHandoff(value: Prisma.JsonValue | null): HandoffConfig {
  const note = asRecord(value).note;
  return typeof note === "string" ? { note } : {};
}

/**
 * The options a step offers, whatever its type.
 *
 * Used to decide whether a step waits for a reply and to draw one arrow per
 * option on the canvas.
 */
export function optionsForStep(
  type: JourneyStepType,
  config: Prisma.JsonValue | null,
): StepOption[] {
  if (type === "SEND_TEMPLATE" || type === "SEND_MESSAGE") {
    return readOptions(config);
  }

  // A condition has exactly two ways out, and they are fixed rather than
  // authored, so they are named here rather than stored per step.
  if (type === "CONDITION") {
    return [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ];
  }

  return [];
}
