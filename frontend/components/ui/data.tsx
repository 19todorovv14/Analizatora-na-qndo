/*
 * Data display primitives (change pills, sparklines, meters, stat tiles).
 * No "use client": pure render functions, usable from Server Components.
 */
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/feedback";
import type { Tone } from "@/components/ui/primitives";
import { GlossaryTip } from "@/components/ui/term";
import { cx } from "@/lib/format";

/** Sign → tone helper for P/L-like values. */
export function pnlTone(v: number | null | undefined): "up" | "down" | "neutral" {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "neutral";
  return v > 0 ? "up" : "down";
}

/** +/- percent change chip. `value` is already in percent (1.5 → "+1.50%"); null → neutral "—". */
export function ChangePill({ value, digits = 2, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  const base = "num inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium leading-4 ring-1 ring-inset";
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cx(base, "bg-white/[0.04] text-faint ring-white/[0.08]", className)}>—</span>;
  }
  const rounded = Number(value.toFixed(digits));
  const dir = rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
  const tone = dir > 0 ? "bg-up/10 text-up ring-up/20" : dir < 0 ? "bg-down/10 text-down ring-down/20" : "bg-white/[0.05] text-muted ring-white/10";
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : null;
  return (
    <span className={cx(base, tone, className)}>
      {Icon && <Icon size={12} strokeWidth={2.25} className="-ml-0.5" aria-hidden />}
      {`${dir > 0 ? "+" : ""}${(dir === 0 ? 0 : rounded).toFixed(digits)}%`}
    </span>
  );
}

/** Tiny SVG trend line; colour by first vs last value. */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  strokeWidth = 1.5,
  fill = true,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  fill?: boolean;
  className?: string;
}) {
  const pts = data.filter((v) => Number.isFinite(v));
  if (pts.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cx("text-faint", className)} aria-hidden>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
      </svg>
    );
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const ink = last > first ? "text-up" : last < first ? "text-down" : "text-muted";
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const pad = strokeWidth;
  const stepX = (width - pad * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = max === min ? height / 2 : pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coords.join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cx("overflow-visible", ink, className)}
      role="img"
      aria-label={last > first ? "Тренд нагоре" : last < first ? "Тренд надолу" : "Без промяна"}
    >
      {fill && <polygon points={`${pad},${height} ${line} ${width - pad},${height}`} fill="currentColor" fillOpacity={0.09} stroke="none" />}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export type MeterTone = "accent" | "up" | "down" | "warn" | "info" | "auto";

const METER_FILL: Record<Exclude<MeterTone, "auto">, string> = {
  accent: "bg-gradient-to-r from-accent to-accent2",
  up: "bg-gradient-to-r from-up/70 to-up",
  down: "bg-gradient-to-r from-down/70 to-down",
  warn: "bg-gradient-to-r from-warn/70 to-warn",
  info: "bg-gradient-to-r from-info/70 to-info",
};

/** Horizontal gauge. tone="auto" goes green → amber → red as the value approaches max (risk usage). */
export function Meter({
  value,
  max = 100,
  tone = "accent",
  label,
  showValue,
  className,
}: {
  value: number;
  max?: number;
  tone?: MeterTone;
  label?: React.ReactNode;
  showValue?: boolean;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 100;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(safeMax, value)) : 0;
  const pct = (v / safeMax) * 100;
  const resolved: Exclude<MeterTone, "auto"> = tone === "auto" ? (pct < 50 ? "up" : pct < 80 ? "warn" : "down") : tone;
  return (
    <div className={cx("w-full min-w-0", className)}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] leading-4">
          <span className="truncate text-muted">{label}</span>
          {showValue && <span className="num text-text">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={v}
        aria-label={typeof label === "string" ? label : undefined}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] shadow-[inset_0_1px_1px_rgb(0_0_0/0.3)]"
      >
        <div className={cx("h-full rounded-full transition-[width] duration-500 ease-out-quart", METER_FILL[resolved])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const TILE_VALUE: Record<Tone, string> = {
  neutral: "text-text",
  up: "text-up",
  down: "text-down",
  warn: "text-warn",
  info: "text-info",
  accent: "text-accent2",
  violet: "text-violet",
  gold: "text-gold",
};

const TILE_ICON: Record<Tone, string> = {
  neutral: "bg-white/[0.05] text-muted ring-white/10",
  up: "bg-up/10 text-up ring-up/20",
  down: "bg-down/10 text-down ring-down/20",
  warn: "bg-warn/10 text-warn ring-warn/20",
  info: "bg-info/10 text-info ring-info/20",
  accent: "bg-accent/15 text-accent2 ring-accent/25",
  violet: "bg-violet/10 text-violet ring-violet/20",
  gold: "bg-gold/10 text-gold ring-gold/20",
};

/** Premium KPI tile (glass card, label + optional icon chip, large tabular value, sub line). */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  icon: Icon,
  term,
  loading,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  /** glossary key → "?" with the explanation card */
  term?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("card min-w-0 px-4 py-3.5", className)} aria-busy={loading || undefined}>
      <div className="flex min-h-7 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 pt-1 text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-muted">
          <span className="line-clamp-2 break-words">{label}</span>
          {term && <GlossaryTip k={term} />}
        </div>
        {Icon && (
          <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", TILE_ICON[tone])}>
            <Icon size={14} strokeWidth={1.9} aria-hidden />
          </span>
        )}
      </div>
      <div className={cx("num mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em]", TILE_VALUE[tone])}>
        {loading ? <Skeleton className="my-1 h-6 w-28" /> : value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{loading ? <Skeleton className="h-3 w-20" /> : sub}</div>}
    </div>
  );
}
