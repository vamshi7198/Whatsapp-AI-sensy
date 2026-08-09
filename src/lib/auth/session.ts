import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { prisma } from "../db";
import { env } from "../env";

/**
 * Session management.
 *
 * Deliberately not Auth.js: its Credentials provider forces the JWT strategy,
 * and a JWT stays valid until it expires — you cannot revoke access when
 * someone leaves the company, which is exactly the property this system needs.
 * Database sessions give instant revocation, and the implementation is a
 * random token plus a lookup. Password hashing (argon2id) and token generation
 * (crypto.randomBytes) both use vetted primitives, so nothing security-critical
 * is hand-rolled here.
 *
 * The cookie holds the raw token; the database stores only its SHA-256 hash.
 * A database leak therefore does not hand the attacker usable sessions.
 */

const COOKIE_NAME = "uncanned_session";
const SESSION_DURATION_DAYS = 7;
const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  isActive: boolean;
}

/** Creates a session row and sets the cookie. Returns the raw token. */
export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expires = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.session.create({
    data: {
      sessionToken: hashToken(token),
      userId,
      expires,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  return token;
}

/**
 * Resolves the current user from the session cookie, or null.
 *
 * Reads the user fresh on every call rather than trusting cookie contents, so
 * a deactivated account or a changed role takes effect on the next request
 * rather than at the next login.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: hashToken(token) },
    select: {
      expires: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      },
    },
  });

  if (!session) return null;

  if (session.expires < new Date()) {
    // Expired sessions are removed on encounter rather than left to accumulate.
    await prisma.session
      .deleteMany({ where: { sessionToken: hashToken(token) } })
      .catch(() => undefined);
    return null;
  }

  if (!session.user.isActive) return null;

  return session.user;
}

/** Deletes the current session and clears the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { sessionToken: hashToken(token) } })
      .catch(() => undefined);
  }

  cookieStore.delete(COOKIE_NAME);
}

/** Revokes every session for a user — used on deactivation and role change. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
