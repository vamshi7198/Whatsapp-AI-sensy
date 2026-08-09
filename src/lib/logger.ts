import pino from "pino";

import { env } from "./env";

/**
 * Structured logging with mandatory secret redaction.
 *
 * The redaction list is not optional hygiene — an access token in a log
 * aggregator is a leaked token. Paths are enumerated explicitly because Pino's
 * redaction works on known paths, so anywhere a secret can appear must be
 * listed here.
 */
export const logger = pino({
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
});

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
