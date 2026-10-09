/*
 * components/terminal/model.ts — layout grid / panel sizes, hotkey bindings, session clock helpers.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BOTTOM_LIMITS,
  HANDLE,
  RAIL_WIDTH,
  RIGHT_LIMITS,
  barCloseIn,
  createNavTracker,
  fitPanel,
  fmtCountdown,
  fmtUtcClock,
  gridTemplate,
  isNavSequence,
  letterBindings,
  prefillStatus,
  readTerminalQuery,
  screenshotName,
  termKey,
  timeframeBindings,
} from "@/components/terminal/model";

describe("layout", () => {
  test("persisted keys are per route: ta-term:<route>:<part>", () => {
    assert.equal(termKey("charts", "right"), "ta-term:charts:right");
    assert.equal(termKey("trade", "bottom"), "ta-term:trade:bottom");
    assert.equal(termKey("trade", "bottom-tab"), "ta-term:trade:bottom-tab");
  });
  test("fitPanel clamps to the limits and leaves room for the chart", () => {
    assert.equal(fitPanel(9999, RIGHT_LIMITS), RIGHT_LIMITS.max);
    assert.equal(fitPanel(10, RIGHT_LIMITS), RIGHT_LIMITS.min);
    assert.equal(fitPanel(Number.NaN, BOTTOM_LIMITS), BOTTOM_LIMITS.def);
    assert.equal(fitPanel(500, RIGHT_LIMITS, 900, 400), 500);
    assert.equal(fitPanel(560, RIGHT_LIMITS, 900, 400), 500, "900 px terminal keeps 400 px for the chart");
    assert.equal(fitPanel(560, RIGHT_LIMITS, 500, 400), RIGHT_LIMITS.min, "never below the minimum");
    assert.equal(fitPanel(300, RIGHT_LIMITS, null), 300);
  });
  test("grid: right panel spans chart + bottom rows; collapsed panels keep a rail / header", () => {
    const open = gridTemplate({ hasLeft: true, rightOpen: true, rightSize: 340, bottomOpen: true, bottomSize: 220 });
    assert.equal(open.columns, `auto minmax(0,1fr) ${HANDLE}px 340px`);
    assert.equal(open.rows, `auto minmax(0,1fr) ${HANDLE}px 220px`);
    assert.equal(open.areas, '"top top top top" "left chart rh right" "bh bh rh right" "bottom bottom rh right"');
    const closed = gridTemplate({ hasLeft: false, rightOpen: false, rightSize: 340, bottomOpen: false, bottomSize: 220 });
    assert.equal(closed.columns, `minmax(0,1fr) 0px ${RAIL_WIDTH}px`);
    assert.equal(closed.rows, "auto minmax(0,1fr) 0px auto");
    assert.equal(closed.areas, '"top top top" "chart rh right" "bh rh right" "bottom rh right"');
    // every row of the areas string has as many cells as there are columns
    for (const g of [open, closed]) {
      const cols = g.columns.replace("minmax(0,1fr)", "fr").split(" ").length;
      for (const row of g.areas.match(/"[^"]+"/g) ?? []) assert.equal(row.replace(/"/g, "").split(" ").length, cols);
    }
  });
});

describe("hotkeys", () => {
  test("Alt+1 … Alt+8 → 1m … 1W", () => {
    const got: string[] = [];
    const b = timeframeBindings((tf) => got.push(tf));
    assert.deepEqual(Object.keys(b), ["alt+1", "alt+2", "alt+3", "alt+4", "alt+5", "alt+6", "alt+7", "alt+8"]);
    Object.values(b).forEach((fn) => fn());
    assert.deepEqual(got, ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
  });
  test("letters: H T R M tools, B / S side, ] and \\ panels", () => {
    const log: string[] = [];
    const b = letterBindings({
      onTool: (t) => log.push(`tool:${t}`),
      onSide: (s) => log.push(`side:${s}`),
      toggleRight: () => log.push("right"),
      toggleBottom: () => log.push("bottom"),
    });
    assert.deepEqual(Object.keys(b).sort(), ["\\", "]", "b", "h", "m", "r", "s", "t"]);
    for (const k of ["h", "t", "r", "m", "b", "s", "]", "\\"]) b[k]();
    assert.deepEqual(log, ["tool:hline", "tool:trend", "tool:rect", "tool:measure", "side:buy", "side:sell", "right", "bottom"]);
    assert.deepEqual(Object.keys(letterBindings({})), [], "only bound actions");
  });
  test("the second key of a shell 'g x' navigation is skipped", () => {
    let fired = 0;
    let skip = true;
    const b = letterBindings({ onSide: () => fired++ }, () => skip);
    b.b();
    assert.equal(fired, 0);
    skip = false;
    b.b();
    assert.equal(fired, 1);
    assert.ok(isNavSequence({ key: "g", t: 100 }, 500));
    assert.ok(isNavSequence({ key: "п", code: "KeyG", t: 100 }, 500), "Cyrillic layout: physical G");
    assert.ok(!isNavSequence({ key: "g", t: 100 }, 1000));
    assert.ok(!isNavSequence({ key: "h", t: 100 }, 200));
    assert.ok(!isNavSequence(null, 0));
  });
  test("nav tracker remembers the previous key (modifiers and repeats ignored)", () => {
    let now = 0;
    const nav = createNavTracker(() => now);
    nav.record({ key: "g", code: "KeyG" });
    now = 300;
    nav.record({ key: "Shift" });
    nav.record({ key: "t", code: "KeyT" });
    assert.ok(nav.skip(), "g → t within 800 ms");
    now = 400;
    nav.record({ key: "t", code: "KeyT", repeat: true });
    assert.ok(nav.skip(), "auto-repeat does not reset");
    nav.record({ key: "h", code: "KeyH" });
    assert.ok(!nav.skip());
  });
});

describe("session clock", () => {
  test("bar countdown on UTC-aligned bars; weekly bars start on Monday", () => {
    assert.equal(barCloseIn(3600 * 10 + 15, "1h"), 3600 - 15);
    assert.equal(barCloseIn(3600 * 10, "1h"), 3600);
    assert.equal(barCloseIn(14400 + 60, "4h"), 14400 - 60);
    const monday = Date.UTC(2026, 9, 5) / 1000; // Mon 2026-10-05 00:00 UTC
    assert.equal(barCloseIn(monday + 3600, "1w"), 7 * 86400 - 3600);
    assert.equal(barCloseIn(123, "2h"), null);
    assert.equal(barCloseIn(0, "1h"), null);
  });
  test("countdown / clock / file name formats", () => {
    assert.equal(fmtCountdown(65), "01:05");
    assert.equal(fmtCountdown(3725), "1:02:05");
    assert.equal(fmtCountdown(2 * 86400 + 3 * 3600 + 4 * 60), "2d 03:04");
    assert.equal(fmtCountdown(null), "—");
    assert.equal(fmtUtcClock(Date.UTC(2026, 9, 8, 14, 5, 9) / 1000), "14:05:09 UTC");
    assert.equal(fmtUtcClock(0), "--:--:-- UTC");
    assert.equal(screenshotName("BTC/USDT", "1h", Date.UTC(2026, 9, 8, 14, 5) / 1000), "BTC-USDT_1h_2026-10-08_1405.png");
  });
  test("?symbol= / ?tf= query", () => {
    assert.deepEqual(readTerminalQuery("?symbol=ETH%2FUSDT&tf=4h"), { symbol: "ETH/USDT", timeframe: "4h", order: null });
    assert.deepEqual(readTerminalQuery("?symbol=%20&tf=7h"), { symbol: null, timeframe: null, order: null });
    assert.deepEqual(readTerminalQuery(""), { symbol: null, timeframe: null, order: null });
  });
});

describe("order prefill link (Trade Simulator → /trade?…)", () => {
  test("the simulator's link fills side, entry, stop, target and leverage", () => {
    // exactly what components/labs/model.ts tradeHref() builds
    const q = readTerminalQuery("?symbol=EUR%2FUSD&side=sell&entry=1.1&stop=1.11&target=1.08&leverage=10");
    assert.equal(q.symbol, "EUR/USD");
    assert.deepEqual(q.order, { side: "sell", entry: 1.1, stop: 1.11, target: 1.08, leverage: 10 });
    assert.deepEqual(readTerminalQuery("?symbol=BTC%2FUSDT&side=buy").order, { side: "buy", entry: null, stop: null, target: null, leverage: null });
  });
  test("long / short aliases, case and spaces; unknown sides are ignored", () => {
    assert.equal(readTerminalQuery("?side=LONG&entry=1").order?.side, "buy");
    assert.equal(readTerminalQuery("?side=%20short%20&entry=1").order?.side, "sell");
    assert.equal(readTerminalQuery("?side=constructor&entry=1").order?.side, null, "no prototype keys");
    assert.equal(readTerminalQuery("?side=hold").order, null, "nothing usable → no prefill");
  });
  test("invalid numbers are dropped one by one; decimals with a comma are read", () => {
    const q = readTerminalQuery("?side=buy&entry=abc&stop=-5&target=0&leverage=0.5");
    assert.deepEqual(q.order, { side: "buy", entry: null, stop: null, target: null, leverage: null });
    assert.equal(readTerminalQuery("?entry=1,25").order?.entry, 1.25);
    assert.equal(readTerminalQuery("?entry=1e3").order?.entry, 1000);
    assert.equal(readTerminalQuery("?entry=").order, null);
  });
  test("leverage: '20x' accepted, below 1x ignored, above 100x capped (instrument max applies later)", () => {
    assert.equal(readTerminalQuery("?leverage=20x").order?.leverage, 20);
    assert.equal(readTerminalQuery("?leverage=1").order?.leverage, 1);
    assert.equal(readTerminalQuery("?leverage=500").order?.leverage, 100);
    assert.equal(readTerminalQuery("?leverage=0").order, null);
  });
  test("a link prefill is never an order request — only levels (no qty / type / submit flag)", () => {
    const q = readTerminalQuery("?symbol=BTC%2FUSDT&side=buy&entry=60000&qty=5&type=market&submit=1&autoplace=true");
    assert.deepEqual(Object.keys(q.order ?? {}).sort(), ["entry", "leverage", "side", "stop", "target"]);
  });
  test("prefillStatus: wait for the linked instrument, apply once settled, drop after a switch", () => {
    assert.equal(prefillStatus("EUR/USD", "EUR/USD", false), "wait");
    assert.equal(prefillStatus("EUR/USD", "EUR/USD", true), "apply");
    assert.equal(prefillStatus("EUR-USD", "EUR/USD", true), "apply", "slug / compact spellings match");
    assert.equal(prefillStatus("EUR/USD", "BTC/USDT", true), "drop");
    assert.equal(prefillStatus(null, "BTC/USDT", true), "apply", "no symbol in the link → the current instrument");
  });
});
