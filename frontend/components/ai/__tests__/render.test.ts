/*
 * Server-render tests of the AI-teacher components (react-dom/server, real backend fixtures).
 * They check the contract other packages and the browser walkthrough rely on: section titles, badges,
 * disclaimers, anchors ("Ask the AI Teacher…", "Send", "DECISION:", "Teach me why") and DATA NOT AVAILABLE.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AIPanel } from "../AIPanel";
import { ChatPanel } from "../ChatPanel";
import { CompareTable } from "../CompareTable";
import { ContextChips } from "../ContextChips";
import { DecisionPanel } from "../DecisionPanel";
import { ExamplesBlock } from "../ExamplesBlock";
import { DEFAULT_MODES, SETUP_DISCLAIMER } from "../model";
import { ModePicker } from "../ModePicker";
import { QuizCard } from "../QuizCard";
import { SetupResultBadge, StrategyViewBody } from "../StrategyView";
import { TeacherAnswer } from "../TeacherAnswer";
import type { StrategyViewData, TeacherAnswerData } from "../types";
import type { Analysis } from "@/lib/types";
import { analyzeAnswer, compareAnswer, explainDraftAnswer, quizAnswer, reviewTradeAnswer, strategyView, teachAnswer, whyAnswer } from "./fixtures";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

/** Phrases the teacher must never show (COMMON_RULES: no signals, no promises). */
const FORBIDDEN = [/BUY NOW/i, /SELL NOW/i, /guaranteed profit/i, /risk[- ]free/i, /easy money/i, /100% win/i, /сигурна печалба/i];
const assertSafe = (s: string) => FORBIDDEN.forEach((re) => assert.doesNotMatch(s, re));

describe("TeacherAnswer", () => {
  test("ANALYZE renders the six sections in order + extras, provider, disclaimer", () => {
    const out = html(h(TeacherAnswer, { answer: analyzeAnswer }));
    const t = text(out);
    const order = ["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO", "HISTORICAL EXAMPLES"].map((x) => t.indexOf(x));
    order.forEach((i) => assert.ok(i >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    for (const k of ["observation", "rules", "scenario", "invalidation", "risk", "alternative", "examples"]) assert.match(out, new RegExp(`data-section="${k}"`));
    assert.match(t, /ANALYZE · BTC\/USDT 1H/);
    assert.match(t, /OFFLINE/);
    assert.ok(t.includes(analyzeAnswer.disclaimer));
    assert.match(t, /not a forecast/);
    assertSafe(t);
  });

  test("follow-ups are /ai links without a handler and buttons with one", () => {
    const links = html(h(TeacherAnswer, { answer: analyzeAnswer }));
    assert.match(links, /href="\/ai\?mode=why&amp;symbol=BTC%2FUSDT&amp;tf=1h"/);
    const buttons = html(h(TeacherAnswer, { answer: analyzeAnswer, onFollowUp: () => {} }));
    assert.doesNotMatch(buttons, /href="\/ai\?mode=/);
    assert.match(text(buttons), /Следващи стъпки/);
  });

  test("RULES lines render ✓ / ✕ markers", () => {
    const t = text(html(h(TeacherAnswer, { answer: analyzeAnswer })));
    assert.ok(t.includes("✓") && t.includes("✕"));
  });

  test("every recorded mode renders safely with its required sections", () => {
    const cases: [TeacherAnswerData, string[]][] = [
      [whyAnswer, ["WHY", "OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO"]],
      [compareAnswer, ["COMPARISON", "OBSERVATION", "CONCLUSION"]],
      [teachAnswer, ["LESSON", "CHART EXAMPLE", "NEXT LESSON"]],
      [reviewTradeAnswer, ["WHAT HAPPENED", "WHAT YOU DID WELL", "WHAT TO IMPROVE", "MAIN LESSON"]],
      [quizAnswer, ["QUIZ"]],
      [explainDraftAnswer, ["YOUR DRAFT ORDER", "OBSERVATION", "ALTERNATIVE SCENARIO"]],
    ];
    for (const [answer, titles] of cases) {
      const t = text(html(h(TeacherAnswer, { answer, compact: true })));
      titles.forEach((title) => assert.ok(t.includes(title), `${answer.mode}: ${title}`));
      assertSafe(t);
    }
  });

  test("WHY renders the engine pipeline as numbered steps", () => {
    const out = html(h(TeacherAnswer, { answer: whyAnswer }));
    assert.match(out, /<ol/);
    assert.match(text(out), /Market data — /);
  });

  test("TEACH links the full lesson", () => {
    const out = html(h(TeacherAnswer, { answer: teachAnswer }));
    assert.ok(out.includes(`href="${teachAnswer.lesson!.href}"`));
    assert.match(text(out), /Целият урок/);
  });

  test("COMPARE renders the table with the 'not a prediction' note", () => {
    const t = text(html(h(TeacherAnswer, { answer: compareAnswer })));
    assert.ok(t.includes(compareAnswer.comparison!.left.label) && t.includes(compareAnswer.comparison!.right.label));
    assert.match(t, /differences, not a prediction/);
  });

  test("DATA NOT AVAILABLE, safety note, fallback and Claude provider", () => {
    const answer: TeacherAnswerData = {
      ...analyzeAnswer,
      data_available: false,
      safety_note: "Премахнато от safety филтъра.",
      provider: "anthropic",
      provider_label: "Claude",
      llm_rejected_sections: ["risk"],
    };
    const t = text(html(h(TeacherAnswer, { answer })));
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /Safety filter/);
    assert.match(t, /Claude/);
    assert.match(t, /offline версията \(risk\)/);
    const fb = text(html(h(TeacherAnswer, { answer: { ...analyzeAnswer, fallback: true } })));
    assert.match(fb, /Външният AI не беше наличен/);
  });
});

describe("QuizCard / CompareTable / ExamplesBlock", () => {
  test("quiz starts at question 1 with lettered options and no answer revealed", () => {
    const t = text(html(h(QuizCard, { quiz: quizAnswer.quiz! })));
    assert.match(t, /Въпрос 1 \/ 5/);
    assert.ok(t.includes(quizAnswer.quiz!.questions[0].question));
    assert.doesNotMatch(t, /Вярно\.|верният отговор/);
  });

  test("empty quiz shows a message", () => {
    assert.match(text(html(h(QuizCard, { quiz: { questions: [] } }))), /Няма въпроси/);
  });

  test("compare table marks unavailable sides as DATA NOT AVAILABLE", () => {
    const c = { ...compareAnswer.comparison!, right: { ...compareAnswer.comparison!.right, available: false } };
    const t = text(html(h(CompareTable, { comparison: c })));
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /се различават/);
  });

  test("examples show the split and the not-a-forecast note; empty → message", () => {
    const t = text(html(h(ExamplesBlock, { examples: analyzeAnswer.examples! })));
    assert.match(t, /\+1R първо/);
    assert.match(t, /not a forecast/);
    assert.match(text(html(h(ExamplesBlock, { examples: { available: false } }))), /not a forecast/);
  });
});

describe("StrategyView", () => {
  test("checklist per side, regime filter row, result badge, exact disclaimer", () => {
    const out = html(h(StrategyViewBody, { data: strategyView }));
    const t = text(out);
    assert.match(t, /What would the strategy do\?/);
    assert.match(t, /LONG entry/);
    assert.match(t, /SHORT entry/);
    assert.match(t, /Regime filter/);
    assert.ok(t.includes(strategyView.result));
    assert.ok(t.includes(SETUP_DISCLAIMER));
    for (const c of [...strategyView.conditions.long, ...strategyView.conditions.short]) assert.ok(t.includes(c.label), c.label);
    assert.equal((t.match(/✓/g) ?? []).length >= 1, true);
    assertSafe(t);
  });

  test("risk plan only when a setup exists; blocked regime filter shows ✕", () => {
    const setup: StrategyViewData = {
      ...strategyView,
      result: "POSSIBLE LONG SETUP",
      regime_filter: { required: ["TRENDING_UP"], actual: "TRENDING_UP", passed: true },
      risk_plan: { side: "long", entry: 100, stop: 95, target: 112.5, rr: 2.5, stop_rule: "ATR(14) × 2", target_rule: "Risk × 2.5", risk_per_trade_pct: 1 },
    };
    const t = text(html(h(StrategyViewBody, { data: setup })));
    assert.match(t, /Risk plan/);
    assert.match(t, /2\.50R/);
    assert.match(t, /POSSIBLE LONG SETUP/);
    assert.doesNotMatch(text(html(h(StrategyViewBody, { data: strategyView }))), /Risk plan/);

    const blocked: StrategyViewData = { ...strategyView, regime_filter: { required: ["TRENDING_UP"], actual: "RANGING", passed: false } };
    const bt = text(html(h(StrategyViewBody, { data: blocked })));
    assert.match(bt, /Режимът не е разрешен/);
    assert.match(bt, /TRENDING_UP · текущ: RANGING/);
  });

  test("not enough history → notice, still the disclaimer", () => {
    const t = text(html(h(StrategyViewBody, { data: { ...strategyView, available: false, reason: "Само 20 затворени свещи." } })));
    assert.match(t, /Оценката не е възможна/);
    assert.match(t, /Само 20 затворени свещи/);
    assert.ok(t.includes(SETUP_DISCLAIMER));
  });

  test("result badge for each result", () => {
    for (const r of ["NO SETUP", "POSSIBLE LONG SETUP", "POSSIBLE SHORT SETUP"]) assert.ok(text(html(h(SetupResultBadge, { result: r }))).includes(r));
  });
});

describe("pickers, chips and panels", () => {
  test("ModePicker: 8 chips with descriptions, the selected one pressed", () => {
    const out = html(h(ModePicker, { value: "quiz", onChange: () => {} }));
    assert.equal((out.match(/<button/g) ?? []).length, 8);
    assert.equal((out.match(/aria-pressed="true"/g) ?? []).length, 1);
    DEFAULT_MODES.forEach((m) => assert.ok(text(out).includes(m.label)));
    const quizDesc = DEFAULT_MODES.find((m) => m.key === "quiz")!.description;
    assert.ok(out.includes(`aria-pressed="true" title="${quizDesc}"`));
    const only = html(h(ModePicker, { value: "why", onChange: () => {}, only: ["explain", "why"], compact: true }));
    assert.equal((only.match(/<button/g) ?? []).length, 2);
  });

  test("ContextChips: header, coverage and unavailable chips", () => {
    const out = html(h(ContextChips, { items: analyzeAnswer.context_used }));
    const t = text(out);
    assert.match(t, /Какво знае учителят/);
    assert.match(t, /What the teacher knows/);
    const items = analyzeAnswer.context_used!;
    assert.ok(t.includes(`${items.filter((i) => i.available).length}/${items.length}`));
    const off = html(h(ContextChips, { items: [{ key: "journal", label: "Дневник", available: false, values: {} }] }));
    assert.match(off, /aria-label="Дневник — няма данни"/);
  });

  test("ChatPanel keeps the walkthrough anchors", () => {
    const out = html(h(ChatPanel, { symbol: "BTC/USDT", timeframe: "1h" }));
    assert.match(out, /placeholder="Ask the AI Teacher…"/);
    assert.match(text(out), /Send/);
    assert.match(text(out), /Защо загубих този trade\?/);
    const compact = text(html(h(ChatPanel, { compact: true })));
    assert.match(compact, /Защо загубих този trade\?/);
  });

  test("DecisionPanel keeps DECISION: and Teach me why", () => {
    const analysis = {
      decision: "WAIT",
      confidence: "LOW",
      confidence_note: "",
      signal: "WAIT",
      regime: { regime: "UNCLEAR", reasons: [], metrics: {} },
      no_trade_reasons: [],
      teach_me_why: ["a"],
      conclusion: "c",
      pipeline: [{ stage: "Market data", detail: "x" }],
      setup: null,
      disclaimer: "d",
    } as unknown as Analysis;
    const t = text(html(h(DecisionPanel, { analysis, panel: { REGIME: "UNCLEAR" } })));
    assert.match(t, /DECISION: WAIT/);
    assert.match(t, /Teach me why/);
  });

  test("AIPanel: four tabs; Explain tab shows the draft and the action", () => {
    const tabs = text(html(h(AIPanel, { symbol: "BTC/USDT", timeframe: "1h" })));
    for (const label of ["Strategy View", "Explain", "WHY?", "Ask"]) assert.ok(tabs.includes(label), label);
    const ex = text(html(h(AIPanel, { symbol: "BTC/USDT", timeframe: "1h", defaultTab: "explain", draft: { side: "buy", entry: 100, stop: 90, target: 125 } })));
    assert.match(ex, /Explain this setup/);
    assert.match(ex, /Твоята чернова/);
    assert.match(ex, /2\.50R/);
    const none = text(html(h(AIPanel, { symbol: "BTC/USDT", timeframe: "1h", defaultTab: "explain", draft: { side: "long", entry: 0 } })));
    assert.match(none, /Няма чернова/);
    const ask = html(h(AIPanel, { symbol: "BTC/USDT", timeframe: "1h", defaultTab: "ask", compact: true }));
    assert.match(ask, /placeholder="Ask the AI Teacher…"/);
    // the Ask tab fills the panel: the chat list has no fixed max height there
    assert.match(ask, /min-h-\[24rem\]/);
    assert.doesNotMatch(ask, /max-height/);
  });

  test("ChatPanel: fixed max height by default, fills its container with `fill`", () => {
    assert.match(html(h(ChatPanel, { compact: true })), /max-height:340px/);
    assert.match(html(h(ChatPanel, {})), /max-height:520px/);
    const fill = html(h(ChatPanel, { compact: true, fill: true, className: "min-h-0 flex-1" }));
    assert.doesNotMatch(fill, /max-height/);
    assert.match(fill, /class="flex h-full min-w-0 flex-col min-h-0 flex-1"/);
  });
});
