import { requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/rbac";
import { isMetaConnected } from "@/lib/settings";
import { prisma } from "@/lib/db";

import { ChangePasswordForm } from "./_change-password";

export const metadata = { title: "Settings" };

export default async function SettingsOverviewPage() {
  // Any signed-in user reaches this page; the cards below are what varies.
  // Everyone needs somewhere to change their own password.
  const user = await requireUser();

  const [connected, teamCount] = await Promise.all([
    isMetaConnected(),
    prisma.user.count({ where: { isActive: true } }),
  ]);

  const showAdminCards = can(user, "settings:whatsapp");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {showAdminCards && (
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
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {showAdminCards ? "Active team members" : "Signed in as"}
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {showAdminCards ? teamCount : user.name}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {showAdminCards ? `Signed in as ${user.name}` : user.email}
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
