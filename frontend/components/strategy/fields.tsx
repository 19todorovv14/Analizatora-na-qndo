"use client";

import { useState } from "react";

import { cx } from "@/lib/format";

/**
 * Numeric text field that keeps the user's draft while typing ("", "1.", "-") and only commits finite
 * numbers (clamped to [min, max] on blur). Used across the Strategy Builder, Backtesting and Bot Lab.
 */
export function NumField({
  value,
  onChange,
  min,
  max,
  step,
  integer,
  className,
  ariaLabel,
  disabled,
  size = "sm",
  suffix,
  id,
  placeholder,
  onClear,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  suffix?: string;
  id?: string;
  placeholder?: string;
  /** called when the field is emptied (lets callers fall back to a default, e.g. fee_bps = null) */
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null || value === undefined || !Number.isFinite(value) ? "" : String(value));
  const clamp = (n: number) => {
    let x = integer ? Math.round(n) : n;
    if (min !== undefined) x = Math.max(min, x);
    if (max !== undefined) x = Math.min(max, x);
    return x;
  };
  const invalid = draft !== null && ((draft.trim() === "" && !onClear) || (draft.trim() !== "" && !Number.isFinite(Number(draft.replace(",", ".")))));
  const input = (
    <input
      id={id}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw.replace(",", "."));
        if (raw.trim() === "") onClear?.();
        else if (Number.isFinite(n)) onChange(clamp(n));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (step && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const base = Number.isFinite(Number(value)) ? Number(value) : 0;
          const next = clamp(Number((base + (e.key === "ArrowUp" ? step : -step)).toFixed(6)));
          setDraft(null);
          onChange(next);
        }
      }}
      className={cx(
        "input num text-right",
        size === "sm" ? "h-8 !px-2 !py-1 text-xs" : "",
        suffix && "!pr-7",
        className,
      )}
    />
  );
  if (!suffix) return input;
  return (
    <span className="relative inline-flex min-w-0 items-center">
      {input}
      <span className="pointer-events-none absolute right-2 text-[11px] text-faint">{suffix}</span>
    </span>
  );
}

/** Compact select for inline sentence editors. */
export function MiniSelect({
  value,
  onChange,
  children,
  className,
  ariaLabel,
  disabled,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx("input h-8 w-auto !py-1 !pl-2.5 !pr-7 text-xs font-medium", className)}
    >
      {children}
    </select>
  );
}

/** Small uppercase caption used above inline groups. */
export function Caption({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint", className)}>{children}</div>;
}
