import { Redis } from "ioredis";

import { env } from "../env";

/**
 * Shared Redis connection for BullMQ.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ — with a retry limit,
 * blocking commands used by workers get terminated and jobs silently stop
 * being processed. A half-dead worker that accepts jobs and never runs them is
 * worse than a crash, because nothing alerts you.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/** Queue names, centralised so producers and consumers cannot drift apart. */
export const QUEUE_NAMES = {
  /** Resolve a campaign audience into frozen recipient rows. */
  CAMPAIGN_EXPAND: "campaign-expand",
  /** Send one message to one recipient via the WhatsApp provider. */
  MESSAGE_SEND: "message-send",
  /** Process a stored webhook event (status updates, inbound messages). */
  WEBHOOK_PROCESS: "webhook-process",
  /** Scheduled maintenance: template sync, webhook pruning, scheduled campaigns. */
  MAINTENANCE: "maintenance",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
