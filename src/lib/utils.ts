import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1542 -> "1,542" — Indian-locale grouping for the dashboard. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

/** Share of total as a percentage string; returns "—" when there is no total,
 * because "0.0%" of nothing reads as a real measurement. */
export function formatPercent(value: number, total: number): string {
  if (total <= 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Formats a money amount for display.
 *
 * Lives here rather than beside the pricing logic because that module imports
 * Prisma — pulling it into a client component would drag the database client
 * into the browser bundle.
 *
 * Extra precision below 1 unit: per-message rates are fractions of a cent, and
 * rounding them to 2dp would show every rate as 0.01.
 */
export function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: amount < 1 ? 4 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
