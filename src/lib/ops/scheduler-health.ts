/**
 * Decides whether the background scheduler looks dead.
 *
 * A pure function taking `now`, so the component that renders the banner does
 * not call Date.now() during render — and so this can be tested without a
 * clock, a database or a server.
 *
 * The scheduler stopping is the failure that hides completely: every page keeps
 * loading perfectly while scheduled campaigns never send, journey waits never
 * resume, and stored webhooks are never recovered.
 */

/** The task runs every 5 minutes; 20 allows three misses before saying so. */
export const SCHEDULER_STALE_MINUTES = 20;

export interface SchedulerAssessment {
  stale: boolean;
  /** Null when it has never run at all. */
  minutesAgo: number | null;
}

/**
 * Reads the heartbeat and judges it.
 *
 * The clock lives here rather than in the component that renders the banner:
 * Date.now() in a render body is impure, and keeping it out means the decision
 * above stays a pure function of its inputs.
 */
export async function getSchedulerState(
  read: () => Promise<string | null>,
): Promise<SchedulerAssessment | null> {
  try {
    return assessScheduler(await read(), Date.now());
  } catch {
    // A banner must never be the thing that breaks the page it sits on.
    return null;
  }
}

export function assessScheduler(
  lastRun: string | null,
  now: number,
): SchedulerAssessment {
  // Never having run is a real state, not a missing reading: it is what a
  // fresh install looks like when the scheduled task was never registered.
  if (!lastRun) return { stale: true, minutesAgo: null };

  const at = new Date(lastRun).getTime();

  if (Number.isNaN(at)) return { stale: true, minutesAgo: null };

  const minutesAgo = Math.round((now - at) / 60_000);

  return { stale: minutesAgo > SCHEDULER_STALE_MINUTES, minutesAgo };
}
