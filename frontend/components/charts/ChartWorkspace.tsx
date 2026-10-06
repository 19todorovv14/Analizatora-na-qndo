"use client";

import type { IChartApi } from "lightweight-charts";
import { useEffect, useMemo, useState } from "react";

import { ChartLegend, DrawToolbar, IndicatorMenu, SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import TradingChart, { type MarkerDef, type PriceLineDef } from "@/components/charts/TradingChart";
import { DRAW_COLORS, loadDrawings, saveDrawings, type Drawing, type Tool } from "@/components/charts/drawings";
import { ErrorText, SourceBadge, Spinner } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { TF_SECONDS } from "@/lib/format";
import { useCandles, useLocalState } from "@/lib/hooks";
import { buildIndicatorSeries } from "@/lib/indicators";
import type { Candle, CandlesResponse, Position, Trade } from "@/lib/types";

type Props = {
  symbol: string;
  onSymbol: (s: string) => void;
  timeframe: string;
  onTimeframe: (tf: string) => void;
  height?: number;
  positions?: Position[];
  trades?: Trade[];
  headerRight?: React.ReactNode;
  apiRef?: React.MutableRefObject<IChartApi | null>;
  beginner?: boolean;
  onData?: (d: CandlesResponse) => void;
  onPriceClick?: (price: number) => void;
  storageKey?: string;
};

export function ChartWorkspace({
  symbol,
  onSymbol,
  timeframe,
  onTimeframe,
  height = 560,
  positions = [],
  trades = [],
  headerRight,
  apiRef,
  beginner,
  onData,
  onPriceClick,
  storageKey = "charts",
}: Props) {
  const [active, setActive] = useLocalState<string[]>(`ta-ind:${storageKey}`, ["ema20", "ema50", "rsi"]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [hover, setHover] = useState<Candle | null>(null);
  const { data, error, isLoading } = useCandles(symbol, timeframe, active, 400);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load per-symbol drawings from storage
    setDrawings(loadDrawings(symbol));
  }, [symbol]);

  useEffect(() => {
    if (data && onData) onData(data);
  }, [data, onData]);

  const updateDrawings = (d: Drawing[]) => {
    setDrawings(d);
    saveDrawings(symbol, d);
  };

  const { overlays, panes } = useMemo(() => buildIndicatorSeries(data, active), [data, active]);

  const priceLines = useMemo<PriceLineDef[]>(() => {
    const out: PriceLineDef[] = [];
    positions
      .filter((p) => p.symbol === symbol)
      .forEach((p) => {
        out.push({ id: `${p.id}-e`, price: p.entry_price, color: "#8b90a0", title: `${p.side.toUpperCase()} ${p.qty}` });
        if (p.stop_loss) out.push({ id: `${p.id}-sl`, price: p.stop_loss, color: "#ef5350", title: "SL", dashed: true });
        if (p.take_profit) out.push({ id: `${p.id}-tp`, price: p.take_profit, color: "#26a69a", title: "TP", dashed: true });
      });
    return out;
  }, [positions, symbol]);

  const markers = useMemo<MarkerDef[]>(() => {
    const step = TF_SECONDS[timeframe];
    if (!data || timeframe === "1w" || !data.candles.length) return [];
    const first = data.candles[0].time;
    const align = (t: number) => t - (t % step);
    const out: MarkerDef[] = [];
    trades
      .filter((t) => t.symbol === symbol && t.opened_ts >= first)
      .slice(0, 40)
      .forEach((t) => {
        out.push({
          time: align(t.opened_ts),
          position: t.side === "long" ? "belowBar" : "aboveBar",
          shape: t.side === "long" ? "arrowUp" : "arrowDown",
          color: t.side === "long" ? "#26a69a" : "#ef5350",
          text: t.side === "long" ? "BUY" : "SELL",
        });
        out.push({
          time: align(t.closed_ts),
          position: t.side === "long" ? "aboveBar" : "belowBar",
          shape: "circle",
          color: t.net_pnl >= 0 ? "#26a69a" : "#ef5350",
          text: `${t.net_pnl >= 0 ? "+" : ""}${t.net_pnl.toFixed(0)}`,
        });
      });
    const last = data.candles[data.candles.length - 1].time;
    return out.filter((m) => m.time <= last);
  }, [trades, data, symbol, timeframe]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SymbolPicker value={symbol} onChange={onSymbol} />
        <TimeframeBar value={timeframe} onChange={onTimeframe} beginner={beginner} />
        <IndicatorMenu active={active} onChange={setActive} />
        <SourceBadge source={data?.source} />
        {isLoading && <Spinner />}
        <div className="ml-auto flex items-center gap-2">{headerRight}</div>
      </div>
      <div className="flex gap-2">
        <DrawToolbar tool={tool} onTool={setTool} color={color} onColor={setColor} onClear={() => updateDrawings([])} />
        <div className="relative min-w-0 flex-1 rounded-md border border-line bg-panel">
          <div className="absolute left-2 top-1.5 z-20 max-w-[85%]">
            <ChartLegend data={data} hover={hover} active={active} beginner={beginner} />
          </div>
          <TradingChart
            candles={data?.candles ?? []}
            precision={data?.precision ?? 2}
            height={height}
            overlays={overlays}
            panes={panes}
            priceLines={priceLines}
            markers={markers}
            tool={tool}
            drawings={drawings}
            onDrawingsChange={updateDrawings}
            drawColor={color}
            fitKey={`${symbol}-${timeframe}`}
            onHover={setHover}
            onPriceClick={onPriceClick}
            apiRef={apiRef}
          />
        </div>
      </div>
      {error && <ErrorText error={errorMessage(error)} />}
      {beginner && tool !== "cursor" && tool !== "crosshair" && (
        <p className="text-xs text-muted">
          Режим чертане: {tool === "hline" || tool === "text" ? "кликни върху графиката" : "кликни и плъзни (или кликни два пъти)"}. Рисунките се пазят
          за този инструмент. Избери Cursor, за да селектираш и изтриеш рисунка.
        </p>
      )}
    </div>
  );
}
