"use client";

/*
 * Building blocks shared by the lesson visuals (components/academy/visuals/*): labelled sliders,
 * read-out rows, captions and a ResizeObserver width hook for responsive SVGs. Everything uses the
 * Crystal Terminal tokens — no hard-coded colours outside lib/theme PALETTE.
 */
import { useEffect, useRef, useState } from "react";

import { Term } from "@/components/ui";
import { cx } from "@/lib/format";

/** Width of an element, kept in sync with a ResizeObserver (SVGs render at real pixel size → crisp text). */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(fallback = 560) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Slim track (filled up to the value via an inline gradient) + round white thumb. */
export const RANGE_CLASS =
  "block h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring " +
  "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgb(0_0_0/0.5)] " +
  "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:bg-transparent";

/** Range input with a label row ("Leverage · 10x") — the value sits right-aligned in mono. */
export function SliderField({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  term,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: number;
  display?: React.ReactNode;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** glossary key — wraps the label in <Term> */
  term?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className={cx("block min-w-0", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-muted">{term ? <Term k={term}>{label}</Term> : label}</span>
        <span className="num shrink-0 font-medium text-text">{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={RANGE_CLASS}
        style={{ background: `linear-gradient(to right, var(--color-accent) ${pct}%, rgb(148 163 184 / 0.16) ${pct}%)` }}
      />
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );
}

export type ReadoutTone = "up" | "down" | "warn" | "accent" | "muted" | "text";

const READOUT_INK: Record<ReadoutTone, string> = {
  up: "text-up",
  down: "text-down",
  warn: "text-warn",
  accent: "text-accent2",
  muted: "text-muted",
  text: "text-text",
};

/** One label → value line inside a read-out panel. */
export function Readout({
  label,
  value,
  tone = "text",
  strong,
  focus,
  term,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: ReadoutTone;
  strong?: boolean;
  /** visually emphasised row (the lesson's focus) */
  focus?: boolean;
  term?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
        focus && "bg-accent/[0.08] ring-1 ring-inset ring-accent/25",
      )}
    >
      <span className="min-w-0 text-muted">{term ? <Term k={term}>{label}</Term> : label}</span>
      <span className={cx("num shrink-0 text-right", READOUT_INK[tone], strong && "font-semibold")}>{value}</span>
    </div>
  );
}

/** Recessed panel that groups read-outs. */
export function ReadoutPanel({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("glass-inset min-w-0 p-2", className)}>
      {title && <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</div>}
      {children}
    </div>
  );
}

/** Quiet caption under a visual. */
export function Caption({ children, icon: Icon, className }: { children: React.ReactNode; icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; "aria-hidden"?: boolean }>; className?: string }) {
  return (
    <p className={cx("flex items-start gap-1.5 text-xs leading-relaxed text-muted", className)}>
      {Icon && <Icon size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-faint" aria-hidden />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Small header row inside a visual: title + optional chips on the right. */
export function VisualHeader({ title, right, className }: { title: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("mb-2.5 flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">{title}</div>
      {right && <div className="flex flex-wrap items-center gap-1.5">{right}</div>}
    </div>
  );
}

/** "HH:MM" (UTC) for intraday timeframes, "DD.MM" for daily and weekly. */
export function utcLabel(ts: number, timeframe?: string): string {
  const d = new Date(ts * 1000);
  if (timeframe === "1d" || timeframe === "1w") {
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
