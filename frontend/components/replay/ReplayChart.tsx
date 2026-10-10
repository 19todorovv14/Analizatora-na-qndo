"use client";

/*
 * Replay chart: TradingChart with the hidden-future boundary (live: a hatched "future hidden" area right of
 * the cursor candle; review: a dashed "session end" line + the tinted next-30-bars area), decision markers,
 * stop / target lines and an optional EMA 20 overlay (the scoring's "chased" reference).
 */
import type { IChartApi, Logical } from "lightweight-charts";
import { EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import TradingChart, { type LineDef, type MarkerDef, type PriceLineDef } from "@/components/charts/TradingChart";
import { EMA_KEY } from "@/components/replay/model";
import type { IndicatorSeries } from "@/components/replay/types";
import { cx } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";
import type { Candle } from "@/lib/types";

type Box = { x: number; x2: number; w: number; h: number };

/** Half of the bar spacing around logical index `i` (px). */
function halfBar(scale: ReturnType<IChartApi["timeScale"]>, i: number): number {
  const a = scale.logicalToCoordinate(i as Logical);
  const b = scale.logicalToCoordinate((i - 1) as Logical);
  if (a === null || b === null) return 3;
  return Math.max(1, Math.abs(a - b) / 2);
}

/**
 * Vertical boundary after candle `index` (logical), re-projected on scroll / zoom / resize. `index` past the
 * data = nothing. `untilIndex` (review) limits the tinted area to the revealed "what happened next" bars.
 */
function useBoundaryBox(apiRef: React.RefObject<IChartApi | null>, index: number | null, untilIndex: number | null, dataKey: string): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (index === null || index < 0) return;
    let raf = 0;
    let chart: IChartApi | null = null;
    let disposed = false;
    const project = () => {
      raf = 0;
      if (disposed || !chart) return;
      try {
        const scale = chart.timeScale();
        const w = scale.width();
        const panes = chart.panes();
        const h = Math.max(0, panes.reduce((sum, p) => sum + p.getHeight(), 0) + Math.max(0, panes.length - 1));
        // logicalToCoordinate needs whole indexes (fractional ones come back as 0): bar centre + half a bar
        const half = halfBar(scale, index);
        const c1 = scale.logicalToCoordinate(index as Logical);
        const c2 = untilIndex !== null ? scale.logicalToCoordinate(untilIndex as Logical) : null;
        const x = c1 === null ? null : c1 + half;
        const x2 = untilIndex === null ? w : c2 === null ? null : c2 + half;
        if (x === null || x2 === null) {
          setBox(null);
          return;
        }
        const next = {
          x: Math.round(x),
          x2: Math.round(Math.min(w, Math.max(x, x2))),
          w,
          h: Math.round(h),
        };
        setBox((b) => (b && b.x === next.x && b.x2 === next.x2 && b.w === next.w && b.h === next.h ? b : next));
      } catch {
        /* chart disposed */
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(project);
    };
    let attach = 0;
    const tryAttach = () => {
      chart = apiRef.current;
      if (!chart) {
        attach = requestAnimationFrame(tryAttach);
        return;
      }
      chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
      chart.timeScale().subscribeSizeChange(schedule);
      schedule();
      // data / scale-margin updates settle a frame later
      setTimeout(schedule, 60);
    };
    tryAttach();
    return () => {
      disposed = true;
      cancelAnimationFrame(attach);
      cancelAnimationFrame(raf);
      try {
        chart?.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);
        chart?.timeScale().unsubscribeSizeChange(schedule);
      } catch {
        /* chart already removed */
      }
    };
  }, [apiRef, index, untilIndex, dataKey]);
  return index === null || index < 0 ? null : box;
}

const HATCH = `repeating-linear-gradient(135deg, ${withAlpha(PALETTE.accent, 0.1)} 0 6px, transparent 6px 13px)`;

function FutureBoundary({ box, mode, label }: { box: Box; mode: "live" | "review"; label: string }) {
  const width = Math.max(0, box.x2 - box.x);
  const live = mode === "live";
  return (
    <div
      style={{
        pointerEvents: "none",
        position: "absolute",
        left: 0,
        top: 0,
        width: box.w,
        height: box.h,
      }}
      aria-hidden={!live}
    >
      <div
        className="absolute top-0"
        style={{
          left: box.x,
          width,
          height: box.h,
          background: live
            ? `${HATCH}, linear-gradient(90deg, ${withAlpha(PALETTE.accent, 0.12)}, ${withAlpha(PALETTE.accent, 0.03)})`
            : withAlpha(PALETTE.violet, 0.06),
        }}
      />
      <div
        className="absolute top-0"
        style={{
          left: box.x,
          height: box.h,
          borderLeft: `1.5px dashed ${live ? withAlpha(PALETTE.accent2, 0.85) : withAlpha(PALETTE.violet, 0.85)}`,
        }}
      />
      {box.x > 0 &&
        box.x < box.w &&
        (width >= 150 ? (
          <div
            className={cx(
              "absolute top-2 flex max-w-[220px] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
              live ? "border-accent/30 bg-surface/85 text-accent2" : "border-violet/30 bg-surface/85 text-violet",
            )}
            style={{ left: box.x + 6 }}
            role={live ? "note" : undefined}
          >
            {live && <EyeOff size={11} aria-hidden />}
            <span className="truncate">{label}</span>
          </div>
        ) : (
          // narrow strip (live: the chart's right offset) → a vertical label inside the hatched area
          <div
            className={cx(
              "absolute flex items-center gap-1 whitespace-nowrap rounded-md border px-0.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
              live ? "border-accent/30 bg-surface/85 text-accent2" : "border-violet/30 bg-surface/85 text-violet",
            )}
            style={{ left: box.x + Math.max(2, width / 2 - 9), top: "38%", writingMode: "vertical-rl" }}
            role={live ? "note" : undefined}
          >
            {live && <EyeOff size={11} className="rotate-90" aria-hidden />}
            {label}
          </div>
        ))}
    </div>
  );
}

export type ReplayChartProps = {
  candles: Candle[];
  precision: number;
  markers?: MarkerDef[];
  priceLines?: PriceLineDef[];
  indicators?: Record<string, IndicatorSeries> | null;
  showEma?: boolean;
  /** live: hatched hidden future after the last candle · review: boundary at `boundaryTime` */
  boundary: "live" | "review";
  boundaryTime?: number | null;
  boundaryLabel?: string;
  height?: number | "fill";
  fitKey: string;
  visibleBars?: number;
  demo?: boolean;
  loading?: boolean;
  unavailable?: string | boolean | null;
  highlightTime?: number | null;
  onPriceClick?: (price: number) => void;
  crosshair?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function ReplayChart({
  candles,
  precision,
  markers,
  priceLines,
  indicators,
  showEma = true,
  boundary,
  boundaryTime,
  boundaryLabel,
  height = "fill",
  fitKey,
  visibleBars = 110,
  demo,
  loading,
  unavailable,
  highlightTime,
  onPriceClick,
  crosshair,
  className,
  children,
}: ReplayChartProps) {
  const apiRef = useRef<IChartApi | null>(null);
  const overlays = useMemo<LineDef[]>(() => {
    const pts = showEma ? indicators?.[EMA_KEY]?.series?.value : null;
    if (!pts?.length) return [];
    // only points inside the candle range: extra times would shift the chart's logical indexes
    const first = candles[0]?.time ?? -Infinity;
    const last = candles[candles.length - 1]?.time ?? Infinity;
    return [
      {
        id: "ema20",
        data: pts.filter((p) => p.time >= first && p.time <= last),
        color: withAlpha(PALETTE.gold, 0.8),
        width: 1,
      },
    ];
  }, [indicators, showEma, candles]);

  let index: number | null = null;
  let until: number | null = null;
  if (boundary === "live") index = candles.length ? candles.length - 1 : null;
  else if (boundaryTime) {
    const i = candles.findIndex((c) => c.time >= boundaryTime);
    index = i < 0 ? null : candles[i].time === boundaryTime ? i : i - 1;
    until = candles.length - 1;
    if (index !== null && index >= candles.length - 1) index = null;
  }
  const dataKey = `${candles.length}:${candles[candles.length - 1]?.time ?? 0}`;
  const box = useBoundaryBox(apiRef, index, until, dataKey);

  return (
    <div className={cx("relative h-full min-h-0", crosshair && "[&_canvas]:!cursor-crosshair", className)}>
      <TradingChart
        candles={candles}
        precision={precision}
        height={height}
        markers={markers}
        priceLines={priceLines}
        overlays={overlays}
        fitKey={fitKey}
        visibleBars={visibleBars}
        demo={demo}
        loading={loading}
        unavailable={unavailable}
        highlightTime={highlightTime}
        apiRef={apiRef}
        onPriceClick={onPriceClick ? (p) => onPriceClick(p) : undefined}
      >
        {box && <FutureBoundary box={box} mode={boundary} label={boundaryLabel ?? (boundary === "live" ? "Бъдещето е скрито" : "След края")} />}
        {children}
      </TradingChart>
    </div>
  );
}
