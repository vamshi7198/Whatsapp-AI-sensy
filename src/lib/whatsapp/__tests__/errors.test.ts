import { describe, expect, it } from "vitest";

import { classifyError } from "../errors";

describe("classifyError", () => {
  it("marks rate limits as retryable", () => {
    for (const code of [4, 80007, 130429, 131056]) {
      expect(classifyError(code).retryable).toBe(true);
    }
  });

  it("marks recipient and template problems as permanent", () => {
    // Retrying these forever would burn quota and delay the rest of a campaign.
    for (const code of [131026, 132001, 132007, 132000]) {
      expect(classifyError(code).retryable).toBe(false);
    }
  });

  it("flags token failures as auth errors so a campaign pauses", () => {
    const result = classifyError(190);
    expect(result.isAuthError).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.suggestedAction).toMatch(/System User token/i);
  });

  it("explains the per-user marketing cap without suggesting a retry", () => {
    const result = classifyError(131049);
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toMatch(/already received several recently/i);
  });

  it("explains a closed 24-hour window in plain language", () => {
    const result = classifyError(131047);
    expect(result.userMessage).toMatch(/24 hours/);
    expect(result.suggestedAction).toMatch(/template/i);
  });

  it("uses HTTP status when the code is unrecognised", () => {
    expect(classifyError(999999, "x", 503).retryable).toBe(true);
    expect(classifyError(999999, "x", 429).retryable).toBe(true);
    expect(classifyError(999999, "x", 401).isAuthError).toBe(true);
  });

  it("defaults an unknown error to non-retryable but keeps the detail", () => {
    const result = classifyError(424242, "Some new Meta failure");
    expect(result.retryable).toBe(false);
    expect(result.technicalDetail).toBe("Some new Meta failure");
    expect(result.code).toBe("424242");
  });

  it("never leaks an error code into the user-facing message", () => {
    const codes = [
      131026, 131047, 131049, 132001, 132007, 190, 4, 130429, 424242,
    ];

    for (const code of codes) {
      const result = classifyError(code, "raw detail");
      expect(result.userMessage).not.toMatch(/\d{5,}/);
      expect(result.userMessage).not.toMatch(/error|exception/i);
      // Must read as a sentence a non-technical operator can act on.
      expect(result.userMessage.length).toBeGreaterThan(15);
    }
  });

  it("handles a missing code", () => {
    const result = classifyError(undefined);
    expect(result.code).toBe("unknown");
    expect(result.retryable).toBe(false);
  });
});
