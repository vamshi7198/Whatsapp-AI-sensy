import { describe, expect, it } from "vitest";

import { isPreConnectFailure } from "../network";

/**
 * How fetch reports a network failure: a TypeError whose `cause` carries the
 * real code. Node v24 shapes it exactly like this.
 */
function fetchFailure(code: string): Error {
  const error = new TypeError("fetch failed");
  (error as Error & { cause?: unknown }).cause = Object.assign(
    new Error(code),
    { code },
  );
  return error;
}

describe("isPreConnectFailure", () => {
  /*
    This decides whether a failed POST may be sent again, and the two
    mistakes are not equal.

    Wrongly "pre-connect": the message is re-sent, so a customer receives
    the same WhatsApp message twice and the business is billed twice. No
    idempotency key reaches Meta to catch it.

    Wrongly "ambiguous": the recipient is flagged for reconciliation and
    somebody looks at it. Cheap.
  */

  it("recognises failures that prove nothing was sent", () => {
    for (const code of [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "CERT_HAS_EXPIRED",
    ]) {
      expect(isPreConnectFailure(fetchFailure(code))).toBe(true);
    }
  });

  it("does NOT treat a reset connection as safe to retry", () => {
    // The finding. A socket reset after the body is written is exactly when
    // Meta may already have accepted the message; this used to fall through
    // to a plain retryable failure and re-send it up to five times.
    expect(isPreConnectFailure(fetchFailure("ECONNRESET"))).toBe(false);
  });

  it("does not treat any other mid-flight failure as safe either", () => {
    for (const code of ["EPIPE", "UND_ERR_SOCKET", "ECONNABORTED", "ETIMEDOUT"]) {
      expect(isPreConnectFailure(fetchFailure(code))).toBe(false);
    }
  });

  it("treats an unrecognised code as unsafe", () => {
    // The default has to fall this way. A code nobody anticipated is far more
    // likely to be a mid-flight failure than a pre-connect one, and guessing
    // wrong here costs a customer a duplicate message.
    expect(isPreConnectFailure(fetchFailure("SOMETHING_NEW"))).toBe(false);
  });

  it("treats an error with no cause as unsafe", () => {
    expect(isPreConnectFailure(new TypeError("fetch failed"))).toBe(false);
    expect(isPreConnectFailure(new Error("boom"))).toBe(false);
    expect(isPreConnectFailure(null)).toBe(false);
    expect(isPreConnectFailure("ECONNREFUSED")).toBe(false);
  });

  it("is not fooled by a code on the error itself rather than the cause", () => {
    // fetch puts it on the cause. An error carrying a top-level code is some
    // other kind of failure and must not be read as a connect refusal.
    const error = Object.assign(new Error("nope"), { code: "ECONNREFUSED" });

    expect(isPreConnectFailure(error)).toBe(false);
  });
});
