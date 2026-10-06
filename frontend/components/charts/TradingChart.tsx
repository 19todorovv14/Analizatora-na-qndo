"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

import { DRAW_COLORS, type DPoint, type Drawing, type Tool } from "@/components/charts/drawings";
import { cx, fmtDuration, fmtPrice } from "@/lib/format";
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

const UP = "#26a69a";
const DOWN = "#ef5350";

type Props = {
  candles: Candle[];
  precision?: number;
  height?: number;
  volume?: boolean;
  overlays?: LineDef[];
  panes?: PaneDef[];
  markers?: MarkerDef[];
  priceLines?: PriceLineDef[];
  zones?: ZoneDef[];
  tool?: Tool;
  drawings?: Drawing[];
  onDrawingsChange?: (d: Drawing[]) => void;
  drawColor?: string;
  fitKey?: string;
  visibleBars?: number;
  /** Pin the visible logical range (used by animated lesson scenarios). */
  logicalRange?: { from: number; to: number };
  onHover?: (c: Candle | null) => void;
  onPriceClick?: (price: number) => void;
  apiRef?: React.MutableRefObject<IChartApi | null>;
  hideTimeAxis?: boolean;
  className?: string;
};

const ts = (t: number) => t as UTCTimestamp;

/** Snapshot of the chart's coordinate system, refreshed whenever the chart scrolls, zooms or rescales. */
type Projector = {
  w: number;
  h: number;
  n: number;
  step: number;
  timeToX: (t: number) => number | null;
  priceToY: (p: number) => number | null;
};
const EMPTY_PROJ: Projector = { w: 0, h: 0, n: 0, step: 60, timeToX: () => null, priceToY: () => null };

function makeProjector(chart: IChartApi, series: ISeriesApi<"Candlestick">, cs: Candle[]): Projector {
  const scale = chart.timeScale();
  const n = cs.length;
  const step = n > 1 ? cs[n - 1].time - cs[n - 2].time || 60 : 60;
  const timeToX = (t: number): number | null => {
    if (n < 2) return null;
    let idx: number;
    if (t <= cs[0].time) idx = (t - cs[0].time) / step;
    else if (t >= cs[n - 1].time) idx = n - 1 + (t - cs[n - 1].time) / step;
    else {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cs[mid].time <= t) lo = mid;
        else hi = mid;
      }
      idx = lo + (t - cs[lo].time) / (cs[hi].time - cs[lo].time);
    }
    return scale.logicalToCoordinate(idx as Logical);
  };
  return {
    w: scale.width(),
    h: chart.panes()[0]?.getHeight() ?? 0,
    n,
    step,
    timeToX,
    priceToY: (p: number) => series.priceToCoordinate(p),
  };
}

export default function TradingChart({
  candles,
  precision = 2,
  height = 420,
  volume = true,
  overlays = [],
  panes = [],
  markers = [],
  priceLines = [],
  zones = [],
  tool = "cursor",
  drawings = [],
  onDrawingsChange,
  drawColor = DRAW_COLORS[0],
  fitKey = "",
  visibleBars = 150,
  logicalRange,
  onHover,
  onPriceClick,
  apiRef,
  hideTimeAxis,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayMap = useRef(new Map<string, ISeriesApi<"Line">>());
  const paneSeries = useRef<ISeriesApi<SeriesType>[]>([]);
  const paneKey = useRef("");
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const fittedKey = useRef<string | null>(null);
  const hoverRef = useRef(onHover);
  const clickRef = useRef(onPriceClick);
  const [proj, setProj] = useState<Projector>(EMPTY_PROJ);
  const [draftState, setDraft] = useState<{ p1: DPoint; p2: DPoint; dragging: boolean; sx: number; sy: number; tool: Tool } | null>(null);
  const [measureState, setMeasure] = useState<{ p1: DPoint; p2: DPoint; tool: Tool } | null>(null);
  // drafts/measurements belong to the tool that created them; switching tools hides them
  const draft = draftState && draftState.tool === tool ? draftState : null;
  const measure = measureState && measureState.tool === tool ? measureState : null;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    hoverRef.current = onHover;
    clickRef.current = onPriceClick;
  }, [onHover, onPriceClick]);

  // ------------------------------------------------------------ create chart
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#b2b5be",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: "#2a2e39", separatorHoverColor: "rgba(41,98,255,0.35)", enableResize: true },
      },
      grid: { vertLines: { color: "#1b1f2b" }, horzLines: { color: "#1b1f2b" } },
      crosshair: { mode: CrosshairMode.Normal },
      // explicit locale: some browsers report tags like "en-US@posix" that Intl rejects
      localization: { locale: "en-US" },
      rightPriceScale: { borderColor: "#2a2e39" },
      timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false, rightOffset: 8, visible: !hideTimeAxis },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    chartRef.current = chart;
    candleRef.current = series;
    if (apiRef) apiRef.current = chart;

    chart.subscribeCrosshairMove((param) => {
      if (!hoverRef.current) return;
      if (param.time === undefined) return hoverRef.current(null);
      const c = candlesRef.current.find((x) => x.time === (param.time as number));
      hoverRef.current(c ?? null);
    });
    chart.subscribeClick((param) => {
      if (!clickRef.current || !param.point || (param.paneIndex ?? 0) !== 0) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null) clickRef.current(price);
    });

    let raf = 0;
    let last = "";
    const loop = () => {
      const cs = candlesRef.current;
      if (cs.length) {
        const c = cs[cs.length - 1];
        const sig = [
          cs.length,
          c.time,
          series.priceToCoordinate(c.close),
          series.priceToCoordinate(c.close * 1.01),
          chart.timeScale().logicalToCoordinate(0 as Logical),
          chart.timeScale().width(),
          chart.panes()[0]?.getHeight(),
        ].join("|");
        if (sig !== last) {
          last = sig;
          setProj(makeProjector(chart, series, cs));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const map = overlayMap.current;
    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      markersApi.current = null;
      map.clear();
      paneSeries.current = [];
      paneKey.current = "";
      priceLineRefs.current = [];
      if (apiRef) apiRef.current = null;
    };
    // the chart instance lives for the whole component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    candleRef.current?.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
  }, [precision]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { visible: !hideTimeAxis } });
  }, [hideTimeAxis]);

  // ------------------------------------------------------------------ data
  useEffect(() => {
    const chart = chartRef.current;
    const s = candleRef.current;
    if (!chart || !s) return;
    candlesRef.current = candles;
    s.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    if (volume) {
      if (!volRef.current) {
        volRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      volRef.current.setData(
        candles.map((c) => ({
          time: ts(c.time),
          value: c.volume,
          color: c.close >= c.open ? "rgba(38,166,154,0.35)" : "rgba(239,83,80,0.35)",
        })),
      );
    } else if (volRef.current) {
      chart.removeSeries(volRef.current);
      volRef.current = null;
    }
    if (logicalRange && candles.length) {
      chart.timeScale().setVisibleLogicalRange(logicalRange);
    } else if (candles.length && fittedKey.current !== fitKey) {
      fittedKey.current = fitKey;
      const n = candles.length;
      if (n > visibleBars) chart.timeScale().setVisibleLogicalRange({ from: n - visibleBars, to: n + 6 });
      else chart.timeScale().fitContent();
    }
  }, [candles, volume, fitKey, visibleBars, logicalRange]);

  // ---------------------------------------------------------- overlays
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = overlayMap.current;
    const ids = new Set(overlays.map((o) => o.id));
    for (const [id, s] of map) {
      if (!ids.has(id)) {
        chart.removeSeries(s);
        map.delete(id);
      }
    }
    for (const o of overlays) {
      let s = map.get(o.id);
      const opts = {
        color: o.color,
        lineWidth: (o.width ?? 2) as 1 | 2 | 3 | 4,
        lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
      if (!s) {
        s = chart.addSeries(LineSeries, opts);
        map.set(o.id, s);
      } else {
        s.applyOptions(opts);
      }
      s.setData(o.data.map((p) => ({ time: ts(p.time), value: p.value })));
    }
  }, [overlays]);

  // -------------------------------------------------------------- panes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const key = panes
      .map((p) => `${p.id}:${(p.lines ?? []).map((l) => l.id).join("|")}:${(p.hist ?? []).map((h) => h.id).join("|")}`)
      .join(";");
    if (key !== paneKey.current) {
      paneSeries.current.forEach((s) => chart.removeSeries(s));
      paneSeries.current = [];
      paneKey.current = key;
      panes.forEach((p, i) => {
        const paneIndex = i + 1;
        (p.hist ?? []).forEach((h) => {
          paneSeries.current.push(
            chart.addSeries(HistogramSeries, { color: h.color, priceLineVisible: false, lastValueVisible: false }, paneIndex),
          );
        });
        (p.lines ?? []).forEach((l, j) => {
          const s = chart.addSeries(
            LineSeries,
            {
              color: l.color,
              lineWidth: (l.width ?? 2) as 1 | 2 | 3 | 4,
              priceLineVisible: false,
              lastValueVisible: true,
              crosshairMarkerVisible: false,
            },
            paneIndex,
          );
          if (j === 0) {
            (p.levels ?? []).forEach((lv) =>
              s.createPriceLine({ price: lv.price, color: lv.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }),
            );
          }
          paneSeries.current.push(s);
        });
      });
      const all = chart.panes();
      all.forEach((pane, i) => pane.setStretchFactor(i === 0 ? 3.2 : 1));
    }
    let k = 0;
    panes.forEach((p) => {
      (p.hist ?? []).forEach((h) => {
        paneSeries.current[k++]?.setData(
          h.data.map((d) => ({ time: ts(d.time), value: d.value, ...(d.color ? { color: d.color } : {}) })),
        );
      });
      (p.lines ?? []).forEach((l) => {
        paneSeries.current[k++]?.setData(l.data.map((d) => ({ time: ts(d.time), value: d.value })));
      });
    });
  }, [panes]);

  // ------------------------------------------------- markers & price lines
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    if (!markersApi.current) markersApi.current = createSeriesMarkers(s, []);
    const sorted = [...markers].sort((a, b) => a.time - b.time);
    markersApi.current.setMarkers(sorted.map((m) => ({ ...m, time: ts(m.time) })));
  }, [markers, candles]);

  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    priceLineRefs.current.forEach((pl) => s.removePriceLine(pl));
    priceLineRefs.current = priceLines.map((pl) =>
      s.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: pl.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: pl.title ?? "",
      }),
    );
  }, [priceLines]);

  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: { mode: tool === "cursor" ? CrosshairMode.Magnet : CrosshairMode.Normal } });
  }, [tool]);

  // ---------------------------------------------------- coordinate helpers
  const xToTime = useCallback((x: number): number | null => {
    const cs = candlesRef.current;
    const scale = chartRef.current?.timeScale();
    if (!scale || cs.length < 2) return null;
    const l = scale.coordinateToLogical(x);
    if (l === null) return null;
    const n = cs.length;
    const step = cs[n - 1].time - cs[n - 2].time || 60;
    if (l <= 0) return Math.round(cs[0].time + l * step);
    if (l >= n - 1) return Math.round(cs[n - 1].time + (l - (n - 1)) * step);
    const i = Math.floor(l);
    return Math.round(cs[i].time + (l - i) * (cs[i + 1].time - cs[i].time));
  }, []);

  const yToPrice = (y: number) => candleRef.current?.coordinateToPrice(y) ?? null;

  const pointAt = (e: React.PointerEvent): { pt: DPoint; x: number; y: number } | null => {
    const r = overlayRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const time = xToTime(x);
    const price = yToPrice(y);
    if (time === null || price === null) return null;
    return { pt: { time, price }, x, y };
  };

  const addDrawing = (d: Omit<Drawing, "id" | "color">) => {
    onDrawingsChange?.([...drawings, { ...d, id: Math.random().toString(36).slice(2, 10), color: drawColor }]);
  };

  const twoPoint = tool === "trend" || tool === "ray" || tool === "rect" || tool === "measure";
  const drawingMode = tool !== "cursor" && tool !== "crosshair";

  const finalize = (p1: DPoint, p2: DPoint) => {
    if (tool === "measure") setMeasure({ p1, p2, tool });
    else if (tool === "trend" || tool === "ray" || tool === "rect") addDrawing({ type: tool, p1, p2 });
  };

  const onDown = (e: React.PointerEvent) => {
    const hit = pointAt(e);
    if (!hit) return;
    if (tool === "hline") return addDrawing({ type: "hline", p1: hit.pt });
    if (tool === "text") {
      const text = window.prompt("Текст на бележката:");
      if (text) addDrawing({ type: "text", p1: hit.pt, text: text.slice(0, 80) });
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
    const hit = pointAt(e);
    if (hit) setDraft({ ...draft, p2: hit.pt });
  };

  const onUp = (e: React.PointerEvent) => {
    if (!draft || !draft.dragging) return;
    const hit = pointAt(e);
    if (!hit) return;
    if (Math.hypot(hit.x - draft.sx, hit.y - draft.sy) > 4) {
      finalize(draft.p1, hit.pt);
      setDraft(null);
    } else {
      setDraft({ ...draft, dragging: false }); // click-click mode: wait for the second point
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        onDrawingsChange?.(drawings.filter((d) => d.id !== selected));
        setSelected(null);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, drawings, onDrawingsChange]);

  // ------------------------------------------------------------- rendering
  const W = proj.w;
  const H = proj.h;
  const timeToX = proj.timeToX;
  const priceToY = proj.priceToY;
  const shapes: React.ReactNode[] = [];
  let deleteBtn: React.ReactNode = null;

  const renderDrawing = (d: Drawing, preview = false) => {
    const x1 = timeToX(d.p1.time);
    const y1 = priceToY(d.p1.price);
    if (x1 === null || y1 === null) return null;
    const x2 = d.p2 ? timeToX(d.p2.time) : null;
    const y2 = d.p2 ? priceToY(d.p2.price) : null;
    const isSel = selected === d.id && !preview;
    const common = {
      stroke: d.color,
      strokeWidth: isSel ? 2.5 : 1.6,
      strokeDasharray: preview ? "5 4" : undefined,
    };
    const hit = (props: React.SVGProps<SVGLineElement>) =>
      preview || drawingMode ? null : (
        <line {...props} stroke="transparent" strokeWidth={12} style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={() => setSelected(d.id)} />
      );
    if (d.type === "hline") {
      return (
        <g key={d.id}>
          <line x1={0} x2={W} y1={y1} y2={y1} {...common} />
          {hit({ x1: 0, x2: W, y1, y2: y1 })}
          <rect x={W - 74} y={y1 - 9} width={72} height={18} rx={3} fill={d.color} />
          <text x={W - 38} y={y1 + 4} fontSize={11} textAnchor="middle" fill="#0b0e14" fontWeight={600}>
            {fmtPrice(d.p1.price, precision)}
          </text>
        </g>
      );
    }
    if (d.type === "text") {
      return (
        <text key={d.id} x={x1} y={y1} fill={d.color} fontSize={13} fontWeight={600} style={{ pointerEvents: drawingMode ? "none" : "all", cursor: "pointer" }} onClick={() => setSelected(d.id)}>
          {d.text}
          {isSel ? " ●" : ""}
        </text>
      );
    }
    if (x2 === null || y2 === null) return null;
    if (d.type === "rect") {
      return (
        <g key={d.id}>
          <rect
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            fill={`${d.color}22`}
            {...common}
            style={{ pointerEvents: preview || drawingMode ? "none" : "all", cursor: "pointer" }}
            onClick={() => setSelected(d.id)}
          />
        </g>
      );
    }
    let ex: number = x2;
    let ey: number = y2;
    if (d.type === "ray" && x2 !== x1) {
      ex = x2 > x1 ? W : 0;
      ey = y1 + ((y2 - y1) * (ex - x1)) / (x2 - x1);
    }
    return (
      <g key={d.id}>
        <line x1={x1} y1={y1} x2={ex} y2={ey} {...common} />
        {hit({ x1, y1, x2: ex, y2: ey })}
        {(isSel || preview) && (
          <>
            <circle cx={x1} cy={y1} r={3.5} fill={d.color} />
            <circle cx={x2} cy={y2} r={3.5} fill={d.color} />
          </>
        )}
      </g>
    );
  };

  if (W > 0 && H > 0 && proj.n > 1) {
    zones.forEach((z) => {
      const yTop = priceToY(z.high);
      const yBot = priceToY(z.low);
      if (yTop === null || yBot === null) return;
      shapes.push(
        <g key={`zone-${z.id}`}>
          <rect x={0} y={Math.min(yTop, yBot)} width={W} height={Math.abs(yBot - yTop)} fill={z.color} />
          {z.label && (
            <text x={8} y={Math.min(yTop, yBot) + 13} fontSize={11} fill="#d1d4dc">
              {z.label}
            </text>
          )}
        </g>,
      );
    });
    drawings.forEach((d) => {
      const node = renderDrawing(d);
      if (node) shapes.push(node);
      if (selected === d.id) {
        const x = timeToX(d.p1.time);
        const y = priceToY(d.p1.price);
        if (x !== null && y !== null) {
          deleteBtn = (
            <button
              className="absolute z-20 rounded bg-down px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ left: Math.min(Math.max(x - 10, 0), W - 50), top: Math.max(y - 26, 0) }}
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
    });
    if (draft) {
      const type = tool === "measure" ? "rect" : (tool as Drawing["type"]);
      const node = renderDrawing({ id: "draft", type, p1: draft.p1, p2: draft.p2, color: tool === "measure" ? "#42a5f5" : drawColor }, true);
      if (node) shapes.push(node);
    }
    if (measure) {
      const x1 = timeToX(measure.p1.time);
      const x2 = timeToX(measure.p2.time);
      const y1 = priceToY(measure.p1.price);
      const y2 = priceToY(measure.p2.price);
      if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
        const dp = measure.p2.price - measure.p1.price;
        const pct = (dp / measure.p1.price) * 100;
        const bars = Math.round((measure.p2.time - measure.p1.time) / proj.step);
        const col = dp >= 0 ? UP : DOWN;
        shapes.push(
          <g key="measure">
            <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={`${col}26`} stroke={col} strokeDasharray="4 3" />
            <rect x={(x1 + x2) / 2 - 78} y={Math.min(y1, y2) - 42} width={156} height={36} rx={4} fill="#1a1e2b" stroke={col} />
            <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 27} fontSize={11} textAnchor="middle" fill={col} fontWeight={600}>
              {dp >= 0 ? "+" : ""}
              {fmtPrice(dp, precision)} ({pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%)
            </text>
            <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 13} fontSize={10.5} textAnchor="middle" fill="#b2b5be">
              {bars} свещи · {fmtDuration(Math.abs(measure.p2.time - measure.p1.time))}
            </text>
          </g>,
        );
      }
    }
  }

  return (
    <div className={cx("relative w-full overflow-hidden rounded-md", className)} style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={overlayRef}
        className="absolute left-0 top-0 z-10"
        style={{
          width: W,
          height: H,
          pointerEvents: drawingMode ? "auto" : "none",
          cursor: drawingMode ? "crosshair" : "default",
        }}
        onPointerDown={drawingMode ? onDown : undefined}
        onPointerMove={drawingMode ? onMove : undefined}
        onPointerUp={drawingMode ? onUp : undefined}
      >
        <svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
          {shapes}
        </svg>
        {deleteBtn && <div style={{ pointerEvents: "auto" }}>{deleteBtn}</div>}
      </div>
    </div>
  );
}
