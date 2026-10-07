/* Unit tests for the interactive-candle maths (components/academy/visuals/candleModel.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  candleAnatomy,
  changePct,
  classifyCandle,
  extremeOrder,
  isValidCandle,
  lastClosed,
  partAtY,
  partsFromHighlight,
  priceFromHighlight,
  pricesOfPart,
  railOrder,
  spreadLabels,
  toCandleItem,
} from "../../academy/visuals/candleModel";

const BULL = { open: 100, high: 112, low: 97, close: 110 };
const BEAR = { open: 110, high: 113, low: 96, close: 99 };

describe("toCandleItem", () => {
  test("accepts [o,h,l,c] arrays from the academy content", () => {
    assert.deepEqual(toCandleItem([100, 112, 97, 110]), { open: 100, high: 112, low: 97, close: 110 });
  });
  test("accepts market candles and keeps time", () => {
    assert.deepEqual(toCandleItem({ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 }), {
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      time: 1700000000,
    });
  });
  test("rejects malformed input instead of inventing numbers", () => {
    assert.equal(toCandleItem([1, 2, 3]), null);
    assert.equal(toCandleItem([1, 2, Number.NaN, 4]), null);
    assert.equal(toCandleItem({ open: 1, high: "2", low: 0, close: 1 }), null);
    assert.equal(toCandleItem(null), null);
    assert.equal(toCandleItem("candle"), null);
  });
});

describe("candleAnatomy", () => {
  test("bullish candle: body = Close − Open, wicks to High / Low", () => {
    const a = candleAnatomy(BULL);
    assert.equal(a.dir, "bullish");
    assert.equal(a.range, 15);
    assert.equal(a.body, 10);
    assert.equal(a.upper, 2);
    assert.equal(a.lower, 3);
    assert.equal(Math.round(a.bodyPct), 67);
    assert.equal(Math.round(a.upperPct + a.bodyPct + a.lowerPct), 100);
  });
  test("bearish candle: the body top is the Open", () => {
    const a = candleAnatomy(BEAR);
    assert.equal(a.dir, "bearish");
    assert.equal(a.top, 110);
    assert.equal(a.bot, 99);
    assert.equal(a.upper, 3);
    assert.equal(a.lower, 3);
  });
  test("a body under 3% of the range is neutral (doji-like)", () => {
    assert.equal(candleAnatomy({ open: 105, high: 109, low: 101, close: 105.1 }).dir, "neutral");
  });
  test("a flat candle has zero percentages, not NaN", () => {
    const a = candleAnatomy({ open: 5, high: 5, low: 5, close: 5 });
    assert.equal(a.range, 0);
    assert.equal(a.bodyPct, 0);
    assert.equal(a.dir, "neutral");
  });
});

describe("highlights and hover", () => {
  test("lesson highlight → parts", () => {
    assert.deepEqual(partsFromHighlight("wick"), ["upper_wick", "lower_wick"]);
    assert.deepEqual(partsFromHighlight("upper_wick"), ["upper_wick"]);
    assert.deepEqual(partsFromHighlight("lower_wick"), ["lower_wick"]);
    assert.deepEqual(partsFromHighlight("body"), ["body"]);
    assert.deepEqual(partsFromHighlight("open"), []);
    assert.deepEqual(partsFromHighlight(null), []);
  });
  test("lesson highlight → price", () => {
    assert.equal(priceFromHighlight("close"), "close");
    assert.equal(priceFromHighlight("body"), null);
  });
  test("each part lights up the two prices that bound it", () => {
    assert.deepEqual(pricesOfPart("upper_wick", BULL), ["high", "close"]);
    assert.deepEqual(pricesOfPart("lower_wick", BULL), ["open", "low"]);
    assert.deepEqual(pricesOfPart("body", BULL), ["close", "open"]);
    assert.deepEqual(pricesOfPart("upper_wick", BEAR), ["high", "open"]);
    assert.deepEqual(pricesOfPart("lower_wick", BEAR), ["close", "low"]);
  });
  test("price rail order follows the body edges", () => {
    assert.deepEqual(railOrder(BULL), ["high", "close", "open", "low"]);
    assert.deepEqual(railOrder(BEAR), ["high", "open", "close", "low"]);
  });
  test("partAtY finds the part under the cursor", () => {
    assert.equal(partAtY(10, 50, 100), "upper_wick");
    assert.equal(partAtY(75, 50, 100), "body");
    assert.equal(partAtY(120, 50, 100), "lower_wick");
  });
  test("a very thin body still has a ±4 px hover zone", () => {
    assert.equal(partAtY(51, 50, 52), "body");
    assert.equal(partAtY(44, 50, 52), "upper_wick");
    assert.equal(partAtY(58, 50, 52), "lower_wick");
  });
});

describe("spreadLabels", () => {
  test("keeps the minimum gap, stays inside the bounds and does not mutate the input", () => {
    const input = [{ y: 10 }, { y: 12 }, { y: 13 }, { y: 200 }];
    const out = spreadLabels(input, 18, 8, 190);
    assert.deepEqual(input.map((i) => i.y), [10, 12, 13, 200]);
    for (let i = 1; i < out.length; i++) assert.ok(out[i].y - out[i - 1].y >= 18, `gap ${i}`);
    assert.ok(out[0].y >= 8);
    assert.ok(out[out.length - 1].y <= 190);
  });
  test("labels that already fit stay on their anchors", () => {
    assert.deepEqual(spreadLabels([{ y: 20 }, { y: 80 }], 18, 0, 100).map((i) => i.y), [20, 80]);
  });
});

describe("builder helpers", () => {
  test("validity: High ≥ max(O,C) and Low ≤ min(O,C)", () => {
    assert.equal(isValidCandle(BULL), true);
    assert.equal(isValidCandle({ open: 100, high: 99, low: 95, close: 98 }), false);
    assert.equal(isValidCandle({ open: 100, high: 105, low: 101, close: 102 }), false);
  });
  test("recognises the teaching shapes", () => {
    assert.ok(classifyCandle({ open: 104, high: 109, low: 99, close: 104.2 }).includes("doji"));
    assert.ok(classifyCandle({ open: 106, high: 107, low: 96, close: 106.8 }).includes("hammer"));
    assert.ok(classifyCandle({ open: 100, high: 110, low: 99.5, close: 100.8 }).includes("shooting star"));
    assert.ok(classifyCandle({ open: 100, high: 110, low: 100, close: 110 }).includes("marubozu"));
    assert.deepEqual(classifyCandle({ open: 5, high: 5, low: 5, close: 5 }), []);
  });
});

describe("market data helpers", () => {
  const candles = [0, 3600, 7200, 10800].map((t) => ({ time: t, open: 1, high: 2, low: 0, close: 1 }));
  test("lastClosed drops the candle that is still forming", () => {
    assert.deepEqual(lastClosed(candles, 3600, 11000, 6).map((c) => c.time), [0, 3600, 7200]);
    assert.deepEqual(lastClosed(candles, 3600, 11000, 2).map((c) => c.time), [3600, 7200]);
  });
  test("lastClosed without server time keeps everything", () => {
    assert.equal(lastClosed(candles, 3600, null, 10).length, 4);
  });
  test("changePct", () => {
    assert.equal(changePct({ open: 100, high: 110, low: 90, close: 105 }), 5);
    assert.equal(changePct({ open: 0, high: 1, low: 0, close: 1 }), null);
  });
  test("extremeOrder numbers the high/low markers of the drill-down", () => {
    assert.deepEqual(extremeOrder("low"), { high: 2, low: 1 });
    assert.deepEqual(extremeOrder("high"), { high: 1, low: 2 });
    assert.deepEqual(extremeOrder("same"), { high: 1, low: 1 });
    assert.deepEqual(extremeOrder(null), { high: null, low: null });
  });
});
