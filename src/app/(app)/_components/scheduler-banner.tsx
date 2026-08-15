import { getSchedulerState } from "@/lib/ops/scheduler-health";
import { SETTING_KEYS, getSetting } from "@/lib/settings";

/**
 * Says so, in the app, when the background scheduler has stopped.
 *
 * This is the one failure that hides completely. Every page keeps loading
 * perfectly without a scheduler, while scheduled campaigns never send, journey
 * waits never resume, and stored webhooks are never recovered. /api/health
 * knows, but it returns 200 by design and nobody was watching it — the README
 * admits the uptime monitor was never set up.
 *
 * So it goes where somebody actually looks. The owner opens this app most
 * days; they do not curl a health endpoint.
 *
 * Deliberately not dismissible. Nothing here is fixed by hiding it, and the
 * whole failure mode is that it is invisible.
 */

export async function SchedulerBanner() {
  const assessment = await getSchedulerState(() =>
    getSetting(SETTING_KEYS.SCHEDULER_LAST_RUN),
  );

  if (!assessment || !assessment.stale) return null;

  const minutes = assessment.minutesAgo;

  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
    >
      <p className="font-medium text-amber-900 dark:text-amber-200">
        {minutes === null
          ? "Background tasks have never run on this machine."
          : `Background tasks last ran ${minutes} minutes ago.`}
      </p>

      <p className="mt-1 text-amber-800 dark:text-amber-300">
        Scheduled campaigns are not being sent and journeys waiting on a timer
        are not resuming. Messages arriving from customers are still received
        and stored. To fix it, run{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900/60">
          deploy\repair.ps1
        </code>{" "}
        as administrator.
      </p>
    </div>
  );
}
