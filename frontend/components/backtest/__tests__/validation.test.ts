/* Unit tests for the "Strategy validation" helpers (components/backtest/validation.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MetricsV2, OutOfSample, RunSummary } from "../types";
import {
  baseSummary,
  comparisonRows,
  costShareLabel,
  deltaTone,
  drawdownTone,
  flipsSign,
  fmtCmp,
  plainReading,
  sensitivityFlips,
  wfGeometry,
} from "../validation";

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  total_trades: 30,
  net_pnl: 100,
  win_rate: 40,
  profit_factor: 1.2,
  expectancy_r: 0.1,
  max_drawdown_pct: 8,
  return_pct: 1,
  ...over,
});

describe("in-sample vs out-of-sample", () => {
  test("formats each metric (and its delta) in its own unit", () => {
    assert.equal(fmtCmp("total_trades", 35), "35");
    assert.equal(fmtCmp("total_trades", -21, true), "-21");
    assert.equal(fmtCmp("win_rate", 42.857), "42.9%");
    assert.equal(fmtCmp("win_rate", 1.5, true), "+1.5 pp");
    assert.equal(fmtCmp("return_pct", 1.31), "+1.31%");
    assert.equal(fmtCmp("profit_factor", 1e9), "∞");
    assert.equal(fmtCmp("profit_factor", 1e9, true), "+99.00", "an ∞ delta is clamped");
    assert.equal(fmtCmp("expectancy_r", 0.07), "+0.07R");
    assert.equal(fmtCmp("net_pnl", -131.02), "-$131.02");
    assert.equal(fmtCmp("sharpe_like", 1.234), "1.23");
    assert.equal(fmtCmp("sharpe_like", 1.234, true), "+1.23");
    assert.equal(fmtCmp("win_rate", null), "—");
  });

  test("delta colours: lower drawdown is good, trade count is neutral", () => {
    assert.equal(deltaTone("win_rate", 2), "text-up");
    assert.equal(deltaTone("net_pnl", -2), "text-down");
    assert.equal(deltaTone("max_drawdown_pct", -6.1), "text-up");
    assert.equal(deltaTone("max_drawdown_pct", 3), "text-down");
    assert.equal(deltaTone("total_trades", -49), "text-muted");
    assert.equal(deltaTone("win_rate", 0), "text-muted");
    assert.equal(deltaTone("win_rate", null), "text-muted");
  });

  test("v2 comparison rows are used as-is; v1 rows are derived from the two summaries", () => {
    const v2: OutOfSample = {
      in_sample: run(),
      out_of_sample: run(),
      split_ts: 1,
      comparison: [{ key: "total_trades", label: "Trades", in_sample: 35, out_of_sample: 14, delta: -21 }],
    };
    assert.equal(comparisonRows(v2), v2.comparison);
    const rows = comparisonRows({ in_sample: run({ win_rate: 40, profit_factor: null }), out_of_sample: run({ win_rate: 35 }) });
    assert.deepEqual(
      rows.map((r) => r.key),
      ["total_trades", "win_rate", "profit_factor", "expectancy_r", "net_pnl", "max_drawdown_pct"],
    );
    assert.equal(rows.find((r) => r.key === "win_rate")?.delta, -5);
    assert.equal(rows.find((r) => r.key === "profit_factor")?.delta, null);
  });
});

describe("stress + sensitivity", () => {
  test("base summary from the metrics", () => {
    const m = { total_trades: 155, net_pnl: -838.33, win_rate: 34.8, profit_factor: 0.92, expectancy_r: -0.05, max_drawdown_pct: 18.47, return_pct: -8.38 } as MetricsV2;
    assert.deepEqual(baseSummary(m), { total_trades: 155, net_pnl: -838.33, win_rate: 34.8, profit_factor: 0.92, expectancy_r: -0.05, max_drawdown_pct: 18.47, return_pct: -8.38 });
  });

  test("a variant flips the sign only when it traded", () => {
    const base = run({ net_pnl: 100 });
    assert.equal(flipsSign(base, run({ net_pnl: -1 })), true);
    assert.equal(flipsSign(base, run({ net_pnl: 50 })), false);
    assert.equal(flipsSign(base, run({ net_pnl: 0, total_trades: 0 })), false);
    assert.equal(sensitivityFlips(base, [run({ net_pnl: -1 }), run({ net_pnl: 2 }), run({ net_pnl: -3, total_trades: 0 }), run({ net_pnl: -4 })]), 2);
  });
});

describe("walk-forward bars", () => {
  const win = (index: number, return_pct: number | null, trades = 10) => ({ index, return_pct, trades });

  test("all windows negative → zero line at the top, bars hang down", () => {
    const { zero, bars } = wfGeometry([win(1, -1), win(2, -3), win(3, -3.5), win(4, -1.4)]);
    assert.equal(zero, 0);
    assert.ok(bars.every((b) => !b.positive && b.top === 0));
    assert.equal(bars[2].height, 100, "the largest loss uses the full height");
    assert.ok(Math.abs(bars[0].height - (1 / 3.5) * 100) < 1e-9);
  });

  test("all windows positive → zero line at the bottom", () => {
    const { zero, bars } = wfGeometry([win(1, 2), win(2, 4)]);
    assert.equal(zero, 100);
    assert.deepEqual(
      bars.map((b) => [b.top, b.height]),
      [
        [50, 50],
        [0, 100],
      ],
    );
  });

  test("mixed signs → proportional zero line; tiny / empty windows keep a visible stub inside the plot", () => {
    const { zero, bars } = wfGeometry([win(1, 3), win(2, -1), win(3, 0, 0), win(4, null)]);
    assert.equal(zero, 75);
    assert.deepEqual([bars[0].top, bars[0].height], [0, 75]);
    assert.deepEqual([bars[1].top, bars[1].height], [75, 25]);
    assert.equal(bars[2].empty, true);
    assert.equal(bars[2].height, 1.5);
    assert.equal(bars[3].value, 0, "a missing return counts as 0");
    for (const b of bars) assert.ok(b.top >= 0 && b.top + b.height <= 100 + 1e-9);
  });

  test("all zero → stubs stay inside", () => {
    const { bars } = wfGeometry([win(1, 0), win(2, 0)]);
    for (const b of bars) assert.ok(b.top >= 0 && b.top + b.height <= 100);
  });
});

describe("labels", () => {
  test("cost share label switches to × when costs exceed the gross profit", () => {
    assert.equal(costShareLabel(34.4), "разходи = 34% от брутното");
    assert.equal(costShareLabel(472.2), "разходи = 4.7× брутната печалба");
    assert.equal(costShareLabel(null), null);
  });

  test("drawdown tile tone", () => {
    assert.equal(drawdownTone(25), "down");
    assert.equal(drawdownTone(-12), "warn");
    assert.equal(drawdownTone(5), "neutral");
    assert.equal(drawdownTone(null), "neutral");
  });

  test("plain-language reading for beginners", () => {
    assert.match(plainReading({ total_trades: 0, winning_trades: 0, win_rate: null, expectancy_r: null, max_drawdown_pct: 0 })[0], /Няма сделки/);
    const pos = plainReading({ total_trades: 40, winning_trades: 18, win_rate: 45, expectancy_r: 0.25, max_drawdown_pct: 7.5 });
    assert.equal(pos.length, 3);
    assert.match(pos[0], /^40 сделки, от които 18 печеливши \(win rate 45%\)/);
    assert.match(pos[1], /Expectancy \+0\.25R: средно всяка сделка е донесла 0\.25 пъти риска/);
    assert.match(pos[2], /Max drawdown 7\.5%/);
    assert.match(plainReading({ total_trades: 10, winning_trades: 2, win_rate: 20, expectancy_r: -0.4, max_drawdown_pct: 9 })[1], /губила/);
  });
});
