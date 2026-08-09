import {
  isValidPhoneNumber,
  parsePhoneNumberWithError,
  type CountryCode,
} from "libphonenumber-js";

/**
 * Phone number normalisation to E.164.
 *
 * This is the identity key for every contact, so it has to be strict: a number
 * that normalises inconsistently creates a duplicate contact, and duplicates
 * mean a customer receives the same campaign twice.
 *
 * Default region is India, because that is where the overwhelming majority of
 * Uncanned's contacts are and CSV exports routinely contain bare 10-digit
 * numbers. Numbers written with an explicit "+" are parsed in their own
 * country regardless of this default.
 */

export const DEFAULT_REGION: CountryCode = "IN";

export type PhoneErrorReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_country"
  | "not_a_number"
  | "invalid";

export type PhoneResult =
  | { ok: true; e164: string; country: string | undefined }
  | { ok: false; reason: PhoneErrorReason; message: string };

const ERROR_MESSAGES: Record<PhoneErrorReason, string> = {
  empty: "Phone number is missing.",
  too_short: "This phone number has too few digits.",
  too_long: "This phone number has too many digits.",
  invalid_country: "The country code in this number is not recognised.",
  not_a_number: "This does not look like a phone number.",
  invalid: "This phone number is not valid.",
};

/**
 * Maps libphonenumber's error strings to our reasons. Kept separate so a
 * library upgrade that renames an error surfaces as "invalid" rather than
 * throwing.
 */
function mapParseError(message: string): PhoneErrorReason {
  switch (message) {
    case "TOO_SHORT":
      return "too_short";
    case "TOO_LONG":
      return "too_long";
    case "INVALID_COUNTRY":
      return "invalid_country";
    case "NOT_A_NUMBER":
      return "not_a_number";
    default:
      return "invalid";
  }
}

/**
 * Normalises a raw phone number to E.164.
 *
 * Accepts the shapes that actually appear in spreadsheets: "+91 98765 43210",
 * "919876543210", "09876543210", "98765-43210", and numbers Excel has mangled
 * into "9.19877E+11" are rejected rather than silently mis-parsed.
 */
export function normalizePhone(
  raw: string | null | undefined,
  region: CountryCode = DEFAULT_REGION,
): PhoneResult {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "empty", message: ERROR_MESSAGES.empty };
  }

  const trimmed = String(raw).trim();
  if (trimmed === "") {
    return { ok: false, reason: "empty", message: ERROR_MESSAGES.empty };
  }

  // Excel turns long numbers into scientific notation. Parsing that would
  // produce a plausible-looking but wrong number, so reject it outright.
  if (/e\+?\d/i.test(trimmed)) {
    return {
      ok: false,
      reason: "not_a_number",
      message:
        "This looks like a number Excel converted to scientific notation. " +
        "Format the phone column as text and export again.",
    };
  }

  // Strip common separators but keep a leading "+", which carries meaning.
  const cleaned = trimmed
    .replace(/[\s\-().]/g, "")
    .replace(/^00/, "+");

  if (!/^\+?\d+$/.test(cleaned)) {
    return {
      ok: false,
      reason: "not_a_number",
      message: ERROR_MESSAGES.not_a_number,
    };
  }

  try {
    const parsed = parsePhoneNumberWithError(cleaned, region);

    if (!parsed.isValid()) {
      return { ok: false, reason: "invalid", message: ERROR_MESSAGES.invalid };
    }

    return {
      ok: true,
      e164: parsed.number,
      country: parsed.country,
    };
  } catch (error) {
    const reason = mapParseError(
      error instanceof Error ? error.message : "invalid",
    );
    return { ok: false, reason, message: ERROR_MESSAGES[reason] };
  }
}

/** True when the value normalises to a valid number. */
export function isValidPhone(
  raw: string,
  region: CountryCode = DEFAULT_REGION,
): boolean {
  try {
    return isValidPhoneNumber(raw.trim(), region);
  } catch {
    return false;
  }
}

/**
 * Display formatting: +919876543210 -> "+91 98765 43210".
 * Falls back to the raw value rather than throwing — a contact list must still
 * render if one stored number is somehow unparseable.
 */
export function formatPhoneForDisplay(e164: string): string {
  try {
    return parsePhoneNumberWithError(e164).formatInternational();
  } catch {
    return e164;
  }
}

/**
 * Meta's send API wants the number without the leading "+".
 * Kept here so the rule lives with the rest of the phone handling rather than
 * being reinvented in the provider.
 */
export function toWhatsAppRecipient(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}
