import type { Permission } from "./rbac";

/**
 * Navigation definition, single source for desktop sidebar and mobile tab bar.
 *
 * Each item declares the permission that gates it, so navigation and
 * authorization cannot drift apart. Hiding an item is cosmetic — the route
 * itself is guarded server-side.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  permission: Permission;
  /** Shown in the mobile bottom bar (max 5 including "More"). */
  primary?: boolean;
  /** Visible but disabled until the phase that builds it lands. */
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: "LayoutDashboard",
    permission: "dashboard:view",
    primary: true,
  },
  {
    label: "Contacts",
    href: "/contacts",
    icon: "Users",
    permission: "contact:view",
    primary: true,
  },
  {
    label: "Inbox",
    href: "/inbox",
    icon: "MessageSquare",
    permission: "inbox:view",
    primary: true,
    comingSoon: true,
  },
  {
    label: "Campaigns",
    href: "/campaigns",
    icon: "Send",
    permission: "campaign:view",
    primary: true,
  },
  {
    label: "Templates",
    href: "/templates",
    icon: "FileText",
    permission: "template:view",
  },
  {
    label: "Automations",
    href: "/automations",
    icon: "Zap",
    permission: "automation:view",
    comingSoon: true,
  },
  {
    label: "Reports",
    href: "/reports",
    icon: "BarChart3",
    permission: "report:view",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "Settings",
    permission: "settings:view",
  },
];
