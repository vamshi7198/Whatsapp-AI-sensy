/**
 * Decides what the health endpoint should say about backups.
 *
 * Pulled out of the route so it can be tested without a database or a running
 * server. The logic it replaced was wrong in a way that unit tests would have
 * caught immediately: it set the label and never set `healthy`, so the endpoint
 * returned {"status":"ok"} with "backup":"stale 500h" inside it, and the
 * warning log — gated on `healthy` — never fired either. Backups stopped for
 * two nights and both signals stayed quiet.
 */

/**
 * Backups run daily at 02:30, so 30 hours allows one late or slow run without
 * crying wolf while still catching a single missed night.
 */
export const BACKUP_STALE_HOURS = 30;

export interface BackupAssessment {
  /** Shown as checks.backup. */
  label: string;
  /** False drags the whole endpoint to "degraded". */
  healthy: boolean;
}

export function assessBackup(input: {
  /** When a backup last reached Drive. */
  offsiteAt: string | null;
  /** When a backup last succeeded anywhere, including the local fallback. */
  anyAt: string | null;
  now: number;
}): BackupAssessment {
  // Judged on the offsite timestamp alone. A copy sitting on the same disk as
  // the database survives nothing that actually happens to a laptop — theft, a
  // dead drive, ransomware — so a local-only run is a warning, not a success.
  if (!input.offsiteAt) {
    return {
      label: input.anyAt ? "never sent offsite" : "none taken",
      healthy: false,
    };
  }

  const at = new Date(input.offsiteAt).getTime();

  // An unparseable timestamp is a fault, not an absence. Treating it as "fine"
  // is the same mistake this function exists to correct.
  if (Number.isNaN(at)) return { label: "unreadable", healthy: false };

  const hours = Math.round((input.now - at) / 3_600_000);

  if (hours > BACKUP_STALE_HOURS) {
    return { label: `stale ${hours}h`, healthy: false };
  }

  return { label: "ok", healthy: true };
}
