/**
 * Domain types for WhatsApp messaging.
 *
 * Nothing above this file speaks Meta's payload shapes. Campaigns, the inbox
 * and automations use only these types, so replacing the provider later means
 * writing one adapter rather than rewriting the application.
 */

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type TemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED";

/** A template component as returned by the provider, kept verbatim. */
export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  buttons?: Array<{
    type: string;
    text?: string;
    url?: string;
    phone_number?: string;
  }>;
  example?: Record<string, unknown>;
}

export interface ProviderTemplate {
  /** Provider-side identifier. */
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: TemplateComponent[];
  qualityScore?: string;
  rejectedReason?: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}

/** Positional template variables: { "1": "Vamshi", "2": "UNC-10432" } */
export type TemplateVariables = Record<string, string>;

export interface SendTemplateInput {
  /** E.164, with the leading "+". The provider strips it if required. */
  to: string;
  templateName: string;
  languageCode: string;
  bodyVariables?: TemplateVariables;
  headerVariables?: TemplateVariables;
  /** Correlates the send with our own record across retries. */
  idempotencyKey?: string;
}

export interface SendTextInput {
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface SendMediaInput {
  to: string;
  type: "image" | "document" | "video" | "audio";
  link: string;
  caption?: string;
  filename?: string;
}

/**
 * Result of a send attempt.
 *
 * `accepted` means the provider took the message — NOT that it was delivered.
 * Delivery arrives later by webhook, and the reporting UI keeps the two
 * distinct rather than implying a send is a delivery.
 */
export type SendResult =
  | { accepted: true; externalMessageId: string }
  | {
      accepted: false;
      error: NormalisedError;
    }
  /**
   * The request timed out after being written, so whether the provider
   * accepted it is genuinely unknowable. Never retried automatically — a
   * duplicate message to a real customer is worse than an under-reported one.
   */
  | { accepted: "unknown"; error: NormalisedError };

export interface NormalisedError {
  /** Provider error code, retained for the admin technical view. */
  code: string;
  /** Whether retrying could plausibly succeed. */
  retryable: boolean;
  /** Plain English, safe to show a non-technical user. */
  userMessage: string;
  /** What the user can do about it, when there is something. */
  suggestedAction?: string;
  /** Raw provider detail — ADMIN only. */
  technicalDetail?: string;
  /** True for auth failures, which pause a whole campaign. */
  isAuthError?: boolean;
}

export interface PhoneNumberProfile {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating?: string;
  /** Messaging tier, e.g. "TIER_1K". */
  messagingLimitTier?: string;
}

export interface BusinessAccountProfile {
  id: string;
  name: string;
  timezoneId?: string;
  messageTemplateNamespace?: string;
}

export type NormalisedWebhookEvent =
  | {
      kind: "inbound_message";
      externalMessageId: string;
      from: string;
      contactName?: string;
      type: string;
      text?: string;
      timestamp: Date;
      raw: unknown;
    }
  | {
      kind: "status_update";
      externalMessageId: string;
      recipient: string;
      status: "sent" | "delivered" | "read" | "failed";
      timestamp: Date;
      pricingCategory?: string;
      billable?: boolean;
      error?: NormalisedError;
      raw: unknown;
    }
  | {
      kind: "template_status";
      templateName: string;
      language: string;
      status: TemplateStatus;
      reason?: string;
      raw: unknown;
    }
  | {
      kind: "quality_update";
      phoneNumber: string;
      qualityRating?: string;
      messagingTier?: string;
      raw: unknown;
    }
  | { kind: "unknown"; raw: unknown };

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
}
