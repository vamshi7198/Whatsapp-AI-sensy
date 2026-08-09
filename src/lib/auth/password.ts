import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id password hashing.
 *
 * @node-rs/argon2 ships prebuilt native binaries, so there is no node-gyp /
 * Visual Studio build step on Windows — relevant because this project is
 * developed on Windows and deployed on Linux.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * Argon2id: 19 MiB memory, 2 iterations, parallelism 1.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext, ARGON2_OPTIONS);
  } catch {
    // A malformed or truncated hash must read as "wrong password", never as an
    // error the caller might mistake for success.
    return false;
  }
}

/** Minimum policy: 12 characters. No forced rotation — rotation policies
 * demonstrably produce weaker passwords. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * A small deny-list of passwords that pass a length check but are trivially
 * guessed. Not a substitute for a breach-corpus check, which is a Phase 2
 * addition if wanted.
 */
const COMMON_PASSWORDS = new Set([
  "password1234",
  "passwordpassword",
  "123456789012",
  "qwertyuiop12",
  "adminadmin12",
  "welcome12345",
  "letmein12345",
  "uncanned1234",
]);

export function validatePasswordStrength(plaintext: string): string | null {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.has(plaintext.toLowerCase())) {
    return "That password is too easy to guess. Please choose another.";
  }
  return null;
}
