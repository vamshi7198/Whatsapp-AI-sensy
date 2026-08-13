import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { SETTING_KEYS, getSetting, isMetaConnected } from "@/lib/settings";

const log = moduleLogger("health");

/**
 * Is this thing working?
 *
 * Deliberately public and unauthenticated, because its whole purpose is to be
 * polled by an outside uptime monitor that has no login. That constrains what
 * it may say: no counts of customers, no names, no numbers, no configuration.
 * Only whether each moving part is alive, in words that mean nothing to a
 * stranger and everything to whoever gets the alert.
 *
 * The interesting check is not "did this respond" — a reply proves only that
 * Next.js is up. It is whether the SCHEDULER has run recently, because that is
 * the part that quietly stops and takes scheduled campaigns and journey waits
 * with it, while every page keeps loading perfectly.
 */

/** Longer than the 5-minute schedule, so one slow run is not an alarm. */
const SCHEDULER_STALE_MINUTES = 20;

export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  /* --- Database --------------------------------------------------------- */

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "unreachable";
    healthy = false;

    // Nothing else can be checked without it, and the response should not
    // hang while each dependent query times out in turn.
    return NextResponse.json(
      { status: "down", checks },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  /* --- The scheduler ---------------------------------------------------- */

  try {
    const lastRun = await getSetting(SETTING_KEYS.SCHEDULER_LAST_RUN);

    if (!lastRun) {
      checks.scheduler = "never run";
      healthy = false;
    } else {
      const minutes = Math.round(
        (Date.now() - new Date(lastRun).getTime()) / 60_000,
      );

      if (minutes > SCHEDULER_STALE_MINUTES) {
        checks.scheduler = `stalled ${minutes}m`;
        healthy = false;
      } else {
        checks.scheduler = "ok";
      }
    }
  } catch {
    checks.scheduler = "unknown";
  }

  /* --- Work that has piled up ------------------------------------------- */

  try {
    const [unprocessed, stuck] = await Promise.all([
      prisma.webhookEvent.count({
        where: { status: { in: ["RECEIVED", "PROCESSING"] } },
      }),
      prisma.campaign.count({ where: { status: "RUNNING" } }),
    ]);

    // A handful mid-flight is normal. A backlog means something has stopped
    // draining it.
    checks.messageQueue = unprocessed > 50 ? `backlog ${unprocessed}` : "ok";
    if (unprocessed > 50) healthy = false;

    checks.campaigns = stuck > 5 ? `${stuck} running` : "ok";
  } catch {
    checks.messageQueue = "unknown";
  }

  /* --- WhatsApp --------------------------------------------------------- */

  try {
    // isMetaConnected reports presence without ever decrypting the token.
    // Nothing here may return the value, a prefix of it, or even its length.
    const connected = await isMetaConnected();
    checks.whatsapp = connected ? "configured" : "not configured";
    if (!connected) healthy = false;
  } catch {
    checks.whatsapp = "unknown";
  }

  /* --- Backups ---------------------------------------------------------- */

  try {
    const lastBackup = await getSetting(SETTING_KEYS.LAST_BACKUP_AT);

    if (!lastBackup) {
      checks.backup = "unknown";
    } else {
      const hours = Math.round(
        (Date.now() - new Date(lastBackup).getTime()) / 3_600_000,
      );
      // Daily schedule, so two days without one means it has stopped.
      checks.backup = hours > 48 ? `stale ${hours}h` : "ok";
    }
  } catch {
    checks.backup = "unknown";
  }

  if (!healthy) {
    log.warn({ checks }, "Health check reported a problem");
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    {
      // 200 even when degraded: a monitor watching for a non-200 would page on
      // a stalled scheduler as loudly as on a dead site, and they are not the
      // same emergency. The body carries the detail.
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
