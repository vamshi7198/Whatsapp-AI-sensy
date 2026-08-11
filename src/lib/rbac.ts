import type { Role } from "@prisma/client";

/**
 * Single source of truth for authorization.
 *
 * Every route handler and server action calls `can()` as its first statement,
 * before reading input. Middleware provides a coarse route guard, but
 * middleware alone is not authorization — a server action can be invoked
 * directly. Hidden navigation is presentation only.
 */

export type Permission =
  // Dashboard
  | "dashboard:view"
  // Contacts
  | "contact:view"
  | "contact:create"
  | "contact:edit"
  | "contact:delete"
  | "contact:import"
  | "contact:export"
  // Tags
  | "tag:view"
  | "tag:manage"
  // Inbox
  | "inbox:view"
  | "inbox:reply"
  // Campaigns
  | "campaign:view"
  | "campaign:create"
  | "campaign:send"
  | "campaign:cancel"
  | "campaign:delete"
  // Templates
  | "template:view"
  | "template:sync"
  | "template:create"
  // Automations
  | "automation:view"
  | "automation:manage"
  // Flows — in-chat forms
  | "flow:view"
  | "flow:manage"
  // Reports
  | "report:view"
  | "report:export"
  // Settings
  | "settings:view"
  | "settings:whatsapp"
  | "settings:users"
  | "settings:business"
  | "settings:compliance"
  | "settings:pricing"
  | "logs:view";

/**
 * Permissions granted per role, matching docs/05-SECURITY.md §2.
 *
 * Expressed as explicit grants rather than inheritance: ADMIN is not "MANAGER
 * plus extras" by construction, so reading any single row tells you exactly
 * what that role can do without tracing a hierarchy.
 */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    "dashboard:view",
    "contact:view",
    "contact:create",
    "contact:edit",
    "contact:delete",
    "contact:import",
    "contact:export",
    "tag:view",
    "tag:manage",
    "inbox:view",
    "inbox:reply",
    "campaign:view",
    "campaign:create",
    "campaign:send",
    "campaign:cancel",
    "campaign:delete",
    "template:view",
    "template:sync",
    "template:create",
    "automation:view",
    "automation:manage",
    "flow:view",
    "flow:manage",
    "report:view",
    "report:export",
    "settings:view",
    "settings:whatsapp",
    "settings:users",
    "settings:business",
    "settings:compliance",
    "settings:pricing",
    "logs:view",
  ]),

  MANAGER: new Set<Permission>([
    "dashboard:view",
    "contact:view",
    "contact:create",
    "contact:edit",
    "contact:delete",
    "contact:import",
    "contact:export",
    "tag:view",
    "tag:manage",
    "inbox:view",
    "inbox:reply",
    "campaign:view",
    "campaign:create",
    "campaign:send",
    "campaign:cancel",
    // Deliberately absent: campaign:delete — a sent campaign is a business
    // record, and deleting it destroys the delivery evidence.
    "template:view",
    "template:sync",
    "template:create",
    // A form is a campaign tool, and a manager already creates templates and
    // sends campaigns, so withholding it would be arbitrary.
    "flow:view",
    "flow:manage",
    "report:view",
    "report:export",
    "settings:business",
  ]),

  AGENT: new Set<Permission>([
    "dashboard:view",
    "contact:view",
    "contact:create",
    "contact:edit",
    "tag:view",
    "inbox:view",
    "inbox:reply",
    // Deliberately absent: contact:delete, contact:export (bulk exfiltration),
    // everything campaign-, settings- and API-related.
  ]),
};

export interface AuthorizedUser {
  id: string;
  role: Role;
  isActive: boolean;
}

/** Returns true when the user may perform the given action. */
export function can(
  user: Pick<AuthorizedUser, "role" | "isActive"> | null | undefined,
  permission: Permission,
): boolean {
  if (!user || !user.isActive) return false;
  return ROLE_PERMISSIONS[user.role]?.has(permission) ?? false;
}

/** All permissions for a role — used to render role-aware navigation. */
export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role] ?? new Set<Permission>();
}

/**
 * Thrown when an authorization check fails. Route handlers translate this to
 * a 404 rather than a 403 for records the user may not access — a 403
 * confirms the record exists.
 */
export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/** Guard form of `can()` for use at the top of server actions. */
export function requirePermission(
  user: Pick<AuthorizedUser, "role" | "isActive"> | null | undefined,
  permission: Permission,
): void {
  if (!can(user, permission)) {
    throw new ForbiddenError(permission);
  }
}
