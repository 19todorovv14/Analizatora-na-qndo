/*
 * lib/sizing.ts — position sizing / order maths shared by the paper terminal, replay and order forms.
 * Mirrors the backend PaperBroker.qty_for_risk (USD account, any quote currency).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  entryTypeForLevel,
  floorToStep,
  fmtQty,
  fxRateAt,
  leverageChoices,
  marginFor,
  marketEntry,
  maxQtyForMargin,
  notionalUsd,
  parseNum,
  perUnitRisk,
  qtyForRisk,
  rewardRisk,
  riskAmount,
  roundPrice,
  stepDecimals,
  stopFromPct,
  stopOnLosingSide,
  targetFromR,
  targetOnWinningSide,
} from "@/lib/sizing";

const close = (a: number | null, b: number, eps = 1e-6) => {
  assert.ok(a !== null, "value is null");
  assert.ok(Math.abs((a as number) - b) <= eps, `${a} ≉ ${b}`);
};

describe("number parsing and rounding", () => {
  test("parseNum accepts comma decimals, thousands separators and spaces", () => {
    assert.equal(parseNum("1,5"), 1.5);
    assert.equal(parseNum("1,234.5"), 1234.5);
    assert.equal(parseNum(" 98.1 "), 98.1);
    assert.equal(parseNum("1 234,5"), 1234.5);
    assert.equal(parseNum(".5"), 0.5);
    assert.equal(parseNum("2e3"), 2000);
    assert.equal(parseNum(42), 42);
  });
  test("parseNum rejects garbage and empty input", () => {
    for (const v of ["", "  ", "abc", "1.2.3", "--1", null, undefined, Number.NaN, Infinity]) assert.equal(parseNum(v as never), null);
  });
  test("stepDecimals / floorToStep follow the instrument step (backend round_qty)", () => {
    assert.equal(stepDecimals(0.0001), 4);
    assert.equal(stepDecimals(100), 0);
    assert.equal(stepDecimals(0.5), 1);
    assert.equal(stepDecimals(1e-8), 8);
    assert.equal(floorToStep(0.123456, 0.0001), 0.1234);
    assert.equal(floorToStep(9799, 100), 9700);
    assert.equal(floorToStep(0.3, 0.1), 0.3, "no float drift below the step");
    assert.equal(floorToStep(-1, 0.1), 0);
    assert.equal(floorToStep(1.23, 0), 1.23, "no step → unchanged");
  });
  test("roundPrice / fmtQty", () => {
    assert.equal(roundPrice(1.23456, 2), 1.23);
    assert.equal(roundPrice(153.3719, 3), 153.372);
    assert.equal(fmtQty(0.015, 0.0001), "0.015");
    assert.equal(fmtQty(1000, 100), "1000");
    assert.equal(fmtQty(0), "");
    assert.equal(fmtQty(null), "");
  });
});

describe("sides and levels", () => {
  test("stop must be on the losing side, target on the winning side", () => {
    assert.ok(stopOnLosingSide("buy", 100, 99));
    assert.ok(!stopOnLosingSide("buy", 100, 101));
    assert.ok(stopOnLosingSide("sell", 100, 101));
    assert.ok(targetOnWinningSide("buy", 100, 102));
    assert.ok(!targetOnWinningSide("sell", 100, 102));
    assert.ok(!stopOnLosingSide("buy", 0, 1));
  });
  test("stopFromPct / targetFromR / rewardRisk", () => {
    assert.equal(stopFromPct(100, "buy", 0.01, 2), 99);
    assert.equal(stopFromPct(100, "sell", 0.005, 2), 100.5);
    assert.equal(targetFromR(100, 99, "buy", 2, 2), 102);
    assert.equal(targetFromR(100, 101, "sell", 1.5, 2), 98.5);
    assert.equal(targetFromR(100, 101, "buy", 2, 2), null, "stop on the wrong side");
    close(rewardRisk("buy", 100, 99, 102), 2);
    assert.equal(rewardRisk("buy", 100, 99, 98), null);
  });
  test("entryTypeForLevel: better price → LIMIT, worse → STOP", () => {
    assert.equal(entryTypeForLevel("buy", 95, 100), "limit");
    assert.equal(entryTypeForLevel("buy", 105, 100), "stop");
    assert.equal(entryTypeForLevel("sell", 105, 100), "limit");
    assert.equal(entryTypeForLevel("sell", 95, 100), "stop");
    assert.equal(entryTypeForLevel("buy", 95, null), "limit");
  });
  test("marketEntry: ASK for buys, BID for sells, last as fallback", () => {
    assert.equal(marketEntry("buy", 99, 101, 100), 101);
    assert.equal(marketEntry("sell", 99, 101, 100), 99);
    assert.equal(marketEntry("buy", null, null, 100), 100);
    assert.equal(marketEntry("sell", undefined, 0, null), null);
  });
});

describe("FX conversion", () => {
  test("identity / inverse / cross / unavailable", () => {
    assert.equal(fxRateAt(null), 1);
    assert.equal(fxRateAt({ method: "identity", rate: 1, available: true }), 1);
    close(fxRateAt({ method: "inverse", rate: 0.0065, available: true }, 150), 1 / 150);
    assert.equal(fxRateAt({ method: "cross", rate: 1.34, available: true }, 0.85), 1.34);
    assert.equal(fxRateAt({ method: "cross", rate: 1.34, available: false }), null);
    assert.equal(fxRateAt({ method: "cross", rate: null, available: true }), null);
  });
  test("notional and margin in USD", () => {
    close(notionalUsd(10000, 153.371, { method: "inverse", available: true }), 10000);
    close(notionalUsd(1000, 0.85, { method: "cross", rate: 1.3, available: true }), 1105);
    close(marginFor(10000, 20), 500);
    assert.equal(marginFor(null, 2), null);
    assert.equal(marginFor(1000, 0), null);
  });
});

describe("risk-based sizing", () => {
  test("riskAmount and per-unit risk with fees", () => {
    assert.equal(riskAmount(10000, 1), 100);
    assert.equal(riskAmount(10000, 0), 0);
    close(perUnitRisk({ side: "buy", entry: 100, stop: 99 }), 1);
    close(perUnitRisk({ side: "buy", entry: 100, stop: 99, feeRate: 0.001 }), 1 + 0.1 + 0.099);
    assert.equal(perUnitRisk({ side: "buy", entry: 100, stop: 101 }), null);
  });
  test("USD-quoted crypto: 1% of 10k with a 1% stop ≈ 1 BTC-equivalent of $10k notional", () => {
    const r = qtyForRisk({ side: "buy", equity: 10000, riskPct: 1, entry: 100000, stop: 99000, qtyStep: 0.0001, minQty: 0.0001 });
    assert.equal(r.qty, 0.1);
    assert.equal(r.riskAmount, 100);
    assert.ok(!r.belowMin && !r.cappedByMargin);
  });
  test("USD/JPY (inverse quote): the stop distance is converted at the stop price", () => {
    const r = qtyForRisk({
      side: "buy",
      equity: 10000,
      riskPct: 1,
      entry: 153.371,
      stop: 151.83,
      qtyStep: 100,
      minQty: 1000,
      conversion: { method: "inverse", available: true },
      feeRate: 0.00003,
    });
    // ≈ 1.541 JPY / 151.83 ≈ 0.01015 USD per unit (+ fees) → ≈ 9 700 units, like the backend preview
    assert.equal(r.qty, 9700);
  });
  test("margin cap and minimum quantity", () => {
    const capped = qtyForRisk({ side: "buy", equity: 10000, riskPct: 2, entry: 100, stop: 99.9, qtyStep: 1, freeMargin: 1000, leverage: 2 });
    assert.ok(capped.cappedByMargin);
    assert.equal(capped.qty, maxQtyForMargin({ freeMargin: 1000, entry: 100, leverage: 2, qtyStep: 1 }));
    assert.equal(capped.qty, 20);
    const tiny = qtyForRisk({ side: "buy", equity: 100, riskPct: 0.1, entry: 100, stop: 50, qtyStep: 0.01, minQty: 1 });
    assert.ok(tiny.belowMin);
    assert.equal(tiny.qty, 0);
  });
  test("no rate / wrong-side stop → nothing to trade", () => {
    const r = qtyForRisk({ side: "sell", equity: 10000, riskPct: 1, entry: 100, stop: 99, qtyStep: 0.01 });
    assert.equal(r.qty, 0);
    assert.equal(r.perUnit, null);
    const fx = qtyForRisk({ side: "buy", equity: 10000, riskPct: 1, entry: 0.85, stop: 0.84, qtyStep: 100, conversion: { method: "cross", available: false } });
    assert.equal(fx.qty, 0);
  });
});

describe("leverage choices", () => {
  test("standard steps up to the max, the max itself included, never above 100", () => {
    assert.deepEqual(leverageChoices(2), [1, 2]);
    assert.deepEqual(leverageChoices(30), [1, 2, 3, 5, 10, 20, 25, 30]);
    assert.deepEqual(leverageChoices(100), [1, 2, 3, 5, 10, 20, 25, 50, 75, 100]);
    assert.deepEqual(leverageChoices(500), [1, 2, 3, 5, 10, 20, 25, 50, 75, 100]);
    assert.deepEqual(leverageChoices(0), [1]);
    assert.deepEqual(leverageChoices(1), [1]);
  });
});
