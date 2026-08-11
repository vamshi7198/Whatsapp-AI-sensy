import type {
  NormalisedWebhookEvent,
  ProviderTemplate,
  TemplateCategory,
  TemplateComponent,
  TemplateStatus,
  TemplateVariables,
} from "../../types";
import { classifyError } from "../../errors";

/**
 * Translation between Meta's wire format and our domain types.
 *
 * All knowledge of Meta's JSON shapes is confined to this file and its
 * siblings, so a change on Meta's side has one place to be absorbed.
 */

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components?: TemplateComponent[];
  quality_score?: { score?: string };
  rejected_reason?: string;
}

/** Meta occasionally introduces statuses; anything unrecognised is treated as
 * unusable rather than assumed sendable. */
function toTemplateStatus(raw: string): TemplateStatus {
  switch (raw?.toUpperCase()) {
    case "APPROVED":
      return "APPROVED";
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    case "PAUSED":
      return "PAUSED";
    case "DISABLED":
    case "DELETED":
      return "DISABLED";
    default:
      return "DISABLED";
  }
}

function toCategory(raw: string): TemplateCategory {
  const upper = raw?.toUpperCase();
  if (upper === "MARKETING" || upper === "UTILITY" || upper === "AUTHENTICATION") {
    return upper;
  }
  // Meta's older OTP category maps onto AUTHENTICATION.
  if (upper === "OTP") return "AUTHENTICATION";
  return "UTILITY";
}

export function toProviderTemplate(raw: MetaTemplate): ProviderTemplate {
  return {
    id: raw.id,
    name: raw.name,
    language: raw.language,
    category: toCategory(raw.category),
    status: toTemplateStatus(raw.status),
    components: raw.components ?? [],
    qualityScore: raw.quality_score?.score,
    rejectedReason: raw.rejected_reason,
  };
}

/** Counts positional {{n}} placeholders in a template's BODY. */
export function countTemplateVariables(
  components: TemplateComponent[],
): number {
  const body = components.find((c) => c.type === "BODY");
  if (!body?.text) return 0;

  const matches = body.text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;

  const indices = matches
    .map((m) => Number(m.replace(/[^\d]/g, "")))
    .filter((n) => Number.isFinite(n));

  // The highest index, not the match count — "{{1}} ... {{1}} ... {{3}}"
  // still requires three parameters to be supplied.
  return indices.length ? Math.max(...indices) : 0;
}

/** Meta wants the recipient without a leading "+". */
export function toRecipient(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

/** Builds the components array for a template send. */
export function buildTemplateComponents(
  bodyVariables?: TemplateVariables,
  headerVariables?: TemplateVariables,
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];

  const toParameters = (vars: TemplateVariables) =>
    Object.keys(vars)
      // Numeric sort: Object key order would put "10" before "2".
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ({ type: "text", text: vars[key] }));

  if (headerVariables && Object.keys(headerVariables).length) {
    components.push({
      type: "header",
      parameters: toParameters(headerVariables),
    });
  }

  if (bodyVariables && Object.keys(bodyVariables).length) {
    components.push({ type: "body", parameters: toParameters(bodyVariables) });
  }

  return components;
}

/* ------------------------------------------------------------------ */
/* Webhook payloads                                                    */
/* ------------------------------------------------------------------ */

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            type?: string;
            button_reply?: { title?: string };
            list_reply?: { title?: string };
            // A completed Flow. response_json is a STRING of JSON, not an
            // object, and carries the answers the customer filled in.
            nfm_reply?: {
              name?: string;
              body?: string;
              response_json?: string;
            };
          };
        }>;
        statuses?: Array<{
          id?: string;
          recipient_id?: string;
          status?: string;
          timestamp?: string;
          pricing?: { billable?: boolean; category?: string };
          errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
          }>;
        }>;
        // message_template_status_update
        event?: string;
        message_template_name?: string;
        message_template_language?: string;
        reason?: string;
        // phone_number_quality_update
        display_phone_number?: string;
        current_limit?: string;
      };
    }>;
  }>;
}

function toDate(timestamp?: string): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

/** Extracts readable text from whichever inbound message shape arrived. */
function extractText(
  message: NonNullable<
    NonNullable<
      NonNullable<MetaWebhookPayload["entry"]>[number]["changes"]
    >[number]["value"]
  >["messages"] extends (infer M)[] | undefined
    ? M
    : never,
): string | undefined {
  const flowReply = message.interactive?.nfm_reply;

  if (flowReply) {
    // Meta's own body here is the literal word "Sent", which tells an operator
    // nothing. Summarising the answers gives the inbox something readable
    // while the full response is kept on the message payload.
    return summariseFlowResponse(flowReply.response_json) ?? "Form completed";
  }

  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title
  );
}

/**
 * Reads the answers out of a completed Flow.
 *
 * response_json is a STRING of JSON, and its shape is whatever the Flow's own
 * screens defined, so nothing about it can be assumed. Anything unparseable
 * returns undefined and the caller carries on — a malformed response must
 * never cost us the message it arrived on.
 */
export function parseFlowResponse(
  responseJson: string | undefined,
): Record<string, unknown> | undefined {
  if (!responseJson) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  return parsed as Record<string, unknown>;
}

/**
 * Turns a Flow's answers into one readable line for the inbox.
 */
export function summariseFlowResponse(
  responseJson: string | undefined,
): string | undefined {
  const parsed = parseFlowResponse(responseJson);
  if (!parsed) return undefined;

  const parts: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    // Meta adds its own bookkeeping fields; they are not answers.
    if (key === "flow_token" || key.startsWith("__")) continue;

    const rendered = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "object"
        ? undefined
        : String(value);

    if (rendered === undefined || rendered === "") continue;

    // Screen field names are snake_case identifiers; make them readable.
    parts.push(`${key.replace(/_/g, " ")}: ${rendered}`);
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function parseMetaWebhook(payload: unknown): NormalisedWebhookEvent[] {
  const body = payload as MetaWebhookPayload;
  const events: NormalisedWebhookEvent[] = [];

  if (!body?.entry?.length) return [{ kind: "unknown", raw: payload }];

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // --- Inbound messages ---
      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;

        const flowAnswers = parseFlowResponse(
          message.interactive?.nfm_reply?.response_json,
        );

        events.push({
          kind: "inbound_message",
          externalMessageId: message.id,
          from: `+${message.from}`,
          contactName: value.contacts?.[0]?.profile?.name,
          type: message.type ?? "unknown",
          text: extractText(message),
          timestamp: toDate(message.timestamp),
          ...(flowAnswers
            ? {
                flowResponse: {
                  flowToken:
                    typeof flowAnswers.flow_token === "string"
                      ? flowAnswers.flow_token
                      : undefined,
                  answers: flowAnswers,
                },
              }
            : {}),
          raw: message,
        });
      }

      // --- Delivery status updates ---
      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;

        const metaError = status.errors?.[0];

        events.push({
          kind: "status_update",
          externalMessageId: status.id,
          recipient: status.recipient_id ? `+${status.recipient_id}` : "",
          status: status.status as "sent" | "delivered" | "read" | "failed",
          timestamp: toDate(status.timestamp),
          pricingCategory: status.pricing?.category,
          billable: status.pricing?.billable,
          error: metaError
            ? classifyError(
                metaError.code,
                metaError.error_data?.details ??
                  metaError.message ??
                  metaError.title,
              )
            : undefined,
          raw: status,
        });
      }

      // --- Template approval status ---
      if (change.field === "message_template_status_update") {
        events.push({
          kind: "template_status",
          templateName: value.message_template_name ?? "",
          language: value.message_template_language ?? "",
          status: toTemplateStatus(value.event ?? ""),
          reason: value.reason,
          raw: value,
        });
      }

      // --- Quality rating / messaging tier ---
      if (change.field === "phone_number_quality_update") {
        events.push({
          kind: "quality_update",
          phoneNumber: value.display_phone_number ?? "",
          qualityRating: value.event,
          messagingTier: value.current_limit,
          raw: value,
        });
      }
    }
  }

  return events.length ? events : [{ kind: "unknown", raw: payload }];
}
