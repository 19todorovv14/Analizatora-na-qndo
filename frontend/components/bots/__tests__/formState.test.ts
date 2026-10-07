/* Unit tests for the Bot Lab helpers (components/bots/formState.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { emptyDefinition } from "../../strategy/dsl";
import type { StrategyRow } from "../../strategy/types";
import {
  WEEKDAYS,
  applyBotPrefill,
  botFormProblem,
  botPayload,
  defaultBotForm,
  filterLogs,
  filteredTotal,
  funnel,
  hoursText,
  withBotStrategy,
  withStartPoint,
} from "../formState";

function strategy(id: number, over: Partial<StrategyRow> = {}): StrategyRow {
  return {
    id,
    name: `Strategy ${id}`,
    description: "",
    is_template: false,
    symbol: "BTC/USDT",
    timeframe: "1h",
    definition: { ...emptyDefinition(), risk_per_trade_pct: 0.75 },
    summary: [],
    rules_count: 4,
    ...over,
  };
}

describe("create form", () => {
  test("defaults: warm start 30 days, 1% risk, one position, 24/7, strategy stop / target", () => {
    const f = defaultBotForm();
    assert.equal(f.run_mode, "warm_start");
    assert.equal(f.warm_start_days, 30);
    assert.equal(f.risk_per_trade_pct, 1);
    assert.equal(f.max_positions, 1);
    assert.deepEqual(f.days, [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(f.start_hour, 0);
    assert.equal(f.end_hour, 24);
    assert.equal(f.stop_type, "");
    assert.equal(f.tp_type, "");
    assert.equal(WEEKDAYS.length, 7);
  });

  test("problems that block 'Create paper bot'", () => {
    const f = { ...defaultBotForm(), strategy_id: 3 };
    assert.equal(botFormProblem(defaultBotForm()), "strategy");
    assert.equal(botFormProblem({ ...f, start_hour: 10, end_hour: 10 }), "hours");
    assert.equal(botFormProblem({ ...f, days: [] }), "days");
    assert.equal(botFormProblem(f), null);
  });

  test("payload: max_positions as the v2 field AND the v1 config key; strategy stop / target kept when not overridden", () => {
    const p = botPayload({ ...defaultBotForm(), strategy_id: 3, max_positions: 3, days: [4, 0, 2], name: "  " });
    assert.equal(p.name, "Paper бот");
    assert.equal(p.max_positions, 3);
    assert.equal(p.config.max_open_positions, 3);
    assert.deepEqual(p.config.trading_hours, { start: 0, end: 24, days: [0, 2, 4] });
    assert.equal(p.stop, undefined);
    assert.equal(p.take_profit, undefined);
    assert.equal(p.run_mode, "warm_start");
    assert.equal(p.config.warm_start_days, 30);
  });

  test("payload: stop / target overrides", () => {
    const base = { ...defaultBotForm(), strategy_id: 3 };
    assert.deepEqual(botPayload({ ...base, stop_type: "atr", stop_value: 1.5 }).stop, { type: "atr", value: 1.5 });
    assert.deepEqual(botPayload({ ...base, stop_type: "swing", stop_value: 1 }).stop, { type: "swing", value: 1, lookback: 10 });
    assert.deepEqual(botPayload({ ...base, tp_type: "r_multiple", tp_value: 3 }).take_profit, { type: "r_multiple", value: 3 });
    assert.deepEqual(botPayload({ ...base, tp_type: "none", tp_value: 2 }).take_profit, { type: "none", value: 2 });
  });
});

describe("strategy prefill (Strategy Builder → 'Create paper bot →')", () => {
  const mine = strategy(5, { symbol: "ETH/USDT", timeframe: "4h" });
  const tpl = strategy(1, { is_template: true, name: "Template" });

  test("choosing a strategy adopts its asset, timeframe and risk", () => {
    const f = withBotStrategy(defaultBotForm(), mine);
    assert.equal(f.strategy_id, 5);
    assert.equal(f.symbol, "ETH/USDT");
    assert.equal(f.timeframe, "4h");
    assert.equal(f.risk_per_trade_pct, 0.75);
  });

  test("query wins for symbol / valid timeframe and names the bot after the strategy", () => {
    const f = applyBotPrefill(defaultBotForm(), [tpl, mine], { strategy: 5, symbol: "SOL/USDT", timeframe: "15m" });
    assert.equal(f.strategy_id, 5);
    assert.equal(f.symbol, "SOL/USDT");
    assert.equal(f.timeframe, "15m");
    assert.equal(f.name, "Paper бот · Strategy 5");
    const g = applyBotPrefill(defaultBotForm(), [tpl, mine], { strategy: 5, timeframe: "7h" });
    assert.equal(g.timeframe, "4h");
  });

  test("without a query: my first strategy, else the first template; default name kept", () => {
    assert.equal(applyBotPrefill(defaultBotForm(), [tpl, mine], {}).strategy_id, 5);
    const t = applyBotPrefill(defaultBotForm(), [tpl], {});
    assert.equal(t.strategy_id, 1);
    assert.equal(t.name, defaultBotForm().name);
    const f = defaultBotForm();
    assert.equal(applyBotPrefill(f, [], { strategy: 5 }), f);
  });

  test("a very long strategy name is cut to the 100-char bot name limit", () => {
    const long = strategy(8, { name: "x".repeat(140) });
    assert.equal(applyBotPrefill(defaultBotForm(), [long], { strategy: 8 }).name.length, 100);
  });
});

describe("schedule text", () => {
  test("24/7, hours, selected days", () => {
    assert.equal(hoursText({}), "24/7");
    assert.equal(hoursText({ trading_hours: { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] } }), "24/7");
    assert.equal(hoursText({ trading_hours: { start: 8, end: 16, days: [0, 1, 2, 3, 4, 5, 6] } }), "08:00–16:00 UTC · всеки ден");
    assert.equal(hoursText({ trading_hours: { start: 0, end: 24, days: [4, 0, 1] } }), "00:00–24:00 UTC · Пн, Вт, Пт");
  });
});

describe("charts", () => {
  test("curves get a starting point at the initial balance / 0%", () => {
    assert.deepEqual(withStartPoint([], 10_000, 100), []);
    assert.deepEqual(withStartPoint(null, 10_000), []);
    assert.deepEqual(
      withStartPoint(
        [
          [7200, 10_100],
          [10_800, 9_900],
        ],
        10_000,
        3600,
      ),
      [
        [3600, 10_000],
        [7200, 10_100],
        [10_800, 9_900],
      ],
    );
    // no (or a later) first evaluated candle → one bar before the first point
    assert.deepEqual(withStartPoint([[7200, -1.2]], 0, null, 900)[0], [6300, 0]);
    assert.deepEqual(withStartPoint([[7200, -1.2]], 0, 9000, 900)[0], [6300, 0]);
  });
});

describe("BOT AI COACH funnel", () => {
  const stats = { setups_generated: 672, all_conditions_met: 354, rejected: 318, entries: 29 };

  test("generated → all met → rejected → trades, as % of generated", () => {
    const steps = funnel(stats);
    assert.deepEqual(
      steps.map((s) => [s.key, s.value, s.pct]),
      [
        ["setups", 672, 100],
        ["met", 354, 52.7],
        ["rejected", 318, 47.3],
        ["trades", 29, 4.3],
      ],
    );
  });

  test("with per-filter counters a 'blocked by filters' step is added", () => {
    const steps = funnel({ ...stats, rejected_by_filters: { regime: 0, max_positions: 325, daily_loss: 0 } });
    assert.deepEqual(
      steps.map((s) => s.key),
      ["setups", "met", "rejected", "filtered", "trades"],
    );
    assert.equal(steps[3].value, 325);
    assert.equal(steps[3].value + steps[4].value, stats.all_conditions_met);
  });

  test("no setups yet → no percentages", () => {
    const steps = funnel({ setups_generated: 0, all_conditions_met: 0, rejected: 0, entries: 0 });
    assert.ok(steps.every((s) => s.pct === null && s.value === 0));
  });

  test("filter totals ignore missing / negative / non-numeric counters", () => {
    assert.equal(filteredTotal({ a: 3, b: undefined, c: -2, d: Number.NaN, e: 4 }), 7);
    assert.equal(filteredTotal(null), 0);
  });
});

describe("logs", () => {
  const logs = [
    { level: "info", message: "a" },
    { level: "signal", message: "b" },
    { level: "trade", message: "c" },
    { level: "warn", message: "d" },
    { level: "error", message: "e" },
  ];

  test("level filter (warn includes errors)", () => {
    assert.equal(filterLogs(logs, "all").length, 5);
    assert.deepEqual(
      filterLogs(logs, "signal").map((l) => l.message),
      ["b"],
    );
    assert.deepEqual(
      filterLogs(logs, "warn").map((l) => l.message),
      ["d", "e"],
    );
  });
});
