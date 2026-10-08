"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { LevelKind } from "@/components/trading/ticket";
import { cx, fmtPrice } from "@/lib/format";

export type PricePick = { price: number; x: number; y: number };

const CHOICES: { kind: LevelKind; label: string; cls: string }[] = [
  { kind: "entry", label: "Entry", cls: "text-accent2 hover:bg-accent/15" },
  { kind: "stop", label: "SL", cls: "text-down hover:bg-down/15" },
  { kind: "target", label: "TP", cls: "text-up hover:bg-up/15" },
];

/**
 * "Set as: Entry / SL / TP" chooser shown where the chart was clicked (render it as TradingChart children).
 * Closes on a choice, Esc or a click outside.
 */
export function PriceLevelChooser({
  pick,
  precision,
  onChoose,
  onClose,
}: {
  pick: PricePick;
  precision: number;
  onChoose: (kind: LevelKind, price: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // capture: the chart canvas stops nothing, but drawing overlays may
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Задай нивото като"
      className="glass-strong absolute z-40 flex items-center gap-0.5 rounded-lg p-1 text-xs shadow-modal"
      style={{ left: Math.max(4, pick.x + 10), top: Math.max(4, pick.y - 16) }}
    >
      <span className="px-1.5 text-[10.5px] text-muted">
        Set as <span className="num font-semibold text-text">{fmtPrice(pick.price, precision)}</span>
      </span>
      {CHOICES.map((c) => (
        <button key={c.kind} type="button" onClick={() => onChoose(c.kind, pick.price)} className={cx("rounded-md px-2 py-1 font-semibold transition-colors", c.cls)}>
          {c.label}
        </button>
      ))}
      <button type="button" aria-label="Затвори" onClick={onClose} className="rounded-md p-1 text-faint hover:bg-white/[0.06] hover:text-text">
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
