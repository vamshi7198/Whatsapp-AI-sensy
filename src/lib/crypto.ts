import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { env } from "./env";

/**
 * Envelope encryption for secrets stored in the database — currently the Meta
 * access token, which can message your entire customer base if it leaks.
 *
 * AES-256-GCM is authenticated encryption: tampering with the ciphertext fails
 * decryption rather than producing garbage plaintext.
 *
 * Stored layout: [12-byte IV][16-byte auth tag][ciphertext]
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits — the GCM standard
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = Buffer.from(env.APP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(payload: Buffer): string {
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted payload is malformed or truncated");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Last 4 characters of a secret, for confirming which credential is configured
 * without revealing it. This is the only form a secret takes in an API
 * response — the plaintext never leaves the server.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "****";
  return `****${plaintext.slice(-4)}`;
}

/**
 * Constant-time string comparison for webhook verify tokens.
 *
 * A plain `===` leaks length and prefix information through timing, which is
 * enough to recover a token given enough attempts.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  // The length itself is not the secret; the contents are.
  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}
