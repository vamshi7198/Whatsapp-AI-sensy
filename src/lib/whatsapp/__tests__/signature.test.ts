import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MetaCloudProvider } from "../providers/meta";

const APP_SECRET = "test_app_secret_value";

const config = {
  wabaId: "waba",
  phoneNumberId: "phone",
  apiVersion: "v23.0",
  accessToken: "token",
};

function sign(body: Buffer, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Webhook signature verification is the webhook endpoint's ONLY authentication
 * — it is machine-to-machine, so there is no session and no CSRF token behind
 * it. A weakness here lets anyone fabricate inbound messages, poison opt-out
 * state, or forge delivery reports.
 */
describe("verifyWebhookSignature", () => {
  const provider = new MetaCloudProvider(config, APP_SECRET);

  it("accepts a correctly signed body", () => {
    const body = Buffer.from(JSON.stringify({ entry: [{ id: "1" }] }));
    expect(provider.verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejects a body altered after signing", () => {
    const original = Buffer.from(JSON.stringify({ amount: 1 }));
    const signature = sign(original);
    const tampered = Buffer.from(JSON.stringify({ amount: 1000 }));

    expect(provider.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = Buffer.from("{}");
    expect(
      provider.verifyWebhookSignature(body, sign(body, "attacker_secret")),
    ).toBe(false);
  });

  it("rejects a missing or malformed signature header", () => {
    const body = Buffer.from("{}");
    expect(provider.verifyWebhookSignature(body, "")).toBe(false);
    expect(provider.verifyWebhookSignature(body, "abc123")).toBe(false);
    expect(provider.verifyWebhookSignature(body, "sha1=abc")).toBe(false);
    expect(
      provider.verifyWebhookSignature(body, "sha256="),
    ).toBe(false);
  });

  it("rejects a truncated signature rather than throwing", () => {
    const body = Buffer.from("{}");
    const short = sign(body).slice(0, 20);
    expect(provider.verifyWebhookSignature(body, short)).toBe(false);
  });

  it("refuses everything when no App Secret is configured", () => {
    // An unverifiable request must never be treated as authentic.
    const unconfigured = new MetaCloudProvider(config, undefined);
    const body = Buffer.from("{}");

    expect(unconfigured.verifyWebhookSignature(body, sign(body))).toBe(false);
  });

  it("is sensitive to exact bytes, including whitespace", () => {
    // Parsing and re-serialising JSON changes the bytes and breaks the
    // signature — which is why the raw body must be passed through untouched.
    const original = Buffer.from('{"a":1}');
    const reserialised = Buffer.from('{ "a": 1 }');

    expect(
      provider.verifyWebhookSignature(reserialised, sign(original)),
    ).toBe(false);
  });
});
