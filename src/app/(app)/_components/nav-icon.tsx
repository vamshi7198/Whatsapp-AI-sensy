"use client";

import {
  BarChart3,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Send,
  Settings,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Explicit icon map rather than a dynamic lookup: nav.ts is shared with the
 * server, so it carries icon *names*, and the bundler can only tree-shake
 * icons it can see referenced statically.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  MessageSquare,
  Send,
  FileText,
  Zap,
  BarChart3,
  Settings,
};

export function NavIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden="true" />;
}
