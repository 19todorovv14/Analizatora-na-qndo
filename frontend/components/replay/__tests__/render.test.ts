/*
 * Server-render tests of the replay screens with real captured responses. They pin the walkthrough anchors
 * ("Start replay", one "Next candle ▶", one button named exactly "BUY", one "+5", "Finish + AI review", one
 * "Replay review"), predict mode without orders, the decision bar, the AI history review sections and the
 * history / stats cards.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";

import { DecisionPanel } from "@/components/replay/DecisionPanel";
import { ReplayHistory, ReplayStatsCard } from "@/components/replay/ReplayHistory";
import { ReplayReview } from "@/components/replay/ReplayReview";
import { ReplayScreen } from "@/components/replay/ReplayScreen";
import { ReplaySetup } from "@/components/replay/ReplaySetup";
import { ScoreHud } from "@/components/replay/ScoreHud";
import { STRATEGY_DISCLAIMER, STRATEGY_SENTENCE, EMPTY_DRAFT, defaultSetup, normalizeFinish } from "@/components/replay/model";
import { ScoreRing } from "@/components/replay/parts";
import type { DecisionsSummary, FinishResponse, ReplayOptions, ReplayState } from "@/components/replay/types";
import type { ReplaySessionApi } from "@/components/replay/useReplaySession";
import type { Review } from "@/lib/types";

import * as fx from "./fixtures";

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {}, hmrRefresh() {} };
function render(el: ReactElement, fallback: Record<string, unknown> = {}) {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: router as never }, h(SWRConfig, { value: { fallback, provider: () => new Map() } }, el)));
}
const decode = (s: string) =>
  s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
const text = (markup: string) =>
  decode(markup.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
/** Visible text of every <button> (nested tags stripped). */
const buttons = (markup: string) => [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const noop = async () => null;
function fakeApi(state: ReplayState | null, over: Partial<ReplaySessionApi> = {}): ReplaySessionApi {
  return {
    state,
    review: null,
    error: null,
    setError() {},
    busy: false,
    opening: false,
    auto: false,
    setAuto() {},
    speed: 900,
    setSpeed() {},
    findings: [],
    toasts: [],
    dismissToast() {},
    pushToasts() {},
    start: noop,
    open: async () => {},
    step: noop,
    decide: noop,
    order: noop,
    action: noop,
    finish: noop,
    reset() {},
    ...over,
  } as unknown as ReplaySessionApi;
}

const predictState = fx.statePredict as unknown as ReplayState;
const tradeState = { ...(fx.tradeState as unknown as ReplayState), candles: predictState.candles };
const options = fx.options as unknown as ReplayOptions;

describe("setup", () => {
  test("one-click start: 'Start replay', period chips, modes, strategy select", () => {
    const html = render(h(ReplaySetup, { value: defaultSetup(), onChange() {}, onStart() {}, busy: false, error: null, options }), {
      "/strategies": { strategies: [] },
    });
    const btns = buttons(html);
    assert.equal(btns.filter((b) => b.includes("Start replay")).length, 1);
    for (const chip of ["Дата", "Random", "Trend", "Range", "High volatility", "Breakout"]) assert.ok(btns.includes(chip), chip);
    assert.match(html, /role="radio" aria-checked="true"[^>]*>[\s\S]*?Trade с paper поръчки/);
    assert.match(html, /aria-checked="false"[^>]*>[\s\S]*?Predict — само прогнози/);
    assert.match(text(html), /Автоматично \(последната ми\)/);
    assert.match(html, /type="date"/);
  });

  test("a preset hides the date picker; DATA NOT AVAILABLE errors are shown as such", () => {
    const html = render(
      h(ReplaySetup, {
        value: { ...defaultSetup(), period: "breakout" },
        onChange() {},
        onStart() {},
        busy: false,
        error: { message: "x", unavailable: true, reason: "No provider for FOO" },
        options,
      }),
    );
    assert.doesNotMatch(html, /type="date"/);
    assert.match(text(html), /автоматично · Breakout/);
    assert.match(text(html), /DATA NOT AVAILABLE/);
    assert.match(text(html), /No provider for FOO/);
  });
});

describe("live replay", () => {
  test("trade mode keeps the walkthrough anchors exactly once", () => {
    const html = render(h(ReplayScreen, { api: fakeApi(tradeState), state: tradeState, options, onNew() {} }));
    const t = text(html);
    const btns = buttons(html);
    assert.equal(count(t, "Next candle ▶"), 1);
    assert.equal(btns.filter((b) => b === "BUY").length, 1, "exactly one button named BUY");
    assert.equal(btns.filter((b) => b.includes("+5")).length, 1, "'+5' is unique");
    assert.ok(btns.includes("+20"));
    assert.equal(btns.filter((b) => b.includes("Finish + AI review")).length, 1);
    assert.ok(btns.includes("SELL"));
    assert.ok(btns.some((b) => b.startsWith("LONG")));
    assert.ok(btns.some((b) => b.startsWith("SHORT")));
    assert.ok(btns.some((b) => b.startsWith("WAIT")));
    assert.equal(count(t, "Replay review"), 0);
    assert.match(t, /Paper поръчка/);
    assert.match(t, /Live score/);
    assert.match(html, /role="progressbar"/);
  });

  test("predict mode: no BUY / SELL panel, the predictions note instead", () => {
    const html = render(h(ReplayScreen, { api: fakeApi(predictState), state: predictState, options, onNew() {} }));
    const btns = buttons(html);
    assert.equal(btns.filter((b) => b === "BUY").length, 0);
    assert.match(text(html), /Predict режим: прогнозите не пускат поръчки/);
    assert.match(text(html), /PREDICT/i);
    assert.match(text(html), /Trend/);
  });

  test("decision bar: armed LONG shows levels, planned R:R and the record button", () => {
    const cs = predictState.candles;
    const close = cs[cs.length - 1].close;
    const base = {
      sid: 1,
      mode: "predict" as const,
      candles: cs,
      precision: 2,
      onDraft() {},
      pick: null,
      onPick() {},
      current: null,
      busy: false,
      active: true,
      onRecord() {},
      onWait() {},
    };
    const ok = render(h(DecisionPanel, { ...base, draft: { ...EMPTY_DRAFT, action: "long", stop: String(close - 100), target: String(close + 200) } }));
    assert.match(ok, new RegExp(`value="${close + 200}"`));
    assert.match(text(ok), /2\.00R/);
    assert.ok(buttons(ok).some((b) => b.startsWith("Запиши LONG")));
    assert.doesNotMatch(ok, /<button type="submit"[^>]*\sdisabled=""/);
    const bad = render(h(DecisionPanel, { ...base, draft: { ...EMPTY_DRAFT, action: "long", stop: String(close + 1), target: "" } }));
    assert.match(text(bad), /stop-ът трябва да е ПОД текущата цена/);
    assert.match(bad, /<button type="submit"[^>]*\sdisabled=""/);
    const idle = render(h(DecisionPanel, { ...base, draft: EMPTY_DRAFT, current: fx.decision as never }));
    assert.match(text(idle), /На тази свещ вече имаш/);
  });

  test("score HUD: ring, counts and flag labels", () => {
    const html = render(
      h(ScoreHud, {
        score: { value: 58, grade: "C", scored: 2, pending: 0 },
        summary: { ...(fx.statePredict.decisions_summary as unknown as DecisionsSummary), total: 3, correct: 1, wrong: 2, total_r: 1, flags: { chased: 1, ignored_structure: 2 } },
        flagOptions: options.flags,
      }),
    );
    const t = text(html);
    assert.match(t, /58/);
    assert.match(t, /grade C/);
    assert.match(t, /Chasing\? ×1/);
    assert.match(t, /Against structure ×2/);
    assert.match(t, /\+1\.00R/);
  });
});

describe("AI history review", () => {
  const data = normalizeFinish(fx.finishPredict as unknown as FinishResponse);

  test("one 'Replay review' heading, score, strategy sentence, sections, lessons, CTA", () => {
    const html = render(h(ReplayReview, { data, onAnother() {}, onSetup() {} }));
    const t = text(html);
    assert.equal(count(t, "Replay review"), 1);
    assert.match(html, /aria-label="Replay score: 66 от 100, оценка C"/);
    assert.ok(t.includes(STRATEGY_SENTENCE));
    for (const sec of ["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO"]) assert.ok(t.includes(sec), sec);
    for (const g of ["Entered too early", "Chased", "Ignored structure"]) assert.ok(t.includes(g), g);
    assert.ok(buttons(html).some((b) => b.includes("Replay another period")));
    const hr = fx.finishPredict.history_review;
    for (const l of hr.lessons) assert.match(html, new RegExp(`href="${l.href}"`));
    // predictions table: one row per prediction
    assert.equal(count(html, 'aria-selected="false"'), hr.predictions.length);
    assert.ok(t.includes(STRATEGY_DISCLAIMER));
    assert.match(t, /NO TRADE/);
  });

  test("legacy trade reviews render under the AI review; a missing history_review degrades gracefully", () => {
    const reviews = fx.finishTradeReviews as unknown as Review[];
    const html = render(h(ReplayReview, { data: { ...data, review: null, reviews }, onAnother() {}, onSetup() {} }));
    const t = text(html);
    assert.equal(count(t, "Replay review"), 1);
    assert.match(t, /Няма AI преглед за тази сесия/);
    assert.equal(count(t, "TRADE REVIEW"), reviews.length + 1, "section title + one card per review");
  });
});

describe("history and stats", () => {
  test("past sessions with score rings and open / review actions", () => {
    const html = render(h(ReplayHistory, { onOpen() {} }), { "/replay?limit=20": fx.list });
    const t = text(html);
    assert.match(t, /История/);
    assert.equal(count(html, "<li"), fx.list.sessions.length);
    assert.match(html, /aria-label="Преглед на сесия 1 \(BTC\/USDT\)"/);
    assert.match(t, /grade C/);
  });

  test("stats card: average ring, best score, accuracy, common flags → lessons", () => {
    const html = render(h(ReplayStatsCard, {}), { "/replay/stats": fx.stats });
    const t = text(html);
    assert.match(html, /Replay средно: 58 от 100/);
    assert.match(t, /66/);
    assert.match(t, /25%/);
    assert.match(html, /href="\/learn\/trend-continuation"/);
  });

  test("score ring without a score", () => {
    const html = render(h(ScoreRing, { score: null }));
    assert.match(html, /още няма оценка/);
    assert.match(text(html), /—/);
  });
});
