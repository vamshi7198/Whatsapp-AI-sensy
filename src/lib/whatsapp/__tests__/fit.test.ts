import { describe, expect, it } from "vitest";

import { fit } from "../fit";
import { INTERACTIVE_LIMITS, TEXT_LIMITS } from "../types";

describe("fit", () => {
  it("leaves text that already fits completely alone", () => {
    const short = "Thanks! Which size would you like?";

    expect(fit(short, INTERACTIVE_LIMITS.MAX_BODY)).toEqual({
      text: short,
      truncated: false,
    });
  });

  it("leaves text of exactly the limit alone", () => {
    // Off-by-one here would truncate a message that Meta would have accepted.
    const exact = "a".repeat(1024);

    expect(fit(exact, 1024).truncated).toBe(false);
    expect(fit(exact, 1024).text).toHaveLength(1024);
  });

  it("brings an over-long body within the limit", () => {
    const result = fit("a".repeat(2000), INTERACTIVE_LIMITS.MAX_BODY);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(INTERACTIVE_LIMITS.MAX_BODY);
    expect(result.text.endsWith("…")).toBe(true);
  });

  it("ends on a whole word when a space is near the cut", () => {
    const words = "banana ".repeat(40).trim(); // spaces throughout

    const result = fit(words, 50);

    expect(result.text.length).toBeLessThanOrEqual(50);
    // Cut at a space, so no half-word before the ellipsis.
    expect(result.text).not.toMatch(/ban…$|bana…$|banan…$/);
  });

  it("does not throw away most of an unbroken string to find a space", () => {
    // A long URL has no spaces. Falling back to "last space anywhere" would
    // return almost nothing; the guard is that the space must be close to
    // the cut.
    const url = "https://uncanned.in/" + "x".repeat(200);
    const result = fit("See " + url, 60);

    expect(result.text.length).toBeGreaterThan(50);
  });

  it("never leaves half an emoji at the cut", () => {
    // Emoji are surrogate pairs: slicing by index can split one and produce a
    // replacement box on the customer's phone.
    const result = fit("🎉".repeat(50), 21);

    expect(result.text.length).toBeLessThanOrEqual(21);
    // No unpaired surrogate anywhere in the output.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result.text)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result.text)).toBe(false);
  });

  describe("the case that used to kill a session", () => {
    /*
      A customer may send up to 4096 characters. An ASK_QUESTION step stores
      that reply verbatim, and the next step renders it back into a message
      with buttons — where the ceiling is 1024, not 4096.

      Meta rejected the send, the step threw, and endSession(FAILED) dropped
      the customer mid-conversation for the crime of writing a long address.
    */

    const longAnswer = "Flat 4B, ".repeat(200); // ~1800 chars, entirely ordinary

    it("keeps a chatty customer's next message sendable", () => {
      const body = `Thanks! We have you at ${longAnswer}. Is that right?`;

      expect(body.length).toBeGreaterThan(INTERACTIVE_LIMITS.MAX_BODY);

      const result = fit(body, INTERACTIVE_LIMITS.MAX_BODY);

      expect(result.text.length).toBeLessThanOrEqual(
        INTERACTIVE_LIMITS.MAX_BODY,
      );
      expect(result.truncated).toBe(true);
    });

    it("still allows the full 4096 when the step sends plain text", () => {
      // The same body with no options attached is a text message, and this
      // one fits — so it must not be trimmed.
      const body = `Thanks! We have you at ${longAnswer}.`;

      expect(fit(body, TEXT_LIMITS.MAX_BODY).truncated).toBe(false);
    });
  });
});
