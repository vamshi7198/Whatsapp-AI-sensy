/**
 * Did this request fail before anything was sent?
 *
 * The distinction decides whether a failed POST may be retried. If the
 * connection was never established, Meta cannot have received the message and
 * sending again is exactly right. If it died after the body went out, Meta may
 * have accepted it, and sending again messages a real customer twice.
 *
 * Nothing in the request itself distinguishes these — fetch reports both as
 * "TypeError: fetch failed" — so it has to come from the underlying cause's
 * code.
 *
 * Deliberately a list of the SAFE ones, with everything else treated as
 * ambiguous. A code nobody anticipated is far more likely to be a mid-flight
 * failure than a pre-connect one, and the two mistakes are not equal: an
 * unrecognised ambiguous case flagged for reconciliation costs somebody a
 * glance, while an unrecognised ambiguous case retried costs a customer a
 * duplicate message and the business a second charge.
 */

/** Failures that prove the request never left this machine. */
const PRE_CONNECT = new Set([
  "ECONNREFUSED", // nothing listening
  "ENOTFOUND", // DNS said no such host
  "EAI_AGAIN", // DNS lookup failed, usually a dropped link
  "ERR_SOCKET_BAD_PORT",
  "UND_ERR_CONNECT_TIMEOUT", // gave up before the connection was made
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** The `code` on a fetch failure lives on its cause, not on the error. */
function causeCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("cause" in error)) return null;

  const cause = (error as { cause?: unknown }).cause;

  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }

  return null;
}

export function isPreConnectFailure(error: unknown): boolean {
  const code = causeCode(error);
  return code !== null && PRE_CONNECT.has(code);
}
