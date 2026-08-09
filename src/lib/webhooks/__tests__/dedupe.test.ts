import { describe, expect, it } from "vitest";

import type { NormalisedWebhookEvent } from "../../whatsapp/types";
import { buildDedupeKey } from "../processor";

/**
 * Meta retries any webhook it considers unacknowledged, so the same event
 * arrives repeatedly. The dedupe key is what stops a retry double-counting a
 * delivery or duplicating an inbound message in the inbox.
 */

function status(
  overrides: Partial<Extract<NormalisedWebhookEvent, { kind: "status_update" }>> = {},
): NormalisedWebhookEvent {
  return {
    kind: "status_update",
    externalMessageId: "wamid.ABC",
    recipient: "+919876543210",
    status: "delivered",
    timestamp: new Date("2026-08-09T12:00:00Z"),
    raw: {},
    ...overrides,
  };
}

describe("buildDedupeKey", () => {
  it("produces the same key for a replayed event", () => {
    expect(buildDedupeKey(status())).toBe(buildDedupeKey(status()));
  });

  it("distinguishes each status of the same message", () => {
    // sent -> delivered -> read all share a wamid but must each be recorded.
    const keys = new Set([
      buildDedupeKey(status({ status: "sent" })),
      buildDedupeKey(status({ status: "delivered" })),
      buildDedupeKey(status({ status: "read" })),
    ]);

    expect(keys.size).toBe(3);
  });

  it("distinguishes different messages", () => {
    expect(buildDedupeKey(status({ externalMessageId: "wamid.A" }))).not.toBe(
      buildDedupeKey(status({ externalMessageId: "wamid.B" })),
    );
  });

  it("distinguishes the same status at a different time", () => {
    expect(
      buildDedupeKey(status({ timestamp: new Date("2026-08-09T12:00:00Z") })),
    ).not.toBe(
      buildDedupeKey(status({ timestamp: new Date("2026-08-09T12:00:01Z") })),
    );
  });

  it("keys an inbound message on its id alone", () => {
    // The same message redelivered must collapse to one inbox entry even if
    // surrounding metadata differs.
    const base: NormalisedWebhookEvent = {
      kind: "inbound_message",
      externalMessageId: "wamid.IN",
      from: "+919876543210",
      type: "text",
      text: "Hello",
      timestamp: new Date("2026-08-09T12:00:00Z"),
      raw: {},
    };

    const redelivered: NormalisedWebhookEvent = {
      ...base,
      contactName: "Vamshi",
      timestamp: new Date("2026-08-09T12:00:30Z"),
      raw: { different: true },
    };

    expect(buildDedupeKey(base)).toBe(buildDedupeKey(redelivered));
  });

  it("keys template status on name, language and status", () => {
    const approved: NormalisedWebhookEvent = {
      kind: "template_status",
      templateName: "shipping_update",
      language: "en",
      status: "APPROVED",
      raw: {},
    };

    expect(buildDedupeKey(approved)).toBe(buildDedupeKey({ ...approved }));
    expect(buildDedupeKey(approved)).not.toBe(
      buildDedupeKey({ ...approved, status: "REJECTED" }),
    );
  });

  it("returns a stable hex digest", () => {
    const key = buildDedupeKey(status());
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});
