import { redirect } from "next/navigation";

import { can, ForbiddenError, type Permission } from "../rbac";
import { getCurrentUser, type SessionUser } from "./session";

/**
 * Guards for server components, route handlers and server actions.
 *
 * These run on the server only. Hiding a nav item or disabling a button is
 * presentation; these calls are the actual control.
 */

/** Requires a signed-in user, or redirects to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Requires a permission. Redirects unauthenticated users to login and sends
 * authenticated-but-unauthorized users to the dashboard rather than showing a
 * 403 — a user who cannot access campaigns has no use for an error page.
 */
export async function requireAuth(
  permission: Permission,
): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/");
  return user;
}

/**
 * Permission check for server actions and route handlers, where redirecting is
 * wrong. Throws ForbiddenError, which the caller maps to a 404 for records the
 * user may not access — a 403 confirms the record exists.
 */
export async function requireApiAuth(
  permission: Permission,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !can(user, permission)) {
    throw new ForbiddenError(permission);
  }
  return user;
}
