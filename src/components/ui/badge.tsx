import { cn } from "@/lib/utils";

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "purple";

const TONES: Record<Tone, string> = {
  neutral:
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Opt-in state shown as icon+text, never colour alone — a red chip must still
 * read "Opted out" to someone who cannot distinguish it from green.
 */
export function OptInBadge({
  status,
  marketingOptOut,
}: {
  status: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  marketingOptOut: boolean;
}) {
  if (marketingOptOut) return <Badge tone="red">✕ Opted out</Badge>;
  if (status === "OPTED_IN") return <Badge tone="green">✓ Opted in</Badge>;
  if (status === "OPTED_OUT") return <Badge tone="red">✕ Opted out</Badge>;
  return <Badge tone="neutral">— Not confirmed</Badge>;
}
