import { describe, expect, it } from "vitest";

import {
  formatPhoneForDisplay,
  normalizePhone,
  toWhatsAppRecipient,
} from "../phone";

/**
 * These cases are the real shapes that turn up in exported contact lists.
 * Every one of them must collapse to a single canonical E.164 value, because
 * the phone number is the contact identity key — if two spellings of the same
 * number normalise differently, the customer gets the campaign twice.
 */
describe("normalizePhone", () => {
  it("normalises the same Indian number written many ways", () => {
    const variants = [
      "+919876543210",
      "919876543210",
      "09876543210",
      "9876543210",
      "+91 98765 43210",
      "+91-98765-43210",
      "  +91 (98765) 43210  ",
      "0091 9876543210",
    ];

    for (const input of variants) {
      const result = normalizePhone(input);
      expect(result.ok, `expected "${input}" to be valid`).toBe(true);
      if (result.ok) expect(result.e164).toBe("+919876543210");
    }
  });

  it("returns the detected country", () => {
    const result = normalizePhone("+919876543210");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.country).toBe("IN");
  });

  it("respects an explicit country code over the default region", () => {
    const uk = normalizePhone("+442071838750");
    expect(uk.ok).toBe(true);
    if (uk.ok) {
      expect(uk.e164).toBe("+442071838750");
      expect(uk.country).toBe("GB");
    }
  });

  it("rejects empty and blank input", () => {
    for (const input of ["", "   ", null, undefined]) {
      const result = normalizePhone(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("empty");
    }
  });

  it("rejects numbers Excel mangled into scientific notation", () => {
    const result = normalizePhone("9.19877E+11");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_a_number");
      // The message must tell a non-technical user how to fix it.
      expect(result.message).toMatch(/format the phone column as text/i);
    }
  });

  it("rejects text and obviously wrong values", () => {
    for (const input of ["not a phone", "abcdefghij", "+91-ABCD-EFGH"]) {
      const result = normalizePhone(input);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects too-short and too-long numbers", () => {
    expect(normalizePhone("12345").ok).toBe(false);
    expect(normalizePhone("+9198765432109876543210").ok).toBe(false);
  });

  it("gives every failure a human-readable message", () => {
    const failures = ["", "abc", "12345", "9.19877E+11"];
    for (const input of failures) {
      const result = normalizePhone(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message.length).toBeGreaterThan(10);
        // No error codes or library jargon in user-facing text.
        expect(result.message).not.toMatch(/TOO_SHORT|NOT_A_NUMBER|undefined/);
      }
    }
  });
});

describe("formatPhoneForDisplay", () => {
  it("formats E.164 for humans", () => {
    expect(formatPhoneForDisplay("+919876543210")).toBe("+91 98765 43210");
  });

  it("falls back to the raw value rather than throwing", () => {
    expect(formatPhoneForDisplay("garbage")).toBe("garbage");
  });
});

describe("toWhatsAppRecipient", () => {
  it("strips the leading + that Meta's API does not want", () => {
    expect(toWhatsAppRecipient("+919876543210")).toBe("919876543210");
  });

  it("leaves an already-bare number alone", () => {
    expect(toWhatsAppRecipient("919876543210")).toBe("919876543210");
  });
});
