import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * Shared by the Next.js server and the BullMQ worker, so this module must stay
 * importable from plain Node — which rules out the `server-only` package.
 * The window guard below is the equivalent protection: if this module ever
 * reaches a client bundle, it fails loudly at import rather than quietly
 * shipping secrets to the browser.
 *
 * No variable here is ever prefixed NEXT_PUBLIC_.
 *
 * Note what is deliberately absent: WABA ID, Phone Number ID, API version and
 * the Meta access token. Those are managed in Settings by an ADMIN and stored
 * encrypted, so rotating credentials needs no redeploy.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/env.ts was imported from client-side code. " +
      "This module holds server secrets and must never reach the browser.",
  );
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  APP_URL: z.url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

  // Base64-encoded 32-byte key for AES-256-GCM. Losing it makes the stored
  // Meta token unrecoverable, so it must be backed up separately.
  APP_ENCRYPTION_KEY: z
    .string()
    .min(1, "APP_ENCRYPTION_KEY is required")
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)",
    ),

  // Optional at boot so the app runs before Meta is connected. The webhook
  // route refuses to process anything when META_APP_SECRET is absent rather
  // than silently accepting unverified events.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  DEFAULT_TIMEZONE: z.string().default("Asia/Kolkata"),
  SEND_RATE_LIMIT_MPS: z.coerce.number().int().positive().default(20),
  LARGE_CAMPAIGN_THRESHOLD: z.coerce.number().int().positive().default(500),
  WEBHOOK_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Report every problem at once. Fixing .env one error per restart is a
    // miserable first-run experience.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();

/** True once Meta credentials exist in the environment. */
export const isMetaConfigured = Boolean(
  env.META_APP_ID && env.META_APP_SECRET && env.META_WEBHOOK_VERIFY_TOKEN,
);
