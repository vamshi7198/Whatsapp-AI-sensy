import { requireAuth } from "@/lib/auth/guards";
import { isMetaConnected } from "@/lib/settings";
import { prisma } from "@/lib/db";

import { ChangePasswordForm } from "./_change-password";

export const metadata = { title: "Settings" };

export default async function SettingsOverviewPage() {
  const user = await requireAuth("settings:view");

  const [connected, teamCount] = await Promise.all([
    isMetaConnected(),
    prisma.user.count({ where: { isActive: true } }),
  ]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            WhatsApp connection
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {connected ? "Connected" : "Not connected"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {connected
              ? "Templates and sending are available."
              : "Add your WhatsApp Business details to start sending."}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Active team members
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {teamCount}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Signed in as {user.name}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Change your password
        </h2>
        <p className="mt-0.5 mb-4 text-sm text-slate-500 dark:text-slate-400">
          Use at least 12 characters.
        </p>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
