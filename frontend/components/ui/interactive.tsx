"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Tooltip } from "@/components/ui/overlay";
import { Kbd } from "@/components/ui/primitives";
import { cx, fmtPrice } from "@/lib/format";

/* ─────────────────────────────────────────────────────── IconButton */

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: LucideIcon;
  /** accessible name + tooltip text */
  label: string;
  active?: boolean;
  size?: "sm" | "md";
  variant?: "ghost" | "glass";
  /** shortcut shown in the tooltip, e.g. "[" or "Ctrl K" */
  shortcut?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  /** set false to hide the tooltip (aria-label stays) */
  tooltip?: boolean;
};

/** Square icon-only button with a portal tooltip (label + optional shortcut). Defaults to type="button". */
export function IconButton({
  icon: Icon,
  label,
  active,
  size = "md",
  variant = "ghost",
  shortcut,
  tooltipSide = "bottom",
  tooltip = true,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const dims = size === "sm" ? "h-7 w-7 rounded-md" : "h-9 w-9 rounded-lg";
  const look =
    variant === "glass"
      ? cx(
          "border shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]",
          active
            ? "border-accent/35 bg-accent/15 text-accent2"
            : "border-white/10 bg-white/[0.04] text-muted hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-text",
        )
      : active
        ? "bg-accent/15 text-accent2 hover:bg-accent/20"
        : "text-muted hover:bg-white/[0.06] hover:text-text active:bg-white/[0.09]";
  return (
    <Tooltip
      content={
        shortcut ? (
          <span className="flex items-center gap-2">
            {label}
            <Kbd>{shortcut}</Kbd>
          </span>
        ) : (
          label
        )
      }
      side={tooltipSide}
      disabled={!tooltip}
      contentClassName="whitespace-nowrap"
    >
      <button
        {...rest}
        type={type}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={cx(
          "inline-flex shrink-0 items-center justify-center transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-40",
          dims,
          look,
          className,
        )}
      >
        <Icon size={size === "sm" ? 15 : 17} strokeWidth={1.85} aria-hidden />
      </button>
    </Tooltip>
  );
}

/* ──────────────────────────────────────────────────────── Segmented */

export type SegmentedOption<T> = { value: T; label: React.ReactNode; title?: string; disabled?: boolean };

/** Compact segmented control (plain buttons with aria-pressed; role stays "button"). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  variant = "neutral",
  fullWidth,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  /** neutral: raised glass thumb · accent: solid blue thumb */
  variant?: "neutral" | "accent";
  fullWidth?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx(
        "items-center gap-0.5 rounded-lg border border-white/[0.08] bg-black/25 p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.title}
            disabled={o.disabled}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-xs",
              fullWidth && "flex-1",
              on
                ? variant === "accent"
                  ? "bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-btn"
                  : "bg-white/[0.1] text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08),0_1px_2px_rgb(0_0_0/0.4)]"
                : "text-muted hover:bg-white/[0.04] hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── Switch */

export function Switch({
  checked,
  onChange,
  label,
  title,
  ariaLabel,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  title?: string;
  /** accessible name when there is no visible label */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : (ariaLabel ?? title)}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "group inline-flex select-none items-center gap-2 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "text-text" : "text-muted hover:text-text",
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-200",
          checked ? "border-[#5b95f7]/50 bg-accent" : "border-white/10 bg-white/[0.08] group-hover:bg-white/[0.12]",
        )}
      >
        <span
          className={cx(
            "absolute left-[2px] h-3 w-3 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.45)] transition-transform duration-200 ease-out-quart",
            checked ? "translate-x-[14px] bg-white" : "translate-x-0 bg-[#c3cbda]",
          )}
        />
      </span>
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────────────── WhyButton */

/** "Why am I seeing this?" — explains the reasoning behind any insight or warning. */
export function WhyButton({ children, label = "Why am I seeing this?" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent2 transition-colors hover:text-text"
      >
        <ChevronRight size={13} strokeWidth={2.25} className={cx("transition-transform duration-150", open && "rotate-90")} aria-hidden />
        {open ? "Скрий обяснението" : label}
      </button>
      {open && (
        <div className="fade-in mt-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 text-xs leading-relaxed text-muted">{children}</div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────── PriceText */

/** Tabular price. With `flash`, briefly tints green/red when the value ticks up/down. */
export function PriceText({
  value,
  precision = 2,
  flash,
  className,
}: {
  value: number | null | undefined;
  precision?: number;
  flash?: boolean;
  className?: string;
}) {
  const [prev, setPrev] = useState(value);
  const [tick, setTick] = useState<{ dir: 1 | -1; n: number } | null>(null);
  if (value !== prev) {
    setPrev(value);
    if (flash && typeof value === "number" && typeof prev === "number" && Number.isFinite(value) && Number.isFinite(prev)) {
      setTick({ dir: value > prev ? 1 : -1, n: (tick?.n ?? 0) + 1 });
    }
  }
  return (
    <span key={tick?.n ?? 0} className={cx("num rounded-[3px]", flash && tick && (tick.dir > 0 ? "flash-up" : "flash-down"), className)}>
      {fmtPrice(value, precision)}
    </span>
  );
}
