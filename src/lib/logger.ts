import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import pino from "pino";

import { env } from "./env";

/**
 * Where production logs are written.
 *
 * Pino writes to standard output, and the app runs as a SYSTEM scheduled task
 * whose standard output Windows discards. So in production there was no record
 * of anything, anywhere — when something broke overnight the only evidence was
 * whatever a customer happened to mention. That is the wrong position to be in
 * for a system meant to run unattended for months.
 */
function productionDestination() {
  const dir = join(process.cwd(), "logs");

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // One file per day, so it can be pruned and so "what happened on Tuesday"
    // is answerable without reading a year of lines.
    const day = new Date().toISOString().slice(0, 10);

    return pino.destination({
      dest: join(dir, `uncanned-${day}.log`),
      // Synchronous on purpose. Buffered writes lose whatever is still in the
      // buffer when a process dies — which is exactly the last few lines
      // before a crash, the only ones anybody ever wants. This app writes a
      // handful of lines a minute, so the throughput that buys is worth
      // nothing and the lines it costs are worth everything.
      sync: true,
      mkdir: true,
    });
  } catch {
    // A read-only disk or a permissions problem must not stop the app
    // starting. Losing logs is bad; refusing to run is worse.
    return undefined;
  }
}

/**
 * Structured logging with mandatory secret redaction.
 *
 * The redaction list is not optional hygiene — an access token in a log
 * aggregator is a leaked token. Paths are enumerated explicitly because Pino's
 * redaction works on known paths, so anywhere a secret can appear must be
 * listed here.
 */
const destination =
  env.NODE_ENV === "production" ? productionDestination() : undefined;

export const logger = pino(
  {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "access_token",
      "secret",
      "authorization",
      "Authorization",
      "headers.authorization",
      "headers.Authorization",
      "req.headers.authorization",
      "config.headers.Authorization",
      "*.password",
      "*.accessToken",
      "*.access_token",
      "*.token",
      "*.secret",
    ],
      censor: "[REDACTED]",
    },
    ...(env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
  },
  // Undefined in development and whenever the file could not be opened, which
  // leaves Pino writing to stdout exactly as before.
  destination,
);

/**
 * Masks a phone number for logging: +919876543210 -> +9198****3210
 *
 * Full numbers stay in the database; logs get enough to correlate a support
 * report without accumulating customer PII in log storage.
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return "****";
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}

/** Child logger tagged with a subsystem name, e.g. logger.child({ module }) */
export function moduleLogger(module: string) {
  return logger.child({ module });
}
