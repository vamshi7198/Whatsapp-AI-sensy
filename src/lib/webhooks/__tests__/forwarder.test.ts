import { describe, expect, it } from "vitest";

import { isSafeForwardUrl } from "../forwarder";

/**
 * The forwarding destination is set by an administrator, not by a customer, so
 * this is defence in depth rather than the primary control. But a mistyped or
 * malicious address should not turn our webhook endpoint into a way of probing
 * whatever else runs on this machine or network.
 */
describe("isSafeForwardUrl", () => {
  it("accepts a genuine external https address", () => {
    expect(
      isSafeForwardUrl(
        "https://script.google.com/macros/s/AKfycbx743/exec",
      ),
    ).toBe(true);
    expect(isSafeForwardUrl("https://hooks.zapier.com/hooks/catch/123/abc")).toBe(
      true,
    );
  });

  it("rejects plain http", () => {
    // Forwarded payloads carry customer messages; sending them unencrypted
    // across the internet is not acceptable.
    expect(isSafeForwardUrl("http://example.com/hook")).toBe(false);
  });

  it("rejects loopback addresses", () => {
    expect(isSafeForwardUrl("https://localhost/hook")).toBe(false);
    expect(isSafeForwardUrl("https://127.0.0.1/hook")).toBe(false);
    expect(isSafeForwardUrl("https://127.0.0.1:3000/api")).toBe(false);
  });

  it("rejects private network ranges", () => {
    expect(isSafeForwardUrl("https://10.0.0.5/hook")).toBe(false);
    expect(isSafeForwardUrl("https://192.168.1.1/hook")).toBe(false);
    expect(isSafeForwardUrl("https://172.16.0.1/hook")).toBe(false);
    expect(isSafeForwardUrl("https://172.31.255.254/hook")).toBe(false);
    // Cloud metadata endpoints live on the link-local range.
    expect(isSafeForwardUrl("https://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
  });

  it("allows public addresses that merely look similar", () => {
    // 172.32 is outside the private 172.16–172.31 block.
    expect(isSafeForwardUrl("https://172.32.0.1/hook")).toBe(true);
    expect(isSafeForwardUrl("https://11.0.0.1/hook")).toBe(true);
  });

  it("rejects internal hostname suffixes", () => {
    expect(isSafeForwardUrl("https://api.internal/hook")).toBe(false);
    expect(isSafeForwardUrl("https://printer.local/hook")).toBe(false);
  });

  it("rejects anything that is not a URL", () => {
    expect(isSafeForwardUrl("")).toBe(false);
    expect(isSafeForwardUrl("not a url")).toBe(false);
    expect(isSafeForwardUrl("script.google.com/exec")).toBe(false);
    expect(isSafeForwardUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeForwardUrl("file:///etc/passwd")).toBe(false);
  });
});
