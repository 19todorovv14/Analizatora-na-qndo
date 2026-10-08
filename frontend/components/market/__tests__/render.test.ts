/*
 * Server-render tests of the markets components (react-dom/server + SWR fallback data recorded from the
 * real backend). They pin the public contract other packages use (props, links, roles, DATA NOT
 * AVAILABLE handling) and the pages' key anchors.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig, unstable_serialize } from "swr";

import { AiAnalysisBody, AiAnalysisCard } from "../asset/AiAnalysisCard";
import { AboutCard, EducationCard, KeyStatsCard, RelatedAssets } from "../asset/AssetSections";
import { AssetView } from "../asset/AssetView";
import { AssetSearchCombobox } from "../AssetSearchCombobox";
import { ClassBadge, ClassIcon } from "../ClassBadge";
import { CatalogBrowser, catalogKey } from "../explorer/CatalogBrowser";
import { MarketsExplorer } from "../explorer/MarketsExplorer";
import { Heatmap } from "../Heatmap";
import { MarketMovers } from "../MarketMovers";
import { MarketStatusDot } from "../MarketStatusDot";
import { MarketTable } from "../MarketTable";
import { FavoriteButton, WatchlistButton } from "../MembershipButtons";
import { CATEGORY_TABS, TAB_BY_KEY, listKey } from "../model";
import { EventExplainButton, ExplainSections, explainParagraphs } from "../NewsExplain";
import { NewsPanel, howToSteps, relevantEvents } from "../NewsPanel";
import { AiStatusBadge, ChangeCell, PriceCell, QuoteStatusChip, TrendBadge, VolumeCell } from "../QuoteCells";
import { QuoteList } from "../QuoteList";
import type { CalendarPayload, MarketList, NewsPayload, Quote, WatchlistPayload, WatchlistRow } from "../types";
import { WatchlistPage } from "../watchlist/WatchlistPage";
import { WatchlistPanel, watchlistKey } from "../WatchlistPanel";
import {
  aaplAnalysis,
  btcAnalysis,
  btcAsset,
  catalogPage,
  cryptoHeatmap,
  earningsExplain,
  gainersList,
  quotes,
  volumeList,
  watchlist,
} from "./fixtures";
import { SETUP_DISCLAIMER } from "@/components/ai/model";
import { ApiError, api, errorReason, isDataNotAvailable } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {}, hmrRefresh() {} };

function render(el: ReactElement, fallback: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router as never }, h(SWRConfig, { value: { fallback, provider: () => new Map() } }, el)),
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

const FORBIDDEN = [/BUY NOW/i, /SELL NOW/i, /guaranteed profit/i, /risk[- ]free/i, /easy money/i, /100% win/i, /сигурна печалба/i];
const assertSafe = (s: string) => FORBIDDEN.forEach((re) => assert.doesNotMatch(s, re));

const okQuote = gainersList.items[0].quote as Quote;
const naQuote: Quote = { ...okQuote, status: "unavailable", available: false, code: "DATA_NOT_AVAILABLE", reason: "DATA NOT AVAILABLE: no provider", price: null, change_24h_pct: null, sparkline: [] };
const unavailableList: MarketList = {
  ...gainersList,
  available: false,
  status: "unavailable",
  items: [],
  total: 0,
  pages: 0,
  code: "PLAN_LIMIT",
  reason: "The configured provider plan cannot compute this list",
  note: null,
};

describe("quote cells", () => {
  test("ok quote → numbers; unavailable → N/A with the reason, never a number", () => {
    const ok = text(render(h(PriceCell, { quote: okQuote })));
    assert.match(ok, /\d/);
    const na = render(h(PriceCell, { quote: naQuote }));
    assert.match(text(na), /N\/A/);
    assert.match(na, /title="DATA NOT AVAILABLE — no provider"/);
    assert.doesNotMatch(text(na), /\d/);
    assert.match(text(render(h(ChangeCell, { quote: naQuote }))), /—/);
    assert.match(text(render(h(VolumeCell, { quote: naQuote }))), /—/);
  });

  test("pending and on-demand statuses have their own chips", () => {
    assert.match(text(render(h(QuoteStatusChip, { quote: { ...naQuote, status: "pending" } }))), /Зарежда се/);
    assert.match(text(render(h(QuoteStatusChip, { quote: { ...naQuote, status: "on_demand" } }))), /On demand/);
    assert.equal(render(h(QuoteStatusChip, { quote: okQuote })), "");
  });

  test("trend and AI status badges", () => {
    assert.match(text(render(h(TrendBadge, { trend: "up" }))), /Uptrend/);
    assert.match(text(render(h(TrendBadge, { trend: null }))), /—/);
    assert.match(text(render(h(AiStatusBadge, { status: "SHORT SETUP" }))), /SHORT SETUP/);
    assert.match(text(render(h(AiStatusBadge, { status: null, pending: true }))), /AI…/);
  });

  test("class badge / icon / market status dot", () => {
    assert.match(text(render(h(ClassBadge, { cls: "etf" }))), /ETF/);
    assert.match(render(h(ClassIcon, { cls: "crypto" })), /<svg/);
    const open = render(h(MarketStatusDot, { status: btcAsset.market_status, showLabel: true }));
    assert.match(text(open), /Отворен/);
    assert.match(open, /title="Пазар: /);
    assert.match(text(render(h(MarketStatusDot, { status: "closed" }))), /Затворен/);
    assert.equal(render(h(MarketStatusDot, { status: "weird" })), "");
  });
});

describe("QuoteList / MarketMovers", () => {
  test("rows link to the asset page with change pills", () => {
    const out = render(h(QuoteList, { items: gainersList.items, kind: "gainers" }));
    for (const it of gainersList.items) assert.ok(out.includes(`href="/markets/${it.slug}"`), it.slug);
    assert.equal((text(out).match(/\+\d+\.\d\d%/g) ?? []).length, gainersList.items.length);
  });

  test("onSelect turns rows into buttons (terminal usage)", () => {
    const out = render(h(QuoteList, { items: gainersList.items, onSelect: () => {}, activeSymbol: gainersList.items[0].symbol }));
    assert.doesNotMatch(out, /href="\/markets\//);
    assert.match(out, /aria-current="true"/);
  });

  test("movers card renders the API list with title, source and pager", () => {
    const key = listKey("gainers", { pageSize: 3 });
    const out = render(h(MarketMovers, { kind: "gainers", limit: 3 }), { [key]: gainersList });
    const t = text(out);
    assert.match(t, /Top gainers/);
    assert.match(t, /DEMO/);
    assert.match(t, new RegExp(`1/${gainersList.pages}`));
    assert.ok(out.includes(`href="/markets/${gainersList.items[0].slug}"`));
  });

  test("most volume shows the USD volume as the row metric", () => {
    const key = listKey("most_volume", { pageSize: 3 });
    const t = text(render(h(MarketMovers, { kind: "most_volume", limit: 3 }), { [key]: volumeList }));
    assert.match(t, /\$\d+(\.\d+)?[KMBT]/);
  });

  test("a list the provider cannot compute → DATA NOT AVAILABLE with the reason", () => {
    const key = listKey("losers", { assetClass: "stock", pageSize: 5 });
    const t = text(render(h(MarketMovers, { kind: "losers", assetClass: "stock", limit: 5 }), { [key]: { ...unavailableList, kind: "losers", asset_class: "stock", category: null } }));
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /cannot compute this list/);
  });

  test("warming lists show a calm loading note", () => {
    const key = listKey("trending", { pageSize: 6 });
    const t = text(render(h(MarketMovers, { kind: "trending" }), { [key]: { ...unavailableList, kind: "trending", status: "warming", code: "WARMING" } }));
    assert.match(t, /warm-up/);
  });

  test("compact mode: no pager / sparklines", () => {
    const key = listKey("gainers", { pageSize: 3 });
    const out = render(h(MarketMovers, { kind: "gainers", limit: 3, compact: true }), { [key]: gainersList });
    assert.doesNotMatch(out, /Следваща страница/);
    assert.doesNotMatch(out, /<polyline/);
  });
});

describe("Heatmap", () => {
  test("legend labels the size basis honestly and shows the note + source", () => {
    const t = text(render(h(Heatmap, { assetClass: "crypto" }), { "/markets/heatmap?asset_class=crypto": cryptoHeatmap }));
    assert.match(t, /Размер: 24h volume \(USD\)/);
    assert.match(t, /Market cap: DATA NOT AVAILABLE/);
    assert.match(t, /DEMO/);
  });

  test("market cap basis is labelled when a real provider supplies it", () => {
    const capped = { ...cryptoHeatmap, size_basis: "market_cap" as const, note: null };
    assert.match(text(render(h(Heatmap, { assetClass: "crypto" }), { "/markets/heatmap?asset_class=crypto": capped })), /Размер: market cap/);
  });

  test("unavailable heatmap → DATA NOT AVAILABLE", () => {
    const na = { ...cryptoHeatmap, asset_class: "stock", available: false, tiles: [], reason: "DATA NOT AVAILABLE: plan limit", code: "PLAN_LIMIT" };
    const t = text(render(h(Heatmap, { assetClass: "stock" }), { "/markets/heatmap?asset_class=stock": na }));
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /plan limit/);
    assert.doesNotMatch(t, /DATA NOT AVAILABLE plan limit DATA NOT AVAILABLE/);
  });
});

describe("MarketTable", () => {
  const rows = watchlist.items;

  test("table roles, default columns and links", () => {
    const out = render(h(MarketTable, { rows }));
    assert.match(out, /role="table"/);
    assert.equal((out.match(/role="row"/g) ?? []).length, rows.length + 1);
    for (const r of rows) assert.ok(out.includes(`href="/markets/${r.slug}"`));
    const t = text(out);
    ["Инструмент", "Цена", "24h", "7d", "Volume 24h", "Range 24h", "Trend", "Данни"].forEach((hd) => assert.ok(t.includes(hd), hd));
  });

  test("sortable headers expose aria-sort", () => {
    const out = render(h(MarketTable, { rows, sort: { key: "change", dir: "desc" }, onSort: () => {} }));
    assert.match(out, /aria-sort="descending"/);
    assert.match(out, /aria-sort="none"/);
  });

  test("custom columns and the empty state", () => {
    const out = render(h(MarketTable, { rows, columns: ["symbol", { key: "x", header: "Custom", width: "60px", render: (r) => `#${(r as WatchlistRow).position}` }] }));
    assert.match(text(out), /Custom/);
    assert.match(text(out), /#0/);
    assert.match(text(render(h(MarketTable, { rows: [], empty: "Нищо тук" }))), /Нищо тук/);
  });

  test("a row whose instrument has no provider shows N/A, not numbers", () => {
    const t = text(render(h(MarketTable, { rows: [{ ...rows[0], available: false, unavailable_reason: "no provider", quote: naQuote }], columns: ["symbol", "price", "source"] })));
    assert.match(t, /N\/A/);
  });
});

describe("WatchlistPanel", () => {
  const key = watchlistKey(1, 100);

  test("rows with price, change and AI status; no 'Watchlist' heading of its own", () => {
    const out = render(h(WatchlistPanel, {}), { [key]: watchlist });
    const t = text(out);
    for (const r of watchlist.items) assert.ok(t.includes(r.symbol));
    assert.match(t, /NO TRADE|WAIT|LONG SETUP|SHORT SETUP/);
    assert.match(t, /Пълен списък/);
    assert.doesNotMatch(out, /<h\d[^>]*>\s*Watchlist\s*</);
    assert.match(out, /href="\/markets\/BTC-USDT"/);
    assert.match(out, /role="combobox"/);
  });

  test("onSelect + activeSymbol (terminal right panel)", () => {
    const out = render(h(WatchlistPanel, { onSelect: () => {}, activeSymbol: "ETH/USDT", compact: true }), { [key]: watchlist });
    assert.doesNotMatch(out, /href="\/markets\/ETH-USDT"/);
    assert.match(out, /aria-current="true"/);
  });

  test("empty list offers 'Add popular assets'", () => {
    const empty: WatchlistPayload = { items: [], page: 1, page_size: 100, total: 0, pages: 0 };
    const t = text(render(h(WatchlistPanel, {}), { [key]: empty }));
    assert.match(t, /Watchlist-ът е празен/);
    assert.match(t, /Add popular assets/);
  });
});

describe("membership buttons", () => {
  const fb = { "/markets/membership": { watchlist: ["BTC/USDT"], favorites: ["AAPL"] } };

  test("state from /markets/membership", () => {
    const fav = render(h(FavoriteButton, { symbol: "AAPL" }), fb);
    assert.match(fav, /aria-pressed="true"/);
    assert.match(fav, /aria-label="Премахни от любими"/);
    const notFav = render(h(FavoriteButton, { symbol: "BTC/USDT" }), fb);
    assert.match(notFav, /aria-label="Добави в любими"/);
    assert.match(text(render(h(WatchlistButton, { symbol: "BTC/USDT" }), fb)), /В watchlist/);
    assert.match(text(render(h(WatchlistButton, { symbol: "AAPL" }), fb)), /Watchlist \+/);
  });

  test("before membership loads: `initial` decides, unknown → disabled", () => {
    assert.match(render(h(FavoriteButton, { symbol: "X", initial: true })), /aria-pressed="true"/);
    assert.match(render(h(WatchlistButton, { symbol: "X" })), /disabled=""/);
  });
});

describe("AssetSearchCombobox", () => {
  test("ARIA combobox showing the selected symbol (name from the search API)", () => {
    const fb = { "/market/search?q=BTC%2FUSDT&limit=8": { query: "btc/usdt", total: 1, results: [btcAsset.instrument] } };
    const out = render(h(AssetSearchCombobox, { value: "BTC/USDT", onChange: () => {} }), fb);
    assert.match(out, /role="combobox"/);
    assert.match(out, /aria-expanded="false"/);
    assert.match(out, /value="BTC\/USDT"/);
    assert.match(text(out), /Bitcoin/);
    assert.match(out, /w-56/, "default width when the class sets none");
  });

  test("clearOnSelect: empty field with its placeholder; custom width kept", () => {
    const out = render(h(AssetSearchCombobox, { value: "", onChange: () => {}, clearOnSelect: true, placeholder: "Добави…", className: "w-full" }));
    assert.match(out, /placeholder="Добави…"/);
    assert.match(out, /value=""/);
    assert.doesNotMatch(out, /w-56/);
  });
});

describe("news & events", () => {
  test("no provider → DATA NOT AVAILABLE + how to enable (3 steps)", () => {
    const t = text(render(h(NewsPanel, { news: btcAsset.news, asset: { symbol: "BTC/USDT", slug: "BTC-USDT", asset_class: "crypto", currency: "USDT" } })));
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /FINNHUB_API_KEY/);
    assert.match(t, /Как да включиш новините/);
    assert.equal(howToSteps(btcAsset.news.how_to_enable).length, 3);
  });

  test("with a provider: headlines, safe external links and the explain button", () => {
    const news: NewsPayload = {
      available: true,
      provider: "finnhub",
      scope: "category",
      category: "crypto",
      items: [{ id: 1, headline: "SEC reviews spot ETF filings", summary: "Regulators extended the review period.", source: "Reuters", url: "https://example.com/a", ts: 1_780_000_000, category: "crypto" }],
      disclaimer: "Новините са контекст, не trading сигнал.",
    };
    const out = render(h(NewsPanel, { news, asset: { symbol: "BTC/USDT", slug: "BTC-USDT", asset_class: "crypto", currency: "USDT" } }));
    const t = text(out);
    assert.match(t, /SEC reviews spot ETF filings/);
    assert.match(out, /rel="noopener noreferrer nofollow"/);
    assert.match(t, /What does this event mean\?/);
    assert.match(t, /не са специфични само за BTC\/USDT/);
  });

  test("calendar events relevant to the instrument", () => {
    const eco: CalendarPayload = {
      available: true,
      kind: "economic",
      items: [
        { event: "CPI m/m", country: "US", impact: "high" },
        { event: "BoJ rate", country: "JP", impact: "high" },
        { event: "ECB speech", country: "EU", impact: "low" },
      ],
    };
    assert.deepEqual(relevantEvents(eco, { symbol: "EUR/USD", slug: "EUR-USD", asset_class: "forex", currency: "USD" }).map((e) => ("event" in e ? e.event : "")), ["CPI m/m", "ECB speech"]);
    const earn: CalendarPayload = {
      available: true,
      kind: "earnings",
      items: [
        { date: "2026-10-09", symbol: "AAPL", slug: "AAPL", name: "Apple" },
        { date: "2026-10-09", symbol: "MSFT", slug: "MSFT", name: "Microsoft" },
      ],
    };
    assert.equal(relevantEvents(earn, { symbol: "AAPL", slug: "AAPL", asset_class: "stock", currency: "USD" }).length, 1);
    assert.deepEqual(relevantEvents({ ...earn, available: false }, { symbol: "AAPL", slug: "AAPL" }), []);
  });

  test("'What does this event mean?' sections: all five, no direction promise, safe wording", () => {
    const out = render(h(ExplainSections, { data: earningsExplain }));
    const t = text(out);
    ["event_type", "who_reacts", "volatility", "beginner_dont", "no_direction"].forEach((k) => assert.match(out, new RegExp(`data-section="${k}"`)));
    assert.match(t, /does not guarantee any price direction/);
    assert.ok(t.includes(earningsExplain.disclaimer));
    assertSafe(t);
    assert.match(text(render(h(EventExplainButton, { headline: "x" }))), /What does this event mean\?/);
    assert.deepEqual(explainParagraphs("a\n\n- b\n- c\n"), ["a", "- b", "- c"]);
  });
});

describe("asset page sections", () => {
  test("AI analysis: decision, regime, S/R, observations, disclaimer; no setup → no setup disclaimer", () => {
    const t = text(render(h(AiAnalysisBody, { analysis: btcAnalysis })));
    assert.match(t, /DECISION: NO TRADE/);
    assert.match(t, /OBSERVATION/);
    assert.match(t, /Support/);
    assert.match(t, /Resistance/);
    assert.ok(t.includes(btcAnalysis.disclaimer));
    assert.ok(!t.includes(SETUP_DISCLAIMER));
    assertSafe(t);
  });

  test("a rule-based setup always carries the exact hypothetical disclaimer", () => {
    const t = text(render(h(AiAnalysisBody, { analysis: aaplAnalysis })));
    assert.match(t, /Possible LONG setup/);
    assert.ok(t.includes(SETUP_DISCLAIMER));
    assert.ok((t.match(/• /g) ?? []).length <= 5, "at most five observation bullets");
  });

  test("AI analysis card (POST /ai/analyze via SWR) links to the AI Teacher", () => {
    const fb = { [unstable_serialize(["ai-analyze", "BTC/USDT", "1h"])]: { analysis: btcAnalysis } };
    const out = render(h(AiAnalysisCard, { symbol: "BTC/USDT" }), fb);
    assert.match(text(out), /AI analysis · 1H/);
    assert.match(out, /href="\/ai\?mode=analyze&amp;symbol=BTC%2FUSDT&amp;tf=1h"/);
    assert.match(text(render(h(AiAnalysisCard, { symbol: "X", enabled: false }))), /DATA NOT AVAILABLE/);
  });

  test("key stats: beginner vs advanced detail", () => {
    const beginner = text(render(h(KeyStatsCard, { data: btcAsset, advanced: false })));
    const advanced = text(render(h(KeyStatsCard, { data: btcAsset, advanced: true })));
    assert.match(beginner, /24h High/);
    assert.match(beginner, /Fees/);
    assert.doesNotMatch(beginner, /Min qty/);
    assert.match(advanced, /Min qty \/ step/);
    assert.match(advanced, /ATR 1h/);
  });

  test("key stats without a quote say DATA NOT AVAILABLE and show no market numbers", () => {
    const na = { ...btcAsset, quote: naQuote, volatility: { atr_pct_1d: null, atr_pct_1h: null, range_24h_pct: null } };
    const t = text(render(h(KeyStatsCard, { data: na, advanced: false })));
    assert.match(t, /DATA NOT AVAILABLE — no provider/);
    ["24h промяна —", "7d промяна —", "24h High —", "24h Low —", "Range 24h —", "ATR 1d —", "Volume 24h —", "Volume 24h (USD) —"].forEach((s) => assert.ok(t.includes(s), s));
  });

  test("about, education and related", () => {
    const about = text(render(h(AboutCard, { data: btcAsset, advanced: true })));
    assert.match(about, /Trading hours/);
    assert.match(about, /Binance/);
    const edu = render(h(EducationCard, { lessons: btcAsset.lessons }));
    for (const l of btcAsset.lessons) assert.ok(edu.includes(`href="${l.href}"`));
    const rel = render(h(RelatedAssets, { items: btcAsset.related }));
    for (const r of btcAsset.related) assert.ok(rel.includes(`href="/markets/${r.slug}"`));
    assert.equal(render(h(RelatedAssets, { items: [] })), "");
  });
});

describe("pages", () => {
  test("asset page: header, actions, chart, sections", () => {
    const out = render(h(SessionProvider, null, h(AssetView, { slug: "BTC-USDT" })), { "/markets/asset/BTC-USDT": btcAsset });
    const t = text(out);
    assert.match(t, /Bitcoin/);
    ["Open chart", "Paper trade", "Replay", "Ask AI", "Key stats", "News & events", "About", "Education", "Related assets", "24h High", "Regime 1D"].forEach((s) =>
      assert.ok(t.includes(s), s),
    );
    assert.match(out, /href="\/charts\?symbol=BTC%2FUSDT"/);
    assert.match(out, /href="\/trade\?symbol=BTC%2FUSDT"/);
    assert.match(out, /href="\/replay\?symbol=BTC%2FUSDT"/);
    assert.match(out, /href="\/ai\?symbol=BTC%2FUSDT"/);
    assert.match(out, /href="\/markets\?class=crypto"/);
  });

  test("asset page for an instrument without a provider: DATA NOT AVAILABLE instead of the chart", () => {
    const na = { ...btcAsset, available: false, code: "DATA_NOT_AVAILABLE", reason: "DATA NOT AVAILABLE: no configured provider", quote: naQuote };
    const t = text(render(h(SessionProvider, null, h(AssetView, { slug: "BTC-USDT" })), { "/markets/asset/BTC-USDT": na }));
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /no configured provider/);
    assert.doesNotMatch(t, /Indicators/, "no chart workspace");
  });

  test("explorer: search, ten category tabs, cards and catalog", () => {
    const fb = {
      "/market/catalog?page_size=1": catalogPage,
      [listKey("gainers", { pageSize: 5 })]: gainersList,
      [catalogKey(TAB_BY_KEY.all, { q: "", category: "", sector: "", sort: "", page: 1 })]: catalogPage,
      [`/markets/quotes?symbols=${catalogPage.items.map((i) => encodeURIComponent(i.symbol)).join(",")}`]: quotes,
    };
    const out = render(h(MarketsExplorer), fb);
    const t = text(out);
    CATEGORY_TABS.forEach((tab) => assert.ok(t.includes(tab.label), tab.label));
    ["Favorites", "Recently viewed", "Popular", "Top gainers", "Top losers", "Most volume", "High volatility", "Low volatility", "Trending", "Heatmap", "Всички инструменти"].forEach((s) =>
      assert.ok(t.includes(s), s),
    );
    assert.match(out, /aria-label="Търси инструмент на пазара"/);
    assert.match(t, new RegExp(`${catalogPage.total} инструмента`));
  });

  test("catalog: page of the active tab with filters and pager", () => {
    const key = catalogKey(TAB_BY_KEY.crypto, { q: "", category: "", sector: "", sort: "", page: 1 });
    assert.equal(key, "/market/catalog?asset_class=crypto&page=1&page_size=50");
    assert.equal(
      catalogKey(TAB_BY_KEY.metal, { q: "gold", category: "ignored", sector: "", sort: "name", page: 2 }),
      "/market/catalog?asset_class=commodity&category=metal&q=gold&sort=name&page=2&page_size=50",
    );
    const t = text(render(h(CatalogBrowser, { tab: TAB_BY_KEY.all }), { [catalogKey(TAB_BY_KEY.all, { q: "", category: "", sector: "", sort: "", page: 1 })]: catalogPage }));
    assert.match(t, /Всички категории/);
    assert.match(t, /Всички сектори/);
    assert.match(t, new RegExp(`1–${catalogPage.items.length} от ${catalogPage.total}`));
  });

  test("watchlist page: sortable table with AI status, remove buttons and add search", () => {
    const out = render(h(WatchlistPage), { [watchlistKey(1, 100)]: watchlist });
    const t = text(out);
    assert.match(t, /Watchlist/);
    ["Change", "Volume 24h", "Volatility", "Trend", "Regime", "AI status"].forEach((s) => assert.ok(t.includes(s), s));
    assert.equal((out.match(/aria-label="Премахни /g) ?? []).length, watchlist.items.length);
    assert.match(out, /aria-label="Добави инструмент в watchlist"/);
    assert.match(out, /aria-sort="none"/);
  });

  test("empty watchlist page: quick 'Add popular assets'", () => {
    const t = text(render(h(WatchlistPage), { [watchlistKey(1, 100)]: { items: [], page: 1, page_size: 100, total: 0, pages: 0 } }));
    assert.match(t, /Add popular assets/);
    assert.match(t, /BTC\/USDT/);
  });
});

describe("lib/api ApiError (additive code / data)", () => {
  test("constructor exposes code + data; message/status unchanged", () => {
    const e = new ApiError(503, "DATA NOT AVAILABLE", { detail: "DATA NOT AVAILABLE", code: "DATA_NOT_AVAILABLE", reason: "no provider", symbol: "X" });
    assert.equal(e.status, 503);
    assert.equal(e.message, "DATA NOT AVAILABLE");
    assert.equal(e.code, "DATA_NOT_AVAILABLE");
    assert.ok(isDataNotAvailable(e));
    assert.equal(errorReason(e), "no provider");
    const plain = new ApiError(404, "Not found");
    assert.equal(plain.code, null);
    assert.equal(plain.data, null);
    assert.ok(!isDataNotAvailable(plain));
    assert.equal(errorReason(plain), "Not found");
    assert.ok(!isDataNotAvailable(new Error("x")));
  });

  test("api() parses the 503 body into code / data", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "Няма данни", code: "DATA_NOT_AVAILABLE", reason: "no provider", symbol: "X" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await assert.rejects(api("/market/candles?symbol=X"), (e: unknown) => {
        assert.ok(e instanceof ApiError);
        assert.equal(e.status, 503);
        assert.equal(e.message, "Няма данни");
        assert.equal(e.code, "DATA_NOT_AVAILABLE");
        assert.deepEqual(e.data, { detail: "Няма данни", code: "DATA_NOT_AVAILABLE", reason: "no provider", symbol: "X" });
        return true;
      });
      globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;
      await assert.rejects(api("/x"), (e: unknown) => e instanceof ApiError && e.code === null && e.message === "Bad Gateway" && e.data === null);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
