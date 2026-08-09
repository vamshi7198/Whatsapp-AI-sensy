import { requireUser } from "@/lib/auth/guards";
import { NAV_ITEMS } from "@/lib/nav";
import { can } from "@/lib/rbac";

import { MobileNav } from "./_components/mobile-nav";
import { Sidebar } from "./_components/sidebar";
import { TopBar } from "./_components/top-bar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  // Navigation is filtered here, on the server, so the browser is never sent
  // the list of routes this user cannot reach. Each route also guards itself —
  // this filtering is for usability, not security.
  const visibleItems = NAV_ITEMS.filter((item) =>
    can(user, item.permission),
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar items={visibleItems} />

      <div className="lg:pl-60">
        <TopBar user={user} />
        <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      <MobileNav items={visibleItems} />
    </div>
  );
}
