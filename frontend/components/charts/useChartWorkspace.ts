"use client";

import type { IChartApi } from "lightweight-charts";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  accumulateLive,
  historyRequest,
  mergeHistoryPage,
  seriesKey,
  snapToBar,
  type ChartSeriesState,
} from "@/components/charts/chartMath";
import { DRAW_COLORS, loadDrawings, saveDrawings, type Drawing, type Tool } from "@/components/charts/drawings";
import type { ChartCapture, ChartType, LineDef, MarkerDef, PaneDef, PriceLineDef, ZoneDef } from "@/components/charts/TradingChart";
import { errorReason, fetcher, isDataNotAvailable } from "@/lib/api";
import { candlesKey, useCandles, useLocalState } from "@/lib/hooks";
import { buildIndicatorSeries } from "@/lib/indicators";
import { CHART, PALETTE } from "@/lib/theme";
import type { Candle, CandlesResponse, Order, Position, Trade } from "@/lib/types";

export const DEFAULT_INDICATORS = ["ema20", "ema50", "rsi"];
const CHART_TYPES: ChartType[] = ["candles", "line", "area", "heikin"];
const NO_POSITIONS: Position[] = [];
const NO_ORDERS: Order[] = [];
const NO_TRADES: Trade[] = [];
const NO_LINES: PriceLineDef[] = [];
const NO_MARKERS: MarkerDef[] = [];
const NO_ZONES: ZoneDef[] = [];

export type ChartWorkspaceOptions = {
  symbol: string;
  timeframe: string;
  /** namespace of the persisted indicator set / chart type / pane heights ("charts", "paper", "asset", …) */
  storageKey?: string;
  positions?: Position[];
  /** open (limit / stop) orders → dashed price lines */
  orders?: Order[];
  trades?: Trade[];
  /** extra annotations merged with the position / trade ones (draft order, strategy levels, …) */
  extraPriceLines?: PriceLineDef[];
  extraMarkers?: MarkerDef[];
  extraZones?: ZoneDef[];
  /** liquidation price lines of open positions */
  showLiquidation?: boolean;
  /** candle polling interval (ms, ≥ 5000) */
  refreshMs?: number;
  /** number of bars of the live window */
  limit?: number;
};

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspace>;

/**
 * All state of a chart workspace (data, indicators, drawings, tools, annotations, history paging) without
 * any layout — the terminal pages and the classic ChartWorkspace render it with their own chrome.
 */
export function useChartWorkspace({
  symbol,
  timeframe,
  storageKey = "charts",
  positions = NO_POSITIONS,
  orders = NO_ORDERS,
  trades = NO_TRADES,
  extraPriceLines = NO_LINES,
  extraMarkers = NO_MARKERS,
  extraZones = NO_ZONES,
  showLiquidation,
  refreshMs = 5000,
  limit = 400,
}: ChartWorkspaceOptions) {
  const [active, setActive] = useLocalState<string[]>(`ta-ind:${storageKey}`, DEFAULT_INDICATORS);
  const [storedType, setChartType] = useLocalState<ChartType>(`ta-chart-type:${storageKey}`, "candles");
  const chartType: ChartType = CHART_TYPES.includes(storedType) ? storedType : "candles";
  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const [hover, setHover] = useState<Candle | null>(null);
  const apiRef = useRef<IChartApi | null>(null);
  const captureRef = useRef<ChartCapture | null>(null);

  // ── drawings: per symbol in localStorage (shared by every page and timeframe)
  const [drawingState, setDrawingState] = useState<{ symbol: string; list: Drawing[] } | null>(null);
  if (typeof window !== "undefined" && drawingState?.symbol !== symbol) {
    setDrawingState({ symbol, list: loadDrawings(symbol) });
  }
  const drawings = drawingState?.symbol === symbol ? drawingState.list : [];
  const updateDrawings = useCallback(
    (d: Drawing[]) => {
      setDrawingState({ symbol, list: d });
      saveDrawings(symbol, d);
    },
    [symbol],
  );
  const clearDrawings = useCallback(() => updateDrawings([]), [updateDrawings]);

  // ── candles: live window (polled) accumulated with older history pages
  const indicators = useMemo(() => active.filter((k) => typeof k === "string"), [active]);
  const { data, error, isLoading, mutate } = useCandles(symbol, timeframe, indicators, limit, true, { refreshMs });
  const [acc, setAcc] = useState<ChartSeriesState | null>(null);
  const [seen, setSeen] = useState<CandlesResponse | undefined>(undefined);
  if (data && data !== seen) {
    setSeen(data);
    setAcc((prev) => accumulateLive(prev, data));
  }
  const key = seriesKey(symbol, timeframe);
  const view = acc && acc.key === key ? acc : null;
  const candles = view?.candles ?? EMPTY_CANDLES;

  const merged = useMemo<CandlesResponse | undefined>(
    () => (view ? { ...view.meta, candles: view.candles, indicators: view.indicators } : undefined),
    [view],
  );

  const [loadingOlder, setLoadingOlder] = useState(false);
  const busy = useRef(false);
  const loadOlder = useCallback(async () => {
    if (!view || busy.current) return;
    const req = historyRequest(view);
    if (!req) return;
    busy.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetcher<CandlesResponse>(candlesKey(symbol, timeframe, indicators, req.limit, req.end));
      setAcc((prev) => (prev && prev.key === view.key ? mergeHistoryPage(prev, page) : prev));
    } catch {
      setAcc((prev) => (prev && prev.key === view.key ? { ...prev, exhausted: true } : prev));
    } finally {
      busy.current = false;
      setLoadingOlder(false);
    }
  }, [view, symbol, timeframe, indicators]);

  const unavailable: string | null = !view && error ? (isDataNotAvailable(error) ? errorReason(error) : null) : null;
  const loadError = !view && error && !unavailable ? errorReason(error) : null;
  const source = view?.meta.source ?? null;

  const { overlays, panes } = useMemo<{ overlays: LineDef[]; panes: PaneDef[] }>(() => buildIndicatorSeries(merged, indicators), [merged, indicators]);

  const priceLines = useMemo<PriceLineDef[]>(() => {
    const out: PriceLineDef[] = [];
    positions
      .filter((p) => p.symbol === symbol)
      .forEach((p) => {
        out.push({ id: `${p.id}-e`, price: p.entry_price, color: PALETTE.muted, title: `${p.side.toUpperCase()} ${p.qty}` });
        if (p.stop_loss) out.push({ id: `${p.id}-sl`, price: p.stop_loss, color: CHART.down, title: "SL", dashed: true });
        if (p.take_profit) out.push({ id: `${p.id}-tp`, price: p.take_profit, color: CHART.up, title: "TP", dashed: true });
        if (showLiquidation && p.liquidation_price) out.push({ id: `${p.id}-liq`, price: p.liquidation_price, color: CHART.warn, title: "LIQ", dashed: true });
      });
    orders
      .filter((o) => o.symbol === symbol && o.price && (o.status === "open" || o.status === "pending" || o.status === "partially_filled"))
      .forEach((o) => {
        out.push({ id: `o-${o.id}`, price: o.price as number, color: CHART.accent2, title: `${o.side.toUpperCase()} ${o.type.toUpperCase()} ${o.qty}`, dashed: true });
      });
    return extraPriceLines.length ? out.concat(extraPriceLines) : out;
  }, [positions, orders, symbol, showLiquidation, extraPriceLines]);

  const markers = useMemo<MarkerDef[]>(() => {
    if (!candles.length) return extraMarkers;
    const first = candles[0].time;
    const out: MarkerDef[] = [];
    trades
      .filter((t) => t.symbol === symbol && t.closed_ts >= first)
      .slice(0, 40)
      .forEach((t) => {
        const open = snapToBar(candles, t.opened_ts);
        const close = snapToBar(candles, t.closed_ts);
        if (open !== null)
          out.push({
            time: open,
            position: t.side === "long" ? "belowBar" : "aboveBar",
            shape: t.side === "long" ? "arrowUp" : "arrowDown",
            color: t.side === "long" ? CHART.up : CHART.down,
            text: t.side === "long" ? "BUY" : "SELL",
          });
        if (close !== null)
          out.push({
            time: close,
            position: t.side === "long" ? "aboveBar" : "belowBar",
            shape: "circle",
            color: t.net_pnl >= 0 ? CHART.up : CHART.down,
            text: `${t.net_pnl >= 0 ? "+" : ""}${t.net_pnl.toFixed(0)}`,
          });
      });
    return extraMarkers.length ? out.concat(extraMarkers) : out;
  }, [trades, candles, symbol, extraMarkers]);

  const lastPrice = candles.length ? candles[candles.length - 1].close : null;

  return {
    symbol,
    timeframe,
    storageKey,
    /** accumulated response (live window + history pages) */
    data: merged,
    candles,
    precision: view?.meta.precision ?? 2,
    source,
    lastPrice,
    isLoading: !view && (isLoading || !error),
    error: loadError,
    unavailable,
    refresh: mutate,
    active: indicators,
    setActive,
    chartType,
    setChartType,
    tool,
    setTool,
    color,
    setColor,
    drawings,
    updateDrawings,
    clearDrawings,
    hover,
    setHover,
    overlays,
    panes,
    priceLines,
    markers,
    zones: extraZones,
    loadOlder,
    loadingOlder,
    historyExhausted: !!view?.exhausted,
    apiRef,
    captureRef,
  };
}

const EMPTY_CANDLES: Candle[] = [];
