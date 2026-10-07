/*
 * Pure candle maths shared by the interactive candle (candle.tsx), the drill-down (drilldown.tsx) and
 * their unit tests (components/learn/__tests__). No React, no DOM — only numbers in, numbers out.
 */

export type CandleItem = { open: number; high: number; low: number; close: number; time?: number };
export type CandlePart = "upper_wick" | "body" | "lower_wick";
export type PriceKey = "open" | "high" | "low" | "close";
export type CandleDirection = "bullish" | "bearish" | "neutral";

export const PART_LABEL: Record<CandlePart, string> = { upper_wick: "UPPER WICK", body: "BODY", lower_wick: "LOWER WICK" };
/** compact labels for narrow screens (the read-out cards under the SVG carry the full names) */
export const PART_LABEL_SHORT: Record<CandlePart, string> = { upper_wick: "UPPER", body: "BODY", lower_wick: "LOWER" };
export const PRICE_LABEL: Record<PriceKey, string> = { open: "OPEN", high: "HIGH", low: "LOW", close: "CLOSE" };
export const PRICE_SHORT: Record<PriceKey, string> = { open: "O", high: "H", low: "L", close: "C" };

/** Accepts [o, h, l, c] arrays (academy content) or {open, high, low, close, time?} objects (market API). */
export function toCandleItem(v: unknown): CandleItem | null {
  if (Array.isArray(v) && v.length >= 4 && v.slice(0, 4).every((x) => typeof x === "number" && Number.isFinite(x))) {
    const [open, high, low, close] = v as number[];
    return { open, high, low, close };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ([o.open, o.high, o.low, o.close].every((x) => typeof x === "number" && Number.isFinite(x))) {
      return {
        open: o.open as number,
        high: o.high as number,
        low: o.low as number,
        close: o.close as number,
        time: typeof o.time === "number" ? o.time : undefined,
      };
    }
  }
  return null;
}

/** High ≥ max(Open, Close) and Low ≤ min(Open, Close). */
export function isValidCandle(c: CandleItem): boolean {
  return c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close);
}

export type Anatomy = {
  top: number;
  bot: number;
  range: number;
  body: number;
  upper: number;
  lower: number;
  bodyPct: number;
  upperPct: number;
  lowerPct: number;
  dir: CandleDirection;
};

/**
 * Body = |Close − Open|, upper wick = High − max(O, C), lower wick = min(O, C) − Low (all as a share of
 * the range too). A body under 3% of the range counts as neutral (doji-like).
 */
export function candleAnatomy(c: CandleItem): Anatomy {
  const top = Math.max(c.open, c.close);
  const bot = Math.min(c.open, c.close);
  const range = c.high - c.low;
  const body = top - bot;
  const upper = c.high - top;
  const lower = bot - c.low;
  const pct = (v: number) => (range > 0 ? (v / range) * 100 : 0);
  const dir: CandleDirection =
    range > 0 && body / range < 0.03 ? "neutral" : c.close > c.open ? "bullish" : c.close < c.open ? "bearish" : "neutral";
  return { top, bot, range, body, upper, lower, bodyPct: pct(body), upperPct: pct(upper), lowerPct: pct(lower), dir };
}

/** Lesson `highlight` → highlighted candle parts ("wick" = both wicks). */
export function partsFromHighlight(h?: string | null): CandlePart[] {
  if (h === "body") return ["body"];
  if (h === "upper_wick") return ["upper_wick"];
  if (h === "lower_wick") return ["lower_wick"];
  if (h === "wick") return ["upper_wick", "lower_wick"];
  return [];
}

/** Lesson `highlight` → highlighted price (open | high | low | close) or null. */
export function priceFromHighlight(h?: string | null): PriceKey | null {
  return h === "open" || h === "high" || h === "low" || h === "close" ? h : null;
}

/** The two prices that bound a part — hovering the part lights them up on the price rail. */
export function pricesOfPart(part: CandlePart, c: CandleItem): PriceKey[] {
  const topKey: PriceKey = c.close >= c.open ? "close" : "open";
  const botKey: PriceKey = topKey === "close" ? "open" : "close";
  if (part === "upper_wick") return ["high", topKey];
  if (part === "lower_wick") return [botKey, "low"];
  return [topKey, botKey];
}

/** Rail order top → bottom: High, upper body edge, lower body edge, Low. */
export function railOrder(c: CandleItem): PriceKey[] {
  return c.close < c.open ? ["high", "open", "close", "low"] : ["high", "close", "open", "low"];
}

/**
 * Which part of a candle sits at pixel `py`, given the pixel y of the body top and bottom. Very thin
 * bodies get a ±4 px hit zone so they can still be hovered.
 */
export function partAtY(py: number, bodyTopY: number, bodyBottomY: number): CandlePart {
  if (bodyBottomY - bodyTopY < 7) {
    const mid = (bodyTopY + bodyBottomY) / 2;
    if (Math.abs(py - mid) <= 4) return "body";
    return py < mid ? "upper_wick" : "lower_wick";
  }
  if (py < bodyTopY) return "upper_wick";
  if (py > bodyBottomY) return "lower_wick";
  return "body";
}

/**
 * Spread label positions so neighbours keep at least `gap` px apart inside [lo, hi] while staying as
 * close as possible to their anchors. Input order = visual order (top → bottom); returns new objects.
 */
export function spreadLabels<T extends { y: number }>(items: T[], gap: number, lo: number, hi: number): T[] {
  const out = items.map((it) => ({ ...it }));
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gap);
  if (out.length) out[out.length - 1].y = Math.min(out[out.length - 1].y, hi);
  for (let i = out.length - 2; i >= 0; i--) out[i].y = Math.min(out[i].y, out[i + 1].y - gap);
  if (out.length) out[0].y = Math.max(out[0].y, lo);
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gap);
  return out;
}

/** Shape names the builder recognises (teaching heuristics on one candle, not trading signals). */
export function classifyCandle(c: CandleItem): string[] {
  const a = candleAnatomy(c);
  const out: string[] = [];
  if (a.range <= 0) return out;
  if (a.bodyPct <= 10) out.push("doji");
  if (a.lower >= 2 * a.body && a.upperPct <= 15 && a.bodyPct > 5) out.push("hammer");
  if (a.upper >= 2 * a.body && a.lowerPct <= 15 && a.bodyPct > 5) out.push("shooting star");
  if (a.bodyPct >= 90) out.push("marubozu");
  return out;
}

/** Closed candles only (time + timeframe ≤ server time); falls back to all candles if none is closed. */
export function lastClosed<T extends { time: number }>(candles: T[], tfSeconds: number, serverTime: number | null | undefined, count: number): T[] {
  const closed = serverTime ? candles.filter((c) => c.time + tfSeconds <= serverTime) : candles;
  return (closed.length ? closed : candles).slice(-count);
}

/** Percentage change Close vs Open of one candle, or null when Open is 0. */
export function changePct(c: CandleItem): number | null {
  return c.open ? ((c.close - c.open) / c.open) * 100 : null;
}

/** Order badges for the drill-down markers: which extreme came first (1) and second (2). */
export function extremeOrder(first: "high" | "low" | "same" | null | undefined): { high: number | null; low: number | null } {
  if (first === "same") return { high: 1, low: 1 };
  if (first === "high") return { high: 1, low: 2 };
  if (first === "low") return { high: 2, low: 1 };
  return { high: null, low: null };
}
