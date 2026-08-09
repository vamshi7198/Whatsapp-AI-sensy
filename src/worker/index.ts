import "dotenv/config";

import { Worker } from "bullmq";

import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { moduleLogger } from "../lib/logger";
import { createRedisConnection, QUEUE_NAMES } from "../lib/queue/connection";

/**
 * Campaign sending worker.
 *
 * This runs as a separate long-lived process, not inside a request handler.
 * Sending a campaign takes minutes; a request handler would time out and leave
 * a half-sent campaign with no record of where it stopped.
 *
 * Phase 0 establishes the process, connection handling and shutdown semantics.
 * Job processors arrive in Phase 1c (sending) and 1d (webhooks).
 */

const log = moduleLogger("worker");
const connection = createRedisConnection();
const workers: Worker[] = [];

function registerPlaceholder(name: string, concurrency: number) {
  const worker = new Worker(
    name,
    async (job) => {
      // Phase 1 replaces this. Until then a job must not be silently
      // swallowed — failing loudly is what surfaces a misconfiguration.
      log.warn(
        { queue: name, jobId: job.id },
        "Received a job but no processor is implemented yet",
      );
      throw new Error(`No processor implemented for queue "${name}"`);
    },
    { connection, concurrency },
  );

  worker.on("failed", (job, err) => {
    log.error({ queue: name, jobId: job?.id, err: err.message }, "Job failed");
  });

  worker.on("error", (err) => {
    log.error({ queue: name, err: err.message }, "Worker error");
  });

  workers.push(worker);
  return worker;
}

async function main() {
  log.info(
    {
      redis: env.REDIS_URL.replace(/\/\/.*@/, "//****@"),
      sendRateMps: env.SEND_RATE_LIMIT_MPS,
    },
    "Worker starting",
  );

  // Fail fast if the datastores are unreachable, rather than accepting jobs we
  // cannot possibly complete.
  await prisma.$queryRaw`SELECT 1`;
  log.info("Database connection OK");

  await connection.ping();
  log.info("Redis connection OK");

  registerPlaceholder(QUEUE_NAMES.CAMPAIGN_EXPAND, 1);
  registerPlaceholder(QUEUE_NAMES.MESSAGE_SEND, 10);
  registerPlaceholder(QUEUE_NAMES.WEBHOOK_PROCESS, 5);
  registerPlaceholder(QUEUE_NAMES.MAINTENANCE, 1);

  log.info(
    { queues: Object.values(QUEUE_NAMES) },
    "Worker ready — awaiting jobs",
  );
}

/**
 * Graceful shutdown: stop accepting new jobs, let in-flight sends finish, then
 * close connections. Killing a worker mid-send is what creates ambiguous
 * "did Meta accept this?" states.
 */
async function shutdown(signal: string) {
  log.info({ signal }, "Shutting down");
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log.fatal({ reason }, "Unhandled rejection — exiting for supervisor restart");
  process.exit(1);
});

main().catch((error) => {
  log.fatal({ err: error instanceof Error ? error.message : error }, "Worker failed to start");
  process.exit(1);
});
