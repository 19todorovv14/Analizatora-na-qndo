"use client";

import type { IChartApi } from "lightweight-charts";
import { useEffect } from "react";

import { ChartCanvas } from "@/components/charts/ChartCanvas";
import { ChartTypeMenu, DrawToolbar, IndicatorMenu, SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import type { MarkerDef, PriceLineDef, ZoneDef } from "@/components/charts/TradingChart";
import { useChartWorkspace } from "@/components/charts/useChartWorkspace";
import { SourceBadge, Spinner } from "@/components/ui";
import type { CandlesResponse, Order, Position, Trade } from "@/lib/types";

type Props = {
  symbol: string;
  onSymbol: (s: string) => void;
  timeframe: string;
  onTimeframe: (tf: string) => void;
  height?: number;
  positions?: Position[];
  trades?: Trade[];
  headerRight?: React.ReactNode;
  apiRef?: React.RefObject<IChartApi | null>;
  beginner?: boolean;
  onData?: (d: CandlesResponse) => void;
  onPriceClick?: (price: number) => void;
  storageKey?: string;
  /* ── v2 (optional) ── */
  orders?: Order[];
  extraPriceLines?: PriceLineDef[];
  extraMarkers?: MarkerDef[];
  extraZones?: ZoneDef[];
};

/**
 * Classic chart block (header row + drawing tools + chart) for pages that embed a chart in a card
 * (asset page, …). Built on useChartWorkspace + ChartCanvas — the terminal pages compose the same
 * pieces into TerminalLayout instead. Props are unchanged from v1 (new ones are optional).
 */
export function ChartWorkspace({
  symbol,
  onSymbol,
  timeframe,
  onTimeframe,
  height = 560,
  positions,
  trades,
  headerRight,
  apiRef,
  beginner,
  onData,
  onPriceClick,
  storageKey = "charts",
  orders,
  extraPriceLines,
  extraMarkers,
  extraZones,
}: Props) {
  const ws = useChartWorkspace({ symbol, timeframe, storageKey, positions, trades, orders, extraPriceLines, extraMarkers, extraZones });
  const { data } = ws;

  useEffect(() => {
    if (data && onData) onData(data);
  }, [data, onData]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SymbolPicker value={symbol} onChange={onSymbol} />
        <TimeframeBar value={timeframe} onChange={onTimeframe} beginner={beginner} />
        <IndicatorMenu active={ws.active} onChange={ws.setActive} />
        <ChartTypeMenu value={ws.chartType} onChange={ws.setChartType} />
        <SourceBadge source={ws.source} />
        {(ws.isLoading || ws.loadingOlder) && <Spinner />}
        {headerRight && <div className="ml-auto flex flex-wrap items-center gap-2">{headerRight}</div>}
      </div>
      <div className="flex gap-2">
        <DrawToolbar
          tool={ws.tool}
          onTool={ws.setTool}
          color={ws.color}
          onColor={ws.setColor}
          onClear={ws.clearDrawings}
          className="shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-0.5"
        />
        <ChartCanvas
          ws={ws}
          height={height}
          beginner={beginner}
          onPriceClick={onPriceClick}
          apiRef={apiRef}
          className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.015]"
        />
      </div>
      {beginner && ws.tool !== "cursor" && ws.tool !== "crosshair" && (
        <p className="text-xs text-muted">
          Режим чертане: {ws.tool === "hline" || ws.tool === "text" ? "кликни върху графиката" : "кликни и плъзни (или кликни два пъти)"}. Рисунките се
          пазят за този инструмент. Избери Cursor, за да селектираш и изтриеш рисунка.
        </p>
      )}
    </div>
  );
}
