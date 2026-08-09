"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("auth");

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export interface LoginState {
  error?: string;
}

/**
 * Lockout policy: after this many consecutive failures the account is locked
 * for a growing interval. Slows credential stuffing without letting an
 * attacker lock a colleague out indefinitely.
 */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const { email, password } = parsed.data;

  // One message for every failure mode. Distinguishing "no such user" from
  // "wrong password" tells an attacker which emails are valid accounts.
  const genericError = { error: "Email or password is incorrect." };

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user || !user.isActive) {
    // Still hash-compare against nothing to keep timing roughly uniform.
    await new Promise((r) => setTimeout(r, 200));
    log.warn({ email }, "Login failed: unknown or inactive account");
    return genericError;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60_000,
    );
    return {
      error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    const failedLogins = user.failedLogins + 1;
    const shouldLock = failedLogins >= MAX_FAILED_LOGINS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null,
      },
    });

    log.warn({ userId: user.id, failedLogins }, "Login failed: bad password");
    return genericError;
  }

  const headerList = await headers();

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await createSession(user.id, {
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: headerList.get("user-agent") ?? undefined,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      actorEmail: user.email,
      action: "auth.login",
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: headerList.get("user-agent") ?? undefined,
    },
  });

  log.info({ userId: user.id }, "Login succeeded");
  redirect("/");
}
