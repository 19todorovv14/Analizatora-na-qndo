"use client";

import { AreaSeries, LineStyle, createChart, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

import { CHART, baseChartOptions, repaintWhenFontsReady } from "@/lib/theme";

/** Simple equity curve (time, value) rendered with Lightweight Charts. */
export function EquityChart({ points, height = 220, baseline }: { points: [number, number][]; height?: number; baseline?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const base = useRef<IPriceLine | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, baseChartOptions());
    repaintWhenFontsReady(c);
    series.current = c.addSeries(AreaSeries, {
      lineColor: CHART.areaLine,
      topColor: CHART.areaTop,
      bottomColor: CHART.areaBottom,
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerBorderColor: CHART.surface,
      crosshairMarkerBackgroundColor: CHART.areaLine,
    });
    chart.current = c;
    return () => c.remove();
  }, []);

  useEffect(() => {
    if (!series.current || !chart.current) return;
    const seen = new Set<number>();
    const data = points
      .filter(([t]) => (seen.has(t) ? false : (seen.add(t), true)))
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
    series.current.setData(data);
    if (base.current) series.current.removePriceLine(base.current);
    base.current = null;
    if (baseline !== undefined) {
      base.current = series.current.createPriceLine({
        price: baseline,
        color: CHART.baseline,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "start",
      });
    }
    chart.current.timeScale().fitContent();
  }, [points, baseline]);

  return <div ref={el} style={{ height }} className="w-full" />;
}
