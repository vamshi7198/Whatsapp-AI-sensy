import { logout } from "../actions";

import type { SessionUser } from "@/lib/auth/session";

const ROLE_LABELS: Record<SessionUser["role"], string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  AGENT: "Agent",
};

export function TopBar({ user }: { user: SessionUser }) {
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-slate-900/90">
      <div className="flex items-center gap-2.5 lg:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
          U
        </div>
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Uncanned
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
            {user.name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {ROLE_LABELS[user.role]}
          </p>
        </div>

        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
          aria-hidden="true"
        >
          {initials}
        </div>

        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
