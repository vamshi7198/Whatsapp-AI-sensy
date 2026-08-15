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
  /**
   * Image, video or document for a template whose header is media.
   * A link is preferred over an uploaded id: Meta expires uploaded media
   * after about a week, which would silently break a reusable template.
   */
  headerMedia?: {
    type: "image" | "video" | "document";
    link?: string;
    id?: string;
    filename?: string;
  };
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
 * A tappable button on a free-form message.
 *
 * The id is ours and comes back on the webhook when tapped. It is what a
 * journey branches on — never the visible label, which someone will reword
 * eventually and which would silently break every branch if it were the key.
 */
export interface ReplyButton {
  id: string;
  /** What the customer sees. Meta caps this at 20 characters. */
  label: string;
}

/**
 * Meta's hard limits on interactive messages, checked before sending.
 *
 * Note MAX_BUTTON_LABEL against MAX_TEMPLATE_BUTTON_LABEL: a template's
 * quick-reply button allows 25 characters, an interactive one only 20. The
 * same wording can therefore be legal on the opening template and rejected
 * on the reply, which is not obvious and has to be caught while the operator
 * is writing it rather than when a customer is waiting.
 */
export const INTERACTIVE_LIMITS = {
  /** Reply buttons per message. More than this needs a list instead. */
  MAX_BUTTONS: 3,
  MAX_BUTTON_LABEL: 20,
  /** Quick-reply buttons on an approved template get five more characters. */
  MAX_TEMPLATE_BUTTON_LABEL: 25,
  /** Rows across all sections of a list. */
  MAX_LIST_ROWS: 10,
  MAX_LIST_ROW_TITLE: 24,
  MAX_LIST_ROW_DESCRIPTION: 72,
  MAX_LIST_BUTTON_LABEL: 20,
  MAX_BODY: 1024,
  MAX_HEADER: 60,
  MAX_FOOTER: 60,
} as const;

/**
 * A plain text message allows four times what an interactive one does.
 *
 * The gap matters because the same journey step can send either: with no
 * options it is a text message, and adding a single button drops the ceiling
 * to 1024. A body that has always been fine can therefore become too long
 * because someone added a button to it.
 */
export const TEXT_LIMITS = {
  MAX_BODY: 4096,
} as const;

/** Up to three buttons under a message. Free-form: needs the 24-hour window. */
export interface SendButtonsInput {
  to: string;
  body: string;
  buttons: ReplyButton[];
  header?: string;
  footer?: string;
}

export interface ListRow extends ReplyButton {
  description?: string;
}

/**
 * A tappable menu, for when there are more options than buttons allow.
 *
 * Costs the customer one extra tap — the menu opens rather than sitting in the
 * chat — which is why buttons are preferred until they run out.
 */
export interface SendListInput {
  to: string;
  body: string;
  /** The button that opens the menu, e.g. "Choose a flavour". */
  buttonLabel: string;
  rows: ListRow[];
  /** Optional grouping. Omitted means one unnamed section. */
  sectionTitle?: string;
  header?: string;
  footer?: string;
}

/** Sending an in-chat form. Only valid inside the 24-hour window. */
export interface SendFlowInput {
  to: string;
  /** Meta's id for the form, not ours. */
  externalFlowId: string;
  /**
   * Our token, echoed back on the response. The ONLY link between an answer
   * and the person who gave it, since the response omits the form's id.
   */
  flowToken: string;
  /** The message shown above the button. */
  body: string;
  buttonText: string;
  header?: string;
  footer?: string;
  /** Open an unpublished draft, for testing before publishing for good. */
  draft?: boolean;
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

/**
 * The public profile customers see when they tap the business name.
 *
 * The display name is deliberately absent: it cannot be changed through the
 * API, only in WhatsApp Manager, and pretending otherwise would produce a
 * field that silently does nothing.
 */
export interface BusinessProfile {
  /** Short status line, max 139 characters. */
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  /** Up to two, each max 256 characters. */
  websites?: string[];
  /** Meta's industry categories, e.g. RETAIL, RESTAURANT. */
  vertical?: string;
  profilePictureUrl?: string;
}

export interface UpdateBusinessProfileInput {
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  /** From the resumable upload API, not the media API. */
  profilePictureHandle?: string;
}

/** Result of uploading media for use in a message. */
export interface MediaUploadResult {
  /** Media ID, usable in a send for about a week. */
  id: string;
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
      /**
       * Set when the customer tapped a button or picked from a menu.
       *
       * The id is the one we sent, so a journey can branch on it without
       * depending on the visible wording, which someone will eventually
       * change. Templates are the exception: Meta returns only the title for
       * a template's own quick-reply buttons, so id falls back to it there.
       */
      reply?: {
        id: string;
        title?: string;
        /** How the customer chose: buttons under a message, or a menu. */
        source: "button" | "list" | "template_button";
      };
      /**
       * Set when the customer completed a Flow — an in-chat form.
       *
       * The token is ours: we generate it when sending and Meta echoes it
       * back unchanged. It is the ONLY way to tell which send a response
       * belongs to, because the response does not carry the Flow's id.
       */
      flowResponse?: {
        flowToken?: string;
        /** The answers, exactly as Meta sent them. */
        answers: Record<string, unknown>;
      };
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
      /**
       * Meta's entry time, in seconds. Part of the dedupe key so the SECOND
       * time a template reaches a status is not mistaken for a replay of the
       * first — a template that went APPROVED, PAUSED, APPROVED had the last
       * event dropped and stayed PAUSED locally, blocking every campaign
       * using it.
       */
      occurredAt?: number;
      raw: unknown;
    }
  | {
      kind: "quality_update";
      phoneNumber: string;
      qualityRating?: string;
      messagingTier?: string;
      /**
       * As above. A rating that oscillates GREEN → YELLOW → GREEN otherwise
       * froze on the stale value, which is dangerous in the direction that
       * reads GREEN while the number is actually flagged.
       */
      occurredAt?: number;
      raw: unknown;
    }
  | { kind: "unknown"; raw: unknown };

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
}
