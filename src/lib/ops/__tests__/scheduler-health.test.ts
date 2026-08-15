import { describe, expect, it } from "vitest";

import {
  SCHEDULER_STALE_MINUTES,
  assessScheduler,
} from "../scheduler-health";

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("assessScheduler", () => {
  it("is quiet when a pass ran recently", () => {
    expect(assessScheduler(minutesAgo(4), NOW)).toEqual({
      stale: false,
      minutesAgo: 4,
    });
  });

  it("tolerates a couple of missed passes", () => {
    // Runs every 5 minutes, so a single slow or skipped pass must not raise a
    // banner the owner then learns to ignore.
    expect(assessScheduler(minutesAgo(SCHEDULER_STALE_MINUTES), NOW).stale).toBe(
      false,
    );
  });

  it("reports a scheduler that has stopped", () => {
    const result = assessScheduler(minutesAgo(90), NOW);

    expect(result.stale).toBe(true);
    expect(result.minutesAgo).toBe(90);
  });

  it("treats never having run as stale, not as unknown", () => {
    // What a fresh install looks like when the scheduled task was never
    // registered — the case most worth saying out loud.
    expect(assessScheduler(null, NOW)).toEqual({ stale: true, minutesAgo: null });
  });

  it("treats an unreadable timestamp as stale rather than fine", () => {
    expect(assessScheduler("not a date", NOW).stale).toBe(true);
  });
});
