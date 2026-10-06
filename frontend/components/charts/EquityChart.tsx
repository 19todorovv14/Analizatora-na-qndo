"use client";

import { AreaSeries, ColorType, createChart, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

/** Simple equity curve (time, value) rendered with Lightweight Charts. */
export function EquityChart({ points, height = 220, baseline }: { points: [number, number][]; height?: number; baseline?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const base = useRef<IPriceLine | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#131722" }, textColor: "#b2b5be", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#1b1f2b" }, horzLines: { color: "#1b1f2b" } },
      localization: { locale: "en-US" },
      rightPriceScale: { borderColor: "#2a2e39" },
      timeScale: { borderColor: "#2a2e39", timeVisible: true },
    });
    series.current = c.addSeries(AreaSeries, {
      lineColor: "#2962ff",
      topColor: "rgba(41,98,255,0.35)",
      bottomColor: "rgba(41,98,255,0.02)",
      lineWidth: 2,
      priceLineVisible: false,
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
      base.current = series.current.createPriceLine({ price: baseline, color: "#5d6273", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "start" });
    }
    chart.current.timeScale().fitContent();
  }, [points, baseline]);

  return <div ref={el} style={{ height }} className="w-full" />;
}
