/*
 * components/charts/chartMath.ts + drawings.ts — the pure parts of the chart (time ↔ logical mapping,
 * incremental updates, history paging, Heikin-Ashi, pane stretch, drawings model / persistence).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_BARS,
  accumulateLive,
  barIndexAt,
  barStep,
  heightsToStretch,
  heikinAshi,
  historyRequest,
  logicalToTime,
  mergeCandles,
  mergeHistoryPage,
  mergePoints,
  nearHistoryStart,
  normSymbol,
  paneOrder,
  planCandleUpdate,
  planPointUpdate,
  seriesKey,
  snapToBar,
  stretchFactors,
  timeToLogical,
} from "@/components/charts/chartMath";
import {
  DEFAULT_POSITION_R,
  TOOL_BY_KEY,
  TOOL_HOTKEYS,
  TOOL_INFO,
  TWO_POINT_TOOLS,
  fibLevels,
  isDrawingTool,
  moveHandle,
  positionPlan,
  sanitizeDrawings,
  type Drawing,
} from "@/components/charts/drawings";
import type { Candle, CandlesResponse } from "@/lib/types";

const bar = (time: number, close = 100, extra: Partial<Candle> = {}): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10, ...extra });
const series = (n: number, start = 1000, step = 60) => Array.from({ length: n }, (_, i) => bar(start + i * step, 100 + i));
const response = (candles: Candle[], symbol = "BTC/USDT", timeframe = "1m"): CandlesResponse => ({
  symbol,
  timeframe,
  precision: 2,
  source: { id: "demo", name: "Demo", is_live: false, disclaimer: "", status: "demo" },
  execution: "PAPER",
  candles,
  indicators: {},
  server_time: 0,
});

describe("time ↔ logical", () => {
  const cs = series(5);
  test("barStep / barIndexAt", () => {
    assert.equal(barStep(cs), 60);
    assert.equal(barStep([bar(1)]), 60);
    assert.equal(barIndexAt(cs, 999), -1);
    assert.equal(barIndexAt(cs, 1000), 0);
    assert.equal(barIndexAt(cs, 1119), 1);
    assert.equal(barIndexAt(cs, 99999), 4);
  });
  test("exact, interpolated and extrapolated indices round-trip", () => {
    assert.equal(timeToLogical(cs, 1060), 1);
    assert.equal(timeToLogical(cs, 1090), 1.5);
    assert.equal(timeToLogical(cs, 940), -1);
    assert.equal(timeToLogical(cs, 1360), 6);
    for (const t of [940, 1000, 1090, 1240, 1360]) assert.equal(logicalToTime(cs, timeToLogical(cs, t) as number), t);
    assert.equal(timeToLogical([bar(1)], 1), null);
    assert.equal(logicalToTime(cs, Number.NaN), null);
  });
  test("snapToBar: inside a bar → its open time, outside the data → null", () => {
    assert.equal(snapToBar(cs, 1075), 1060);
    assert.equal(snapToBar(cs, 900), null);
    assert.equal(snapToBar(cs, 1259), 1240);
    assert.equal(snapToBar(cs, 1300), null);
  });
});

describe("incremental updates", () => {
  const a = series(5);
  test("same data → none; last bar changed / new bar → tail; history change → reset", () => {
    assert.deepEqual(planCandleUpdate(a, a), { kind: "none" });
    assert.deepEqual(planCandleUpdate(a, a.map((c) => ({ ...c }))), { kind: "none" });
    const lastChanged = a.slice(0, 4).concat({ ...a[4], close: 999 });
    assert.deepEqual(planCandleUpdate(a, lastChanged), { kind: "tail", from: 4 });
    assert.deepEqual(planCandleUpdate(a, a.concat(bar(1300))), { kind: "tail", from: 4 });
    assert.deepEqual(planCandleUpdate(a, [{ ...a[0], close: 1 }, ...a.slice(1)]), { kind: "reset" });
    assert.deepEqual(planCandleUpdate(a, series(5, 2000)), { kind: "reset" });
    assert.deepEqual(planCandleUpdate([], a), { kind: "reset" });
    assert.deepEqual(planCandleUpdate(a, series(60)), { kind: "reset" }, "too many new bars → setData");
  });
  test("indicator points: only times of the prefix must match", () => {
    const p = a.map((c) => ({ time: c.time, value: c.close }));
    const drift = p.map((x, i) => (i < 4 ? { ...x, value: x.value + 0.001 } : x));
    assert.deepEqual(planPointUpdate(p, drift), { kind: "none" });
    assert.deepEqual(planPointUpdate(p, p.slice(0, 4).concat({ time: 1240, value: 1 })), { kind: "tail", from: 4 });
    assert.deepEqual(planPointUpdate(p, p.map((x) => ({ ...x, time: x.time + 1 }))), { kind: "reset" });
  });
});

describe("history merging / paging", () => {
  test("mergeCandles: live window moving forward and an older page", () => {
    const prev = series(5);
    const live = [bar(1240, 555), bar(1300, 556)];
    const m = mergeCandles(prev, live);
    assert.deepEqual(m.map((c) => c.time), [1000, 1060, 1120, 1180, 1240, 1300]);
    assert.equal(m[4].close, 555, "incoming wins inside its range");
    const older = mergeCandles(prev, series(3, 820));
    assert.deepEqual(older.map((c) => c.time), [820, 880, 940, 1000, 1060, 1120, 1180, 1240]);
    assert.equal(mergeCandles(series(10), series(3, 2000), 5).length, 5, "capped");
  });
  test("mergePoints skips the warm-up of an overlapping window", () => {
    const prev = [1, 2, 3, 4].map((i) => ({ time: i, value: i }));
    const inc = [3, 4, 5, 6].map((i) => ({ time: i, value: i * 10 }));
    assert.deepEqual(mergePoints(prev, inc, 0.25).map((p) => p.value), [1, 2, 3, 40, 50, 60]);
    assert.deepEqual(mergePoints([], inc).length, 4);
  });
  test("accumulateLive / mergeHistoryPage / historyRequest", () => {
    const s1 = accumulateLive(null, response(series(300, 100000)));
    assert.equal(s1.key, seriesKey("btc-usdt", "1m"));
    assert.equal(normSymbol("btc/usdt"), "BTCUSDT");
    const req = historyRequest(s1);
    assert.deepEqual(req, { end: s1.candles[200].time, limit: 700 });
    const page = mergeHistoryPage(s1, response(series(500, 100000 - 300 * 60)));
    assert.equal(page.candles[0].time, 100000 - 300 * 60);
    assert.ok(!page.exhausted);
    assert.ok(mergeHistoryPage(page, response(series(10, 100000))).exhausted, "a page without older bars exhausts the history");
    assert.equal(historyRequest({ ...s1, exhausted: true }), null);
    const other = accumulateLive(s1, response(series(5), "ETH/USDT"));
    assert.equal(other.candles.length, 5, "another symbol starts fresh");
    assert.ok(MAX_BARS >= 2000);
  });
  test("nearHistoryStart", () => {
    assert.ok(nearHistoryStart({ from: 3, to: 100 }));
    assert.ok(!nearHistoryStart({ from: 50, to: 150 }));
    assert.ok(!nearHistoryStart(null));
  });
});

describe("chart types and panes", () => {
  test("Heikin-Ashi", () => {
    const ha = heikinAshi([bar(1, 100, { open: 98, high: 103, low: 97 }), bar(2, 104, { open: 100, high: 105, low: 99 })]);
    assert.equal(ha[0].close, (98 + 103 + 97 + 100) / 4);
    assert.equal(ha[0].open, (98 + 100) / 2);
    assert.equal(ha[1].open, (ha[0].open + ha[0].close) / 2);
    assert.ok(ha.every((c) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)));
  });
  test("pane order + stretch factors (volume in its own pane, indicator panes after it)", () => {
    assert.deepEqual(paneOrder(true, ["rsi", "macd"]), ["main", "volume", "rsi", "macd"]);
    assert.deepEqual(paneOrder(false, ["rsi"]), ["main", "rsi"]);
    assert.deepEqual(stretchFactors(["main", "volume", "rsi"], null), [1, 0.2, 0.3]);
    assert.deepEqual(stretchFactors(["main", "rsi"], { rsi: 0.5, main: 999 }), [1, 0.5]);
    assert.deepEqual(heightsToStretch(["main", "volume"], [400, 100]), { main: 1, volume: 0.25 });
  });
});

describe("drawings", () => {
  test("tool catalogue keeps the walkthrough titles and adds fib + position", () => {
    assert.deepEqual(
      TOOL_INFO.slice(0, 8).map((t) => t.label),
      ["Cursor", "Crosshair", "Trend line", "Horizontal line", "Ray", "Rectangle", "Text", "Measure"],
    );
    assert.equal(TOOL_BY_KEY.fib.label, "Fib retracement");
    assert.equal(TOOL_BY_KEY.position.label, "Long / Short position");
    assert.deepEqual(TOOL_HOTKEYS, { hline: "h", trend: "t", rect: "r", measure: "m" });
    assert.ok(TWO_POINT_TOOLS.has("fib") && TWO_POINT_TOOLS.has("position") && !TWO_POINT_TOOLS.has("hline"));
    assert.ok(isDrawingTool("hline") && !isDrawingTool("cursor") && !isDrawingTool("crosshair"));
  });
  test("fib levels from the start to the end of the move", () => {
    const lv = fibLevels({ time: 1, price: 100 }, { time: 2, price: 200 });
    assert.equal(lv[0].price, 200);
    assert.equal(lv.at(-1)?.price, 100);
    assert.equal(lv.find((l) => l.level === 0.5)?.price, 150);
    assert.ok(Math.abs((lv.find((l) => l.level === 0.618)?.price ?? 0) - 138.2) < 1e-9);
  });
  test("position plan: side from the stop, default 2R target, R:R", () => {
    const long = positionPlan({ p1: { time: 1, price: 100 }, p2: { time: 5, price: 95 } });
    assert.deepEqual(long && { side: long.side, target: long.target, rr: long.rr, riskPct: long.riskPct }, { side: "long", target: 110, rr: DEFAULT_POSITION_R, riskPct: 5 });
    const short = positionPlan({ p1: { time: 1, price: 100 }, p2: { time: 5, price: 102 }, p3: { time: 5, price: 94 } });
    assert.equal(short?.side, "short");
    assert.equal(short?.rr, 3);
    const flipped = positionPlan({ p1: { time: 1, price: 100 }, p2: { time: 5, price: 95 }, p3: { time: 5, price: 90 } });
    assert.ok(flipped && flipped.target > 100, "target dragged through the entry is clamped to the winning side");
    assert.equal(positionPlan({ p1: { time: 1, price: 100 }, p2: { time: 5, price: 100 } }), null);
  });
  test("moveHandle", () => {
    const h: Drawing = { id: "a", type: "hline", p1: { time: 1, price: 10 }, color: "#fff" };
    assert.deepEqual(moveHandle(h, "p1", { time: 9, price: 12 }).p1, { time: 1, price: 12 }, "hline moves vertically only");
    const pos: Drawing = { id: "b", type: "position", p1: { time: 1, price: 100 }, p2: { time: 5, price: 95 }, color: "#fff" };
    assert.deepEqual(moveHandle(pos, "p3", { time: 3, price: 112 }).p3, { time: 5, price: 112 });
    const tr: Drawing = { id: "c", type: "trend", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 }, color: "#fff" };
    assert.deepEqual(moveHandle(tr, "p2", { time: 3, price: 3 }).p2, { time: 3, price: 3 });
  });
  test("sanitizeDrawings drops malformed / unknown records and dedupes ids (old storage stays readable)", () => {
    const out = sanitizeDrawings([
      { id: "x", type: "hline", p1: { time: 1, price: 2 }, color: "#abc" },
      { id: "x", type: "trend", p1: { time: 1, price: 2 }, p2: { time: 3, price: 4 } },
      { id: "y", type: "trend", p1: { time: 1, price: 2 } },
      { id: "z", type: "laser", p1: { time: 1, price: 2 } },
      { id: "t", type: "text", p1: { time: 1, price: 2 } },
      { id: "u", type: "text", p1: { time: 1, price: 2 }, text: "note".repeat(40) },
      { id: "p", type: "position", p1: { time: 1, price: 100 }, p2: { time: 2, price: 95 }, p3: { time: 2, price: 120 } },
      { id: "n", type: "rect", p1: { time: "1", price: 2 }, p2: { time: 3, price: 4 } },
      null,
      7,
    ]);
    assert.deepEqual(out.map((d) => d.id), ["x", "x-1", "u", "p"]);
    assert.equal(out[1].color.length > 0, true, "default colour");
    assert.equal(out[2].text?.length, 80);
    assert.deepEqual(out[3].p3, { time: 2, price: 120 });
    assert.deepEqual(sanitizeDrawings("nope"), []);
  });
});
