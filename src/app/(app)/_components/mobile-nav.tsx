"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import type { NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

import { NavIcon } from "./nav-icon";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Bottom tab bar for mobile. Shows up to four primary destinations plus
 * "More" — a full sidebar on a phone means every tap costs two actions.
 */
export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);

  const primary = items.filter((i) => i.primary).slice(0, 4);
  const secondary = items.filter((i) => !primary.includes(i));

  return (
    <>
      {showMore && secondary.length > 0 && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setShowMore(false)}
            className="fixed inset-0 z-40 bg-slate-900/20 lg:hidden"
          />
          <div className="fixed right-0 bottom-16 left-0 z-50 border-t border-slate-200 bg-white p-2 lg:hidden dark:border-slate-800 dark:bg-slate-900">
            {secondary.map((item) =>
              item.comingSoon ? (
                <span
                  key={item.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 dark:text-slate-600"
                >
                  <NavIcon name={item.icon} className="h-5 w-5" />
                  {item.label}
                  <span className="ml-auto text-[10px]">Soon</span>
                </span>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300"
                >
                  <NavIcon name={item.icon} className="h-5 w-5" />
                  {item.label}
                </Link>
              ),
            )}
          </div>
        </>
      )}

      <nav className="fixed right-0 bottom-0 left-0 z-40 flex h-16 border-t border-slate-200 bg-white lg:hidden dark:border-slate-800 dark:bg-slate-900">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.comingSoon ? "#" : item.href}
              aria-disabled={item.comingSoon}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[11px]",
                item.comingSoon && "pointer-events-none opacity-40",
                active
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-slate-500 dark:text-slate-400",
              )}
            >
              <NavIcon name={item.icon} className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}

        {secondary.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            More
          </button>
        )}
      </nav>
    </>
  );
}
