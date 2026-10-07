/* Unit tests for the Backtesting Lab form state (components/backtest/formState.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { emptyDefinition } from "../../strategy/dsl";
import type { StrategyRow } from "../../strategy/types";
import {
  MAX_BARS,
  RANGES,
  WARMUP_BARS,
  applyPrefill,
  defaultForm,
  estimateBars,
  fitStart,
  formProblem,
  isTimeframe,
  pickStrategy,
  rangeStart,
  toPayload,
  todayInput,
  withStrategy,
} from "../formState";

// 2026-10-07 12:34:56 UTC
const NOW = Date.UTC(2026, 9, 7, 12, 34, 56);

function strategy(id: number, over: Partial<StrategyRow> = {}): StrategyRow {
  return {
    id,
    name: `S${id}`,
    description: "",
    is_template: false,
    symbol: "BTC/USDT",
    timeframe: "1h",
    definition: { ...emptyDefinition(), risk_per_trade_pct: 1 },
    summary: [],
    rules_count: 4,
    template_key: null,
    ...over,
  };
}

const TEMPLATE = strategy(1, { is_template: true, symbol: "ETH/USDT", timeframe: "4h", template_key: "trend_momentum_structure" });
const MINE = strategy(7, { symbol: "SOL/USDT", timeframe: "15m", definition: { ...emptyDefinition(), risk_per_trade_pct: 0.5 } });
const OTHER = strategy(9, { symbol: "AAPL", timeframe: "1d" });
const ALL = [TEMPLATE, MINE, OTHER];

describe("defaults and ranges", () => {
  test("6M on BTC/USDT 1h ending today (UTC), fees on, worst-case intrabar, one position", () => {
    const f = defaultForm(NOW);
    assert.equal(f.end, "2026-10-07");
    assert.equal(f.start, "2026-04-08");
    assert.equal(f.range, "6M");
    assert.equal(f.symbol, "BTC/USDT");
    assert.equal(f.timeframe, "1h");
    assert.equal(f.strategy_id, 0);
    assert.equal(f.fees_enabled, true);
    assert.equal(f.fee_bps, null);
    assert.equal(f.intrabar_policy, "worst_case");
    assert.equal(f.max_open_positions, 1);
    assert.equal(todayInput(NOW), "2026-10-07");
  });

  test("quick ranges", () => {
    assert.deepEqual(
      RANGES.map((r) => r.key),
      ["1M", "3M", "6M", "1Y", "2Y"],
    );
    assert.equal(rangeStart("2026-10-07", 30), "2026-09-07");
    assert.equal(rangeStart("2026-03-01", 1), "2026-02-28");
  });
});

describe("MAX_BARS guard", () => {
  test("estimateBars counts the whole end day plus the warm-up", () => {
    // one full day of 1h candles
    assert.equal(estimateBars({ start: "2026-10-07", end: "2026-10-07", timeframe: "1h" }), 23 + WARMUP_BARS);
    assert.equal(estimateBars({ start: "2026-10-01", end: "2026-10-07", timeframe: "1d" }), 6 + WARMUP_BARS);
    assert.equal(estimateBars({ start: "2026-10-08", end: "2026-10-07", timeframe: "1h" }), WARMUP_BARS);
  });

  test("a long 5m period is too long; fitStart shortens it under the limit", () => {
    const f = { ...defaultForm(NOW), strategy_id: 7, timeframe: "5m", start: "2025-10-07" };
    assert.ok(estimateBars(f) > MAX_BARS);
    assert.equal(formProblem(f), "too_long");
    const fixed = { ...f, start: fitStart(f) };
    assert.ok(estimateBars(fixed) <= MAX_BARS, `fits: ${estimateBars(fixed)}`);
    assert.equal(formProblem(fixed), null);
    // every timeframe: the shortened period always passes the guard (the end day counts in full)
    for (const tf of ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]) {
      const g = { ...f, timeframe: tf, start: "2000-01-01" };
      assert.ok(estimateBars({ ...g, start: fitStart(g) }) <= MAX_BARS, tf);
    }
  });

  test("form problems: strategy, dates", () => {
    const f = defaultForm(NOW);
    assert.equal(formProblem(f), "strategy");
    assert.equal(formProblem({ ...f, strategy_id: 7, start: "2026-10-07", end: "2026-10-07" }), "dates");
    assert.equal(formProblem({ ...f, strategy_id: 7 }), null);
  });
});

describe("payload", () => {
  test("POST /backtests body: UTC day bounds, auto fees omitted, v2 max_open_positions", () => {
    const p = toPayload({ ...defaultForm(NOW), strategy_id: 7 });
    assert.equal(p.start_ts, Date.UTC(2026, 3, 8) / 1000);
    assert.equal(p.end_ts, Date.UTC(2026, 9, 7) / 1000 + 86399);
    assert.equal(p.fee_bps, undefined);
    assert.equal(p.max_open_positions, 1);
    assert.equal(p.intrabar_policy, "worst_case");
    assert.equal(toPayload({ ...defaultForm(NOW), strategy_id: 7, fee_bps: 7.5 }).fee_bps, 7.5);
    assert.equal(toPayload({ ...defaultForm(NOW), strategy_id: 7, fee_bps: 7.5, fees_enabled: false }).fee_bps, undefined);
  });
});

describe("deep-link prefill (?strategy=&symbol=&timeframe= from the builder or the BOT AI COACH)", () => {
  test("timeframe whitelist", () => {
    assert.equal(isTimeframe("4h"), true);
    assert.equal(isTimeframe("2h"), false);
    assert.equal(isTimeframe(null), false);
  });

  test("strategy choice: requested → current → my first → first template", () => {
    assert.equal(pickStrategy(ALL, { strategy: 9 })?.id, 9);
    assert.equal(pickStrategy(ALL, { strategy: 404 }, 9)?.id, 9);
    assert.equal(pickStrategy(ALL, {})?.id, 7);
    assert.equal(pickStrategy([TEMPLATE], {})?.id, 1);
    assert.equal(pickStrategy([], { strategy: 1 }), undefined);
  });

  test("query symbol / timeframe win over the strategy's own; unknown timeframes are ignored", () => {
    const f = applyPrefill(defaultForm(NOW), ALL, { strategy: 1, symbol: "BTC/USDT", timeframe: "1h" });
    assert.equal(f.strategy_id, 1);
    assert.equal(f.symbol, "BTC/USDT");
    assert.equal(f.timeframe, "1h");
    const g = applyPrefill(defaultForm(NOW), ALL, { strategy: 7, timeframe: "2h" });
    assert.equal(g.symbol, "SOL/USDT");
    assert.equal(g.timeframe, "15m");
    assert.equal(g.risk_per_trade_pct, 0.5);
  });

  test("no strategies → form unchanged", () => {
    const f = defaultForm(NOW);
    assert.equal(applyPrefill(f, [], { strategy: 3 }), f);
  });

  test("choosing a strategy adopts its asset, timeframe and risk", () => {
    const f = withStrategy(defaultForm(NOW), OTHER);
    assert.equal(f.strategy_id, 9);
    assert.equal(f.symbol, "AAPL");
    assert.equal(f.timeframe, "1d");
    assert.equal(f.risk_per_trade_pct, 1);
  });
});
