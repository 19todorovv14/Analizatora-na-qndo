/* Unit tests for the AI-teacher UI logic (components/ai/model.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_MODES,
  MODE_ORDER,
  QUESTION_MODES,
  SETUP_DISCLAIMER,
  STANDARD_SECTIONS,
  buildAskBody,
  conditionCounts,
  contextCoverage,
  contextRows,
  defaultCompareTimeframe,
  draftKey,
  draftRR,
  examplesSplit,
  fmtValue,
  followUpRequest,
  isDataNotAvailableError,
  isTeacherMode,
  lessonIndicators,
  linkLabel,
  logicLabel,
  mergeModes,
  modeUsesChart,
  normalizeDraft,
  normalizeTimeframe,
  overlayFromAnalysis,
  overlayFromAnswer,
  overlayFromView,
  overlayLines,
  parseDraftInputs,
  parseLine,
  parseTeacherQuery,
  providerInfo,
  quizInit,
  quizReducer,
  quizScore,
  regimeFilterText,
  resultTone,
  sectionAccent,
  splitNumbers,
  splitPipeline,
  swingMarkers,
  teacherHref,
  tfLabel,
  uniquePositions,
  unavailableReason,
  validQuestions,
  type AskParams,
} from "../model";
import type { ModeInfo, QuizQuestion, StrategyViewData, Swing } from "../types";
import type { Analysis } from "@/lib/types";
import { analyzeAnswer, compareAnswer, quizAnswer, strategyView, whyAnswer } from "./fixtures";

const base: AskParams = { symbol: "BTC/USDT", timeframe: "1h" };

describe("modes", () => {
  test("built-in list has the 8 modes in the canonical order", () => {
    assert.deepEqual(
      DEFAULT_MODES.map((m) => m.key),
      MODE_ORDER,
    );
    assert.deepEqual(MODE_ORDER, ["explain", "analyze", "teach", "review_trade", "review_strategy", "quiz", "why", "compare"]);
    for (const m of DEFAULT_MODES) {
      assert.ok(m.label && m.description && m.icon, m.key);
    }
  });

  test("mergeModes keeps all 8, applies server copy, ignores unknown keys", () => {
    const remote = [
      { key: "why", label: "WHY?", description: "server why", icon: "HelpCircle", context: ["chart"] },
      { key: "nonsense", label: "X", description: "y" },
    ] as unknown as ModeInfo[];
    const merged = mergeModes(remote);
    assert.equal(merged.length, 8);
    assert.equal(merged.find((m) => m.key === "why")?.description, "server why");
    assert.deepEqual(merged.find((m) => m.key === "why")?.context, ["chart"]);
    assert.ok(!merged.some((m) => (m.key as string) === "nonsense"));
    assert.deepEqual(mergeModes(null), DEFAULT_MODES);
    assert.deepEqual(mergeModes([]), DEFAULT_MODES);
  });

  test("isTeacherMode / modeUsesChart", () => {
    assert.equal(isTeacherMode("quiz"), true);
    assert.equal(isTeacherMode("buy"), false);
    assert.equal(isTeacherMode(undefined), false);
    assert.equal(modeUsesChart("analyze"), true);
    assert.equal(modeUsesChart("review_trade"), false);
    assert.equal(modeUsesChart("review_strategy"), false);
  });

  test("timeframe helpers mirror the backend defaults", () => {
    assert.equal(defaultCompareTimeframe("1h"), "4h");
    assert.equal(defaultCompareTimeframe("4h"), "1d");
    assert.equal(defaultCompareTimeframe("1w"), "1d");
    assert.equal(defaultCompareTimeframe("1m"), "15m");
    assert.equal(normalizeTimeframe("4H"), "4h");
    assert.equal(normalizeTimeframe("2h"), undefined);
    assert.equal(tfLabel("1h"), "1H");
    assert.equal(tfLabel("15m"), "15m");
    assert.equal(tfLabel(null), "");
  });
});

describe("buildAskBody", () => {
  test("chart modes send symbol, timeframe, indicators, strategy and a trimmed question", () => {
    const body = buildAskBody("analyze", { ...base, indicators: ["ema20", "rsi"], strategyId: 8, question: "  Къде е invalidation?  " });
    assert.deepEqual(body, {
      mode: "analyze",
      symbol: "BTC/USDT",
      timeframe: "1h",
      indicators: ["ema20", "rsi"],
      strategy_id: 8,
      question: "Къде е invalidation?",
    });
  });

  test("question only for modes that accept it, capped at 2000 chars", () => {
    for (const m of MODE_ORDER) {
      const b = buildAskBody(m, { ...base, question: "Защо?" });
      assert.equal("question" in b, QUESTION_MODES.includes(m), m);
    }
    assert.equal(buildAskBody("why", { ...base, question: "x".repeat(3000) }).question?.length, 2000);
    assert.equal("question" in buildAskBody("why", { ...base, question: "   " }), false);
  });

  test("review modes do not send the chart", () => {
    assert.deepEqual(buildAskBody("review_trade", { ...base, positionId: "abc123", strategyId: 3 }), { mode: "review_trade", position_id: "abc123" });
    assert.deepEqual(buildAskBody("review_trade", base), { mode: "review_trade" });
    assert.deepEqual(buildAskBody("review_strategy", { ...base, strategyId: 8, backtestId: 2 }), { mode: "review_strategy", strategy_id: 8, backtest_id: 2 });
  });

  test("teach sends the topic; other modes do not", () => {
    assert.equal(buildAskBody("teach", { ...base, topic: "rsi" }).topic, "rsi");
    assert.equal(buildAskBody("analyze", { ...base, topic: "rsi" }).topic, undefined);
  });

  test("explain sends a normalized draft only when it is valid", () => {
    const b = buildAskBody("explain", { ...base, draft: { side: "buy", entry: 100, stop: 95, target: 0 } });
    assert.deepEqual(b.draft, { side: "long", entry: 100, stop: 95 });
    assert.equal(buildAskBody("explain", { ...base, draft: { side: "long", entry: null } }).draft, undefined);
    assert.equal(buildAskBody("why", { ...base, draft: { side: "long", entry: 100 } }).draft, undefined);
  });

  test("compare: one of compare_timeframe / compare_symbol, never the same chart", () => {
    assert.equal(buildAskBody("compare", base).compare_timeframe, "4h");
    assert.equal(buildAskBody("compare", { ...base, compareTimeframe: "1d" }).compare_timeframe, "1d");
    assert.equal(buildAskBody("compare", { ...base, compareTimeframe: "1h" }).compare_timeframe, "4h");
    const sym = buildAskBody("compare", { ...base, compareKind: "symbol", compareSymbol: "ETH/USDT", compareTimeframe: "1d" });
    assert.equal(sym.compare_symbol, "ETH/USDT");
    assert.equal(sym.compare_timeframe, undefined);
    const same = buildAskBody("compare", { ...base, compareKind: "symbol", compareSymbol: "BTC/USDT" });
    assert.equal(same.compare_symbol, undefined);
    assert.equal(same.compare_timeframe, "4h");
  });
});

describe("drafts", () => {
  test("normalizeDraft maps buy/sell and drops non-positive values", () => {
    assert.deepEqual(normalizeDraft({ side: "sell", entry: 50, stop: 55, target: 40, qty: 2 }), { side: "short", entry: 50, stop: 55, target: 40, qty: 2 });
    assert.equal(normalizeDraft({ side: "long", entry: Number.NaN }), undefined);
    assert.equal(normalizeDraft({ side: "long", entry: -1 }), undefined);
    assert.equal(normalizeDraft(null), undefined);
    assert.deepEqual(normalizeDraft({ side: "long", entry: 10, stop: -2, target: Number.POSITIVE_INFINITY }), { side: "long", entry: 10 });
  });

  test("draftRR for long and short; null on the wrong side or incomplete", () => {
    assert.equal(draftRR({ side: "long", entry: 100, stop: 90, target: 125 }), 2.5);
    assert.equal(draftRR({ side: "short", entry: 100, stop: 110, target: 85 }), 1.5);
    assert.equal(draftRR({ side: "long", entry: 100, stop: 105, target: 125 }), null);
    assert.equal(draftRR({ side: "long", entry: 100, stop: 90 }), null);
  });

  test("draftKey changes with any price and is empty without a draft", () => {
    const a = draftKey({ side: "long", entry: 100, stop: 90, target: 120 });
    assert.notEqual(a, draftKey({ side: "long", entry: 100, stop: 91, target: 120 }));
    assert.equal(a, draftKey({ side: "buy", entry: 100, stop: 90, target: 120 }));
    assert.equal(draftKey(null), "");
  });

  test("parseDraftInputs accepts grouped numbers and needs an entry", () => {
    assert.deepEqual(parseDraftInputs({ side: "long", entry: "106,500.5", stop: " 105 000 ", target: "" }), {
      side: "long",
      entry: 106500.5,
      stop: 105000,
      target: null,
    });
    assert.equal(parseDraftInputs({ side: "short", entry: "", stop: "1", target: "2" }), null);
    assert.equal(parseDraftInputs({ side: "short", entry: "abc", stop: "", target: "" }), null);
  });
});

describe("follow-ups and deep links", () => {
  test("followUpRequest copies known payload fields only", () => {
    const req = followUpRequest(
      { label: "COMPARE с 4H", mode: "compare", payload: { symbol: "BTC/USDT", timeframe: "1h", compare_timeframe: "4h", evil: "x", strategy_id: "7" } },
      { strategyId: 8, indicators: ["rsi"] },
    );
    assert.deepEqual(req, { mode: "compare", symbol: "BTC/USDT", timeframe: "1h", compare_timeframe: "4h", strategy_id: 8, indicators: ["rsi"] });
    const review = followUpRequest({ label: "r", mode: "review_strategy", payload: { strategy_id: 3 } }, { strategyId: 8 });
    assert.deepEqual(review, { mode: "review_strategy", strategy_id: 3 });
    const teach = followUpRequest({ label: "t", mode: "teach", payload: { topic: "risk-per-trade" } });
    assert.deepEqual(teach, { mode: "teach", topic: "risk-per-trade" });
  });

  test("every recorded follow-up maps to a valid mode request", () => {
    for (const a of [analyzeAnswer, whyAnswer, compareAnswer, quizAnswer]) {
      for (const f of a.follow_ups ?? []) {
        const r = followUpRequest(f);
        assert.ok(isTeacherMode(r.mode));
      }
    }
  });

  test("parseTeacherQuery reads and validates every parameter", () => {
    const q = parseTeacherQuery("?mode=Review-Trade&symbol=ETH%2FUSDT&tf=4H&topic=market-structure&q=%D0%97%D0%B0%D1%89%D0%BE%3F&strategy_id=12&position_id=ab_12-x&backtest_id=3&compare_symbol=AAPL&compare_tf=1d");
    assert.deepEqual(q, {
      mode: "review_trade",
      symbol: "ETH/USDT",
      timeframe: "4h",
      topic: "market-structure",
      question: "Защо?",
      strategyId: 12,
      positionId: "ab_12-x",
      backtestId: 3,
      compareSymbol: "AAPL",
      compareTimeframe: "1d",
    });
  });

  test("parseTeacherQuery drops invalid values", () => {
    assert.deepEqual(parseTeacherQuery("mode=buy_now&tf=2h&strategy_id=-1&topic=<script>&position_id=a%20b&backtest_id=1.5"), {});
    assert.deepEqual(parseTeacherQuery(""), {});
    assert.deepEqual(parseTeacherQuery("?timeframe=1d&mode=teach"), { mode: "teach", timeframe: "1d" });
  });

  test("teacherHref round-trips through parseTeacherQuery", () => {
    const href = teacherHref({ mode: "teach", symbol: "BTC/USDT", timeframe: "1h", topic: "rsi", strategy_id: 4, compare_timeframe: "4h", question: "Какво е RSI?" });
    assert.ok(href.startsWith("/ai?mode=teach"));
    const q = parseTeacherQuery(href.slice(href.indexOf("?")));
    assert.deepEqual(q, { mode: "teach", symbol: "BTC/USDT", timeframe: "1h", topic: "rsi", strategyId: 4, compareTimeframe: "4h", question: "Какво е RSI?" });
  });
});

describe("answer lines", () => {
  test("✓ / ✗ / ⚠ prefixes become marks", () => {
    assert.equal(parseLine("✓ LONG: Close > EMA(200) → изпълнено.").mark, "pass");
    assert.equal(parseLine("✗ R:R 0.38 спрямо минимума 1.5.").mark, "fail");
    assert.equal(parseLine("⚠ Висока волатилност").mark, "warn");
    const plain = parseLine("Цена 106,735.28; RSI 60.7");
    assert.equal(plain.mark, null);
    assert.deepEqual(plain.parts, [{ kind: "text", text: "Цена 106,735.28; RSI 60.7" }]);
    assert.deepEqual(parseLine("✓ x").parts, [{ kind: "text", text: "x" }]);
  });

  test("in-app paths become links (arrow dropped, punctuation kept out)", () => {
    const p = parseLine("Прочети целия урок: Market structure → /learn/market-structure");
    assert.deepEqual(p.parts, [
      { kind: "text", text: "Прочети целия урок: Market structure " },
      { kind: "link", text: "Отвори урока", href: "/learn/market-structure" },
    ]);
    const bt = parseLine("Пусни backtest на BTC/USDT 1H → /backtesting?strategy_id=8.");
    assert.equal(bt.parts[1].kind, "link");
    assert.equal((bt.parts[1] as { href: string }).href, "/backtesting?strategy_id=8");
    assert.deepEqual(bt.parts[2], { kind: "text", text: "." });
    // fractions and pairs are not links
    assert.ok(parseLine("LONG 1/2, SHORT 0/2 · BTC/USDT").parts.every((x) => x.kind === "text"));
  });

  test("linkLabel names the target page", () => {
    assert.equal(linkLabel("/learn/rsi"), "Отвори урока");
    assert.equal(linkLabel("/backtesting?strategy_id=8"), "Отвори Backtesting");
    assert.equal(linkLabel("/bots"), "Отвори Bot Lab");
    assert.equal(linkLabel("/unknown"), "Отвори");
  });

  test("splitNumbers highlights values, not indicator names", () => {
    const parts = splitNumbers("EMA(20) 105,087.91, RSI(14) 60.7, ATR 1.07% от цената, 1H");
    assert.deepEqual(
      parts.filter((p) => p.num).map((p) => p.text),
      ["105,087.91", "60.7", "1.07%"],
    );
    assert.equal(parts.map((p) => p.text).join(""), "EMA(20) 105,087.91, RSI(14) 60.7, ATR 1.07% от цената, 1H");
  });

  test("splitPipeline takes the leading stages once and keeps the rest", () => {
    const { steps, rest } = splitPipeline([
      "Market data: 400 свещи 1h (demo)",
      "Indicators: EMA, RSI 61",
      "Risk engine: —",
      "Signal: NO TRADE",
      "Market structure: Higher highs и higher lows.",
      "Volume is low.",
    ]);
    assert.deepEqual(
      steps.map((s) => s.stage),
      ["Market data", "Indicators", "Risk engine", "Signal"],
    );
    assert.equal(steps[2].detail, "няма setup за оценка");
    assert.deepEqual(rest, ["Market structure: Higher highs и higher lows.", "Volume is low."]);
    const why = whyAnswer.sections.find((s) => s.key === "why")!;
    assert.ok(splitPipeline(why.body).steps.length >= 3);
  });

  test("the six standard sections have distinct accents", () => {
    const accents = STANDARD_SECTIONS.map((s) => sectionAccent(s.key));
    assert.equal(new Set(accents).size, 6);
    assert.equal(sectionAccent("something-else"), "neutral");
    assert.deepEqual(
      STANDARD_SECTIONS.map((s) => s.title),
      ["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO"],
    );
  });

  test("providerInfo labels OFFLINE / Claude / fallback", () => {
    assert.equal(providerInfo({ provider: "offline" }).label, "OFFLINE");
    assert.equal(providerInfo({ provider: "anthropic", provider_label: "Claude" }).label, "Claude");
    assert.equal(providerInfo({ provider: "anthropic" }).label, "Claude");
    assert.equal(providerInfo({ provider: "anthropic" }).tone, "violet");
    const fb = providerInfo({ provider: "offline", fallback: true });
    assert.equal(fb.label, "OFFLINE");
    assert.match(fb.title, /offline/);
  });

  test("context chips helpers", () => {
    const items = analyzeAnswer.context_used ?? [];
    const cov = contextCoverage(items);
    assert.equal(cov.total, items.length);
    assert.equal(cov.available, items.filter((i) => i.available).length);
    assert.deepEqual(contextRows({ key: "x", label: "x", available: false, values: {} }), []);
    const chart = items.find((i) => i.key === "chart")!;
    assert.ok(contextRows(chart).some(([k]) => k === "RSI(14)"));
    assert.deepEqual(contextCoverage(undefined), { available: 0, total: 0 });
  });

  test("examplesSplit sums to 100 and is null without examples", () => {
    const s = examplesSplit(analyzeAnswer.examples)!;
    assert.equal(s.plus + s.minus + s.neither, 100);
    assert.equal(examplesSplit({ available: true, count: 0 }), null);
    assert.equal(examplesSplit({ available: false, count: 5 }), null);
    assert.equal(examplesSplit(null), null);
    const odd = examplesSplit({ available: true, count: 3, plus_first_pct: 33, minus_first_pct: 33, neither_pct: 33 })!;
    assert.equal(odd.plus + odd.minus + odd.neither, 100);
    assert.match(analyzeAnswer.examples?.summary ?? "", /not a forecast/);
  });
});

describe("quiz", () => {
  const questions = quizAnswer.quiz!.questions;

  test("recorded quiz questions are valid", () => {
    assert.equal(validQuestions(questions).length, questions.length);
    assert.ok(questions.length >= 3 && questions.length <= 7);
    const bad = [
      { id: "a", question: "?", options: ["x"], answer_index: 0, explanation: "" },
      { id: "b", question: "?", options: ["x", "y"], answer_index: 2, explanation: "" },
      { id: "c", question: "?", options: ["x", "y"], answer_index: 1, explanation: "" },
    ] as QuizQuestion[];
    assert.deepEqual(
      validQuestions(bad).map((q) => q.id),
      ["c"],
    );
  });

  test("answers lock, next needs an answer, last next finishes", () => {
    let s = quizInit(2);
    assert.deepEqual(s, { index: 0, answers: [null, null], finished: false });
    assert.equal(quizReducer(s, { type: "next" }), s); // unanswered → stays
    s = quizReducer(s, { type: "answer", choice: 1 });
    assert.deepEqual(s.answers, [1, null]);
    assert.equal(quizReducer(s, { type: "answer", choice: 0 }), s); // locked
    s = quizReducer(s, { type: "next" });
    assert.equal(s.index, 1);
    s = quizReducer(quizReducer(s, { type: "answer", choice: 0 }), { type: "next" });
    assert.equal(s.finished, true);
    assert.equal(quizReducer(s, { type: "answer", choice: 1 }), s);
    const back = quizReducer(s, { type: "prev" });
    assert.equal(back.finished, false);
    assert.equal(back.index, 1);
    assert.equal(quizReducer(back, { type: "goto", index: 0 }).index, 0);
    assert.equal(quizReducer(back, { type: "goto", index: 9 }), back);
    assert.deepEqual(quizReducer(s, { type: "restart" }), quizInit(2));
    assert.equal(quizInit(0).finished, true);
  });

  test("score with the pass threshold", () => {
    const right = questions.map((q) => q.answer_index);
    assert.deepEqual(quizScore(questions, right), { correct: questions.length, answered: questions.length, total: questions.length, pct: 100, passed: true });
    const wrong = questions.map((q) => (q.answer_index + 1) % q.options.length);
    const sc = quizScore(questions, wrong);
    assert.equal(sc.correct, 0);
    assert.equal(sc.passed, false);
    const partial = quizScore(questions, [questions[0].answer_index, null]);
    assert.equal(partial.answered, 1);
    assert.equal(partial.correct, 1);
    assert.equal(quizScore([], []).passed, false);
  });
});

describe("chart overlay", () => {
  test("answer overlay only for the same chart", () => {
    const o = overlayFromAnswer(analyzeAnswer, "BTC/USDT", "1h")!;
    assert.equal(o.source, "answer");
    assert.ok(o.support.length > 0 && o.resistance.length > 0);
    assert.equal(overlayFromAnswer(analyzeAnswer, "ETH/USDT", "1h"), null);
    assert.equal(overlayFromAnswer(analyzeAnswer, "BTC/USDT", "4h"), null);
    assert.equal(overlayFromAnswer(null), null);
  });

  test("strategy view overlay uses its risk plan as the setup", () => {
    const withPlan: StrategyViewData = {
      ...strategyView,
      result: "POSSIBLE LONG SETUP",
      risk_plan: { side: "long", entry: 100, stop: 95, target: 112.5, rr: 2.5 },
    };
    const o = overlayFromView(withPlan, "BTC/USDT", "1h")!;
    assert.deepEqual(o.setup, { side: "long", entry: 100, stop: 95, target: 112.5, source: "strategy" });
    assert.equal(overlayFromView({ ...strategyView, available: false }), null);
    assert.equal(overlayFromView(strategyView, "AAPL"), null);
  });

  test("legacy analysis overlay maps invalidation → stop", () => {
    const a = {
      market: "BTC/USDT",
      timeframe: "1h",
      support: [{ price: 90, touches: 2 }],
      resistance: [{ price: 110, touches: 1 }],
      structure: { trend: "bullish", text: "", swings: [{ time: 1, price: 95, kind: "low", label: "HL" }] },
      setup: { side: "long", name: "x", entry: 100, invalidation: 94, target: 112, reward_risk: 2, risk_text: "", reward_text: "" },
    } as unknown as Analysis;
    const o = overlayFromAnalysis(a, "BTC/USDT", "1h")!;
    assert.deepEqual(o.setup, { side: "long", entry: 100, stop: 94, target: 112, source: "engine" });
    assert.equal(overlayFromAnalysis(a, "ETH/USDT"), null);
  });

  test("overlayLines: ≤2 levels per side, invalidation + target, layers respected", () => {
    const o = { source: "view" as const, support: [1, 2, 3], resistance: [7, 8, 9], swings: [], setup: { side: "long" as const, entry: 5, stop: 4, target: 8 } };
    const all = overlayLines(o);
    assert.deepEqual(
      all.map((l) => l.title),
      ["Support", "Support", "Resistance", "Resistance", "Invalidation", "Target"],
    );
    assert.deepEqual(
      overlayLines(o, { levels: false, setup: true, structure: true }).map((l) => l.id),
      ["inv", "tgt"],
    );
    assert.deepEqual(overlayLines(o, { levels: true, setup: false, structure: true }).length, 4);
    assert.deepEqual(overlayLines(null), []);
    assert.deepEqual(
      overlayLines({ ...o, support: [], resistance: [], setup: { side: "short", entry: 5, stop: 6, target: null } }).map((l) => l.title),
      ["Invalidation"],
    );
  });

  test("swingMarkers: last N, deduped, coloured by structure, only at candle times", () => {
    const sw: Swing[] = [
      { time: 10, price: 1, kind: "high", label: "HH" },
      { time: 20, price: 1, kind: "low", label: "LL" },
      { time: 20, price: 1, kind: "low", label: "LL" },
      { time: 30, price: 1, kind: "high", label: null },
      { time: 40, price: 1, kind: "low", label: "HL" },
    ];
    const m = swingMarkers(sw, 3);
    assert.deepEqual(
      m.map((x) => [x.time, x.text, x.position]),
      [
        [20, "LL", "belowBar"],
        [30, "SH", "aboveBar"],
        [40, "HL", "belowBar"],
      ],
    );
    assert.notEqual(m[0].color, m[2].color);
    assert.deepEqual(
      swingMarkers(sw, 8, new Set([10, 40])).map((x) => x.time),
      [10, 40],
    );
    assert.deepEqual(swingMarkers(undefined), []);
  });
});

describe("strategy view helpers", () => {
  test("result tone and logic label", () => {
    assert.equal(resultTone("POSSIBLE LONG SETUP"), "up");
    assert.equal(resultTone("POSSIBLE SHORT SETUP"), "down");
    assert.equal(resultTone("NO SETUP"), "neutral");
    assert.equal(logicLabel("any"), "поне едно условие (OR)");
    assert.equal(logicLabel("all"), "всички условия (AND)");
    assert.equal(logicLabel(undefined), "всички условия (AND)");
  });

  test("condition counts and regime filter text", () => {
    assert.deepEqual(conditionCounts(strategyView.conditions.long), {
      passed: strategyView.conditions.long.filter((c) => c.passed).length,
      total: strategyView.conditions.long.length,
    });
    assert.deepEqual(conditionCounts(undefined), { passed: 0, total: 0 });
    assert.equal(regimeFilterText({ required: [], actual: "UNCLEAR", passed: true }), "всеки режим · текущ: UNCLEAR");
    assert.equal(regimeFilterText({ required: ["TRENDING_UP", "TRENDING_DOWN"], actual: "RANGING", passed: false }), "TRENDING_UP / TRENDING_DOWN · текущ: RANGING");
  });

  test("fmtValue adapts decimals", () => {
    assert.equal(fmtValue(105087.912), "105,087.91");
    assert.equal(fmtValue(60.67), "60.67");
    assert.equal(fmtValue(1.08345), "1.08345");
    assert.equal(fmtValue(1.5), "1.50");
    assert.equal(fmtValue(0.4567891), "0.456789");
    assert.equal(fmtValue(0.000123456), "0.00012346");
    assert.equal(fmtValue(57.81, 1), "57.8");
    assert.equal(fmtValue(null), "—");
    assert.equal(fmtValue(Number.NaN), "—");
  });

  test("recorded strategy view carries the exact disclaimer", () => {
    assert.equal(strategyView.disclaimer, SETUP_DISCLAIMER);
    assert.equal(SETUP_DISCLAIMER, "This is a rule-based hypothetical setup, not a guarantee of future price movement.");
  });
});

describe("misc", () => {
  test("isDataNotAvailableError / unavailableReason", () => {
    assert.equal(isDataNotAvailableError({ status: 503, message: "Market data unavailable: x" }), true);
    assert.equal(isDataNotAvailableError(new Error("DATA_NOT_AVAILABLE: x")), true);
    assert.equal(isDataNotAvailableError({ status: 404, message: "Unknown instrument" }), false);
    assert.equal(isDataNotAvailableError(null), false);
    assert.equal(unavailableReason({ message: "Market data unavailable: no provider for AAPL" }), "no provider for AAPL");
    assert.equal(unavailableReason(new Error("DATA NOT AVAILABLE — twelvedata key missing")), "twelvedata key missing");
    assert.match(unavailableReason({ message: "" }), /Доставчикът/);
  });

  test("lessonIndicators adds the lesson's indicator once", () => {
    const active = ["ema20"];
    assert.deepEqual(lessonIndicators("rsi", active), ["ema20", "rsi"]);
    assert.deepEqual(lessonIndicators("macd", active), ["ema20", "macd"]);
    assert.deepEqual(lessonIndicators("ema", ["rsi"]), ["rsi", "ema20", "ema50"]);
    const same = ["ema20", "ema50"];
    assert.equal(lessonIndicators("ema", same), same); // unchanged → same array (no re-render)
    assert.equal(lessonIndicators("market-structure", active), active);
    assert.equal(lessonIndicators(null, active), active);
  });

  test("uniquePositions keeps the newest row per position", () => {
    const rows = uniquePositions([
      { position_id: "a", closed_ts: 1 },
      { position_id: "b", closed_ts: 5 },
      { position_id: "a", closed_ts: 9 },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.position_id, r.closed_ts]),
      [
        ["a", 9],
        ["b", 5],
      ],
    );
    assert.deepEqual(uniquePositions(undefined), []);
  });
});
