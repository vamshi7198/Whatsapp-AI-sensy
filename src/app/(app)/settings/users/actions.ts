"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import {
  hashPassword,
  validatePasswordStrength,
} from "@/lib/auth/password";
import { getCurrentUser, revokeAllSessions } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";

export interface UserActionState {
  error?: string;
  success?: string;
  /** Shown once, immediately after creating a user. Never stored or re-shown. */
  temporaryPassword?: string;
  createdEmail?: string;
}

function toState(error: unknown): UserActionState {
  if (error instanceof ForbiddenError) {
    return { error: "You do not have permission to do that." };
  }
  return { error: "Something went wrong. Please try again." };
}

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.email("Enter a valid email address"),
  role: z.enum(["ADMIN", "MANAGER", "AGENT"]),
});

/**
 * Creates a team member with a generated password shown once.
 *
 * No email is sent: this deployment has no mail infrastructure, and adding one
 * would be a dependency and an attack surface for a three-person team. The
 * admin passes the password on directly, and the new user changes it.
 */
export async function inviteUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireApiAuth("settings:users");

    const parsed = inviteSchema.safeParse({
      name: formData.get("name"),
      email: String(formData.get("email") ?? "").toLowerCase().trim(),
      role: formData.get("role"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
    }

    const { name, email, role } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { error: "Someone with that email address already exists." };
    }

    // 24 random bytes -> 32 base64url chars, well beyond the 12-char minimum.
    const temporaryPassword = randomBytes(24).toString("base64url");

    const user = await prisma.user.create({
      data: {
        name,
        email,
        role,
        passwordHash: await hashPassword(temporaryPassword),
        isActive: true,
      },
    });

    await audit(actor, "user.create", {
      entityType: "User",
      entityId: user.id,
      // The password is never written to the audit log.
      metadata: { email, role },
    });

    revalidatePath("/settings/users");

    return {
      success: `${name} can now sign in.`,
      temporaryPassword,
      createdEmail: email,
    };
  } catch (error) {
    return toState(error);
  }
}

export async function changeUserRole(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireApiAuth("settings:users");

    const id = String(formData.get("id") ?? "");
    const role = String(formData.get("role") ?? "");

    if (!["ADMIN", "MANAGER", "AGENT"].includes(role)) {
      return { error: "Unknown role." };
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return { error: "That person no longer exists." };

    // Removing the last admin would lock everyone out of settings permanently.
    if (target.role === "ADMIN" && role !== "ADMIN") {
      const admins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true },
      });
      if (admins <= 1) {
        return {
          error:
            "This is the only administrator. Make someone else an administrator first.",
        };
      }
    }

    await prisma.user.update({
      where: { id },
      data: { role: role as "ADMIN" | "MANAGER" | "AGENT" },
    });

    // A role change must take effect immediately, not at next login.
    await revokeAllSessions(id);

    await audit(actor, "user.role_change", {
      entityType: "User",
      entityId: id,
      metadata: { from: target.role, to: role },
    });

    revalidatePath("/settings/users");
    return { success: `${target.name} is now a ${role.toLowerCase()}.` };
  } catch (error) {
    return toState(error);
  }
}

export async function setUserActive(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireApiAuth("settings:users");

    const id = String(formData.get("id") ?? "");
    const activate = formData.get("activate") === "true";

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return { error: "That person no longer exists." };

    const current = await getCurrentUser();
    if (current?.id === id && !activate) {
      return { error: "You cannot deactivate your own account." };
    }

    if (!activate && target.role === "ADMIN") {
      const admins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true },
      });
      if (admins <= 1) {
        return { error: "This is the only administrator and cannot be removed." };
      }
    }

    await prisma.user.update({
      where: { id },
      data: {
        isActive: activate,
        // Clear any lockout when reactivating.
        ...(activate ? { failedLogins: 0, lockedUntil: null } : {}),
      },
    });

    // Deactivation revokes every session immediately — this is the whole
    // reason for database sessions rather than JWTs.
    if (!activate) await revokeAllSessions(id);

    await audit(actor, activate ? "user.activate" : "user.deactivate", {
      entityType: "User",
      entityId: id,
      metadata: { email: target.email },
    });

    revalidatePath("/settings/users");
    return {
      success: activate
        ? `${target.name} can sign in again.`
        : `${target.name} has been signed out and can no longer sign in.`,
    };
  } catch (error) {
    return toState(error);
  }
}

export async function resetUserPassword(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireApiAuth("settings:users");

    const id = String(formData.get("id") ?? "");
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return { error: "That person no longer exists." };

    const temporaryPassword = randomBytes(24).toString("base64url");

    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        failedLogins: 0,
        lockedUntil: null,
      },
    });

    await revokeAllSessions(id);

    await audit(actor, "user.password_reset", {
      entityType: "User",
      entityId: id,
      metadata: { email: target.email },
    });

    revalidatePath("/settings/users");

    return {
      success: `Password reset for ${target.name}.`,
      temporaryPassword,
      createdEmail: target.email,
    };
  } catch (error) {
    return toState(error);
  }
}

const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string(),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "The two new passwords do not match",
    path: ["confirmPassword"],
  });

/** Any signed-in user can change their own password. */
export async function changeOwnPassword(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "Please sign in again." };

    const parsed = changeOwnPasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
    }

    const strengthError = validatePasswordStrength(parsed.data.newPassword);
    if (strengthError) return { error: strengthError };

    const record = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    const { verifyPassword } = await import("@/lib/auth/password");
    const valid = await verifyPassword(
      record.passwordHash,
      parsed.data.currentPassword,
    );
    if (!valid) return { error: "Your current password is not correct." };

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword) },
    });

    await audit(user, "user.password_change", {
      entityType: "User",
      entityId: user.id,
    });

    return { success: "Password changed." };
  } catch (error) {
    return toState(error);
  }
}
