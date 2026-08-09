import { describe, expect, it } from "vitest";

import { getServiceWindow, SERVICE_WINDOW_MS } from "../service";

/**
 * The 24-hour customer service window decides whether your team can type a
 * normal reply or must fall back to a paid template. Getting it wrong either
 * blocks legitimate replies or lets through sends Meta will reject.
 */
describe("getServiceWindow", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it("is closed when the customer has never messaged", () => {
    const window = getServiceWindow(null, now);
    expect(window.open).toBe(false);
    expect(window.expiresAt).toBeNull();
  });

  it("is open just after an inbound message, with ~24h left", () => {
    const window = getServiceWindow(new Date(now.getTime() - 60_000), now);
    expect(window.open).toBe(true);
    expect(window.hoursLeft).toBe(23);
    expect(window.minutesLeft).toBe(59);
  });

  it("reports the remaining time part-way through", () => {
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const window = getServiceWindow(fiveHoursAgo, now);

    expect(window.open).toBe(true);
    expect(window.hoursLeft).toBe(19);
  });

  it("is closed at exactly 24 hours, not a moment later", () => {
    const exactly24h = new Date(now.getTime() - SERVICE_WINDOW_MS);
    expect(getServiceWindow(exactly24h, now).open).toBe(false);

    const justInside = new Date(now.getTime() - SERVICE_WINDOW_MS + 1000);
    expect(getServiceWindow(justInside, now).open).toBe(true);
  });

  it("is closed well past the window", () => {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const window = getServiceWindow(threeDaysAgo, now);

    expect(window.open).toBe(false);
    expect(window.hoursLeft).toBe(0);
    // The expiry is still reported so the UI can say when it lapsed.
    expect(window.expiresAt).not.toBeNull();
  });

  it("expires exactly 24 hours after the last inbound message", () => {
    const inbound = new Date("2026-08-09T09:30:00Z");
    const window = getServiceWindow(inbound, now);

    expect(window.expiresAt?.toISOString()).toBe("2026-08-10T09:30:00.000Z");
  });
});
