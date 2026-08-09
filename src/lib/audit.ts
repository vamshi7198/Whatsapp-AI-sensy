import { headers } from "next/headers";

import type { SessionUser } from "./auth/session";
import { prisma } from "./db";
import { moduleLogger } from "./logger";

const log = moduleLogger("audit");

/**
 * Append-only audit trail for sensitive actions.
 *
 * Deliberately never throws: an audit write failing must not roll back the
 * user's actual work. It logs loudly instead, so the gap is visible.
 */
export async function audit(
  actor: SessionUser | null,
  action: string,
  details: {
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    const headerList = await headers();

    await prisma.auditLog.create({
      data: {
        actorUserId: actor?.id,
        actorEmail: actor?.email,
        action,
        entityType: details.entityType,
        entityId: details.entityId,
        metadata: details.metadata as never,
        ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim(),
        userAgent: headerList.get("user-agent") ?? undefined,
      },
    });
  } catch (error) {
    log.error(
      { action, err: error instanceof Error ? error.message : error },
      "Failed to write audit log",
    );
  }
}
