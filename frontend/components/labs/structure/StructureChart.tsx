"use client";

/*
 * The Market Structure Lab chart: TradingChart (candles + label markers) with a click layer — a click on (or
 * near) a candle reports that candle's index and the clicked price, so the lab can snap the selected label to
 * the candle's High / Low. A one-line read-out shows the hovered candle.
 */
import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

import TradingChart, { type MarkerDef, type PriceLineDef } from "@/components/charts/TradingChart";
import { clamp, nearestIndex } from "@/components/labs/model";
import { fmtPrice } from "@/lib/format";
import type { Candle } from "@/lib/types";

function stamp(ts: number, timeframe: string): string {
  const d = new Date(ts * 1000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCFullYear()).slice(2)}`;
  if (timeframe === "1d" || timeframe === "1w") return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function StructureChart({
  candles,
  precision,
  timeframe,
  markers,
  priceLines,
  onPick,
  hint,
  chartKey,
  height = 460,
}: {
  candles: Candle[];
  precision: number;
  timeframe: string;
  markers: MarkerDef[];
  priceLines?: PriceLineDef[];
  /** click on candle `index`; `price` = the clicked price (null outside the price pane) */
  onPick: (index: number, price: number | null) => void;
  /** what a click does right now (e.g. "клик = HH на High") */
  hint?: string;
  /** remounts the chart for a new exercise */
  chartKey: string;
  height?: number;
}) {
  const apiRef = useRef<IChartApi | null>(null);
  const pickRef = useRef(onPick);
  const candlesRef = useRef(candles);
  const [hover, setHover] = useState<Candle | null>(null);

  useEffect(() => {
    pickRef.current = onPick;
    candlesRef.current = candles;
  });

  // TradingChart creates its chart in its own mount effect, which runs before this one (children first),
  // so apiRef is set here; re-subscribe whenever the chart is remounted for a new exercise.
  useEffect(() => {
    const chart = apiRef.current;
    if (!chart) return;
    const handler = (param: MouseEventParams<Time>) => {
      if (!param.point || (param.paneIndex ?? 0) !== 0) return;
      const cs = candlesRef.current;
      if (!cs.length) return;
      let idx = -1;
      if (param.time !== undefined) idx = nearestIndex(cs, Number(param.time));
      else if (param.logical !== undefined) idx = clamp(Math.round(param.logical), 0, cs.length - 1);
      if (idx < 0) return;
      const series = chart
        .panes()[0]
        ?.getSeries()
        .find((s) => s.seriesType() === "Candlestick");
      const raw = series ? series.coordinateToPrice(param.point.y) : null;
      pickRef.current(idx, raw === null ? null : Number(raw));
    };
    chart.subscribeClick(handler);
    return () => {
      try {
        chart.unsubscribeClick(handler);
      } catch {
        /* the chart was already removed with its component */
      }
    };
  }, [chartKey]);

  const onHover = useCallback((c: Candle | null) => setHover(c), []);

  return (
    <div className="min-w-0">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pb-1.5 text-[11px] text-muted">
        <span className="num min-w-0">
          {hover ? (
            <>
              <span className="text-text">{stamp(hover.time, timeframe)}</span> · O {fmtPrice(hover.open, precision)} · H{" "}
              <span className="text-text">{fmtPrice(hover.high, precision)}</span> · L <span className="text-text">{fmtPrice(hover.low, precision)}</span> · C{" "}
              {fmtPrice(hover.close, precision)}
            </>
          ) : (
            "Наведи върху свещ, за да видиш нейните цени."
          )}
        </span>
        {hint && <span className="text-accent2">{hint}</span>}
      </div>
      <div className="glass-inset overflow-hidden rounded-xl" style={{ cursor: "crosshair" }}>
        <TradingChart
          key={chartKey}
          candles={candles}
          precision={precision}
          height={height}
          volume={false}
          markers={markers}
          priceLines={priceLines}
          fitKey={chartKey}
          visibleBars={Math.max(150, candles.length + 2)}
          onHover={onHover}
          apiRef={apiRef}
        />
      </div>
    </div>
  );
}
