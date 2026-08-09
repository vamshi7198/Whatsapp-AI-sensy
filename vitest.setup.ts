import "dotenv/config";

/**
 * Test environment defaults.
 *
 * Modules such as the logger and provider read validated env at import time.
 * These fallbacks let unit tests run without a populated .env — for example in
 * CI — while a real .env still takes precedence.
 *
 * DATABASE_URL is only present to satisfy validation; unit tests do not touch
 * the database.
 */
// NODE_ENV is typed read-only; Vitest already sets it to "test".
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.AUTH_SECRET ??= "test-auth-secret-at-least-32-characters-long";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString("base64");
