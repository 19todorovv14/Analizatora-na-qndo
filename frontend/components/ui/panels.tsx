"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useStoredState } from "@/components/ui/storage";
import { cx } from "@/lib/format";

/* ───────────────────────────────────────────────────── ResizeHandle */

/**
 * Drag handle between two panels.
 * - direction="horizontal": resizes along the X axis (a vertical bar, col-resize cursor).
 * - direction="vertical":   resizes along the Y axis (a horizontal bar, row-resize cursor).
 * `onResize(deltaPx)` receives incremental pointer deltas (positive = right / down). Keyboard:
 * arrows move by `step` px (Shift ×4). Double-click typically resets the size.
 */
export function ResizeHandle({
  direction,
  onResize,
  onDoubleClick,
  label = "Промени размера",
  step = 16,
  valueNow,
  valueMin,
  valueMax,
  className,
}: {
  direction: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;
  onDoubleClick?: () => void;
  label?: string;
  step?: number;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  className?: string;
}) {
  const horizontal = direction === "horizontal";
  const last = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const end = useCallback(() => {
    if (last.current === null) return;
    last.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  // safety: never leave the body cursor locked if unmounted mid-drag
  useEffect(() => end, [end]);

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = horizontal ? e.clientX : e.clientY;
        setDragging(true);
        document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const pos = horizontal ? e.clientX : e.clientY;
        const d = pos - last.current;
        if (d !== 0) {
          last.current = pos;
          onResize(d);
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        const s = e.shiftKey ? step * 4 : step;
        const dec = horizontal ? "ArrowLeft" : "ArrowUp";
        const inc = horizontal ? "ArrowRight" : "ArrowDown";
        if (e.key === dec) {
          e.preventDefault();
          onResize(-s);
        } else if (e.key === inc) {
          e.preventDefault();
          onResize(s);
        } else if (e.key === "Enter" && onDoubleClick) {
          e.preventDefault();
          onDoubleClick();
        }
      }}
      className={cx(
        "group relative z-10 flex shrink-0 touch-none select-none items-center justify-center outline-none",
        horizontal ? "w-2 cursor-col-resize self-stretch" : "h-2 w-full cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          "rounded-full transition-colors duration-150",
          horizontal ? "h-full w-px" : "h-px w-full",
          dragging ? "bg-accent" : "bg-white/[0.06] group-hover:bg-accent/60 group-focus-visible:bg-accent",
        )}
      />
      <span
        aria-hidden
        className={cx(
          "absolute rounded-full bg-white/25 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
          horizontal ? "h-7 w-[3px]" : "h-[3px] w-7",
          dragging && "bg-accent2 opacity-100",
        )}
      />
    </div>
  );
}

/**
 * Panel size (px) persisted per viewer in localStorage, clamped to [min, max].
 * Server render / hydration use `defaultSize`; the stored size applies right after.
 */
export function usePanelSize(
  storageKey: string,
  defaultSize: number,
  min: number,
  max: number,
): [number, (v: number | ((prev: number) => number)) => void] {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, Math.round(n))), [min, max]);
  const [raw, setRaw] = useStoredState<number>(storageKey, defaultSize, {
    validate: (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined),
    flushMs: 250,
  });
  const size = clamp(raw);
  const setSize = useCallback(
    (v: number | ((prev: number) => number)) => setRaw((p) => clamp(typeof v === "function" ? v(clamp(p)) : v)),
    [setRaw, clamp],
  );
  return [size, setSize];
}

/* ────────────────────────────────────────────────────── VirtualList */

/**
 * Simple fixed-row-height windowing for long lists/tables. Give it a `height` (px) or a
 * `className` with a definite height (e.g. "h-full" inside a sized parent, "h-[60vh]").
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  className,
  renderRow,
  overscan = 6,
  getKey,
  ariaLabel,
}: {
  items: T[];
  rowHeight: number;
  height?: number;
  className?: string;
  renderRow: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  getKey?: (item: T, index: number) => React.Key;
  ariaLabel?: string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    // ResizeObserver reports the initial size right after observe()
    const ro = new ResizeObserver((entries) => setMeasured(entries[0]?.contentRect.height ?? el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const viewport = height ?? (measured || 600);
  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  const slice = items.slice(start, end);

  return (
    <div
      ref={setEl}
      aria-label={ariaLabel}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={cx("relative overflow-y-auto overscroll-contain", className)}
      style={height !== undefined ? { height } : undefined}
    >
      <div style={{ height: total, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${start * rowHeight}px)` }}>
          {slice.map((item, i) => (
            <div key={getKey ? getKey(item, start + i) : start + i} style={{ height: rowHeight }}>
              {renderRow(item, start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
