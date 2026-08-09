import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { UsersManager } from "./_manager";

export const metadata = { title: "Team members" };

export default async function UsersPage() {
  const currentUser = await requireAuth("settings:users");

  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Team members
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Add colleagues and control what each of them can do.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          What each role can do
        </h3>
        <dl className="mt-3 space-y-2.5 text-sm">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-slate-700 dark:text-slate-300">
              Administrator
            </dt>
            <dd className="text-slate-500 dark:text-slate-400">
              Everything, including the WhatsApp connection and team members.
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-slate-700 dark:text-slate-300">
              Manager
            </dt>
            <dd className="text-slate-500 dark:text-slate-400">
              Campaigns, contacts, templates, reports and the inbox. Cannot see
              or change the WhatsApp connection.
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-slate-700 dark:text-slate-300">
              Agent
            </dt>
            <dd className="text-slate-500 dark:text-slate-400">
              Inbox and contacts only. Cannot send campaigns or export contacts.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-400">
          For colleagues who need to run campaigns and reply to customers,
          choose Manager.
        </p>
      </section>

      <UsersManager users={users} currentUserId={currentUser.id} />
    </div>
  );
}
