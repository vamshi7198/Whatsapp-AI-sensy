import Link from "next/link";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guards";
import { can, type Permission } from "@/lib/rbac";

const SECTIONS: Array<{
  label: string;
  href: string;
  permission: Permission;
}> = [
  { label: "WhatsApp connection", href: "/settings/whatsapp", permission: "settings:whatsapp" },
  { label: "Business profile", href: "/settings/business", permission: "settings:business" },
  { label: "Team members", href: "/settings/users", permission: "settings:users" },
  { label: "Compliance", href: "/settings/compliance", permission: "settings:compliance" },
  { label: "Activity log", href: "/settings/logs", permission: "logs:view" },
];

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gated on holding *any* settings permission rather than settings:view.
  // A manager can edit the business profile but not the API connection, and
  // requiring settings:view would have locked them out of a page their role
  // explicitly allows.
  const user = await requireUser();
  const visible = SECTIONS.filter((s) => can(user, s.permission));

  if (visible.length === 0) redirect("/");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        Settings
      </h1>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {visible.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-lg px-3 py-2 text-sm whitespace-nowrap text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
