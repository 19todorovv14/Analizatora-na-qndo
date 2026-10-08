/* Unit tests for the S3b labs logic (components/labs/model.ts): Candlestick Lab, Market Structure Lab,
 * Leverage Academy and Trade Simulator helpers. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BIAS_META,
  LEVERAGES,
  LEVERAGE_RAMP,
  LEVERAGE_WARNING,
  TABLE_MOVES,
  allowedLeverages,
  anatomyFocus,
  candlePrecision,
  crossLiqMovePct,
  curveGeometry,
  curveTable,
  decimalsFor,
  effectiveLeverage,
  equityAtMove,
  exampleLevels,
  exampleMarkers,
  filterPatterns,
  fmtUnits,
  isolatedLiqMovePct,
  labelKind,
  leverageColor,
  leverageRequest,
  leverageWarning,
  marketPrice,
  marksChanged,
  miniGeometry,
  nearestIndex,
  neighbourKey,
  niceTicks,
  parseNum,
  planError,
  pnlAtMove,
  pointsAt,
  practiceBody,
  rangeAround,
  removeMarks,
  rescaleResult,
  roundTo,
  scoreTone,
  signedPct,
  snapMark,
  snapMove,
  structureMarkers,
  tradeHref,
  tradeRequest,
  upsertMark,
  usd,
  usdCompact,
} from "../model";
import type { CurveFamily, CurvePoint, LeverageResult, PatternCard, PatternExample, StructureCheck, StructureMark } from "../types";

/* ───────────────────────────────────────────── fixtures */

const C = (time: number, open: number, high: number, low: number, close: number) => ({ time, open, high, low, close, volume: 0 });
const CANDLES = [C(100, 10, 12, 9, 11), C(200, 11, 15, 10, 14), C(300, 14, 14.5, 8, 9), C(400, 9, 11, 7, 10), C(500, 10, 13, 9.5, 12)];

function card(key: string, type: PatternCard["type"], bias: PatternCard["bias"]): PatternCard {
  return { key, type, bias } as PatternCard;
}

function pt(move_pct: number, equity: number, extra: Partial<CurvePoint> = {}): CurvePoint {
  return { move_pct, pnl: equity - 10_000, equity, pnl_pct_of_equity: (equity - 10_000) / 100, liquidated: false, at_liquidation: false, ...extra };
}

/** $2,000 margin at 1x and 50x on a $10,000 account (long): 50x liquidates at −9 % (equity 1,000). */
function family(): CurveFamily {
  const moves = [-20, -10, 0, 10, 20];
  return {
    basis: "margin",
    margin: 2000,
    position_notional: null,
    equity: 10_000,
    side: "long",
    moves_pct: moves,
    series: [
      {
        leverage: 1,
        position_notional: 2000,
        required_margin: 2000,
        can_open: true,
        liquidation_price: null,
        liquidation_move_pct: null,
        isolated_liquidation_move_pct: -50,
        risk_level: "low",
        points: moves.map((m) => pt(m, 10_000 + 20 * m)),
      },
      {
        leverage: 50,
        position_notional: 100_000,
        required_margin: 2000,
        can_open: true,
        liquidation_price: 91,
        liquidation_move_pct: -9,
        isolated_liquidation_move_pct: -1,
        risk_level: "elevated",
        points: [
          pt(-20, 1000, { liquidated: true }),
          pt(-10, 1000, { liquidated: true }),
          pt(0, 10_000),
          pt(10, 20_000),
          pt(20, 30_000),
          pt(-9, 1000, { liquidated: true, at_liquidation: true }),
        ],
      },
    ],
  };
}

const RESULT = {
  entry_price: 110,
  mid_price: 109.99,
  price_after_move: 99,
  price_change: -11,
  exit_price: 98.9,
  liquidation_price: 88,
  isolated_liquidation_price: null,
  scenarios: [{ move_pct: -1, price: 108.9, pnl: -10, pnl_pct_of_equity: -0.1, pnl_pct_of_margin: -10, equity_after: 9990, liquidated: false }],
  plan: { stop_price: 104.5, target_price: 121, stop_distance_pct: 5, target_distance_pct: 10, reward_risk: 2 },
  position_notional: 1000,
  warning: "x",
} as unknown as LeverageResult;

/* ───────────────────────────────────────────── shared helpers */

describe("formatting", () => {
  test("decimalsFor keeps small prices readable", () => {
    assert.equal(decimalsFor(104854.28), 2);
    assert.equal(decimalsFor(1.2345), 3);
    assert.equal(decimalsFor(0.826), 4);
    assert.equal(decimalsFor(0.00012), 5);
    assert.equal(decimalsFor(null), 2);
    assert.equal(candlePrecision([{ high: 0.5 }, { high: 0.7 }]), 4);
    assert.equal(candlePrecision([]), 2);
  });
  test("signedPct uses a true minus sign and a dash for missing values", () => {
    assert.equal(signedPct(1.234), "+1.23%");
    assert.equal(signedPct(-0.4, 1), "−0.4%");
    assert.equal(signedPct(0), "0.00%");
    assert.equal(signedPct(null), "—");
    assert.equal(signedPct(Number.NaN), "—");
  });
  test("usd: whole dollars from 1,000, cents below, optional sign", () => {
    assert.equal(usd(2000), "$2,000");
    assert.equal(usd(12.5), "$12.50");
    assert.equal(usd(-102.53), "−$102.53");
    assert.equal(usd(5, true), "+$5.00");
    assert.equal(usd(undefined), "—");
  });
  test("usdCompact for axis labels", () => {
    assert.equal(usdCompact(20_000), "$20k");
    assert.equal(usdCompact(5_000), "$5k");
    assert.equal(usdCompact(9_500), "$9.5k");
    assert.equal(usdCompact(800), "$800");
    assert.equal(usdCompact(0), "$0");
    assert.equal(usdCompact(1_500_000), "$1.5M");
  });
  test("parseNum understands decimal commas, thousands and spaces", () => {
    assert.equal(parseNum("12,5"), 12.5);
    assert.equal(parseNum("1,234"), 1234);
    assert.equal(parseNum("1,234.5"), 1234.5);
    assert.equal(parseNum("1 234"), 1234);
    assert.equal(parseNum(""), null);
    assert.equal(parseNum("abc"), null);
  });
  test("fmtUnits picks decimals by magnitude", () => {
    assert.equal(fmtUnits(1250), "1,250");
    assert.equal(fmtUnits(12.5), "12.5");
    assert.equal(fmtUnits(0.019071), "0.01907");
    assert.equal(fmtUnits(null), "—");
  });
  test("roundTo rounds to the instrument precision", () => {
    assert.equal(roundTo(1.234567, 5), 1.23457);
    assert.equal(roundTo(104854.2849, 2), 104854.28);
  });
});

/* ───────────────────────────────────────────── Candlestick Lab */

describe("Candlestick Lab", () => {
  const cards = [card("hammer", "single", "bullish"), card("bearish_engulfing", "double", "bearish"), card("doji", "single", "neutral")];

  test("filterPatterns by type and bias", () => {
    assert.deepEqual(
      filterPatterns(cards, "single", "all").map((c) => c.key),
      ["hammer", "doji"],
    );
    assert.deepEqual(
      filterPatterns(cards, "all", "bearish").map((c) => c.key),
      ["bearish_engulfing"],
    );
    assert.equal(filterPatterns(cards, "triple", "all").length, 0);
  });
  test("neighbourKey wraps around and falls back to the first key", () => {
    const keys = ["a", "b", "c"];
    assert.equal(neighbourKey(keys, "c", 1), "a");
    assert.equal(neighbourKey(keys, "a", -1), "c");
    assert.equal(neighbourKey(keys, "zzz", 1), "a");
    assert.equal(neighbourKey([], "a", 1), null);
  });
  test("miniGeometry maps the highest high to the top and the lowest low to the bottom", () => {
    const g = miniGeometry(CANDLES, 200, 100, 10);
    assert.equal(g.y(15), 10);
    assert.equal(g.y(7), 90);
    assert.equal(g.x(0), 10 + g.slot / 2);
    assert.ok(g.bodyW >= 2 && g.bodyW <= 22);
  });
  test("exampleMarkers: bullish below the bar with an up arrow, the selected one gold and named", () => {
    const ex = [{ time: 1 }, { time: 2 }] as PatternExample[];
    const m = exampleMarkers(ex, "bullish", 2, "Hammer");
    assert.equal(m[0].position, "belowBar");
    assert.equal(m[0].shape, "arrowUp");
    assert.equal(m[0].text, undefined);
    assert.equal(m[1].text, "Hammer");
    assert.notEqual(m[1].color, m[0].color);
    const bear = exampleMarkers(ex, "bearish", null, "X");
    assert.equal(bear[0].position, "aboveBar");
    assert.equal(bear[0].shape, "arrowDown");
  });
  test("rangeAround centres the example and stays inside the data", () => {
    assert.deepEqual(rangeAround(250, 500, 60), { from: 220, to: 280 });
    assert.deepEqual(rangeAround(490, 500, 60), { from: 440, to: 500 });
    assert.deepEqual(rangeAround(2, 500, 60), { from: -5, to: 55 });
  });
  test("anatomyFocus: wick-led patterns highlight the wick, others the body", () => {
    assert.equal(anatomyFocus("hammer"), "lower_wick");
    assert.equal(anatomyFocus("shooting_star"), "upper_wick");
    assert.equal(anatomyFocus("bullish_engulfing"), "body");
  });
  test("practiceBody sends every round, unanswered as null", () => {
    const rounds = [
      { index: 0, token: "t0" },
      { index: 1, token: "t1" },
    ] as never[];
    assert.deepEqual(practiceBody(rounds, { 0: "hammer" }), {
      answers: [
        { token: "t0", answer: "hammer" },
        { token: "t1", answer: null },
      ],
    });
  });
  test("bias meta covers every bias", () => {
    assert.deepEqual(Object.keys(BIAS_META).sort(), ["bearish", "bullish", "context-dependent", "neutral"]);
  });
});

/* ───────────────────────────────────────────── Market Structure Lab */

describe("Market Structure Lab", () => {
  test("labelKind", () => {
    assert.equal(labelKind("HH"), "high");
    assert.equal(labelKind("LH"), "high");
    assert.equal(labelKind("HL"), "low");
    assert.equal(labelKind("LL"), "low");
    assert.equal(labelKind("FAKEOUT"), "event");
  });
  test("nearestIndex finds the closest candle (ties → the earlier one)", () => {
    assert.equal(nearestIndex(CANDLES, 290), 2);
    assert.equal(nearestIndex(CANDLES, 250), 1);
    assert.equal(nearestIndex(CANDLES, 10), 0);
    assert.equal(nearestIndex(CANDLES, 9999), 4);
    assert.equal(nearestIndex([], 1), -1);
  });
  test("snapMark: swing highs snap to the High, lows to the Low, events keep the clicked price inside the candle", () => {
    assert.deepEqual(snapMark(CANDLES, 1, "HH", 11), { time: 200, price: 15, label: "HH" });
    assert.deepEqual(snapMark(CANDLES, 2, "LL", 12), { time: 300, price: 8, label: "LL" });
    assert.deepEqual(snapMark(CANDLES, 3, "BREAKOUT", 50), { time: 400, price: 11, label: "BREAKOUT" });
    assert.deepEqual(snapMark(CANDLES, 3, "RETEST", null), { time: 400, price: 10, label: "RETEST" });
    assert.equal(snapMark(CANDLES, 99, "HH", null), null);
  });
  test("upsertMark replaces the slot, toggles the same label off and keeps the list sorted", () => {
    let marks: StructureMark[] = [];
    marks = upsertMark(marks, { time: 300, price: 8, label: "LL" });
    marks = upsertMark(marks, { time: 200, price: 15, label: "HH" });
    assert.deepEqual(
      marks.map((m) => m.time),
      [200, 300],
    );
    // HH → LH on the same candle replaces the swing-high slot
    marks = upsertMark(marks, { time: 200, price: 15, label: "LH" });
    assert.deepEqual(
      marks.map((m) => m.label),
      ["LH", "LL"],
    );
    // a low and an event can share the candle with a high
    marks = upsertMark(marks, { time: 200, price: 10, label: "HL" });
    marks = upsertMark(marks, { time: 200, price: 12, label: "BREAKOUT" });
    assert.equal(marks.filter((m) => m.time === 200).length, 3);
    // same label again → removed
    marks = upsertMark(marks, { time: 300, price: 8, label: "LL" });
    assert.equal(
      marks.some((m) => m.time === 300),
      false,
    );
    // the cap keeps the list unchanged
    assert.equal(upsertMark(marks, { time: 999, price: 1, label: "HH" }, marks.length), marks);
  });
  test("removeMarks clears a candle or one label", () => {
    const marks: StructureMark[] = [
      { time: 1, price: 2, label: "HH" },
      { time: 1, price: 1, label: "HL" },
      { time: 2, price: 1, label: "LL" },
    ];
    assert.equal(removeMarks(marks, 1).length, 1);
    assert.deepEqual(
      removeMarks(marks, 1, "HL").map((m) => m.label),
      ["HH", "LL"],
    );
  });

  const check = {
    marks: [
      { time: 200, price: 15, label: "HH", verdict: "CORRECT", expected_label: "HH", matched_swing: { time: 200, price: 15, kind: "high", label: "HH" }, scored: true, kind: "swing", explanation: "" },
      { time: 300, price: 8, label: "HL", verdict: "INCORRECT", expected_label: "LL", matched_swing: { time: 300, price: 8, kind: "low", label: "LL" }, scored: true, kind: "swing", explanation: "" },
      { time: 400, price: 7, label: "LL", verdict: "NOT A SWING", expected_label: null, matched_swing: null, scored: true, kind: "swing", explanation: "" },
      { time: 100, price: 9, label: "LL", verdict: "REFERENCE", expected_label: null, matched_swing: null, scored: false, kind: "swing", explanation: "" },
    ],
    missed: [{ time: 500, price: 13, kind: "high", label: "LH", explanation: "" }],
    missed_events: [{ type: "BREAKOUT", time: 400, price: 11, direction: "up", explanation: "" }],
    reference: {
      swings: [
        { index: 0, time: 100, price: 9, kind: "low", label: null, anchor: true, prev_price: null, prev_time: null },
        { index: 1, time: 200, price: 15, kind: "high", label: "HH", anchor: false, prev_price: 12, prev_time: 50 },
        { index: 2, time: 300, price: 8, kind: "low", label: "LL", anchor: false, prev_price: 9, prev_time: 100 },
        { index: 4, time: 500, price: 13, kind: "high", label: "LH", anchor: false, prev_price: 15, prev_time: 200 },
      ],
      events: [{ type: "BREAKOUT", index: 3, time: 400, price: 11, direction: "up", level_time: 200, end_index: 3, end_time: 400, close: 10, undetermined: false }],
      structure: "range",
      atr: 1,
    },
  } as unknown as StructureCheck;

  test("structureMarkers before the check: anchors (REF) + the user's labels", () => {
    const m = structureMarkers({ candles: CANDLES, anchors: [{ time: 100, price: 9, kind: "low" }], marks: [{ time: 200, price: 15, label: "HH" }] });
    assert.deepEqual(
      m.map((x) => x.text),
      ["REF", "HH"],
    );
    assert.equal(m[0].position, "belowBar");
    assert.equal(m[1].position, "aboveBar");
  });
  test("structureMarkers after the check: verdict glyphs, expected label, ghost missed swings and events", () => {
    const m = structureMarkers({ candles: CANDLES, anchors: [], marks: [], check });
    const texts = m.map((x) => x.text);
    assert.ok(texts.includes("HH ✓"));
    assert.ok(texts.includes("HL ✗ → LL"));
    assert.ok(texts.includes("LL ✗"));
    assert.ok(texts.includes("LH"), "missed swing drawn as a ghost");
    assert.ok(texts.includes("Breakout"), "missed event drawn");
    assert.equal(texts.filter((t) => t?.startsWith("LL") && t.includes("•")).length, 0, "REFERENCE marks are not drawn twice");
  });
  test("structureMarkers with the answer shows the reference swings the user did not match", () => {
    const m = structureMarkers({ candles: CANDLES, anchors: [], marks: [], check, showAnswer: true });
    const ghosts = m.filter((x) => x.time === 300 || x.time === 500).map((x) => x.text);
    assert.ok(ghosts.includes("LL"), "the wrongly labelled swing is shown with its answer");
    assert.ok(ghosts.includes("LH"));
    assert.equal(m.filter((x) => x.time === 200 && x.text === "HH").length, 0, "matched swing not repeated");
  });
  test("marksChanged compares labels with the checked set", () => {
    const marks = check.marks.map(({ time, price, label }) => ({ time, price, label }));
    assert.equal(marksChanged(marks, check), false);
    assert.equal(marksChanged(marks.slice(1), check), true);
    assert.equal(marksChanged([], null), false);
    assert.equal(marksChanged(marks, null), true);
  });
  test("scoreTone", () => {
    assert.equal(scoreTone(85), "up");
    assert.equal(scoreTone(50), "warn");
    assert.equal(scoreTone(10), "down");
    assert.equal(scoreTone(null), "neutral");
  });
});

/* ───────────────────────────────────────────── Leverage Academy */

describe("Leverage Academy", () => {
  test("the chips are 1x … 100x and every chip has its own ramp colour", () => {
    assert.deepEqual([...LEVERAGES], [1, 2, 5, 10, 20, 50, 100]);
    assert.equal(new Set(LEVERAGES.map(leverageColor)).size, LEVERAGES.length);
    assert.equal(leverageColor(1), LEVERAGE_RAMP[0]);
    assert.equal(leverageColor(30), leverageColor(20), "between chips → the lower chip's colour");
  });
  test("isolated liquidation distance ≈ (1 − maintenance) / leverage", () => {
    assert.equal(isolatedLiqMovePct(20), 2.5);
    assert.equal(isolatedLiqMovePct(100), 0.5);
    assert.equal(isolatedLiqMovePct(5), 10);
  });
  test("pnlAtMove for long and short", () => {
    assert.equal(pnlAtMove(10_000, -5), -500);
    assert.equal(pnlAtMove(10_000, -5, "short"), 500);
  });
  test("crossLiqMovePct matches the broker example ($2,000 margin on a $10,000 account)", () => {
    assert.equal(crossLiqMovePct(10_000, 40_000, 20), 22.5);
    assert.equal(crossLiqMovePct(10_000, 10_000, 5), 90);
    assert.equal(crossLiqMovePct(10_000, 2_000, 1), null, "1x: unreachable");
    assert.equal(crossLiqMovePct(10_000, 100_000, 50), 9);
    assert.equal(crossLiqMovePct(10_000, 200_000, 100), 4.5);
    assert.equal(crossLiqMovePct(1_000, 40_000, 1), 0, "cannot even be held");
  });
  test("leverageRequest sends exactly one size field and clamps the move", () => {
    const n = leverageRequest({ leverage: 20, mode: "notional", amount: 2000, side: "long", move: -5 }, false);
    assert.deepEqual(n, { leverage: 20, equity: 10_000, side: "long", price_move_pct: -5, include_curves: false, position_notional: 2000 });
    const m = leverageRequest({ leverage: 5, mode: "margin", amount: 2000, side: "short", move: -150, equity: 5000 }, true);
    assert.equal(m.margin, 2000);
    assert.equal(m.position_notional, undefined);
    assert.equal(m.price_move_pct, -99);
    assert.equal(m.equity, 5000);
  });
  test("leverageWarning always carries the platform sentence", () => {
    assert.equal(leverageWarning({ warning: `${LEVERAGE_WARNING} Далеч.` }), `${LEVERAGE_WARNING} Далеч.`);
    assert.equal(leverageWarning({ warning: "Само опашка." }), `${LEVERAGE_WARNING} Само опашка.`);
    assert.equal(leverageWarning(null), LEVERAGE_WARNING);
  });
  test("niceTicks covers the range with round steps", () => {
    assert.deepEqual(niceTicks(0, 20_000, 5), [0, 5000, 10_000, 15_000, 20_000]);
    const t = niceTicks(9600, 10_400, 5);
    assert.ok(t[0] <= 9600 && t[t.length - 1] >= 10_400);
    assert.deepEqual(niceTicks(5, 5), [5]);
  });
  test("curveGeometry with a fixed domain: axis, paths and the liquidation point", () => {
    const fam = family();
    const g = curveGeometry(fam, { width: 500, height: 300, left: 50, right: 50, top: 10, bottom: 30 }, [0, 20_000]);
    assert.equal(g.y0, 0);
    assert.equal(g.y1, 20_000);
    assert.deepEqual(g.ticks, [0, 5000, 10_000, 15_000, 20_000]);
    assert.equal(g.x(-20), 50);
    assert.equal(g.x(20), 450);
    assert.equal(g.y(20_000), 10);
    assert.equal(g.y(0), 270);
    const s50 = g.series.find((s) => s.leverage === 50)!;
    assert.equal(s50.liq.length, 1);
    assert.equal(s50.liq[0].move, -9);
    assert.ok(s50.d.startsWith("M50.0,"), "the path starts at the left edge");
    assert.equal((s50.d.match(/L/g) ?? []).length, 5, "6 points → 5 segments, sorted by move");
    // without a domain the axis fits the data
    const auto = curveGeometry(fam, { width: 500, height: 300, left: 50, right: 50, top: 10, bottom: 30 });
    assert.ok(auto.y1 >= 30_000 && auto.y0 <= 1000);
  });
  test("snapMove and pointsAt snap the crosshair to the grid (liquidation extras excluded)", () => {
    const fam = family();
    assert.equal(snapMove(fam.moves_pct, -8.7), -10);
    assert.equal(snapMove(fam.moves_pct, 4), 0);
    const at = pointsAt(fam, -9);
    assert.equal(at.find((r) => r.leverage === 50)!.point.move_pct, -10);
  });
  test("equityAtMove interpolates and stays flat after the liquidation", () => {
    const fam = family();
    const lev1 = fam.series[0].points;
    assert.equal(equityAtMove(lev1, 5), 10_100);
    assert.equal(equityAtMove(lev1, -15), 9_700);
    const lev50 = fam.series[1].points;
    assert.equal(equityAtMove(lev50, -9), 1000);
    assert.equal(equityAtMove(lev50, -15), 1000);
    assert.equal(equityAtMove(lev50, 5), 15_000);
    assert.equal(equityAtMove(lev50, -4.5), 5500);
    assert.equal(equityAtMove([], 1), null);
  });
  test("curveTable lists equity per leverage at the table moves", () => {
    const rows = curveTable(family(), [-20, 0, 20, 7]);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows[1].cells.map((c) => c?.equity ?? null),
      [1000, 10_000, 30_000, null],
    );
    assert.equal(rows[1].cells[0]?.liquidated, true);
    assert.equal(rows[1].liquidationMove, -9);
    assert.deepEqual([...TABLE_MOVES], [-20, -10, -5, -2, 0, 2, 5, 10, 20]);
  });
});

/* ───────────────────────────────────────────── Trade Simulator */

describe("Trade Simulator", () => {
  test("allowedLeverages caps the chips at the instrument maximum", () => {
    assert.deepEqual(allowedLeverages(2), [1, 2]);
    assert.deepEqual(allowedLeverages(30), [1, 2, 5, 10, 20, 30]);
    assert.deepEqual(allowedLeverages(5), [1, 2, 5]);
    assert.deepEqual(allowedLeverages(null), [1, 2, 5, 10, 20, 50, 100]);
    assert.deepEqual(allowedLeverages(500), [1, 2, 5, 10, 20, 50, 100]);
  });
  test("effectiveLeverage falls back to the largest allowed chip below the choice", () => {
    assert.equal(effectiveLeverage(20, [1, 2]), 2);
    assert.equal(effectiveLeverage(5, [1, 2, 5]), 5);
    assert.equal(effectiveLeverage(0.5, [1, 2]), 1);
  });
  test("marketPrice: a long buys at the ask, a short sells at the bid", () => {
    const q = { bid: 99, ask: 101, mid: 100 };
    assert.equal(marketPrice(q, "long"), 101);
    assert.equal(marketPrice(q, "short"), 99);
    assert.equal(marketPrice({ bid: null, ask: null, mid: 100 }, "long"), 100);
    assert.equal(marketPrice({ bid: null, ask: null, mid: null }, "short"), null);
    assert.equal(marketPrice(null, "long"), null);
  });
  test("exampleLevels: one daily move for the stop, two for the target, mirrored for a short", () => {
    assert.deepEqual(exampleLevels(100, "long", 3, 2), { stop: 97, target: 106 });
    assert.deepEqual(exampleLevels(100, "short", 3, 2), { stop: 103, target: 94 });
    assert.deepEqual(exampleLevels(0.82601, "long", 0.4, 5), { stop: 0.82271, target: 0.83262 });
    assert.equal(exampleLevels(100, "long", 0, 2), null);
    assert.equal(exampleLevels(0, "long", 3, 2), null);
  });
  test("planError mirrors the backend side checks", () => {
    assert.equal(planError("long", 100, 95, 110), null);
    assert.match(planError("long", 100, 105, 110) ?? "", /ПОД/);
    assert.match(planError("long", 100, 95, 90) ?? "", /НАД/);
    assert.match(planError("short", 100, 95, 90) ?? "", /НАД/);
    assert.match(planError("short", 100, 105, 110) ?? "", /ПОД/);
    assert.equal(planError("long", null, 105, 1), null);
    assert.equal(planError("long", 100, null, null), null);
  });
  test("tradeRequest converts prices to USD and sends one sizing field", () => {
    const base = { side: "long" as const, entry: 0.8, stop: 0.79, target: 0.82, leverage: 10, rate: 1.25, feeRate: 0.0003, spreadBps: 1.5, dailyVolPct: 0.4 };
    const r = tradeRequest({ ...base, sizing: "risk", riskPct: 1, notional: null })!;
    assert.equal(r.entry_price, 1);
    assert.equal(r.stop_price, 0.9875);
    assert.equal(r.target_price, 1.025);
    assert.equal(r.risk_pct, 1);
    assert.equal(r.position_notional, undefined);
    assert.equal(r.include_curves, false);
    assert.deepEqual(r.scenario_moves, [-10, -5, -2, -1, 1, 2, 5, 10]);
    assert.equal(r.daily_vol_pct, 0.4);
    const n = tradeRequest({ ...base, stop: null, sizing: "notional", riskPct: null, notional: 5000 })!;
    assert.equal(n.position_notional, 5000);
    assert.equal(n.stop_price, undefined);
    assert.equal(tradeRequest({ ...base, stop: null, sizing: "risk", riskPct: 1, notional: null }), null, "risk sizing needs a stop");
    assert.equal(tradeRequest({ ...base, sizing: "notional", riskPct: null, notional: 0 }), null);
    assert.equal(tradeRequest({ ...base, rate: 0, sizing: "risk", riskPct: 1, notional: null }), null);
  });
  test("rescaleResult converts the price fields back to the quote currency and keeps money in USD", () => {
    const r = rescaleResult(RESULT, 2);
    assert.equal(r.entry_price, 55);
    assert.equal(r.liquidation_price, 44);
    assert.equal(r.isolated_liquidation_price, null);
    assert.equal(r.scenarios[0].price, 54.45);
    assert.equal(r.plan!.stop_price, 52.25);
    assert.equal(r.plan!.target_price, 60.5);
    assert.equal(r.position_notional, 1000, "money is not converted");
    assert.equal(rescaleResult(RESULT, 1), RESULT);
  });
  test("tradeHref opens /trade with the symbol and the plan as optional prefill", () => {
    assert.equal(tradeHref({ symbol: "BTC/USDT", side: "long" }), "/trade?symbol=BTC%2FUSDT&side=buy");
    const h = tradeHref({ symbol: "EUR/USD", side: "short", entry: 1.1, stop: 1.11, target: 1.08, leverage: 10 });
    const q = new URLSearchParams(h.split("?")[1]);
    assert.equal(q.get("symbol"), "EUR/USD");
    assert.equal(q.get("side"), "sell");
    assert.equal(q.get("stop"), "1.11");
    assert.equal(q.get("leverage"), "10");
  });
});
