"use client";

import type { IChartApi } from "lightweight-charts";

import { ChartLegend } from "@/components/charts/ChartControls";
import TradingChart from "@/components/charts/TradingChart";
import type { Candle } from "@/lib/types";
import type { ChartWorkspaceState } from "@/components/charts/useChartWorkspace";
import { ErrorState } from "@/components/ui";
import { cx } from "@/lib/format";

/**
 * Presentational chart of a workspace: OHLC / indicator legend + TradingChart bound to the
 * useChartWorkspace state (data, indicators, drawings, annotations, history paging, capture).
 * Loading → candle skeleton, provider without data → DATA NOT AVAILABLE, other errors → retry card.
 */
export function ChartCanvas({
  ws,
  height = "fill",
  beginner,
  volume = true,
  onPriceClick,
  onCandleClick,
  highlightTime,
  apiRef,
  className,
  children,
}: {
  ws: ChartWorkspaceState;
  height?: number | "fill";
  beginner?: boolean;
  volume?: boolean;
  onPriceClick?: (price: number, at?: { x: number; y: number }) => void;
  onCandleClick?: (c: Candle, price: number | null) => void;
  highlightTime?: number | null;
  /** extra ref to the chart API (the workspace keeps its own in ws.apiRef) */
  apiRef?: React.RefObject<IChartApi | null>;
  className?: string;
  /** overlay content (e.g. the click-to-set chooser) */
  children?: React.ReactNode;
}) {
  const fill = height === "fill";
  const failed = !!ws.error && !ws.candles.length;
  return (
    <div className={cx("relative min-w-0", fill && "h-full min-h-0", className)}>
      <div className="pointer-events-none absolute left-2 top-1.5 z-20 max-w-[calc(100%-5rem)]">
        <ChartLegend data={ws.data} hover={ws.hover} active={ws.active} beginner={beginner} candles={ws.candles} />
      </div>
      <TradingChart
        candles={ws.candles}
        precision={ws.precision}
        height={height}
        volume={volume}
        overlays={ws.overlays}
        panes={ws.panes}
        priceLines={ws.priceLines}
        markers={ws.markers}
        zones={ws.zones}
        tool={ws.tool}
        drawings={ws.drawings}
        onDrawingsChange={ws.updateDrawings}
        drawColor={ws.color}
        fitKey={`${ws.symbol}-${ws.timeframe}`}
        onHover={ws.setHover}
        onPriceClick={onPriceClick}
        onCandleClick={onCandleClick}
        highlightTime={highlightTime}
        apiRef={apiRef ?? ws.apiRef}
        captureRef={ws.captureRef}
        loading={failed ? undefined : ws.isLoading}
        unavailable={ws.unavailable}
        demo={ws.source?.status === "demo"}
        chartType={ws.chartType}
        paneStorageKey={ws.storageKey}
        onReachStart={ws.loadOlder}
      >
        {failed ? (
          <div className="absolute inset-0 grid place-items-center p-4">
            <ErrorState
              title="Графиката не се зареди"
              description={ws.error}
              onRetry={() => void ws.refresh()}
              className="w-full max-w-md bg-surface/80 backdrop-blur-sm"
            />
          </div>
        ) : (
          children
        )}
      </TradingChart>
    </div>
  );
}
