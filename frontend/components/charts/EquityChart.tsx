"use client";

import {
  AreaSeries,
  BaselineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

import { CHART, PALETTE, baseChartOptions, repaintWhenFontsReady, withAlpha } from "@/lib/theme";

type Pt = [number, number];

/** Sorted, strictly ascending series. Duplicate timestamps keep the LAST value (equity after every fill
 * at that bar) or, for drawdown, the WORST one. Non-finite points are dropped. */
function clean(points: Pt[], mode: "last" | "min") {
  const byTs = new Map<number, number>();
  for (const [t, v] of points) {
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const prev = byTs.get(t);
    byTs.set(t, prev === undefined ? v : mode === "min" ? Math.min(prev, v) : v);
  }
  return [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
}

const pctFormat = { type: "custom" as const, minMove: 0.01, formatter: (p: number) => `${p.toFixed(Math.abs(p) >= 10 ? 1 : 2)}%` };

const DRAWDOWN_STYLE = {
  baseValue: { type: "price" as const, price: 0 },
  topLineColor: "rgba(0,0,0,0)",
  topFillColor1: "rgba(0,0,0,0)",
  topFillColor2: "rgba(0,0,0,0)",
  bottomLineColor: PALETTE.down,
  bottomFillColor1: withAlpha(PALETTE.down, 0.06),
  bottomFillColor2: withAlpha(PALETTE.down, 0.32),
  lineWidth: 1 as const,
  priceLineVisible: false,
  priceFormat: pctFormat,
  crosshairMarkerBorderColor: CHART.surface,
  crosshairMarkerBackgroundColor: PALETTE.down,
};

/**
 * Equity curve (time, value) rendered with Lightweight Charts.
 * - `drawdown` adds a second pane with the drawdown curve ([ts, dd% ≤ 0]) on the SAME time axis, so zoom,
 *   scroll and crosshair stay in sync.
 * - `variant="drawdown"` renders `points` as a stand-alone drawdown chart.
 * Existing props (points, height, baseline) behave as before.
 */
export function EquityChart({
  points,
  height = 220,
  baseline,
  drawdown,
  drawdownRatio = 0.34,
  variant = "equity",
}: {
  points: Pt[];
  height?: number;
  baseline?: number;
  /** optional drawdown curve shown in a synced lower pane */
  drawdown?: Pt[];
  /** share of the height used by the drawdown pane (0.15–0.6) */
  drawdownRatio?: number;
  variant?: "equity" | "drawdown";
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const main = useRef<ISeriesApi<"Area"> | ISeriesApi<"Baseline"> | null>(null);
  const dd = useRef<ISeriesApi<"Baseline"> | null>(null);
  const base = useRef<IPriceLine | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, baseChartOptions());
    repaintWhenFontsReady(c);
    main.current =
      variant === "drawdown"
        ? c.addSeries(BaselineSeries, DRAWDOWN_STYLE)
        : c.addSeries(AreaSeries, {
            lineColor: CHART.areaLine,
            topColor: CHART.areaTop,
            bottomColor: CHART.areaBottom,
            lineWidth: 2,
            priceLineVisible: false,
            crosshairMarkerBorderColor: CHART.surface,
            crosshairMarkerBackgroundColor: CHART.areaLine,
          });
    chart.current = c;
    return () => {
      chart.current = null;
      main.current = null;
      dd.current = null;
      base.current = null;
      c.remove();
    };
  }, [variant]);

  useEffect(() => {
    const c = chart.current;
    const s = main.current;
    if (!c || !s) return;
    s.setData(clean(points, variant === "drawdown" ? "min" : "last"));
    if (base.current) s.removePriceLine(base.current);
    base.current = null;
    if (baseline !== undefined && variant === "equity") {
      base.current = s.createPriceLine({
        price: baseline,
        color: CHART.baseline,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "start",
      });
    }

    // synced drawdown pane
    const ddData = drawdown && variant === "equity" ? clean(drawdown, "min") : null;
    if (ddData && ddData.length) {
      if (!dd.current) dd.current = c.addSeries(BaselineSeries, DRAWDOWN_STYLE, 1);
      dd.current.setData(ddData);
      const panes = c.panes();
      const r = Math.min(0.6, Math.max(0.15, drawdownRatio));
      panes[0]?.setStretchFactor(1 - r);
      panes[1]?.setStretchFactor(r);
    } else if (dd.current) {
      c.removeSeries(dd.current);
      dd.current = null;
    }
    c.timeScale().fitContent();
  }, [points, baseline, drawdown, drawdownRatio, variant]);

  return <div ref={el} style={{ height }} className="w-full" />;
}
