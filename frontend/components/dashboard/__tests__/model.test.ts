/*
 * Pure-logic tests of the S7 pages: dashboard model, analytics model, journal model, system helpers,
 * risk rules validation.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  bucketShort,
  bucketTone,
  checkMeta,
  ciIncludes,
  ciText,
  currentStreakText,
  dailyLossUse,
  exitLabel,
  exposureUse,
  fmtHold,
  fmtPF,
  heatStyle,
  limitShare,
  limitTone,
  marginLevelPct,
  monthlyScale,
  orderChecks,
  pfTone,
  riskTone,
  sampleMeta,
  sortBreakdown,
} from "@/components/analytics/model";
import type { BreakdownRow, RiskStatus } from "@/components/analytics/types";
import { breadth, classState, extraActions, greeting, isNewUser, lessonsPercent, moverItems, orderInsights, primaryCtas, xpPercent } from "@/components/dashboard/model";
import { chainText, coveragePct, orderProviders, reachText, splitEnv, statusTone, yesNo, type ProviderInfo } from "@/components/dashboard/settings/system";
import type { DashboardData, Insight } from "@/components/dashboard/types";
import { EMPTY_FILTERS, activeFilterCount, distinct, filterEntries, gradeTone, journalBody, parseNum, plannedRR, resultKind, stopValid, strategyOf, type JournalEntry } from "@/components/journal/model";

import fixtures from "./fixtures.json" with { type: "json" };

const dash = fixtures.dashboard as unknown as DashboardData;

describe("dashboard model", () => {
  test("greeting by hour", () => {
    assert.equal(greeting(6), "Добро утро");
    assert.equal(greeting(13), "Добър ден");
    assert.equal(greeting(20), "Добър вечер");
    assert.equal(greeting(2), "Добър вечер");
  });

  test("LEARN → continue learning, TRADE → paper terminal", () => {
    const learn = primaryCtas("learn", dash);
    assert.equal(learn.primary.href, dash.learning.next?.href);
    assert.equal(learn.secondary.href, "/trade");
    const trade = primaryCtas("trade", dash);
    assert.equal(trade.primary.href, "/trade");
    assert.equal(trade.primary.label, "Отвори Paper Trading");
    const fresh = primaryCtas("trade", { ...dash, recent_trades: [], open_positions: [] });
    assert.equal(fresh.primary.label, "Първа paper сделка");
    const noNext = primaryCtas("learn", { ...dash, learning: { ...dash.learning, next: null } });
    assert.equal(noNext.primary.href, "/learn");
  });

  test("new user detection", () => {
    assert.equal(isNewUser(dash), false);
    assert.equal(isNewUser({ ...dash, recent_trades: [], open_positions: [], learning: { ...dash.learning, lessons_completed: 0 } }), true);
  });

  test("next actions skip the header CTAs and cap at 4", () => {
    const acts = [1, 2, 3, 4, 5].map((i) => ({ key: `k${i}`, label: `L${i}`, href: `/h${i}`, reason: "" }));
    assert.deepEqual(
      extraActions(acts, ["/h1"]).map((a) => a.href),
      ["/h2", "/h3", "/h4", "/h5"],
    );
    assert.equal(extraActions(acts, []).length, 4);
    assert.deepEqual(extraActions(undefined, []), []);
  });

  test("movers, breadth and class state", () => {
    assert.ok(moverItems(dash.market, "gainers").length > 0);
    assert.deepEqual(moverItems(null, "losers"), []);
    assert.equal(breadth({ advancers: 3, decliners: 1 }), 75);
    assert.equal(breadth({ advancers: 0, decliners: 0 }), null);
    assert.equal(classState({ available: true, code: null, ranked: 10 }), "ok");
    assert.equal(classState({ available: true, code: null, ranked: 0 }), "warming");
    assert.equal(classState({ available: false, code: "DATA_NOT_AVAILABLE", ranked: 0 }), "unavailable");
    assert.equal(classState({ available: true, code: "PLAN_LIMIT", ranked: 0 }), "plan");
  });

  test("insights: warnings first, then market, then next step", () => {
    const items: Insight[] = [
      { kind: "next_step", title: "n", text: "" },
      { kind: "market", title: "m", text: "" },
      { kind: "behavior", title: "b-info", text: "", severity: "info" },
      { kind: "behavior", title: "b-warn", text: "", severity: "warn" },
    ];
    assert.deepEqual(
      orderInsights(items).map((i) => i.title),
      ["b-warn", "b-info", "m", "n"],
    );
  });

  test("learning percentages are clamped", () => {
    assert.equal(xpPercent({ xp_progress: { level_start: 0, next_level_at: 250, into_level: 10, needed: 240, percent: 140 } }), 100);
    assert.equal(xpPercent({ xp_progress: null }), 0);
    assert.equal(lessonsPercent({ lessons_completed: 5, lessons_total: 20 }), 25);
    assert.equal(lessonsPercent({ lessons_completed: 0, lessons_total: 0 }), 0);
  });
});

describe("analytics model", () => {
  test("profit factor: no losers → ∞", () => {
    assert.equal(fmtPF(1000000000.0), "∞");
    assert.equal(fmtPF(1.3456), "1.35");
    assert.equal(fmtPF(null), "—");
    assert.equal(pfTone(0.8), "down");
    assert.equal(pfTone(1.1), "warn");
    assert.equal(pfTone(2), "up");
  });

  test("holding time and exit labels", () => {
    assert.equal(fmtHold(30), "30с");
    assert.equal(fmtHold(45 * 60), "45м");
    assert.equal(fmtHold(3 * 3600 + 20 * 60), "3ч 20м");
    assert.equal(fmtHold(50 * 3600), "2д 2ч");
    assert.equal(fmtHold(null), "—");
    assert.equal(exitLabel("take_profit"), "Take profit");
    assert.equal(exitLabel("weird_reason"), "weird reason");
  });

  test("risk usage of limits", () => {
    const st = fixtures.risk as unknown as RiskStatus;
    assert.equal(riskTone(st.status), "up");
    assert.equal(riskTone("LIMIT"), "down");
    assert.equal(dailyLossUse({ day_loss_pct: 1.5, rules: { ...st.rules, max_daily_loss_pct: 3 } }), 50);
    assert.equal(exposureUse({ exposure_pct: 150, max_exposure_pct: 300, rules: st.rules }), 50);
    assert.equal(limitShare(1, 0), null);
    assert.equal(limitTone(50), "up");
    assert.equal(limitTone(80), "warn");
    assert.equal(limitTone(100), "down");
    assert.equal(marginLevelPct(1.5), 150);
    assert.equal(marginLevelPct(null), null);
    assert.equal(marginLevelPct(1.5, 160), 160);
  });

  test("confidence notes", () => {
    const exp = fixtures.performance.confidence.expectancy_r as { value: number; ci95: [number, number]; n: number; note: string };
    assert.match(ciText(exp, (v) => v.toFixed(2)) ?? "", /^95% CI: -?\d/);
    assert.equal(ciText({ value: 1, n: 1, note: null, ci95: null }, String), null);
    assert.equal(ciIncludes({ value: 1, n: 3, note: null, ci95: [-0.5, 2] }), true);
    assert.equal(ciIncludes({ value: 1, n: 30, note: null, ci95: [0.2, 2] }), false);
    assert.equal(sampleMeta("very_small").tone, "warn");
    assert.equal(sampleMeta("large").tone, "up");
  });

  test("breakdown sorting is stable and keeps nulls last", () => {
    const row = (key: string, trades: number, average_r: number | null): BreakdownRow => ({
      key,
      label: key,
      trades,
      wins: 0,
      losses: 0,
      win_rate: null,
      net_pnl: 0,
      average_pnl: null,
      with_r: 0,
      average_r,
      profit_factor: null,
      enough_data: trades >= 5,
    });
    const rows = [row("a", 1, null), row("b", 5, 0.5), row("c", 5, 1.2)];
    assert.deepEqual(
      sortBreakdown(rows, "average_r").map((r) => r.key),
      ["c", "b", "a"],
    );
    assert.deepEqual(
      sortBreakdown(rows, "trades").map((r) => r.key),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      sortBreakdown(rows, "default").map((r) => r.key),
      ["a", "b", "c"],
    );
  });

  test("monthly heat colour uses tokens and scales with |value|", () => {
    const scale = monthlyScale(fixtures.performance.monthly_returns as never);
    assert.ok(scale > 0);
    assert.deepEqual(heatStyle(null, scale), {});
    assert.deepEqual(heatStyle(0, scale), {});
    assert.match(heatStyle(scale, scale).backgroundColor ?? "", /var\(--color-up\) 55%/);
    assert.match(heatStyle(-scale / 2, scale).backgroundColor ?? "", /var\(--color-down\)/);
  });

  test("R buckets: tone and compact labels", () => {
    assert.equal(bucketTone({ from: null, to: -2 }), "down");
    assert.equal(bucketTone({ from: 1, to: 2 }), "up");
    assert.equal(bucketTone({ from: -0.5, to: 0.5 }), "neutral");
    assert.equal(bucketShort({ from: null, to: -2 }), "<-2");
    assert.equal(bucketShort({ from: 3, to: null }), "≥3");
    assert.equal(bucketShort({ from: -1, to: -0.5 }), "-1…-0.5");
  });

  test("streak text and coach checks", () => {
    assert.equal(currentStreakText({ max_wins: 1, max_losses: 2, current: { kind: "loss", length: 2 } }), "2 губещи подред");
    assert.equal(currentStreakText({ max_wins: 1, max_losses: 0, current: { kind: "win", length: 1 } }), "1 печеливша подред");
    assert.equal(currentStreakText(null), "—");
    assert.equal(checkMeta("found").label, "Засечено");
    const ordered = orderChecks([
      { key: "a", title: "", status: "insufficient_data", detail: "" },
      { key: "b", title: "", status: "ok", detail: "" },
      { key: "c", title: "", status: "found", detail: "" },
    ]);
    assert.deepEqual(
      ordered.map((c) => c.key),
      ["c", "b", "a"],
    );
  });
});

describe("journal model", () => {
  const entries = fixtures.journal.entries as unknown as JournalEntry[];

  test("filters by result, symbol, strategy, review and text", () => {
    assert.equal(filterEntries(entries, EMPTY_FILTERS).length, entries.length);
    assert.ok(filterEntries(entries, { ...EMPTY_FILTERS, result: "win" }).every((e) => (e.result ?? 0) > 0));
    assert.ok(filterEntries(entries, { ...EMPTY_FILTERS, result: "open" }).every((e) => resultKind(e) === "open"));
    assert.deepEqual(
      filterEntries(entries, { ...EMPTY_FILTERS, symbol: "EUR/USD" }).map((e) => e.symbol),
      ["EUR/USD"],
    );
    assert.equal(filterEntries(entries, { ...EMPTY_FILTERS, q: "ema20" }).length, 1);
    assert.equal(filterEntries(entries, { ...EMPTY_FILTERS, strategy: "EMA pullback" }).length, 1);
    assert.equal(activeFilterCount({ ...EMPTY_FILTERS, q: " x ", reviewed: true }), 2);
    assert.deepEqual(distinct(["b", "a", "", null, "a"]), ["a", "b"]);
    assert.equal(strategyOf({ setup: "breakout" }), "breakout");
  });

  test("planned R:R and stop side", () => {
    assert.equal(plannedRR({ side: "long", entry: 100, stop: 98, target: 106 }), 3);
    assert.equal(plannedRR({ side: "short", entry: 100, stop: 102, target: 95 }), 2.5);
    assert.equal(plannedRR({ side: "long", entry: 100, stop: 102, target: 106 }), null);
    assert.equal(plannedRR({ side: "long", entry: 100, stop: null, target: 106 }), null);
    assert.equal(stopValid({ side: "short", entry: 100, stop: 90 }), false);
    assert.equal(stopValid({ side: "long", entry: 100, stop: 90 }), true);
    assert.equal(stopValid({ side: null, entry: 100, stop: 90 }), null);
  });

  test("request body: linked trade owns the result, tags parsed, no read-only fields", () => {
    const body = journalBody({ trade_id: "t1", result: 55, reason: "r", strategy: "  ", notes: " n ", id: 4, ai_review: null }, "a, b,, ");
    assert.equal(body.result, null);
    assert.deepEqual(body.tags, ["a", "b"]);
    assert.equal(body.strategy, null);
    assert.equal(body.notes, "n");
    assert.ok(!("id" in body) && !("ai_review" in body) && !("r_multiple" in body));
    assert.equal(journalBody({ result: -5 }, "").result, -5);
    assert.equal(parseNum(" 1,5 "), 1.5);
    assert.equal(parseNum(""), null);
    assert.ok(Number.isNaN(parseNum("abc") as number));
  });

  test("grade tone", () => {
    assert.equal(gradeTone("A"), "up");
    assert.equal(gradeTone("c"), "warn");
    assert.equal(gradeTone("F"), "down");
    assert.equal(gradeTone(null), "neutral");
  });
});

describe("system helpers", () => {
  test("status, yes/no, reachability", () => {
    assert.equal(statusTone("live"), "up");
    assert.equal(statusTone("demo"), "warn");
    assert.equal(statusTone("unavailable"), "neutral");
    assert.equal(yesNo(true), "да");
    assert.equal(yesNo(false), "не");
    assert.equal(yesNo(null), "—");
    assert.equal(reachText({ reachable: null }).text, "непроверен");
    assert.equal(reachText({ reachable: true, latency_ms: 120.4, stale: false }).text, "достъпен · 120 ms");
    assert.equal(reachText({ reachable: false, http_status: 503, error: null }).tone, "down");
    assert.match(reachText({ reachable: false, http_status: 503, error: null }).text, /HTTP 503/);
  });

  test("class chain and coverage from the real payload", () => {
    const crypto = fixtures.sources.classes[0];
    assert.equal(chainText(crypto), "MARKET_DATA_CRYPTO=demo");
    assert.equal(coveragePct(crypto), 100);
    assert.equal(coveragePct({ instruments: { total: 0, available: 0, by_source: {}, serving: {}, supported_by: {} } }), 0);
  });

  test("providers in use come first", () => {
    const order = orderProviders(fixtures.sources.providers as unknown as Record<string, ProviderInfo>).map((p) => p.id);
    assert.equal(order[0], "demo");
    assert.equal(order.length, 3);
  });

  test("env var names become code parts", () => {
    const parts = splitEnv("Задай MARKET_DATA_CRYPTO=binance и TWELVEDATA_API_KEY в backend/.env");
    assert.deepEqual(
      parts.filter((p) => p.code).map((p) => p.t),
      ["MARKET_DATA_CRYPTO=binance", "TWELVEDATA_API_KEY"],
    );
    assert.equal(parts.map((p) => p.t).join(""), "Задай MARKET_DATA_CRYPTO=binance и TWELVEDATA_API_KEY в backend/.env");
  });
});
