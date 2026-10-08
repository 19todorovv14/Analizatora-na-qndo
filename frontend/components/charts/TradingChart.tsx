"use client";

import {
  AreaSeries,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ITextWatermarkPluginApi,
  type Logical,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  barStep,
  heightsToStretch,
  heikinAshi,
  logicalToTime,
  nearHistoryStart,
  paneOrder,
  planCandleUpdate,
  planPointUpdate,
  stretchFactors,
  timeToLogical,
} from "@/components/charts/chartMath";
import { captureChartWithOverlay } from "@/components/charts/capture";
import { DrawingLayer, EMPTY_PROJ, type HandleKey, type Projector } from "@/components/charts/DrawingLayer";
import {
  DRAW_COLORS,
  TWO_POINT_TOOLS,
  isDrawingTool,
  moveHandle,
  newDrawingId,
  type DPoint,
  type Drawing,
  type DrawingType,
  type Tool,
} from "@/components/charts/drawings";
import { DataNotAvailable } from "@/components/ui";
import { cx } from "@/lib/format";
import { CHART, baseChartOptions, repaintWhenFontsReady } from "@/lib/theme";
import type { Candle, Point } from "@/lib/types";

export type LineDef = { id: string; data: Point[]; color: string; width?: number; dashed?: boolean };
export type HistDef = { id: string; data: { time: number; value: number; color?: string }[]; color: string };
export type PaneDef = { id: string; lines?: LineDef[]; hist?: HistDef[]; levels?: { price: number; color: string }[] };
export type MarkerDef = {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  color: string;
  text?: string;
};
export type PriceLineDef = { id: string; price: number; color: string; title?: string; dashed?: boolean };
export type ZoneDef = { id: string; low: number; high: number; color: string; label?: string };

/** candles · line (close) · area (close) · Heikin-Ashi */
export type ChartType = "candles" | "line" | "area" | "heikin";

export type CaptureOptions = {
  /** scroll to this time range (unix s) before capturing, then restore the view (journal screenshots) */
  focus?: { from: number; to: number } | null;
  mime?: string;
  quality?: number;
};
/** Screenshot of the chart INCLUDING the drawings / zones overlay (data URL, or null). */
export type ChartCapture = (opts?: CaptureOptions) => Promise<string | null>;

const UP = CHART.up;
const DOWN = CHART.down;
const TRANSPARENT = "rgba(0,0,0,0)";

// stable defaults: fresh [] literals would re-run every effect on each parent render
const NO_LINES: LineDef[] = [];
const NO_PANES: PaneDef[] = [];
const NO_MARKERS: MarkerDef[] = [];
const NO_PRICE_LINES: PriceLineDef[] = [];
const NO_ZONES: ZoneDef[] = [];
const NO_DRAWINGS: Drawing[] = [];

type Props = {
  candles: Candle[];
  precision?: number;
  /** px, or "fill" = 100 % of the parent (the parent needs a definite height, e.g. a grid cell with min-h-0) */
  height?: number | "fill";
  /** volume histogram in its own pane under the price pane */
  volume?: boolean;
  overlays?: LineDef[];
  /** indicator panes (after the volume pane) */
  panes?: PaneDef[];
  markers?: MarkerDef[];
  priceLines?: PriceLineDef[];
  zones?: ZoneDef[];
  tool?: Tool;
  drawings?: Drawing[];
  onDrawingsChange?: (d: Drawing[]) => void;
  drawColor?: string;
  /** a change re-fits the view to the last `visibleBars` bars (symbol / timeframe switch) */
  fitKey?: string;
  visibleBars?: number;
  /** Pin the visible logical range (used by animated lesson scenarios). */
  logicalRange?: { from: number; to: number };
  onHover?: (c: Candle | null) => void;
  /** click on the price pane (cursor tools): price + position in px relative to the chart */
  onPriceClick?: (price: number, at?: { x: number; y: number }) => void;
  /** click on any candle (any pane): the candle + price under the pointer (null outside the price pane) */
  onCandleClick?: (c: Candle, price: number | null) => void;
  /** highlight one candle (unix s of its open) */
  highlightTime?: number | null;
  apiRef?: React.RefObject<IChartApi | null>;
  captureRef?: React.RefObject<ChartCapture | null>;
  hideTimeAxis?: boolean;
  className?: string;
  /** first load in flight (skeleton instead of an empty grid) */
  loading?: boolean;
  /** no data from the provider: DATA NOT AVAILABLE overlay (string = reason) */
  unavailable?: string | boolean | null;
  /** synthetic demo data → subtle "DEMO" watermark */
  demo?: boolean;
  chartType?: ChartType;
  /** persist pane heights (stretch factors) under localStorage "ta-panes:<key>" */
  paneStorageKey?: string;
  /** the user scrolled to the oldest loaded bar (lazy history paging) */
  onReachStart?: () => void;
  /** absolutely positioned content over the chart (e.g. a click-to-set chooser) */
  children?: React.ReactNode;
};

const ts = (t: number) => t as UTCTimestamp;
const bar = (c: Candle) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
const volBar = (c: Candle) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? CHART.volUp : CHART.volDown });
const linePt = (p: Point) => ({ time: ts(p.time), value: p.value });
const histPt = (d: { time: number; value: number; color?: string }) => ({ time: ts(d.time), value: d.value, ...(d.color ? { color: d.color } : {}) });

type Synced<T extends SeriesType> = { series: ISeriesApi<T>; data: Point[] };

/** setData or incremental update() of a line / histogram series. */
function syncPoints<T extends SeriesType>(entry: Synced<T>, next: Point[], map: (p: Point) => object = linePt) {
  const plan = planPointUpdate(entry.data, next);
  const s = entry.series as unknown as ISeriesApi<"Line">;
  if (plan.kind === "reset") s.setData(next.map(map) as never);
  else if (plan.kind === "tail") for (let i = plan.from; i < next.length; i++) s.update(map(next[i]) as never);
  entry.data = next;
}

function loadStretch(key?: string): Record<string, number> | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(`ta-panes:${key}`);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, number>) : null;
  } catch {
    return null;
  }
}

function saveStretch(key: string, v: Record<string, number>) {
  try {
    window.localStorage.setItem(`ta-panes:${key}`, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

function makeProjector(chart: IChartApi, series: ISeriesApi<"Candlestick">, cs: Candle[]): Projector {
  const scale = chart.timeScale();
  const a = scale.logicalToCoordinate(0 as Logical);
  const b = scale.logicalToCoordinate(1 as Logical);
  return {
    w: scale.width(),
    h: chart.panes()[0]?.getHeight() ?? 0,
    n: cs.length,
    step: barStep(cs),
    barSpacing: a !== null && b !== null ? Math.abs(b - a) : 6,
    timeToX: (t: number) => {
      const l = timeToLogical(cs, t);
      return l === null ? null : scale.logicalToCoordinate(l as Logical);
    },
    priceToY: (p: number) => series.priceToCoordinate(p),
  };
}

const isEditableTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * lightweight-charts v5 wrapper: candles (or line / area / Heikin-Ashi), volume in its own pane, indicator
 * panes after it, overlays, markers, price lines, zones and an SVG drawing layer (8 classic tools + fib
 * retracement + long/short position). Updates incrementally (series.update for the last bar), re-projects
 * the drawings only on view changes (no perpetual animation loop) and can capture itself with the drawings.
 */
export default function TradingChart({
  candles,
  precision = 2,
  height = 420,
  volume = true,
  overlays = NO_LINES,
  panes = NO_PANES,
  markers = NO_MARKERS,
  priceLines = NO_PRICE_LINES,
  zones = NO_ZONES,
  tool = "cursor",
  drawings = NO_DRAWINGS,
  onDrawingsChange,
  drawColor = DRAW_COLORS[0],
  fitKey = "",
  visibleBars = 150,
  logicalRange,
  onHover,
  onPriceClick,
  onCandleClick,
  highlightTime,
  apiRef,
  captureRef,
  hideTimeAxis,
  className,
  loading,
  unavailable,
  demo,
  chartType = "candles",
  paneStorageKey,
  onReachStart,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const mainLineRef = useRef<{ type: "line" | "area"; entry: Synced<"Line" | "Area"> } | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayMap = useRef(new Map<string, Synced<"Line"> & { style: string }>());
  const paneSeries = useRef<Synced<SeriesType>[]>([]);
  const paneKey = useRef("");
  const paneIds = useRef<string[]>(["main"]);
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markerSig = useRef("");
  const priceLineMap = useRef(new Map<string, { line: IPriceLine; sig: string }>());
  const watermark = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const candleByTime = useRef(new Map<number, Candle>());
  const drawn = useRef<{ shown: Candle[]; raw: Candle[]; type: ChartType; volume: boolean }>({ shown: [], raw: [], type: "candles", volume: false });
  const fittedKey = useRef<string | null>(null);
  const reachRequested = useRef(-1);
  const schedule = useRef<() => void>(() => {});
  const stretchKey = useRef(paneStorageKey);
  const cb = useRef({ onHover, onPriceClick, onCandleClick, onReachStart });

  const [proj, setProj] = useState<Projector>(EMPTY_PROJ);
  const [draftState, setDraft] = useState<{ p1: DPoint; p2: DPoint; dragging: boolean; sx: number; sy: number; tool: Tool } | null>(null);
  const [measureState, setMeasure] = useState<{ p1: DPoint; p2: DPoint; tool: Tool } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; handle: HandleKey; d: Drawing } | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number; pt: DPoint; tool: Tool } | null>(null);
  // drafts / measurements / text inputs belong to the tool that created them; switching tools hides them
  const draft = draftState && draftState.tool === tool ? draftState : null;
  const measure = measureState && measureState.tool === tool ? measureState : null;
  const textInput = textAt && textAt.tool === tool ? textAt : null;

  useEffect(() => {
    cb.current = { onHover, onPriceClick, onCandleClick, onReachStart };
    stretchKey.current = paneStorageKey;
  }, [onHover, onPriceClick, onCandleClick, onReachStart, paneStorageKey]);

  // ------------------------------------------------------------ create chart
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const base = baseChartOptions({ hideTimeAxis });
    const chart = createChart(el, { ...base, timeScale: { ...base.timeScale, rightOffset: 8 } });
    repaintWhenFontsReady(chart);
    const series = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN });
    chartRef.current = chart;
    candleRef.current = series;
    if (apiRef) apiRef.current = chart;

    // the drawing overlay is re-projected only when the view can have changed: scroll / zoom / resize /
    // pointer activity (price-axis drags, pane separators) / data updates — coalesced to one per frame
    let raf = 0;
    let last = "";
    const recompute = () => {
      raf = 0;
      const cs = candlesRef.current;
      if (!cs.length) {
        if (last !== "empty") {
          last = "empty";
          setProj(EMPTY_PROJ);
        }
        return;
      }
      const c = cs[cs.length - 1];
      const scale = chart.timeScale();
      const sig = [
        cs.length,
        cs[0].time,
        c.time,
        series.priceToCoordinate(c.close),
        series.priceToCoordinate(c.close * 1.01),
        scale.logicalToCoordinate(0 as Logical),
        scale.logicalToCoordinate(1 as Logical),
        scale.width(),
        chart.panes()[0]?.getHeight(),
      ].join("|");
      if (sig !== last) {
        last = sig;
        setProj(makeProjector(chart, series, cs));
      }
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };
    schedule.current = run;

    const onRange = (range: LogicalRange | null) => {
      run();
      const reach = cb.current.onReachStart;
      const n = candlesRef.current.length;
      if (reach && range && n >= 20 && nearHistoryStart(range) && reachRequested.current !== n) {
        reachRequested.current = n;
        reach();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.timeScale().subscribeSizeChange(run);
    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      run();
      const hover = cb.current.onHover;
      if (!hover) return;
      if (param.time === undefined) return hover(null);
      hover(candleByTime.current.get(param.time as number) ?? null);
    });
    chart.subscribeClick((param: MouseEventParams<Time>) => {
      const pane = param.paneIndex ?? 0;
      const price = pane === 0 && param.point ? series.coordinateToPrice(param.point.y) : null;
      const { onPriceClick: priceClick, onCandleClick: candleClick } = cb.current;
      if (priceClick && pane === 0 && param.point && price !== null) priceClick(price, { x: param.point.x, y: param.point.y });
      if (candleClick && param.time !== undefined) {
        const c = candleByTime.current.get(param.time as number);
        if (c) candleClick(c, price);
      }
    });

    // pane separators were dragged → remember the proportions
    const persistPanes = () => {
      const key = stretchKey.current;
      if (!key) return;
      const ids = paneIds.current;
      const heights = chart.panes().map((p) => p.getHeight());
      if (heights.length !== ids.length || heights.some((h) => !(h > 0))) return;
      const next = heightsToStretch(ids, heights);
      const prev = loadStretch(key);
      const changed = ids.some((id) => Math.abs((prev?.[id] ?? -1) - (next[id] ?? -1)) > 0.02);
      if (changed) saveStretch(key, { ...prev, ...next });
    };
    const onPointerUp = () => {
      run();
      persistPanes();
    };
    el.addEventListener("pointermove", run, { passive: true });
    el.addEventListener("wheel", run, { passive: true });
    el.addEventListener("pointerup", onPointerUp);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    ro?.observe(el);

    const lines = overlayMap.current;
    const plines = priceLineMap.current;
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      el.removeEventListener("pointermove", run);
      el.removeEventListener("wheel", run);
      el.removeEventListener("pointerup", onPointerUp);
      schedule.current = () => {};
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      mainLineRef.current = null;
      volRef.current = null;
      markersApi.current = null;
      markerSig.current = "";
      watermark.current = null;
      lines.clear();
      plines.clear();
      paneSeries.current = [];
      paneKey.current = "";
      drawn.current = { shown: [], raw: [], type: "candles", volume: false };
      if (apiRef) apiRef.current = null;
    };
    // the chart instance lives for the whole component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fmt = { type: "price" as const, precision, minMove: 1 / 10 ** precision };
    candleRef.current?.applyOptions({ priceFormat: fmt });
    mainLineRef.current?.entry.series.applyOptions({ priceFormat: fmt });
  }, [precision]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { visible: !hideTimeAxis } });
  }, [hideTimeAxis]);

  // ------------------------------------------------------- chart type
  useEffect(() => {
    const chart = chartRef.current;
    const s = candleRef.current;
    if (!chart || !s) return;
    const lineType = chartType === "line" || chartType === "area" ? chartType : null;
    if (mainLineRef.current && mainLineRef.current.type !== lineType) {
      chart.removeSeries(mainLineRef.current.entry.series);
      mainLineRef.current = null;
    }
    if (lineType && !mainLineRef.current) {
      const fmt = { type: "price" as const, precision, minMove: 1 / 10 ** precision };
      const series =
        lineType === "area"
          ? chart.addSeries(AreaSeries, { lineColor: CHART.areaLine, topColor: CHART.areaTop, bottomColor: CHART.areaBottom, lineWidth: 2, priceFormat: fmt })
          : chart.addSeries(LineSeries, { color: CHART.accent2, lineWidth: 2, priceFormat: fmt });
      mainLineRef.current = { type: lineType, entry: { series: series as ISeriesApi<"Line" | "Area">, data: [] } };
    }
    const hide = !!lineType;
    s.applyOptions({
      upColor: hide ? TRANSPARENT : UP,
      downColor: hide ? TRANSPARENT : DOWN,
      wickUpColor: hide ? TRANSPARENT : UP,
      wickDownColor: hide ? TRANSPARENT : DOWN,
      lastValueVisible: !hide,
      priceLineVisible: !hide,
    });
    // precision is applied by its own effect; the series is created with it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  // ------------------------------------------------------------------ data
  useEffect(() => {
    const chart = chartRef.current;
    const s = candleRef.current;
    if (!chart || !s) return;
    candlesRef.current = candles;
    candleByTime.current = new Map(candles.map((c) => [c.time, c]));
    const prev = drawn.current;
    const typeChanged = prev.type !== chartType;
    const shown = chartType === "heikin" ? heikinAshi(candles) : candles;

    const plan = typeChanged ? ({ kind: "reset" } as const) : planCandleUpdate(prev.shown, shown);
    if (plan.kind === "reset") s.setData(shown.map(bar));
    else if (plan.kind === "tail") for (let i = plan.from; i < shown.length; i++) s.update(bar(shown[i]));

    const rawPlan = planCandleUpdate(prev.raw, candles);
    const main = mainLineRef.current;
    if (main) {
      const closes = candles.map((c) => ({ time: c.time, value: c.close }));
      if (typeChanged) main.entry.data = [];
      syncPoints(main.entry, closes);
    }

    if (volume) {
      let fresh = false;
      if (!volRef.current) {
        volRef.current = chart.addSeries(
          HistogramSeries,
          { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false, color: CHART.volUp },
          1,
        );
        volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
        fresh = true;
      }
      if (fresh || !prev.volume || rawPlan.kind === "reset") volRef.current.setData(candles.map(volBar));
      else if (rawPlan.kind === "tail") for (let i = rawPlan.from; i < candles.length; i++) volRef.current.update(volBar(candles[i]));
    } else if (volRef.current) {
      chart.removeSeries(volRef.current);
      volRef.current = null;
    }
    drawn.current = { shown, raw: candles, type: chartType, volume };

    if (logicalRange && candles.length) {
      chart.timeScale().setVisibleLogicalRange(logicalRange);
    } else if (candles.length && fittedKey.current !== fitKey) {
      fittedKey.current = fitKey;
      reachRequested.current = -1;
      const n = candles.length;
      if (n > visibleBars) chart.timeScale().setVisibleLogicalRange({ from: n - visibleBars, to: n + 6 });
      else chart.timeScale().fitContent();
    }
    schedule.current();
  }, [candles, chartType, volume, fitKey, visibleBars, logicalRange]);

  // -------------------------------------------------------------- panes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const first = volume ? 2 : 1;
    const key = `${volume ? "v" : "-"}|${panes
      .map((p) => `${p.id}:${(p.lines ?? []).map((l) => l.id).join("|")}:${(p.hist ?? []).map((h) => h.id).join("|")}`)
      .join(";")}`;
    if (key !== paneKey.current) {
      paneSeries.current.forEach((e) => chart.removeSeries(e.series));
      paneSeries.current = [];
      paneKey.current = key;
      panes.forEach((p, i) => {
        const paneIndex = first + i;
        (p.hist ?? []).forEach((h) => {
          const series = chart.addSeries(HistogramSeries, { color: h.color, priceLineVisible: false, lastValueVisible: false }, paneIndex);
          paneSeries.current.push({ series, data: [] });
        });
        (p.lines ?? []).forEach((l, j) => {
          const series = chart.addSeries(
            LineSeries,
            { color: l.color, lineWidth: (l.width ?? 2) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false },
            paneIndex,
          );
          if (j === 0) {
            (p.levels ?? []).forEach((lv) =>
              series.createPriceLine({ price: lv.price, color: lv.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }),
            );
          }
          paneSeries.current.push({ series, data: [] });
        });
      });
      const ids = paneOrder(volume, panes.map((p) => p.id));
      paneIds.current = ids;
      const factors = stretchFactors(ids, loadStretch(stretchKey.current));
      chart.panes().forEach((pane, i) => pane.setStretchFactor(factors[i] ?? 0.3));
    }
    let k = 0;
    panes.forEach((p) => {
      (p.hist ?? []).forEach((h) => {
        const e = paneSeries.current[k++];
        if (e) syncPoints(e, h.data, histPt);
      });
      (p.lines ?? []).forEach((l) => {
        const e = paneSeries.current[k++];
        if (e) syncPoints(e, l.data);
      });
    });
    schedule.current();
  }, [panes, volume]);

  // ---------------------------------------------------------- overlays
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = overlayMap.current;
    const ids = new Set(overlays.map((o) => o.id));
    for (const [id, e] of map) {
      if (!ids.has(id)) {
        chart.removeSeries(e.series);
        map.delete(id);
      }
    }
    for (const o of overlays) {
      const style = `${o.color}|${o.width ?? 2}|${o.dashed ? 1 : 0}`;
      const opts = {
        color: o.color,
        lineWidth: (o.width ?? 2) as 1 | 2 | 3 | 4,
        lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
      let e = map.get(o.id);
      if (!e) {
        e = { series: chart.addSeries(LineSeries, opts), data: [], style };
        map.set(o.id, e);
      } else if (e.style !== style) {
        e.series.applyOptions(opts);
        e.style = style;
      }
      syncPoints(e, o.data);
    }
  }, [overlays]);

  // ------------------------------------------------- markers & price lines
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    if (!markersApi.current) markersApi.current = createSeriesMarkers(s, []);
    const known = candleByTime.current;
    const list = markers.filter((m) => known.has(m.time)).sort((a, b) => a.time - b.time);
    const sig = JSON.stringify(list);
    if (sig === markerSig.current) return;
    markerSig.current = sig;
    markersApi.current.setMarkers(list.map((m) => ({ ...m, time: ts(m.time) })));
  }, [markers, candles]);

  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    const map = priceLineMap.current;
    const ids = new Set(priceLines.map((p) => p.id));
    for (const [id, e] of map) {
      if (!ids.has(id)) {
        s.removePriceLine(e.line);
        map.delete(id);
      }
    }
    for (const pl of priceLines) {
      const opts = {
        price: pl.price,
        color: pl.color,
        lineWidth: 1 as const,
        lineStyle: pl.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: pl.title ?? "",
      };
      const sig = JSON.stringify(opts);
      const e = map.get(pl.id);
      if (!e) map.set(pl.id, { line: s.createPriceLine(opts), sig });
      else if (e.sig !== sig) {
        e.line.applyOptions(opts);
        e.sig = sig;
      }
    }
  }, [priceLines]);

  // -------------------------------------------------- DEMO watermark
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (demo && !watermark.current) {
      const pane = chart.panes()[0];
      if (!pane) return;
      watermark.current = createTextWatermark(pane, {
        horzAlign: "center",
        vertAlign: "center",
        lines: [{ text: "DEMO", color: "rgba(148,163,184,0.075)", fontSize: 72, fontFamily: CHART.fontFamily, fontStyle: "700" }],
      });
    }
    watermark.current?.applyOptions({ visible: !!demo });
  }, [demo]);

  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: { mode: tool === "cursor" ? CrosshairMode.Magnet : CrosshairMode.Normal } });
  }, [tool]);

  // ------------------------------------------------------------ capture
  useEffect(() => {
    if (!captureRef) return;
    const capture: ChartCapture = async (opts) => {
      const api = chartRef.current;
      if (!api) return null;
      let restore: LogicalRange | null = null;
      const cs = candlesRef.current;
      if (opts?.focus && cs.length > 1) {
        const a = timeToLogical(cs, opts.focus.from);
        const b = timeToLogical(cs, opts.focus.to);
        if (a !== null && b !== null && b >= -5 && a <= cs.length + 5) {
          restore = api.timeScale().getVisibleLogicalRange();
          const pad = Math.max(12, (b - a) * 0.8);
          api.timeScale().setVisibleLogicalRange({ from: a - pad, to: b + pad });
          // let the overlay re-project and re-render before rasterising it
          await new Promise((r) => setTimeout(r, 180));
        }
      }
      const url = await captureChartWithOverlay(api, svgRef.current, opts?.mime ?? "image/jpeg", opts?.quality ?? 0.85);
      if (restore && chartRef.current) chartRef.current.timeScale().setVisibleLogicalRange(restore);
      return url;
    };
    captureRef.current = capture;
    return () => {
      if (captureRef.current === capture) captureRef.current = null;
    };
  }, [captureRef]);

  // ---------------------------------------------------- coordinate helpers
  const xToTime = useCallback((x: number): number | null => {
    const scale = chartRef.current?.timeScale();
    if (!scale) return null;
    const l = scale.coordinateToLogical(x);
    return l === null ? null : logicalToTime(candlesRef.current, l);
  }, []);

  const pointAt = (clientX: number, clientY: number): { pt: DPoint; x: number; y: number } | null => {
    const r = overlayRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = clientX - r.left;
    const y = clientY - r.top;
    const time = xToTime(x);
    const price = candleRef.current?.coordinateToPrice(y) ?? null;
    if (time === null || price === null) return null;
    return { pt: { time, price }, x, y };
  };

  const addDrawing = (d: Omit<Drawing, "id" | "color">) => {
    const id = newDrawingId();
    onDrawingsChange?.([...drawings, { ...d, id, color: drawColor }]);
    return id;
  };

  const drawingMode = isDrawingTool(tool);
  const twoPoint = TWO_POINT_TOOLS.has(tool);

  const finalize = (p1: DPoint, p2: DPoint) => {
    if (tool === "measure") return setMeasure({ p1, p2, tool });
    if (tool === "position") {
      // a tiny drag still gives a readable box: at least ~24 bars wide
      const step = barStep(candlesRef.current);
      const end = Math.abs(p2.time - p1.time) < step * 8 ? p1.time + step * 24 : p2.time;
      if (p2.price === p1.price) return;
      const id = addDrawing({ type: "position", p1, p2: { time: Math.max(end, p1.time + step), price: p2.price } });
      setSelected(id);
      return;
    }
    if (tool === "trend" || tool === "ray" || tool === "rect" || tool === "fib") addDrawing({ type: tool, p1, p2 });
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const hit = pointAt(e.clientX, e.clientY);
    if (!hit) return;
    if (tool === "hline") {
      addDrawing({ type: "hline", p1: hit.pt });
      return;
    }
    if (tool === "text") {
      setTextAt({ x: hit.x, y: hit.y, pt: hit.pt, tool });
      return;
    }
    if (!twoPoint) return;
    if (draft && !draft.dragging) {
      finalize(draft.p1, hit.pt);
      setDraft(null);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraft({ p1: hit.pt, p2: hit.pt, dragging: true, sx: hit.x, sy: hit.y, tool });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const hit = pointAt(e.clientX, e.clientY);
    if (hit) setDraft({ ...draft, p2: hit.pt });
  };

  const onUp = (e: React.PointerEvent) => {
    if (!draft || !draft.dragging) return;
    const hit = pointAt(e.clientX, e.clientY);
    if (!hit) return;
    if (Math.hypot(hit.x - draft.sx, hit.y - draft.sy) > 4) {
      finalize(draft.p1, hit.pt);
      setDraft(null);
    } else {
      setDraft({ ...draft, dragging: false }); // click-click mode: wait for the second point
    }
  };

  // ------------------------------------------------ edit handles (cursor mode)
  const onHandleDown = (e: React.PointerEvent<SVGElement>, id: string, handle: HandleKey) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const d = drawings.find((x) => x.id === id);
    if (!d) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, handle, d });
  };
  const onHandleMove = (e: React.PointerEvent<SVGElement>) => {
    if (!drag) return;
    const hit = pointAt(e.clientX, e.clientY);
    if (hit) setDrag({ ...drag, d: moveHandle(drag.d, drag.handle, hit.pt) });
  };
  const onHandleUp = () => {
    if (!drag) return;
    onDrawingsChange?.(drawings.map((x) => (x.id === drag.id ? drag.d : x)));
    setDrag(null);
  };

  const commitText = (value: string) => {
    const t = value.trim();
    if (textInput && t) addDrawing({ type: "text", p1: textInput.pt, text: t.slice(0, 80) });
    setTextAt(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setDraft(null);
        setMeasure(null);
        return;
      }
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        onDrawingsChange?.(drawings.filter((d) => d.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, drawings, onDrawingsChange]);

  // ------------------------------------------------------------- rendering
  const shownDrawings = drag ? drawings.map((d) => (d.id === drag.id ? drag.d : d)) : drawings;
  const draftDrawing: Drawing | null = draft
    ? {
        id: "draft",
        type: (tool === "measure" ? "rect" : tool) as DrawingType,
        p1: draft.p1,
        p2: draft.p2,
        color: tool === "measure" ? CHART.info : drawColor,
      }
    : null;
  const sel = selected && drawings.some((d) => d.id === selected) ? selected : null;
  let deleteBtn: React.ReactNode = null;
  if (sel && !drag && proj.n > 1) {
    const d = drawings.find((x) => x.id === sel)!;
    const x = proj.timeToX(d.p1.time);
    const y = proj.priceToY(d.p1.price);
    if (x !== null && y !== null) {
      deleteBtn = (
        <button
          type="button"
          className="absolute z-20 rounded bg-down px-1.5 py-0.5 text-[10px] font-bold text-white shadow-btn"
          style={{ left: Math.min(Math.max(x - 10, 0), Math.max(0, proj.w - 60)), top: Math.max(y - 30, 0), pointerEvents: "auto" }}
          onClick={() => {
            onDrawingsChange?.(drawings.filter((x2) => x2.id !== d.id));
            setSelected(null);
          }}
        >
          ✕ Delete
        </button>
      );
    }
  }

  const fill = height === "fill";
  const empty = candles.length === 0;
  const showUnavailable = empty && !loading && (!!unavailable || loading === false);

  return (
    <div className={cx("relative w-full overflow-hidden rounded-md", fill && "h-full min-h-0", className)} style={fill ? undefined : { height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={overlayRef}
        className="absolute left-0 top-0 z-10"
        style={{ width: proj.w, height: proj.h, pointerEvents: drawingMode ? "auto" : "none", cursor: drawingMode ? "crosshair" : "default" }}
        onPointerDown={drawingMode ? onDown : undefined}
        onPointerMove={drawingMode ? onMove : undefined}
        onPointerUp={drawingMode ? onUp : undefined}
      >
        <DrawingLayer
          proj={proj}
          drawings={shownDrawings}
          zones={zones}
          draft={draftDrawing}
          measure={measure}
          selected={sel}
          interactive={!drawingMode}
          precision={precision}
          highlightTime={highlightTime}
          onSelect={setSelected}
          onHandleDown={onHandleDown}
          onHandleMove={onHandleMove}
          onHandleUp={onHandleUp}
          svgRef={svgRef}
        />
        {deleteBtn}
        {textInput && (
          <input
            autoFocus
            aria-label="Текст на бележката"
            placeholder="Бележка… (Enter)"
            maxLength={80}
            className="absolute z-30 w-48 rounded-md border border-accent/40 bg-surface px-2 py-1 text-xs text-text shadow-modal outline-none"
            style={{ left: Math.min(textInput.x, Math.max(0, proj.w - 196)), top: Math.max(0, textInput.y - 14), pointerEvents: "auto" }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText(e.currentTarget.value);
              else if (e.key === "Escape") {
                e.stopPropagation();
                setTextAt(null);
              }
            }}
            onBlur={(e) => commitText(e.currentTarget.value)}
          />
        )}
      </div>
      {children && <div className="pointer-events-none absolute inset-0 z-30 [&>*]:pointer-events-auto">{children}</div>}
      {empty && loading && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end gap-[3px] px-6 pb-10 pt-16" aria-hidden>
          {Array.from({ length: 48 }, (_, i) => (
            <span
              key={i}
              className="skeleton flex-1 rounded-[2px]"
              style={{ height: `${28 + Math.round(22 * Math.sin(i / 4.2) + 14 * Math.cos(i / 1.7))}%`, opacity: 0.5 }}
            />
          ))}
        </div>
      )}
      {showUnavailable && (
        <div className="absolute inset-0 z-20 grid place-items-center p-4">
          <DataNotAvailable reason={typeof unavailable === "string" ? unavailable : undefined} className="w-full max-w-md bg-surface/80 backdrop-blur-sm" />
        </div>
      )}
    </div>
  );
}
