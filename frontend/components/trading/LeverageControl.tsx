"use client";

import { TriangleAlert } from "lucide-react";
import { useId } from "react";

import { Term } from "@/components/ui";
import { cx, fmtPrice } from "@/lib/format";

/** Default sentence of the leverage block (the backend sends the same text as `leverage_warning`). */
export const LEVERAGE_WARNING = "Higher leverage magnifies exposure and liquidation risk.";

/** Index of the step closest to `value` (the slider position of a leverage). */
export function stepIndex(steps: readonly number[], value: number): number {
  if (!steps.length) return 0;
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - value) < Math.abs(steps[best] - value)) best = i;
  return best;
}

/**
 * Per-order leverage: a slider over the allowed steps (capped at the instrument's max — none of them is
 * ever marked as recommended), the liquidation estimate of the preview and the fixed risk sentence.
 * `value` null = the account default.
 */
export function LeverageControl({
  value,
  effective,
  accountDefault,
  max,
  steps,
  onChange,
  liquidation,
  liquidationDistancePct,
  precision,
  warning = LEVERAGE_WARNING,
  disabled,
  className,
}: {
  value: number | null;
  /** leverage the order will use */
  effective: number;
  accountDefault: number;
  max: number;
  steps: number[];
  onChange: (v: number | null) => void;
  liquidation?: number | null;
  liquidationDistancePct?: number | null;
  precision: number;
  warning?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const idx = stepIndex(steps, effective);
  const single = steps.length <= 1;
  return (
    <div className={cx("space-y-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-semibold uppercase tracking-[0.05em] text-muted">
          <Term k="leverage">Leverage</Term>
        </label>
        <span className="num flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-text">{effective.toLocaleString("en-US", { maximumFractionDigits: 2 })}x</span>
          <span className="text-[11px] text-faint">max {max.toLocaleString("en-US", { maximumFractionDigits: 2 })}x</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        value={idx}
        disabled={disabled || single}
        aria-valuetext={`${effective}x`}
        onChange={(e) => onChange(steps[Number(e.target.value)] ?? null)}
        className="h-1.5 w-full cursor-pointer accent-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-50"
      />
      {!single && (
        <div className="num flex justify-between text-[10px] text-faint" aria-hidden>
          {steps.map((s) => (
            <span key={s} className={cx(s === steps[idx] && "text-accent2")}>
              {s}x
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-muted">
          <Term k="liquidation">Liquidation</Term> ≈{" "}
          <span className="num text-text">{liquidation ? fmtPrice(liquidation, precision) : "—"}</span>
          {liquidation && liquidationDistancePct != null && <span className="num text-faint"> ({liquidationDistancePct.toFixed(1)}%)</span>}
        </span>
        {value !== null ? (
          <button type="button" onClick={() => onChange(null)} className="text-accent2 hover:underline" disabled={disabled}>
            Account ({accountDefault.toLocaleString("en-US", { maximumFractionDigits: 2 })}x)
          </button>
        ) : (
          <span className="text-faint">Account leverage</span>
        )}
      </div>
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-warn/90">
        <TriangleAlert size={12} className="mt-px shrink-0" aria-hidden />
        {warning}
      </p>
    </div>
  );
}
