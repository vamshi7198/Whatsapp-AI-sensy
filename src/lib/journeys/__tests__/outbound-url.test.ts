import { describe, expect, it } from "vitest";

import { checkOutboundUrl, renderUrl } from "../outbound-url";

/*
  The journey webhook step makes the SERVER fetch an address. That server sits
  beside PostgreSQL and the application itself, so an address pointing back at
  the machine reaches things no customer should touch, from inside the trust
  boundary.

  These are the addresses that must never be fetched.
*/

describe("checkOutboundUrl — refuses", () => {
  it("anything pointing at this machine", () => {
    for (const url of [
      "https://localhost/hook",
      "https://localhost:5432/",
      "https://127.0.0.1/hook",
      "https://127.0.0.1:3000/api/health",
      "https://0.0.0.0/",
      "https://[::1]/hook",
    ]) {
      expect(checkOutboundUrl(url).ok, url).toBe(false);
    }
  });

  it("private networks", () => {
    for (const url of [
      "https://10.0.0.5/hook",
      "https://192.168.1.1/hook",
      "https://172.16.0.1/hook",
      "https://172.31.255.254/hook",
    ]) {
      expect(checkOutboundUrl(url).ok, url).toBe(false);
    }
  });

  it("cloud metadata, which matters the day this moves to a server", () => {
    expect(checkOutboundUrl("https://169.254.169.254/latest/meta-data/").ok).toBe(
      false,
    );
    expect(checkOutboundUrl("https://metadata.google.internal/").ok).toBe(false);
  });

  it("internal hostnames", () => {
    expect(checkOutboundUrl("https://db.internal/hook").ok).toBe(false);
    expect(checkOutboundUrl("https://printer.local/hook").ok).toBe(false);
  });

  it("anything not encrypted", () => {
    expect(checkOutboundUrl("http://example.com/hook").ok).toBe(false);
    expect(checkOutboundUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkOutboundUrl("ftp://example.com/").ok).toBe(false);
  });

  it("credentials embedded in the address", () => {
    expect(checkOutboundUrl("https://user:pass@example.com/hook").ok).toBe(false);
  });

  it("nonsense", () => {
    expect(checkOutboundUrl("not a url").ok).toBe(false);
    expect(checkOutboundUrl("").ok).toBe(false);
  });
});

describe("checkOutboundUrl — allows", () => {
  it("ordinary public addresses", () => {
    for (const url of [
      "https://example.com/hook",
      "https://uncanned.in/api/order",
      "https://hooks.zapier.com/abc/123?x=1",
      "https://8.8.8.8/hook",
    ]) {
      expect(checkOutboundUrl(url).ok, url).toBe(true);
    }
  });
});

describe("renderUrl", () => {
  /*
    Values come from what a CUSTOMER typed. Substituted raw, an answer
    containing "?" or "#" silently changes the query or truncates the path, and
    one containing "@" can change the host in some parsers.
  */
  it("encodes a value so it cannot alter the address", () => {
    const out = renderUrl("https://example.com/o?q={{answer}}", {
      answer: "a&b=c#d /e?f",
    });

    expect(out).toBe("https://example.com/o?q=a%26b%3Dc%23d%20%2Fe%3Ff");
    expect(checkOutboundUrl(out).ok).toBe(true);
  });

  it("cannot be used to redirect the request elsewhere", () => {
    const out = renderUrl("https://example.com/{{answer}}", {
      answer: "@evil.example.com/",
    });

    // The host must still be example.com, whatever was typed.
    expect(new URL(out).hostname).toBe("example.com");
  });

  it("drops a missing value rather than leaving braces in the address", () => {
    expect(renderUrl("https://example.com/{{nope}}", {})).toBe(
      "https://example.com/",
    );
  });
});
