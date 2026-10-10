/*
 * Pure logic of the replay screens: setup body / validation / URL query, level checks + planned R:R (same
 * rules as the backend), ATR suggestions and draft arming, click-to-set, outcome labels, chart markers and
 * lines, toasts, the review normalisation and state merging — against real captured responses.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_DRAFT,
  STRATEGY_SENTENCE,
  armDraft,
  atr,
  buildCreateBody,
  checkLevels,
  clearDraft,
  decisionColor,
  decisionLines,
  decisionMarkers,
  defaultQty,
  defaultSetup,
  flagLabel,
  flagToasts,
  gradeOf,
  levelForClick,
  mergeCandles,
  mergeState,
  normalizeFinish,
  normalizeStored,
  outcomeView,
  paperTradeMarkers,
  plannedRR,
  positionLines,
  precisionOf,
  priceInput,
  progress,
  readReplayQuery,
  resolvedToast,
  roundTo,
  rrTone,
  scoreTone,
  sessionUrl,
  snapMarkers,
  strategyTradeMarkers,
  suggestLevels,
  validateSetup,
} from "@/components/replay/model";
import type { FinishResponse, PaperTradeRow, ReplayDecision, ReplayOptions, ReplayState, StrategyTrade } from "@/components/replay/types";
import { PALETTE } from "@/lib/theme";
import type { Candle } from "@/lib/types";

import * as fx from "./fixtures";

const NOW = 1_791_600_000; // 2026-10-10 UTC
const candles = (n: number, start = 100, step = 1, t0 = 1_700_000_000, tf = 3600): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return { time: t0 + i * tf, open: c - step / 2, high: c + 1, low: c - 1, close: c, volume: 10 };
  });
const decision = (over: Partial<ReplayDecision>): ReplayDecision => ({
  id: 1,
  bar_ts: 1_700_000_000,
  action: "long",
  entry_price: 100,
  stop: 98,
  target: 104,
  planned_rr: 2,
  outcome: { status: "open", bars_held: 0, r_result: 0 },
  score: null,
  flags: [],
  correct: null,
  ...over,
});

describe("setup", () => {
  test("defaults allow a one-click start (BTC/USDT 1h, 60 days ago, 200 bars, trade mode)", () => {
    const s = defaultSetup(NOW);
    assert.equal(s.symbol, "BTC/USDT");
    assert.equal(s.timeframe, "1h");
    assert.equal(s.period, "date");
    assert.equal(s.bars, 200);
    assert.equal(s.mode, "trade");
    assert.equal(s.strategyId, null);
    assert.deepEqual(validateSetup(s, NOW), []);
    const body = buildCreateBody(s);
    assert.equal(body.start_ts, Math.floor(Date.parse(`${s.start}T00:00:00Z`) / 1000));
    assert.ok(NOW - body.start_ts! >= 59 * 86_400 && NOW - body.start_ts! <= 61 * 86_400);
    assert.equal(body.preset, undefined);
    assert.equal(body.strategy_id, undefined);
  });

  test("a preset replaces start_ts; strategy and mode are sent", () => {
    const body = buildCreateBody({ ...defaultSetup(NOW), period: "trend", mode: "predict", strategyId: 8, bars: 120.4 });
    assert.deepEqual(body, { symbol: "BTC/USDT", timeframe: "1h", bars: 120, mode: "predict", preset: "trend", strategy_id: 8 });
  });

  test("validation: symbol, bars 20..1000, a past start date", () => {
    const base = defaultSetup(NOW);
    assert.deepEqual(
      validateSetup({ ...base, symbol: " " }, NOW).map((i) => i.field),
      ["symbol"],
    );
    assert.deepEqual(
      validateSetup({ ...base, bars: 10 }, NOW).map((i) => i.field),
      ["bars"],
    );
    assert.deepEqual(
      validateSetup({ ...base, bars: Number.NaN }, NOW).map((i) => i.field),
      ["bars"],
    );
    assert.deepEqual(
      validateSetup({ ...base, start: new Date(NOW * 1000).toISOString().slice(0, 10) }, NOW).map((i) => i.field),
      ["start"],
    );
    assert.deepEqual(
      validateSetup({ ...base, start: "" }, NOW).map((i) => i.field),
      ["start"],
    );
    // presets ignore the date field
    assert.deepEqual(validateSetup({ ...base, start: "", period: "random" }, NOW), []);
  });

  test("URL query: prefill and ?session=", () => {
    assert.deepEqual(readReplayQuery("?symbol=ETH%2FUSDT&tf=4h&preset=breakout&mode=predict"), {
      symbol: "ETH/USDT",
      timeframe: "4h",
      session: null,
      preset: "breakout",
      mode: "predict",
    });
    const q = readReplayQuery("?session=12&preset=nope&mode=live");
    assert.equal(q.session, 12);
    assert.equal(q.preset, null);
    assert.equal(q.mode, null);
    assert.equal(readReplayQuery("?session=-3").session, null);
    assert.equal(sessionUrl(7), "/replay?session=7");
    assert.equal(sessionUrl(null), "/replay");
  });
});

describe("levels", () => {
  test("LONG: stop below, target above; SHORT mirrored; stop required; WAIT always ok", () => {
    assert.equal(checkLevels("long", 100, 98, 104).ok, true);
    assert.match(checkLevels("long", 100, 101, 104).stopError ?? "", /ПОД/);
    assert.match(checkLevels("long", 100, 98, 99).targetError ?? "", /НАД/);
    assert.match(checkLevels("long", 100, null, null).stopError ?? "", /Постави stop/);
    assert.equal(checkLevels("long", 100, 98, null).ok, true, "target is optional");
    assert.equal(checkLevels("short", 100, 102, 96).ok, true);
    assert.match(checkLevels("short", 100, 99, 96).stopError ?? "", /НАД/);
    assert.match(checkLevels("short", 100, 102, 101).targetError ?? "", /ПОД/);
    assert.equal(checkLevels("long", 100, 100, 104).ok, false, "stop at the entry is invalid");
    assert.equal(checkLevels("wait", 100, null, null).ok, true);
  });

  test("the backend's own rejection is reproduced (LONG stop above the close)", () => {
    const d = fx.decision;
    assert.equal(checkLevels("long", d.entry_price, d.entry_price * 1.01, null, 2).ok, false);
    assert.equal(checkLevels("long", d.entry_price, d.stop, d.target, 2).ok, true);
  });

  test("planned R:R equals the backend's planned_rr", () => {
    const d = fx.decision;
    assert.ok(Math.abs(plannedRR("long", d.entry_price, d.stop, d.target)! - d.planned_rr) < 0.005);
    assert.equal(plannedRR("short", 100, 102, 96), 2);
    assert.equal(plannedRR("long", 100, 98, null), null);
    assert.equal(plannedRR("long", 100, 101, 104), null);
    assert.equal(plannedRR("wait", 100, 98, 104), null);
    assert.equal(rrTone(2), "up");
    assert.equal(rrTone(1.2), "warn");
    assert.equal(rrTone(0.8), "down");
    assert.equal(rrTone(null), "neutral");
  });

  test("ATR (Wilder) and the 1.5 ATR / 2R suggestion", () => {
    const cs = candles(30, 100, 0); // flat closes, high-low = 2 → ATR 2
    assert.equal(atr(cs), 2);
    assert.equal(atr(cs.slice(0, 10)), null);
    assert.deepEqual(suggestLevels("long", cs, 2), { stop: 97, target: 106 });
    assert.deepEqual(suggestLevels("short", cs, 2), { stop: 103, target: 94 });
    assert.equal(suggestLevels("long", [], 2), null);
  });

  test("arming keeps valid levels, replaces wrong-side ones, and switching side re-suggests", () => {
    const cs = candles(30, 100, 0);
    const long = armDraft(EMPTY_DRAFT, "long", cs, 2);
    assert.equal(long.action, "long");
    assert.equal(long.stop, "97.00");
    assert.equal(long.target, "106.00");
    const edited = { ...long, stop: "98.5" };
    assert.equal(armDraft(edited, "long", cs, 2), edited, "re-arming the same side keeps the draft");
    const short = armDraft(edited, "short", cs, 2);
    assert.equal(short.stop, "103.00");
    assert.equal(short.target, "94.00");
    const kept = armDraft({ ...EMPTY_DRAFT, stop: "101", target: "90" }, "short", cs, 2);
    assert.equal(kept.stop, "101");
    assert.equal(kept.target, "90");
    const cleared = clearDraft({ ...short, placeOrder: true, riskPct: "0.5", note: "x" });
    assert.deepEqual(cleared, { ...EMPTY_DRAFT, placeOrder: true, riskPct: "0.5" });
  });

  test("click-to-set: below the entry = stop for LONG, target for SHORT", () => {
    assert.equal(levelForClick("long", 100, 95), "stop");
    assert.equal(levelForClick("long", 100, 105), "target");
    assert.equal(levelForClick("short", 100, 95), "target");
    assert.equal(levelForClick("short", 100, 105), "stop");
    assert.equal(levelForClick("short", 100, 100), null);
    assert.equal(levelForClick("wait", 100, 90), null);
  });

  test("number helpers", () => {
    assert.equal(roundTo(1.23456, 2), 1.23);
    assert.equal(priceInput(86554.413, 2), "86554.41");
    assert.equal(priceInput(null, 2), "");
    assert.equal(gradeOf(85), "A");
    assert.equal(gradeOf(70), "B");
    assert.equal(gradeOf(55), "C");
    assert.equal(gradeOf(54.9), "D");
    assert.equal(gradeOf(null), null);
    assert.equal(scoreTone(90), "up");
    assert.equal(scoreTone(60), "warn");
    assert.equal(scoreTone(10), "down");
    assert.equal(defaultQty(91_727.78, 10_000), "0.011");
    assert.equal(defaultQty(1.08, 10_000), "930");
    assert.equal(defaultQty(null, 10_000), "1");
    assert.equal(precisionOf({ session: { precision: 5 } }), 5);
    assert.equal(precisionOf({ precision: 3, session: {} }), 3);
    assert.equal(precisionOf(null, 1.2), 4);
  });
});

describe("outcomes and markers", () => {
  const hr = fx.finishPredict.history_review;
  const preds = hr.predictions as unknown as ReplayDecision[];

  test("outcome labels from real predictions", () => {
    const target = preds.find((p) => p.outcome.status === "target")!;
    assert.deepEqual(outcomeView(target), { label: "Target +2.00R", tone: "up", final: true, r: 2 });
    const stop = preds.find((p) => p.outcome.status === "stop")!;
    assert.equal(outcomeView(stop).tone, "down");
    assert.match(outcomeView(stop).label, /^Stop -1\.00R/);
    const wait = preds.find((p) => p.action === "wait")!;
    assert.equal(outcomeView(wait).tone, "warn");
    assert.match(outcomeView(wait).label, /Пропуснато движение ↑/);
    assert.equal(outcomeView(decision({ action: "wait", outcome: { status: "resolved", right_to_wait: true } })).tone, "up");
    assert.equal(outcomeView(decision({})).final, false);
    assert.equal(outcomeView(decision({ outcome: { status: "expired", bars_held: 50, r_result: 0.4 } })).tone, "up");
  });

  test("decision markers: entry arrow + exit dot coloured by the outcome", () => {
    const ms = decisionMarkers(preds);
    const target = preds.find((p) => p.outcome.status === "target")!;
    const entry = ms.find((m) => m.time === target.bar_ts)!;
    assert.equal(entry.shape, "arrowUp");
    assert.equal(entry.position, "belowBar");
    assert.equal(entry.color, PALETTE.up);
    assert.equal(entry.text, "L 2.0R");
    const exit = ms.find((m) => m.time === (target.outcome as { exit_ts: number }).exit_ts)!;
    assert.equal(exit.shape, "circle");
    assert.equal(exit.text, "+2.00R");
    const short = preds.find((p) => p.action === "short")!;
    assert.equal(ms.find((m) => m.time === short.bar_ts)!.shape, "arrowDown");
    const w = ms.find((m) => m.text === "W")!;
    assert.equal(w.color, PALETTE.warn);
    // open decision → accent, selected → "▶"
    assert.equal(decisionColor(decision({})), PALETTE.accent2);
    assert.equal(decisionMarkers([decision({})], { selectedId: 1 })[0].text, "▶ L 2.0R");
  });

  test("lines: the draft + open predictions only (or the selected one)", () => {
    const open = decision({ id: 5 });
    const closed = decision({ id: 6, outcome: { status: "stop", bars_held: 3, r_result: -1 } });
    const lines = decisionLines([open, closed], { action: "short", stop: 105.123, target: 90 }, 2);
    assert.deepEqual(
      lines.map((l) => l.id),
      ["draft-stop", "draft-target", "d5-stop", "d5-target"],
    );
    assert.equal(lines[0].price, 105.12);
    assert.match(lines[0].title ?? "", /SL SHORT/);
    assert.deepEqual(
      decisionLines([open, closed], null, 2, { selectedId: 6 }).map((l) => l.id),
      ["d6-stop", "d6-target"],
    );
    assert.deepEqual(decisionLines([open], { action: "wait", stop: 1, target: 2 }, 2).length, 2, "a WAIT draft has no lines");
  });

  test("strategy trades (violet) and paper trades (gold), snapped to bar opens", () => {
    const trades: StrategyTrade[] = [
      { side: "short", entry_ts: 1_700_003_600, exit_ts: 1_700_010_800, entry_price: 1, exit_price: 1, qty: 1, net_pnl: 1, fees: 0, r_multiple: 1.5, exit_reason: "take_profit" },
    ];
    const sm = strategyTradeMarkers(trades);
    assert.equal(sm.length, 2);
    assert.equal(sm[0].color, PALETTE.violet);
    assert.equal(sm[0].shape, "arrowDown");
    assert.equal(sm[1].text, "TP +1.50R");
    const pm = paperTradeMarkers(fx.finishTradePaper as unknown as PaperTradeRow[]);
    assert.equal(pm.length, 4);
    assert.ok(pm.every((m) => m.color === PALETTE.gold));
    assert.equal(pm[0].text, "BUY");
    assert.equal(pm[1].text, "SL");
    // a 30-minute exit (1h bars) snaps to its bar's open; outside the data → dropped
    const cs = candles(5);
    const snapped = snapMarkers([{ time: cs[2].time + 1800, position: "inBar", shape: "circle", color: "#fff" }, { time: cs[0].time - 3600, position: "inBar", shape: "circle", color: "#fff" }], cs);
    assert.deepEqual(
      snapped.map((m) => m.time),
      [cs[2].time],
    );
  });

  test("mergeCandles dedupes by time and sorts", () => {
    const a = candles(3);
    const b = candles(3, 200, 1, a[1].time);
    const m = mergeCandles(a, b);
    assert.equal(m.length, 4);
    assert.equal(m[1].close, 200, "later arrays win");
    assert.ok(m.every((c, i) => i === 0 || c.time > m[i - 1].time));
  });

  test("trade-mode position / pending order lines", () => {
    const st = fx.tradeState as unknown as ReplayState;
    const lines = positionLines(st.account.positions, [{ id: "o1", side: "buy", type: "limit", price: 90_000, status: "pending" }]);
    assert.ok(lines.some((l) => l.title === "LONG"));
    assert.ok(lines.some((l) => l.id === "oo1" && l.title === "LIMIT BUY"));
  });
});

describe("HUD, toasts, review data", () => {
  test("progress counts candles", () => {
    assert.deepEqual(progress({ bars: 120, revealed: 30, remaining: 90 }), { revealed: 30, total: 120, pct: 25 });
    assert.deepEqual(progress({ remaining: 10 }), { revealed: 0, total: 10, pct: 0 });
    const s = fx.statePredict.session;
    assert.equal(progress(s).total, s.bars);
  });

  test("warning flags become toasts ('Chasing?', 'Against structure'); info flags do not", () => {
    const flags = [
      { key: "chased", label: "Chasing?", severity: "warning", text: "…" },
      { key: "ignored_structure", label: "Against structure", severity: "warning", text: "…" },
      { key: "stop_inside_structure", label: "Stop inside structure", severity: "info", text: "…" },
    ];
    const t = flagToasts(flags, "d1");
    assert.deepEqual(
      t.map((x) => x.title),
      ["Chasing?", "Against structure"],
    );
    assert.equal(t[0].id, "d1-chased");
    const opts = (fx.options as unknown as ReplayOptions).flags!;
    assert.equal(flagLabel("chased", opts), "Chasing?");
    assert.equal(flagLabel("ignored_structure", null), "Against structure");
    assert.equal(flagLabel("brand_new_flag", null), "brand new flag");
  });

  test("resolved predictions → toasts", () => {
    assert.match(resolvedToast({ id: 1, bar_ts: 1, action: "long", status: "target", r_result: 2, right_to_wait: null, score: 91, correct: true }).title, /LONG → target \+2\.00R/);
    assert.equal(resolvedToast({ id: 2, bar_ts: 1, action: "short", status: "stop", r_result: -1, right_to_wait: null, score: 40, correct: false }).tone, "down");
    assert.equal(resolvedToast({ id: 3, bar_ts: 1, action: "wait", status: "resolved", r_result: null, right_to_wait: true, score: 80, correct: true }).tone, "up");
    assert.equal(resolvedToast({ id: 4, bar_ts: 1, action: "wait", status: "resolved", r_result: null, right_to_wait: false, score: 30, correct: false }).tone, "warn");
    assert.equal(resolvedToast({ id: 5, bar_ts: 1, action: "long", status: "expired", r_result: 0.2, right_to_wait: null, score: 50, correct: null }).tone, "neutral");
  });

  test("normalizeFinish keeps the legacy keys + history_review; normalizeStored uses the review summary", () => {
    const f = fx.finishPredict as unknown as FinishResponse;
    const n = normalizeFinish(f);
    assert.equal(n.session.id, f.session.id);
    assert.equal(n.next.length, 30);
    assert.equal(n.review?.strategy_comparison.sentence, STRATEGY_SENTENCE);
    assert.deepEqual(n.summary, f.summary);
    assert.equal(n.precision, 2);
    const stored = normalizeStored({
      session: f.session,
      precision: 2,
      source: f.source,
      candles: f.candles,
      what_happened_next: f.what_happened_next,
      decisions: f.decisions ?? [],
      paper_trades: [],
      history_review: f.history_review!,
    });
    assert.deepEqual(stored.summary, f.history_review!.summary);
    assert.equal(stored.reviews.length, 0);
    assert.equal(stored.metrics, null);
  });

  test("mergeState keeps the EMA overlay when an order / action response has no indicators", () => {
    const prev = { ...(fx.statePredict as unknown as ReplayState), indicators: { ema_20: { name: "ema", series: { value: [{ time: 1, value: 2 }] } } } };
    const next = fx.statePredict as unknown as ReplayState;
    assert.equal(mergeState(prev, next).indicators, prev.indicators);
    const other = { ...next, session: { ...next.session, id: 999 } };
    assert.equal(mergeState(prev, other).indicators, undefined, "another session never inherits");
    const fresh = { ...next, indicators: { ema_20: { name: "ema", series: { value: [] } } } };
    assert.equal(mergeState(prev, fresh).indicators, fresh.indicators);
  });
});
