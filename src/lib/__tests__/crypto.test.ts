import { beforeAll, describe, expect, it } from "vitest";

/**
 * crypto.ts reads env at import time, so the environment must be populated
 * before the dynamic import below.
 */
let encryptSecret: typeof import("../crypto").encryptSecret;
let decryptSecret: typeof import("../crypto").decryptSecret;
let maskSecret: typeof import("../crypto").maskSecret;
let safeEquals: typeof import("../crypto").safeEquals;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.AUTH_SECRET ??= "a".repeat(48);
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

  const mod = await import("../crypto");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  maskSecret = mod.maskSecret;
  safeEquals = mod.safeEquals;
});

describe("secret encryption", () => {
  it("round-trips a value", () => {
    const token = "EAAG1234567890abcdefXYZ";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a.equals(b)).toBe(false);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("rejects tampered ciphertext rather than returning garbage", () => {
    const encrypted = encryptSecret("sensitive-token");
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("rejects a truncated payload", () => {
    expect(() => decryptSecret(Buffer.alloc(4))).toThrow(/malformed|truncated/i);
  });

  it("handles unicode", () => {
    const value = "पासवर्ड-🔐-token";
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });
});

describe("maskSecret", () => {
  it("reveals only the last four characters", () => {
    expect(maskSecret("EAAG1234567890abcdefXYZ9")).toBe("****XYZ9");
  });

  it("reveals nothing for very short values", () => {
    expect(maskSecret("abc")).toBe("****");
  });
});

describe("safeEquals", () => {
  it("matches identical strings", () => {
    expect(safeEquals("verify-token-123", "verify-token-123")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEquals("verify-token-123", "verify-token-124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEquals("short", "much-longer-value")).toBe(false);
  });
});
