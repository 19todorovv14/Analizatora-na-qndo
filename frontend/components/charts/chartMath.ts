/*
 * Pure chart helpers (no lightweight-charts / React imports) — unit-tested in components/terminal/__tests__.
 *   time ↔ logical index mapping for the drawing overlay, incremental-update planning, history merging,
 *   Heikin-Ashi transform, pane stretch factors, marker snapping.
 */
import type { Candle, CandlesResponse, IndicatorPayload, Point } from "@/lib/types";

type Timed = { time: number };

/** Bar interval (s) from the last two bars (fallback 60). */
export function barStep(cs: readonly Timed[]): number {
  const n = cs.length;
  return n > 1 ? cs[n - 1].time - cs[n - 2].time || 60 : 60;
}

/** Index of the last bar with time ≤ t (−1 when t is before the first bar). */
export function barIndexAt(cs: readonly Timed[], t: number): number {
  let lo = 0;
  let hi = cs.length - 1;
  if (hi < 0 || t < cs[0].time) return -1;
  if (t >= cs[hi].time) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cs[mid].time <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Fractional logical index of a time: exact for bar times, interpolated between bars, extrapolated with the
 * bar step outside the loaded range (drawings anchored before the first / after the last bar).
 */
export function timeToLogical(cs: readonly Timed[], t: number): number | null {
  const n = cs.length;
  if (n < 2) return null;
  const step = barStep(cs);
  if (t <= cs[0].time) return (t - cs[0].time) / step;
  if (t >= cs[n - 1].time) return n - 1 + (t - cs[n - 1].time) / step;
  const lo = barIndexAt(cs, t);
  const hi = Math.min(n - 1, lo + 1);
  const span = cs[hi].time - cs[lo].time;
  return span > 0 ? lo + (t - cs[lo].time) / span : lo;
}

/** Inverse of timeToLogical (rounded to whole seconds). */
export function logicalToTime(cs: readonly Timed[], l: number): number | null {
  const n = cs.length;
  if (n < 2 || !Number.isFinite(l)) return null;
  const step = barStep(cs);
  if (l <= 0) return Math.round(cs[0].time + l * step);
  if (l >= n - 1) return Math.round(cs[n - 1].time + (l - (n - 1)) * step);
  const i = Math.floor(l);
  return Math.round(cs[i].time + (l - i) * (cs[i + 1].time - cs[i].time));
}

/** Time of the bar that contains `t` (trade markers on any timeframe, incl. 1W); null outside the data. */
export function snapToBar(cs: readonly Timed[], t: number): number | null {
  const i = barIndexAt(cs, t);
  if (i < 0) return null;
  const step = barStep(cs);
  // after the last bar only while still inside its period
  if (i === cs.length - 1 && t >= cs[i].time + step) return null;
  return cs[i].time;
}

/* ───────────────────────────────────────────────── incremental updates */

export type UpdatePlan =
  /** nothing changed */
  | { kind: "none" }
  /** prefix identical → series.update() for next[from …] (replaces the last bar, appends new ones) */
  | { kind: "tail"; from: number }
  /** anything else → setData */
  | { kind: "reset" };

const MAX_TAIL = 32;

const sameBar = (a: Candle, b: Candle) =>
  a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;

/** How to bring a candle series from `prev` to `next` with the fewest chart operations. */
export function planCandleUpdate(prev: readonly Candle[], next: readonly Candle[]): UpdatePlan {
  if (prev === next) return { kind: "none" };
  if (!prev.length || !next.length || next.length < prev.length || next[0].time !== prev[0].time) return { kind: "reset" };
  if (next.length - prev.length > MAX_TAIL) return { kind: "reset" };
  const k = prev.length - 1;
  for (let i = 0; i < k; i++) if (!sameBar(prev[i], next[i])) return { kind: "reset" };
  if (next.length === prev.length && sameBar(prev[k], next[k])) return { kind: "none" };
  if (next[k].time !== prev[k].time) return { kind: "reset" };
  return { kind: "tail", from: k };
}

/**
 * Same for a line/histogram series: only the TIMES of the prefix must match (indicator values of older bars
 * may drift slightly between polls — e.g. an EMA re-seeded on a shifted window — and are left as drawn).
 */
export function planPointUpdate(prev: readonly Point[], next: readonly Point[]): UpdatePlan {
  if (prev === next) return { kind: "none" };
  if (!prev.length || !next.length || next.length < prev.length || next[0].time !== prev[0].time) return { kind: "reset" };
  if (next.length - prev.length > MAX_TAIL) return { kind: "reset" };
  const k = prev.length - 1;
  if (next[k].time !== prev[k].time) return { kind: "reset" };
  // spot-check a few prefix times (cheap) — a different alignment means a different series
  for (const i of [0, k >> 2, k >> 1, k - 1]) if (i >= 0 && i < k && next[i].time !== prev[i].time) return { kind: "reset" };
  if (next.length === prev.length && next[k].value === prev[k].value) return { kind: "none" };
  return { kind: "tail", from: k };
}

/* ───────────────────────────────────────────────────── history merging */

/** Hard cap on bars kept in memory per chart. */
export const MAX_BARS = 6000;

/**
 * Union of two candle arrays by time; `incoming` wins inside its own time range. Used to accumulate the live
 * window (polls) and older history pages (`end=` requests) into one series. Sorted, deduplicated, capped.
 */
export function mergeCandles(prev: readonly Candle[], incoming: readonly Candle[], cap = MAX_BARS): Candle[] {
  if (!incoming.length) return prev.slice(-cap);
  if (!prev.length) return incoming.slice(-cap);
  const first = incoming[0].time;
  const last = incoming[incoming.length - 1].time;
  // fast path: the live window moved forward (prefix from prev, the rest from incoming)
  if (first >= prev[0].time && last >= prev[prev.length - 1].time) {
    const keep = barIndexAt(prev, first - 1);
    const head = keep >= 0 ? prev.slice(0, keep + 1) : [];
    const out = head.concat(incoming);
    return out.length > cap ? out.slice(-cap) : out;
  }
  const before = prev.filter((c) => c.time < first);
  const after = prev.filter((c) => c.time > last);
  const out = before.concat(incoming, after);
  return out.length > cap ? out.slice(-cap) : out;
}

/**
 * Merge an indicator series: `prev` values are kept before the cut, `incoming` after it. When `prev` already
 * covers the start of `incoming`, the first `warmFraction` of the incoming points are skipped (they were
 * computed on a shorter window and can differ slightly from the warmed-up values already drawn).
 */
export function mergePoints(prev: readonly Point[], incoming: readonly Point[], warmFraction = 0.25): Point[] {
  if (!incoming.length) return prev.slice();
  if (!prev.length) return incoming.slice();
  const first = incoming[0].time;
  const last = incoming[incoming.length - 1].time;
  const covered = prev[0].time <= first && prev[prev.length - 1].time >= first;
  const cutIdx = covered ? Math.min(incoming.length - 1, Math.floor(incoming.length * warmFraction)) : 0;
  const cut = incoming[cutIdx].time;
  const out: Point[] = [];
  for (const p of prev) if (p.time < cut) out.push(p);
  for (let i = cutIdx; i < incoming.length; i++) out.push(incoming[i]);
  for (const p of prev) if (p.time > last) out.push(p);
  return out;
}

/* ─────────────────────────────────────────────────────────── chart types */

/** Heikin-Ashi candles (time and volume unchanged). */
export function heikinAshi(cs: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  let pOpen = 0;
  let pClose = 0;
  cs.forEach((c, i) => {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = i === 0 ? (c.open + c.close) / 2 : (pOpen + pClose) / 2;
    out.push({ time: c.time, open, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close), close, volume: c.volume });
    pOpen = open;
    pClose = close;
  });
  return out;
}

/* ──────────────────────────────────────────────────────────── panes */

/** Default stretch factors: price pane 1, volume 0.2, every indicator pane 0.3. */
export const DEFAULT_STRETCH = { main: 1, volume: 0.2, indicator: 0.3 } as const;

/** Pane ids in chart order: "main", then "volume" (optional), then the indicator panes. */
export function paneOrder(volume: boolean, indicatorPaneIds: readonly string[]): string[] {
  return ["main", ...(volume ? ["volume"] : []), ...indicatorPaneIds];
}

/** Stretch factor per pane id: stored (if sane) else the default. */
export function stretchFactors(ids: readonly string[], stored: Record<string, number> | null | undefined): number[] {
  return ids.map((id) => {
    const v = stored?.[id];
    if (typeof v === "number" && Number.isFinite(v) && v > 0.02 && v < 50) return v;
    return id === "main" ? DEFAULT_STRETCH.main : id === "volume" ? DEFAULT_STRETCH.volume : DEFAULT_STRETCH.indicator;
  });
}

/** Normalise pane heights (px) to stretch factors relative to the price pane (main = 1). */
export function heightsToStretch(ids: readonly string[], heights: readonly number[]): Record<string, number> {
  const main = heights[0] || 1;
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    const h = heights[i];
    if (typeof h === "number" && h > 0) out[id] = Number((h / main).toFixed(3));
  });
  return out;
}

/** True when the left edge of the visible logical range is within `threshold` bars of the first bar. */
export function nearHistoryStart(range: { from: number; to: number } | null | undefined, threshold = 12): boolean {
  return !!range && Number.isFinite(range.from) && range.from < threshold;
}

/* ────────────────────────────────────────── accumulated chart data */

/** Candles + indicator series accumulated across live polls and history pages for one symbol|timeframe. */
export type ChartSeriesState = {
  /** normalised "SYMBOL|tf" the data belongs to */
  key: string;
  candles: Candle[];
  indicators: Record<string, IndicatorPayload>;
  /** the latest live response (precision, source, execution, server_time) */
  meta: Omit<CandlesResponse, "candles" | "indicators">;
  /** no older history available (provider exhausted / error / cap reached) */
  exhausted: boolean;
};

/** "BTC/USDT", "btc-usdt", "BTCUSDT" → "BTCUSDT" (the API answers with the canonical symbol). */
export const normSymbol = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const seriesKey = (symbol: string, timeframe: string) => `${normSymbol(symbol)}|${timeframe}`;

function mergeIndicators(
  prev: Record<string, IndicatorPayload>,
  incoming: Record<string, IndicatorPayload>,
  mode: "live" | "page",
): Record<string, IndicatorPayload> {
  const out: Record<string, IndicatorPayload> = {};
  const keys = mode === "live" ? Object.keys(incoming) : Array.from(new Set([...Object.keys(prev), ...Object.keys(incoming)]));
  for (const k of keys) {
    const a = prev[k];
    const b = incoming[k];
    if (!a || !b) {
      // live: the requested set defines the keys; page: keep what exists
      out[k] = (b ?? a)!;
      continue;
    }
    const series: Record<string, Point[]> = {};
    const outs = new Set([...Object.keys(a.series), ...Object.keys(b.series)]);
    for (const o of outs) series[o] = mergePoints(a.series[o] ?? [], b.series[o] ?? [], mode === "live" ? 0.25 : 0);
    out[k] = { ...b, series };
  }
  return out;
}

/** Fold a live /market/candles response into the accumulated state (a new key starts fresh). */
export function accumulateLive(prev: ChartSeriesState | null, res: CandlesResponse): ChartSeriesState {
  const key = seriesKey(res.symbol, res.timeframe);
  const { candles, indicators, ...meta } = res;
  if (!prev || prev.key !== key) return { key, candles: candles.slice(-MAX_BARS), indicators, meta, exhausted: false };
  return {
    key,
    candles: mergeCandles(prev.candles, candles),
    indicators: mergeIndicators(prev.indicators, indicators, "live"),
    meta,
    exhausted: prev.exhausted,
  };
}

/** Merge an older history page (`end=` request). Marks the state exhausted when the page adds nothing older. */
export function mergeHistoryPage(prev: ChartSeriesState, page: CandlesResponse): ChartSeriesState {
  const first = prev.candles[0]?.time ?? Infinity;
  const older = page.candles.filter((c) => c.time < first).length;
  if (older === 0) return { ...prev, exhausted: true };
  const candles = mergeCandles(prev.candles, page.candles);
  return {
    ...prev,
    candles,
    indicators: mergeIndicators(prev.indicators, page.indicators, "page"),
    exhausted: candles.length >= MAX_BARS,
  };
}

/** Parameters of the next history page: `end` overlaps the loaded data so indicators warm up across the seam. */
export function historyRequest(state: ChartSeriesState, page = 500, overlap = 200): { end: number; limit: number } | null {
  const cs = state.candles;
  if (cs.length < 2 || state.exhausted) return null;
  const ov = Math.min(overlap, cs.length - 1);
  return { end: cs[ov].time, limit: Math.min(2000, page + ov) };
}
