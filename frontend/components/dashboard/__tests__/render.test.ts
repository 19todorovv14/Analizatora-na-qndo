/*
 * Server-render tests of the S7 pages with SWR fallback data recorded from the real backend: page
 * anchors the e2e walkthrough relies on, empty / error states, DATA NOT AVAILABLE handling and "no
 * secrets on the settings pages".
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";

import { CoachReview } from "@/components/analytics/CoachReview";
import { BreakdownTable, MonthlyReturns, RHistogram } from "@/components/analytics/PerformanceParts";
import { PerformanceView, performanceKey } from "@/components/analytics/PerformanceView";
import { ExposureBreakdown, RiskRulesEditor, RiskStatusSummary, validateRules } from "@/components/analytics/RiskPanels";
import { StatsView } from "@/components/analytics/StatsView";
import type { Coach, Performance, RiskStatus } from "@/components/analytics/types";
import { CommandCenter, DASHBOARD_KEY } from "@/components/dashboard/CommandCenter";
import { InsightsCard, MarketOverviewCard } from "@/components/dashboard/sections";
import { AiSettingsView } from "@/components/dashboard/settings/AiSettingsView";
import { DataSourcesView } from "@/components/dashboard/settings/DataSourcesView";
import type { DashboardData } from "@/components/dashboard/types";
import { AiReviewView } from "@/components/journal/AiReviewPanel";
import { JournalForm } from "@/components/journal/JournalForm";
import { JournalTable } from "@/components/journal/JournalTable";
import type { JournalAiReview, JournalEntry } from "@/components/journal/model";
import { SessionProvider } from "@/lib/session";

import fixtures from "./fixtures.json" with { type: "json" };

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {}, hmrRefresh() {} };

function render(el: ReactElement, fallback: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    h(
      AppRouterContext.Provider,
      { value: router as never },
      h(SWRConfig, { value: { fallback, provider: () => new Map() } }, h(SessionProvider, null, el)),
    ),
  );
}
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const count = (hay: string, needle: RegExp) => (hay.match(needle) ?? []).length;

const dash = fixtures.dashboard as unknown as DashboardData;
const perf = fixtures.performance as unknown as Performance;
const coach = fixtures.coach as unknown as Coach;
const risk = fixtures.risk as unknown as RiskStatus;

describe("dashboard (TRADING COMMAND CENTER)", () => {
  const html = render(h(CommandCenter), { [DASHBOARD_KEY]: dash });
  const t = text(html);

  test("exactly one heading named Watchlist (e2e anchor) and the main sections", () => {
    const headings = [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/g)].map((m) => text(m[1]).trim());
    assert.equal(headings.filter((x) => /watchlist/i.test(x)).length, 1);
    assert.ok(headings.includes("Watchlist"));
    for (const s of ["Market overview", "AI market insights", "Risk status", "Learning progress", "Recent trades", "Bot status"]) {
      assert.ok(t.includes(s), s);
    }
  });

  test("greeting, paper account and LEARN-mode primary CTA", () => {
    assert.match(t, /(Добро утро|Добър ден|Добър вечер), Guest/);
    assert.ok(t.includes("Paper account"));
    assert.ok(t.includes("Free margin") && t.includes("Used margin"));
    assert.ok(html.includes(`href="${dash.learning.next?.href}"`));
    assert.ok(t.includes("Продължи обучението"));
  });

  test("market overview: class tiles link to markets, heatmap link", () => {
    assert.ok(html.includes('href="/markets?asset_class=crypto"'));
    assert.ok(html.includes('href="/markets?view=heatmap"'));
    assert.ok(t.includes("Gainers") && t.includes("Losers"));
  });

  test("unavailable class / no movers → DATA NOT AVAILABLE, no numbers invented", () => {
    const market = structuredClone(dash.market!);
    market.classes[0] = { ...market.classes[0], available: false, code: "DATA_NOT_AVAILABLE", reason: "Няма доставчик", ranked: 0, top_mover: null };
    market.movers.gainers = [];
    const m = text(render(h(MarketOverviewCard, { market })));
    assert.ok(m.includes("DATA NOT AVAILABLE"));
    assert.ok(m.includes("Няма доставчик"));
  });

  test("insights carry Why? buttons and an unavailable market insight shows DATA NOT AVAILABLE", () => {
    const ins = text(render(h(InsightsCard, { insights: dash.ai_insights })));
    assert.ok(count(ins, /Защо\?/g) >= 2);
    const off = text(render(h(InsightsCard, { insights: [{ kind: "market", title: "BTC/USDT 4H: DATA NOT AVAILABLE", text: "Няма данни", available: false }] })));
    assert.ok(off.includes("DATA NOT AVAILABLE"));
    const none = text(render(h(InsightsCard, { insights: [] })));
    assert.ok(none.includes("Още няма insights"));
  });

  test("loading → skeleton, not data", () => {
    const loading = render(h(CommandCenter));
    assert.ok(loading.includes('aria-busy="true"'));
    assert.ok(!text(loading).includes("Market overview"));
  });

  test("new user: empty trades → first paper trade CTA", () => {
    const fresh = text(render(h(CommandCenter), { [DASHBOARD_KEY]: { ...dash, recent_trades: [], open_positions: [], bots: [] } }));
    assert.ok(fresh.includes("Още няма затворени сделки"));
    assert.ok(fresh.includes("Първа paper сделка"));
    assert.ok(fresh.includes("Нямаш paper ботове"));
  });
});

describe("statistics + AI coach", () => {
  test("WEEKLY REVIEW appears exactly once with findings, next lesson and practice exercise", () => {
    const t = text(render(h(CoachReview, { coach })));
    assert.equal(count(t, /WEEKLY REVIEW/gi), 1);
    assert.ok(t.includes(coach.findings![0].title));
    assert.ok(t.includes("Next lesson") && t.includes(coach.next_lesson!.title));
    assert.ok(t.includes("Practice exercise") && t.includes(coach.practice_exercise!.title));
    assert.ok(t.includes("Какво провери Coach-ът"));
  });

  test("stats page renders the report and the coach", () => {
    const t = text(render(h(StatsView), { "/stats/report": fixtures.report, "/ai/coach": coach, "/ai/reviews": { reviews: [] } }));
    assert.equal(count(t, /WEEKLY REVIEW/gi), 1);
    assert.ok(t.includes("Behaviour & psychology"));
    assert.ok(t.includes("Discipline score"));
    assert.ok(t.includes("1.34"));
  });

  test("stats page without trades shows the empty state and still the coach card", () => {
    const empty = { ...fixtures.report, metrics: { ...fixtures.report.metrics, total_trades: 0 } };
    const t = text(render(h(StatsView), { "/stats/report": empty, "/ai/coach": coach }));
    assert.ok(t.includes("Още няма затворени paper сделки"));
    assert.equal(count(t, /WEEKLY REVIEW/gi), 1);
  });
});

describe("performance", () => {
  test("KPIs, curves card, breakdowns, monthly table, R histogram", () => {
    const t = text(render(h(PerformanceView), { [performanceKey("manual")]: perf }));
    for (const s of ["Equity & drawdown", "Разбивки", "Месечни резултати", "R distribution", "Най-добри сделки", "Най-лоши сделки", "Доверие в числата"]) {
      assert.ok(t.includes(s), s);
    }
    assert.ok(t.includes("Много малка извадка"));
  });

  test("empty performance → empty state with CTAs", () => {
    const t = text(render(h(PerformanceView), { [performanceKey("manual")]: { ...perf, positions: 0 } }));
    assert.ok(t.includes("Още няма затворени paper сделки"));
    assert.ok(t.includes("Market Replay"));
  });

  test("breakdown flags small groups and shows ∞ for PF without losers", () => {
    const t = text(render(h(BreakdownTable, { rows: perf.breakdowns.timeframe!, minTrades: 5 })));
    assert.ok(t.includes("малко"));
    assert.ok(t.includes("∞"));
  });

  test("monthly returns has 12 month columns; histogram labels buckets", () => {
    const html = render(h(MonthlyReturns, { rows: perf.monthly_returns }));
    assert.equal(count(html, /<th[\s>]/g), 14);
    const hist = text(render(h(RHistogram, { dist: perf.r_distribution })));
    assert.ok(hist.includes("<-2"));
    assert.ok(hist.includes("Median"));
  });
});

describe("risk", () => {
  test("status summary and exposure empty state", () => {
    const t = text(render(h(RiskStatusSummary, { st: risk })));
    assert.ok(t.includes("В рамките на правилата"));
    assert.ok(t.includes("Отворени позиции"));
    const ex = text(render(h(ExposureBreakdown, { st: risk })));
    assert.ok(ex.includes("Няма отворена експозиция"));
    const withExp = text(
      render(
        h(ExposureBreakdown, {
          st: { ...risk, exposure_breakdown: { by_class: [{ asset_class: "crypto", label: "Крипто", notional: 5000, pct_of_equity: 50 }], by_symbol: [{ symbol: "BTC/USDT", side: "long", notional: 5000, pct_of_equity: 50 }] } },
        }),
      ),
    );
    assert.ok(withExp.includes("Крипто") && withExp.includes("BTC/USDT") && withExp.includes("50.0%"));
  });

  test("rules editor renders every rule; validation catches bad values", () => {
    const t = text(render(h(RiskRulesEditor, { rules: risk.rules })));
    assert.ok(t.includes("Max risk per trade") && t.includes("Min reward : risk") && t.includes("Запази правилата"));
    const ok = { max_risk_per_trade_pct: "1", warn_risk_pct: "5", max_daily_loss_pct: "3", max_open_positions: "3", max_portfolio_exposure_pct: "300", min_reward_risk: "1.5" };
    assert.deepEqual(validateRules(ok), {});
    assert.ok(validateRules({ ...ok, max_open_positions: "2.5" }).max_open_positions);
    assert.ok(validateRules({ ...ok, warn_risk_pct: "0.5" }).warn_risk_pct);
    assert.ok(validateRules({ ...ok, max_daily_loss_pct: "" }).max_daily_loss_pct);
  });
});

describe("journal", () => {
  const entries = fixtures.journal.entries as unknown as JournalEntry[];

  test("table columns and AI review button", () => {
    const t = text(render(h(JournalTable, { entries, onEdit() {}, onDelete() {}, onUpdated() {}, onOpenShot() {} })));
    for (const s of ["Entry → Exit", "Stop / Target", "Risk", "Result", "AI review", "EMA pullback", "Grade C"]) assert.ok(t.includes(s), s);
  });

  test("AI review view: grade, process score, lessons, disclaimer", () => {
    const review = fixtures.tradeReview.ai_review as unknown as JournalAiReview;
    const t = text(render(h(AiReviewView, { review })));
    assert.ok(t.includes(review.title));
    assert.ok(t.includes("Process score"));
    assert.ok(t.includes(review.lesson_refs[0].title));
  });

  test("form keeps its anchors: first textarea is Reason, submit reads 'Добави в журнала'", () => {
    const html = render(h(JournalForm, {}));
    const firstArea = html.indexOf("<textarea");
    assert.ok(firstArea > 0);
    assert.ok(html.lastIndexOf("Reason", firstArea) > html.lastIndexOf("Notes", firstArea));
    assert.ok(text(html).includes("Добави в журнала"));
    for (const s of ["Strategy", "Exit", "Risk ($)", "Notes", "Planned R:R"]) assert.ok(text(html).includes(s), s);
    const edit = text(render(h(JournalForm, { initial: { ...entries[0] } })));
    assert.ok(edit.includes("Запази промените"));
  });
});

describe("settings pages", () => {
  test("data sources: classes, providers, key presence only — never key values", () => {
    const html = render(h(DataSourcesView), { "/system/data-sources": fixtures.sources });
    const t = text(html);
    assert.ok(t.includes("Data Sources"));
    assert.ok(t.includes("MARKET_DATA_CRYPTO=demo"));
    assert.ok(t.includes("TWELVEDATA_API_KEY"));
    assert.ok(t.includes("Ключовете живеят само в сървъра"));
    assert.equal(count(html, /<input[^>]*type="password"/g), 0);
    assert.equal(count(html, /<input/g), 0);
  });

  test("AI settings: provider, safety rules, explain toggle and no key inputs", () => {
    const html = render(h(AiSettingsView), { "/system/ai": fixtures.ai, "/settings": fixtures.settings });
    const t = text(html);
    assert.ok(t.includes("AI Settings") && t.includes("Offline fallback") && t.includes("Предпазни правила"));
    assert.equal(count(html, /role="switch"/g), 1);
    for (const r of fixtures.ai.safety_rules) assert.ok(t.includes(r.title), r.title);
    assert.ok(!/<input[^>]*type="(text|password)"/.test(html));
  });
});
