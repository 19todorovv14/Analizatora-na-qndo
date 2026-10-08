/*
 * Market session status dot (open / closed / break) with an optional label.
 * No hooks: renders in Server Components too. The title carries the session and the note
 * (e.g. "Демо данните се генерират 24/7.").
 */
import type { MarketStatus } from "@/components/market/types";
import { cx } from "@/lib/format";

const META: Record<string, { label: string; dot: string; ink: string }> = {
  open: { label: "Отворен", dot: "bg-up shadow-[0_0_0_3px_rgb(34_199_158/0.16)] animate-pulse-soft", ink: "text-up" },
  break: { label: "Пауза", dot: "bg-warn shadow-[0_0_0_3px_rgb(245_184_74/0.16)]", ink: "text-warn" },
  closed: { label: "Затворен", dot: "bg-faint", ink: "text-muted" },
};

export type MarketStatusDotProps = {
  /** "open" | "closed" | "break" or the whole market_status object of the API */
  status: MarketStatus | string | null | undefined;
  /** show the text label next to the dot */
  showLabel?: boolean;
  className?: string;
};

export function MarketStatusDot({ status, showLabel, className }: MarketStatusDotProps) {
  const obj = status && typeof status === "object" ? status : null;
  const key = (typeof status === "string" ? status : status?.status) || "";
  const m = META[key];
  if (!m) return null;
  const label = obj?.label || m.label;
  const title = [`Пазар: ${label}`, obj?.session_name, obj?.note].filter(Boolean).join(" · ");
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", m.ink, className)} title={title}>
      <span className={cx("h-2 w-2 shrink-0 rounded-full", m.dot)} aria-hidden />
      {showLabel ? label : <span className="sr-only">{label}</span>}
    </span>
  );
}
