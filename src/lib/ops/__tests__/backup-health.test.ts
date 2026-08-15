import { describe, expect, it } from "vitest";

import { BACKUP_STALE_HOURS, assessBackup } from "../backup-health";

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0); // 2026-08-15T12:00:00Z

/** A timestamp `hours` before NOW. */
function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3_600_000).toISOString();
}

describe("assessBackup", () => {
  it("is happy with a backup from last night", () => {
    expect(
      assessBackup({ offsiteAt: hoursAgo(10), anyAt: hoursAgo(10), now: NOW }),
    ).toEqual({ label: "ok", healthy: true });
  });

  /*
    The regression test for the bug this file was extracted to fix.

    The old code computed the label and stopped there without ever touching
    `healthy`, so /api/health returned {"status":"ok"} with "backup":"stale
    500h" sitting inside it. The warning log is gated on `healthy`, so that
    stayed silent too. Backups had in fact stopped two nights earlier and
    nothing anywhere said so.

    Asserting the label alone would still pass against the broken version --
    it always produced the right label. `healthy` is the whole point.
  */
  it("reports a stalled backup as UNHEALTHY, not merely labelled", () => {
    const result = assessBackup({
      offsiteAt: hoursAgo(500),
      anyAt: hoursAgo(500),
      now: NOW,
    });

    expect(result.label).toBe("stale 500h");
    expect(result.healthy).toBe(false); // the assertion that was missing
  });

  it("catches a single missed night", () => {
    // The old 48-hour threshold let two nights pass without comment.
    const result = assessBackup({
      offsiteAt: hoursAgo(34),
      anyAt: hoursAgo(34),
      now: NOW,
    });

    expect(result.healthy).toBe(false);
  });

  it("tolerates one late run without crying wolf", () => {
    expect(
      assessBackup({
        offsiteAt: hoursAgo(BACKUP_STALE_HOURS - 1),
        anyAt: hoursAgo(BACKUP_STALE_HOURS - 1),
        now: NOW,
      }).healthy,
    ).toBe(true);
  });

  describe("a local-only backup is not protection", () => {
    it("degrades when backups run but never leave the machine", () => {
      // Exactly what a SYSTEM-principal task produced: dumps written to the
      // local fallback every night, none of them ever reaching Drive. The
      // plain timestamp looks perfectly fresh.
      const result = assessBackup({
        offsiteAt: null,
        anyAt: hoursAgo(1),
        now: NOW,
      });

      expect(result.label).toBe("never sent offsite");
      expect(result.healthy).toBe(false);
    });

    it("distinguishes that from never having backed up at all", () => {
      const result = assessBackup({ offsiteAt: null, anyAt: null, now: NOW });

      expect(result.label).toBe("none taken");
      expect(result.healthy).toBe(false);
    });
  });

  it("treats an unreadable timestamp as a fault rather than a pass", () => {
    const result = assessBackup({
      offsiteAt: "not a date",
      anyAt: null,
      now: NOW,
    });

    expect(result.healthy).toBe(false);
    expect(result.label).toBe("unreadable");
  });
});
