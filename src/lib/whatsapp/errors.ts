import type { NormalisedError } from "./types";

/**
 * Meta error code catalogue.
 *
 * Two jobs, both important:
 *
 *  1. Decide whether a failure is worth retrying. Retrying a permanent error
 *     wastes quota and delays the rest of a campaign; not retrying a transient
 *     one loses a message that would have gone through.
 *
 *  2. Say what happened in language a non-technical user can act on.
 *     "Error 131026" tells an operator nothing. "This number is not on
 *     WhatsApp" tells them to check the contact.
 *
 * Codes verified against Meta's published error reference. Unknown codes fall
 * back to a generic message and are never silently swallowed — the raw detail
 * is always kept for the admin technical view.
 */

interface ErrorDefinition {
  retryable: boolean;
  userMessage: string;
  suggestedAction?: string;
  isAuthError?: boolean;
}

const CATALOGUE: Record<string, ErrorDefinition> = {
  // --- Authentication / configuration --------------------------------------
  "0": {
    retryable: false,
    userMessage: "WhatsApp could not authenticate this request.",
    suggestedAction: "Check the access token in Settings.",
    isAuthError: true,
  },
  "190": {
    retryable: false,
    userMessage: "The WhatsApp access token has expired or been revoked.",
    suggestedAction:
      "Generate a new System User token in Meta Business Settings and update it in Settings.",
    isAuthError: true,
  },
  "200": {
    retryable: false,
    userMessage:
      "This account does not have permission to send WhatsApp messages.",
    suggestedAction:
      "Check the token has whatsapp_business_messaging permission.",
    isAuthError: true,
  },
  "10": {
    retryable: false,
    userMessage:
      "This account does not have permission to perform that action.",
    isAuthError: true,
  },

  // --- Rate limiting / throughput ------------------------------------------
  "4": {
    retryable: true,
    userMessage: "Sending is temporarily paused because of WhatsApp's limits.",
    suggestedAction: "This will retry automatically.",
  },
  "80007": {
    retryable: true,
    userMessage: "WhatsApp is rate limiting this account.",
    suggestedAction: "This will retry automatically.",
  },
  "130429": {
    retryable: true,
    userMessage: "Too many messages sent too quickly.",
    suggestedAction: "This will retry automatically at a slower rate.",
  },
  "131048": {
    retryable: true,
    userMessage:
      "WhatsApp has limited sending on this account to protect its quality rating.",
    suggestedAction:
      "Reduce how often you message the same people, and check your quality rating.",
  },
  "131056": {
    retryable: true,
    userMessage:
      "Too many messages sent to this person in a short time.",
    suggestedAction: "This will retry automatically after a pause.",
  },

  // --- Recipient problems (permanent) --------------------------------------
  "131026": {
    retryable: false,
    userMessage:
      "This number is not registered on WhatsApp, so the message could not be delivered.",
    suggestedAction:
      "Check the number is correct, or remove this contact from future campaigns.",
  },
  "131052": {
    retryable: false,
    userMessage: "This number cannot receive WhatsApp messages.",
    suggestedAction: "Check the number is correct.",
  },
  "131051": {
    retryable: false,
    userMessage: "This message type is not supported for this recipient.",
  },

  // --- Messaging window / policy -------------------------------------------
  "131047": {
    retryable: false,
    userMessage:
      "You can only send a free message within 24 hours of the customer's last reply. That window has closed.",
    suggestedAction: "Send an approved template instead.",
  },
  "131049": {
    retryable: false,
    userMessage:
      "WhatsApp did not deliver this marketing message because the customer has already received several recently.",
    suggestedAction:
      "This is a WhatsApp-wide limit to protect users. Try again in a few days, or send fewer marketing messages.",
  },
  "131050": {
    retryable: false,
    userMessage:
      "This customer has chosen not to receive marketing messages from your business.",
    suggestedAction: "Do not message them again for marketing.",
  },

  // --- Template problems (permanent) ---------------------------------------
  "132000": {
    retryable: false,
    userMessage:
      "The number of values supplied does not match what the template expects.",
    suggestedAction: "Check the variable mapping in the campaign.",
  },
  "132001": {
    retryable: false,
    userMessage: "This template does not exist, or is not available in that language.",
    suggestedAction: "Sync templates in Settings and choose an approved one.",
  },
  "132005": {
    retryable: false,
    userMessage: "One of the values is too long for this template.",
    suggestedAction: "Shorten the value in the variable mapping.",
  },
  "132007": {
    retryable: false,
    userMessage: "This template was rejected by WhatsApp and cannot be used.",
    suggestedAction: "Edit the template in WhatsApp Manager and resubmit it.",
  },
  "132012": {
    retryable: false,
    userMessage: "One of the values has formatting WhatsApp does not allow.",
    suggestedAction:
      "Remove line breaks, tabs, or runs of spaces from the values.",
  },
  "132015": {
    retryable: false,
    userMessage: "This template is currently paused by WhatsApp.",
    suggestedAction:
      "Paused templates resume automatically. Use a different template meanwhile.",
  },
  "132016": {
    retryable: false,
    userMessage:
      "This template was paused permanently because of poor customer feedback.",
    suggestedAction: "Create a new template.",
  },
  "132068": {
    retryable: false,
    userMessage: "This flow is not published and cannot be sent.",
  },

  // --- Request problems ----------------------------------------------------
  "100": {
    retryable: false,
    userMessage: "WhatsApp rejected this request as invalid.",
    suggestedAction: "Check the campaign settings.",
  },
  "131008": {
    retryable: false,
    userMessage: "A required detail was missing from this message.",
  },
  "131009": {
    retryable: false,
    userMessage: "One of the values in this message was not accepted.",
  },
  "131021": {
    retryable: false,
    userMessage:
      "You cannot send a message to your own WhatsApp business number.",
  },

  // --- Server-side / transient ---------------------------------------------
  "1": {
    retryable: true,
    userMessage: "WhatsApp had a temporary problem.",
    suggestedAction: "This will retry automatically.",
  },
  "2": {
    retryable: true,
    userMessage: "WhatsApp is temporarily unavailable.",
    suggestedAction: "This will retry automatically.",
  },
  "131000": {
    retryable: true,
    userMessage: "WhatsApp had a temporary problem sending this message.",
    suggestedAction: "This will retry automatically.",
  },
  "131016": {
    retryable: true,
    userMessage: "The WhatsApp service is temporarily unavailable.",
    suggestedAction: "This will retry automatically.",
  },
  "131057": {
    retryable: true,
    userMessage: "This account is temporarily unavailable for sending.",
  },
};

/** Errors we generate ourselves, not returned by Meta. */
export const LOCAL_ERRORS = {
  NOT_CONFIGURED: {
    code: "not_configured",
    retryable: false,
    userMessage:
      "WhatsApp is not connected yet, so no messages can be sent.",
    suggestedAction: "Add your WhatsApp Business details in Settings.",
    isAuthError: true,
  },
  TIMEOUT: {
    code: "timeout",
    retryable: true,
    userMessage: "WhatsApp did not respond in time.",
    suggestedAction: "This will retry automatically.",
  },
  NETWORK: {
    code: "network",
    retryable: true,
    userMessage: "Could not reach WhatsApp.",
    suggestedAction: "This will retry automatically.",
  },
  TEMPLATE_NOT_APPROVED: {
    code: "template_not_approved",
    retryable: false,
    userMessage:
      "This template is not approved by WhatsApp, so it cannot be sent.",
    suggestedAction: "Choose an approved template.",
  },
} as const satisfies Record<string, NormalisedError>;

/**
 * Classifies an error code read back from the database.
 *
 * Needed because classifyError stores the HTTP status AS the code when Meta
 * returns no usable one, so a transient 500 is persisted as "500". Re-reading
 * that later without the status would miss the catalogue and fall through to
 * "not retryable", labelling a temporary outage as permanent.
 *
 * Meta's own codes are checked first, so a real code like 100 is never
 * mistaken for an HTTP status.
 */
export function classifyStoredError(code: string | null | undefined): NormalisedError {
  if (!code) {
    return classifyError(undefined);
  }

  if (CATALOGUE[code]) return classifyError(code);

  // Not a Meta code, but shaped like an HTTP status — that is what it is.
  const asStatus = /^\d{3}$/.test(code) ? Number(code) : undefined;
  return classifyError(code, undefined, asStatus);
}

/**
 * Classifies a provider error code.
 *
 * HTTP status is used as a fallback signal: 5xx and 429 are transient
 * regardless of the body, which matters because Meta occasionally returns
 * those without a usable code.
 */
export function classifyError(
  code: string | number | undefined,
  message?: string,
  httpStatus?: number,
): NormalisedError {
  const key = code === undefined ? "" : String(code);
  const known = CATALOGUE[key];

  if (known) {
    return {
      code: key,
      retryable: known.retryable,
      userMessage: known.userMessage,
      suggestedAction: known.suggestedAction,
      technicalDetail: message,
      isAuthError: known.isAuthError,
    };
  }

  if (httpStatus === 429) {
    return {
      code: key || String(httpStatus),
      retryable: true,
      userMessage: "WhatsApp is rate limiting this account.",
      suggestedAction: "This will retry automatically.",
      technicalDetail: message,
    };
  }

  if (httpStatus !== undefined && httpStatus >= 500) {
    return {
      code: key || String(httpStatus),
      retryable: true,
      userMessage: "WhatsApp had a temporary problem.",
      suggestedAction: "This will retry automatically.",
      technicalDetail: message,
    };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: key || String(httpStatus),
      retryable: false,
      userMessage: "WhatsApp rejected these credentials.",
      suggestedAction: "Check the access token in Settings.",
      technicalDetail: message,
      isAuthError: true,
    };
  }

  // Unrecognised code: not retried (safer — a permanent error retried forever
  // is worse than a transient one abandoned), but the detail is always kept.
  return {
    code: key || "unknown",
    retryable: false,
    userMessage: "WhatsApp could not send this message.",
    suggestedAction: "An administrator can see the technical details in Logs.",
    technicalDetail: message,
  };
}
