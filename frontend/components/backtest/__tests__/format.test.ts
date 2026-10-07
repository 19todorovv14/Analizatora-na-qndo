/* Unit tests for the backtest formatting helpers (components/backtest/format.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EXIT_LABEL,
  NOT_AVAILABLE_RE,
  barsToText,
  costShare,
  exitTone,
  filterTrades,
  fmtPF,
  fmtSigned,
  fmtTradePrice,
  pfTone,
  regimeShort,
  riskTone,
  shortTime,
  signTone,
  unavailableReason,
  wfVerdict,
} from "../format";

describe("numbers", () => {
  test("profit factor: 1e9 from the backend means no losing trades (∞)", () => {
    assert.equal(fmtPF(1e9), "∞");
    assert.equal(fmtPF(1.2345), "1.23");
    assert.equal(fmtPF(null), "—");
    assert.equal(fmtPF(Number.POSITIVE_INFINITY), "—");
    assert.equal(pfTone(1.3), "up");
    assert.equal(pfTone(0.8), "down");
    assert.equal(pfTone(1), "neutral");
    assert.equal(pfTone(undefined), "neutral");
  });

  test("signed numbers and tones", () => {
    assert.equal(fmtSigned(2.456), "+2.46");
    assert.equal(fmtSigned(-0.314, 1), "-0.3");
    assert.equal(fmtSigned(0), "0.00");
    assert.equal(fmtSigned(null), "—");
    assert.equal(signTone(5), "up");
    assert.equal(signTone(-5), "down");
    assert.equal(signTone(0), "neutral");
    assert.equal(signTone(Number.NaN), "neutral");
  });

  test("trade prices keep a consistent number of decimals per magnitude", () => {
    assert.equal(fmtTradePrice(81021), "81,021.00");
    assert.equal(fmtTradePrice(86163.4), "86,163.40");
    assert.equal(fmtTradePrice(1.08346), "1.0835");
    assert.equal(fmtTradePrice(0.000123456), "0.000123");
    assert.equal(fmtTradePrice(1.08345, 5), "1.08345");
    assert.equal(fmtTradePrice(null), "—");
  });

  test("bar counts as time", () => {
    assert.equal(barsToText(30, 3600), "30 ч");
    assert.equal(barsToText(72, 3600), "3 дни");
    assert.equal(barsToText(3620, 3600), "5.0 мес.");
    assert.equal(barsToText(12, undefined), "12 свещи");
    assert.equal(barsToText(null, 3600), "—");
  });

  test("short local time for dense tables", () => {
    const ts = new Date(2026, 3, 8, 14, 5).getTime() / 1000; // local time
    assert.equal(shortTime(ts), "08.04.26 14:05");
    assert.equal(shortTime(null), "—");
  });
});

describe("labels and tones", () => {
  test("exit reasons", () => {
    assert.equal(EXIT_LABEL.end_of_window, "End of window");
    assert.equal(exitTone("take_profit"), "up");
    assert.equal(exitTone("stop_loss"), "down");
    assert.equal(exitTone("liquidation"), "down");
    assert.equal(exitTone("exit_signal"), "info");
    assert.equal(exitTone("end_of_test"), "neutral");
  });

  test("overfitting risk tone", () => {
    assert.equal(riskTone("LOW"), "up");
    assert.equal(riskTone("MEDIUM"), "warn");
    assert.equal(riskTone("HIGH"), "down");
    assert.equal(riskTone(undefined), "neutral");
  });

  test("regime short labels", () => {
    assert.equal(regimeShort("TRENDING_UP"), "Trend ↑");
    assert.equal(regimeShort("HIGH_VOLATILITY"), "High vol");
    assert.equal(regimeShort("SOMETHING_NEW"), "something new");
  });
});

describe("walk-forward verdict", () => {
  const w = (profitable: boolean) => ({ profitable });

  test("a consistently NEGATIVE result is a red flag, not a green one", () => {
    assert.deepEqual(wfVerdict({ verdict: "consistent", available: true, profitable_fraction: 0, windows: [w(false), w(false)] }), {
      label: "consistently negative",
      tone: "down",
    });
    assert.deepEqual(wfVerdict({ verdict: "consistent", available: true, profitable_fraction: 1 }), { label: "consistent", tone: "up" });
  });

  test("fraction derived from the windows when the backend omits it", () => {
    assert.equal(wfVerdict({ verdict: "consistent", windows: [w(false), w(false), w(false), w(true)] }).tone, "down");
    assert.equal(wfVerdict({ verdict: "consistent", windows: [w(true), w(true), w(true), w(false)] }).tone, "up");
  });

  test("inconsistent / insufficient / unknown", () => {
    assert.deepEqual(wfVerdict({ verdict: "inconsistent", available: true }), { label: "inconsistent", tone: "warn" });
    assert.equal(wfVerdict({ verdict: "insufficient" }).label, "insufficient data");
    assert.equal(wfVerdict({ verdict: "consistent", available: false }).tone, "neutral");
    assert.equal(wfVerdict({ verdict: "new_kind" }).label, "new kind");
  });
});

describe("costs and trade filters", () => {
  test("cost share of the gross profit", () => {
    assert.equal(costShare({ fees: 10, slippage_est: 5, gross_pnl_before_fees: 100 }), 15);
    assert.equal(costShare({ fees: 1176.39, slippage_est: 420.06, gross_pnl_before_fees: 338.06 })?.toFixed(0), "472");
    assert.equal(costShare({ fees: 10, slippage_est: 5, gross_pnl_before_fees: -50 }), null);
    assert.equal(costShare({ fees: 1e6, slippage_est: 0, gross_pnl_before_fees: 1 }), 999);
  });

  test("quick filters", () => {
    const trades = [
      { net_pnl: 10, side: "long" },
      { net_pnl: -5, side: "short" },
      { net_pnl: 0, side: "long" },
    ];
    assert.equal(filterTrades(trades, "all").length, 3);
    assert.equal(filterTrades(trades, "win").length, 1);
    assert.equal(filterTrades(trades, "loss").length, 2, "break-even counts as a loss");
    assert.equal(filterTrades(trades, "long").length, 2);
    assert.equal(filterTrades(trades, "short").length, 1);
  });
});

describe("data not available", () => {
  test("detects provider / backend 'no data' messages", () => {
    assert.ok(NOT_AVAILABLE_RE.test("DATA_NOT_AVAILABLE"));
    assert.ok(NOT_AVAILABLE_RE.test("Няма налични данни за AAPL"));
    assert.ok(!NOT_AVAILABLE_RE.test("Твърде малко данни за този период."));
  });

  test("strips the repeated prefix", () => {
    assert.equal(unavailableReason("DATA NOT AVAILABLE: доставчикът не предоставя история."), "доставчикът не предоставя история.");
    assert.equal(unavailableReason("DATA_NOT_AVAILABLE — no provider"), "no provider");
    assert.equal(unavailableReason("Няма налични данни (DATA_NOT_AVAILABLE)."), "Няма налични данни (DATA_NOT_AVAILABLE).");
    assert.equal(unavailableReason("DATA NOT AVAILABLE"), undefined);
    assert.equal(unavailableReason(null), undefined);
  });
});
