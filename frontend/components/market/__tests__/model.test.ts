/* Unit tests for the pure markets helpers (components/market/model.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CATEGORY_TABS,
  LIST_KINDS,
  LIST_META,
  TAB_BY_KEY,
  aiStatusTone,
  assetHref,
  askAiHref,
  chartHref,
  chunk,
  cleanReason,
  decisionTone,
  fmtCompact,
  fmtCountdown,
  fmtPctPlain,
  fmtPctSigned,
  fmtQuotePrice,
  fmtUsdCompact,
  hasWidthClass,
  inTab,
  isListKind,
  isTabKey,
  listKey,
  listMatches,
  listMetricText,
  nextSort,
  pricePrecision,
  quoteOk,
  quoteState,
  quotesKey,
  relevantCountries,
  replayHref,
  slugFor,
  sortRows,
  splitPickerClass,
  tabCount,
  timeAgo,
  tradeHref,
  trendMeta,
} from "../model";
import type { Quote, WatchlistRow } from "../types";
import { catalogPage, gainersList, quotes, volumeList, watchlist } from "./fixtures";

const okQuote = gainersList.items[0].quote as Quote;
const naQuote: Quote = { ...okQuote, status: "unavailable", available: false, code: "DATA_NOT_AVAILABLE", reason: "DATA NOT AVAILABLE: no provider", price: null };

describe("links & slugs", () => {
  test("slugFor mirrors backend slug_for()", () => {
    assert.equal(slugFor("BTC/USDT"), "BTC-USDT");
    assert.equal(slugFor(" eur/usd "), "EUR-USD");
    assert.equal(slugFor("BRK B"), "BRK_B");
    assert.equal(slugFor("A&B/C"), "A_B-C");
    assert.equal(slugFor("XAU/USD/X"), "XAU-USD-X");
  });

  test("assetHref uses the slug when present, otherwise derives it", () => {
    assert.equal(assetHref({ symbol: "BTC/USDT", slug: "BTC-USDT" }), "/markets/BTC-USDT");
    assert.equal(assetHref({ symbol: "EUR/USD" }), "/markets/EUR-USD");
    assert.equal(assetHref("ETH/USDT"), "/markets/ETH-USDT");
  });

  test("action links carry the encoded symbol", () => {
    assert.equal(chartHref("BTC/USDT"), "/charts?symbol=BTC%2FUSDT");
    assert.equal(tradeHref("AAPL"), "/trade?symbol=AAPL");
    assert.equal(replayHref("EUR/USD"), "/replay?symbol=EUR%2FUSD");
    assert.equal(askAiHref("XAU/USD"), "/ai?symbol=XAU%2FUSD");
  });
});

describe("category tabs", () => {
  test("all ten tabs from the spec, in order", () => {
    assert.deepEqual(
      CATEGORY_TABS.map((t) => t.label),
      ["All", "Crypto", "Stocks", "ETFs", "Forex", "Indices", "Commodities", "Metals", "Energy", "Agriculture"],
    );
    assert.ok(isTabKey("metal") && !isTabKey("bonds") && !isTabKey(3));
  });

  test("commodity sub-categories filter the catalog by class + category and use the list alias", () => {
    const metal = TAB_BY_KEY.metal;
    assert.deepEqual(metal.filter, { asset_class: "commodity", category: "metal" });
    assert.equal(metal.listClass, "metal");
    assert.equal(metal.heatmap, null);
    assert.equal(TAB_BY_KEY.stock.heatmap, "stock");
    assert.equal(TAB_BY_KEY.all.listClass, null);
  });

  test("tab counts come from the unfiltered facets", () => {
    const f = catalogPage.facets;
    assert.equal(tabCount(TAB_BY_KEY.all, f, catalogPage.total), catalogPage.total);
    assert.equal(tabCount(TAB_BY_KEY.crypto, f), f.asset_class?.crypto);
    assert.equal(tabCount(TAB_BY_KEY.metal, f), f.category?.metal);
    assert.equal(tabCount(TAB_BY_KEY.all, undefined), null);
    assert.equal(tabCount(TAB_BY_KEY.forex, { asset_class: {} }), 0);
    // without a total, "All" sums the classes
    assert.equal(tabCount(TAB_BY_KEY.all, { asset_class: { crypto: 2, stock: 3 } }), 5);
  });

  test("inTab filters favorites / recent client-side", () => {
    assert.ok(inTab({ asset_class: "commodity", category: "metal" }, TAB_BY_KEY.metal));
    assert.ok(!inTab({ asset_class: "commodity", category: "energy" }, TAB_BY_KEY.metal));
    assert.ok(inTab({ asset_class: "crypto", category: "layer1" }, TAB_BY_KEY.all));
    assert.ok(!inTab({ asset_class: "stock" }, TAB_BY_KEY.crypto));
  });
});

describe("number formatting", () => {
  test("compact numbers", () => {
    assert.equal(fmtCompact(31_791_898_723.48), "31.79B");
    assert.equal(fmtCompact(2_500_000_000_000), "2.50T");
    assert.equal(fmtCompact(12_500), "12.5K");
    assert.equal(fmtCompact(950), "950");
    assert.equal(fmtCompact(0.000123), "0.000123");
    assert.equal(fmtCompact(-4_200_000), "-4.20M");
    assert.equal(fmtCompact(null), "—");
    assert.equal(fmtCompact(Number.NaN), "—");
    assert.equal(fmtUsdCompact(1_234_567), "$1.23M");
    assert.equal(fmtUsdCompact(undefined), "—");
  });

  test("percent formats", () => {
    assert.equal(fmtPctSigned(1.273), "+1.27%");
    assert.equal(fmtPctSigned(-0.004), "0.00%");
    assert.equal(fmtPctSigned(-2.5, 1), "-2.5%");
    assert.equal(fmtPctSigned(null), "—");
    assert.equal(fmtPctPlain(6.391), "6.39%");
    assert.equal(fmtPctPlain(undefined), "—");
  });

  test("prices use the instrument precision (quote → summary → 2)", () => {
    assert.equal(fmtQuotePrice(105768.77, 2), "105,768.77");
    assert.equal(fmtQuotePrice(1.11089, 5), "1.11089");
    assert.equal(fmtQuotePrice(null, 2), "—");
    assert.equal(pricePrecision({ quote: { ...okQuote, precision: 5 }, price_precision: 2 }), 5);
    assert.equal(pricePrecision({ quote: null, price_precision: 4 }), 4);
    assert.equal(pricePrecision(undefined), 2);
    assert.equal(pricePrecision({ price_precision: 99 }), 10);
  });
});

describe("quotes", () => {
  test("only status ok counts as a quote with values", () => {
    assert.ok(quoteOk(okQuote));
    assert.ok(!quoteOk(naQuote));
    assert.ok(!quoteOk(null));
    assert.ok(!quoteOk({ ...okQuote, available: false }));
  });

  test("quoteState labels every non-ok status and never invents values", () => {
    assert.equal(quoteState(okQuote).kind, "ok");
    assert.equal(quoteState(undefined).kind, "missing");
    const na = quoteState(naQuote);
    assert.equal(na.label, "N/A");
    assert.equal(na.detail, "no provider", "the DATA NOT AVAILABLE prefix is not repeated");
    assert.equal(quoteState({ ...naQuote, status: "pending", reason: null }).label, "Зарежда се…");
    assert.equal(quoteState({ ...naQuote, status: "on_demand" }).label, "On demand");
    assert.equal(quoteState({ ...naQuote, status: "error", reason: null }).detail, "Грешка от доставчика на данни.");
    assert.equal(quoteState(quotes.quotes.NOPE).kind, "na", "unknown instrument from /markets/quotes");
  });

  test("partial Binance quotes keep their reason as detail", () => {
    const s = quoteState({ ...okQuote, partial: true, reason: "daily candles loading" });
    assert.equal(s.kind, "ok");
    assert.equal(s.detail, "daily candles loading");
  });

  test("quotesKey: de-duplicated, encoded, ≤ 100, null when empty", () => {
    assert.equal(quotesKey(["BTC/USDT", "BTC/USDT", "AAPL"]), "/markets/quotes?symbols=BTC%2FUSDT,AAPL");
    assert.equal(quotesKey([]), null);
    assert.equal(quotesKey(["", ""]), null);
    const many = Array.from({ length: 150 }, (_, i) => `S${i}`);
    assert.equal(quotesKey(many)?.split(",").length, 100);
  });

  test("chunk", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 3), []);
    assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
  });

  test("cleanReason strips a repeated DATA NOT AVAILABLE prefix", () => {
    assert.equal(cleanReason("DATA NOT AVAILABLE: no configured provider"), "no configured provider");
    assert.equal(cleanReason("DATA_NOT_AVAILABLE — x"), "x");
    assert.equal(cleanReason("The configured provider plan cannot compute this list"), "The configured provider plan cannot compute this list");
    assert.equal(cleanReason("DATA NOT AVAILABLE", "fallback"), "fallback");
    assert.equal(cleanReason(null, "fb"), "fb");
  });
});

describe("lists", () => {
  test("seven list kinds with titles", () => {
    assert.deepEqual(LIST_KINDS, ["gainers", "losers", "most_volume", "high_volatility", "low_volatility", "trending", "popular"]);
    assert.equal(LIST_META.gainers.title, "Top gainers");
    assert.ok(isListKind("trending") && !isListKind("biggest"));
  });

  test("listKey builds the /markets/list query", () => {
    assert.equal(listKey("gainers"), "/markets/list?kind=gainers&page=1&page_size=6");
    assert.equal(listKey("losers", { assetClass: "metal", page: 3, pageSize: 5 }), "/markets/list?kind=losers&asset_class=metal&page=3&page_size=5");
    assert.equal(listKey("popular", { pageSize: 500 }), "/markets/list?kind=popular&page=1&page_size=100");
    assert.equal(listKey("popular", { page: 0 }), "/markets/list?kind=popular&page=1&page_size=6");
  });

  test("real list payloads: gainers are sorted desc and positive", () => {
    const ch = gainersList.items.map((i) => i.quote?.change_24h_pct ?? 0);
    assert.ok(ch.every((c) => c > 0));
    assert.deepEqual([...ch].sort((a, b) => b - a), ch);
  });

  test("listMatches: kind, class and the commodity aliases", () => {
    assert.ok(listMatches(gainersList, "gainers"));
    assert.ok(!listMatches(gainersList, "losers"));
    assert.ok(!listMatches(gainersList, "gainers", "crypto"));
    assert.ok(listMatches({ kind: "gainers", asset_class: "crypto", category: null }, "gainers", "crypto"));
    assert.ok(listMatches({ kind: "gainers", asset_class: "commodity", category: "metal" }, "gainers", "metal"));
    assert.ok(!listMatches({ kind: "gainers", asset_class: "commodity", category: null }, "gainers", "metal"));
    assert.ok(listMatches({ kind: "popular" }, "popular", "stock"), "overview lists carry no echo");
    assert.ok(!listMatches(undefined, "popular"));
  });

  test("secondary metric per kind", () => {
    const vq = volumeList.items[0].quote;
    assert.match(listMetricText("most_volume", vq) ?? "", /^\$\d/);
    assert.match(listMetricText("high_volatility", okQuote) ?? "", /%$/);
    assert.equal(listMetricText("gainers", okQuote), null);
    assert.equal(listMetricText("most_volume", naQuote), null);
  });
});

describe("trend / AI status", () => {
  test("trend meta accepts quote and analysis spellings", () => {
    assert.equal(trendMeta("up")?.label, "Uptrend");
    assert.equal(trendMeta("Downtrend")?.tone, "down");
    assert.equal(trendMeta("sideways")?.tone, "neutral");
    assert.equal(trendMeta(null), null);
    assert.equal(trendMeta("weird"), null);
  });

  test("AI status and decision tones", () => {
    assert.equal(aiStatusTone("LONG SETUP"), "up");
    assert.equal(aiStatusTone("SHORT SETUP"), "down");
    assert.equal(aiStatusTone("WAIT"), "warn");
    assert.equal(aiStatusTone("NO TRADE"), "neutral");
    assert.equal(aiStatusTone(null), "neutral");
    assert.equal(decisionTone("POSSIBLE LONG"), "up");
    assert.equal(decisionTone("POSSIBLE SHORT"), "down");
    assert.equal(decisionTone("WAIT"), "warn");
    assert.equal(decisionTone("NO TRADE"), "neutral");
  });
});

describe("sorting", () => {
  const rows = watchlist.items as WatchlistRow[];
  const withNa: WatchlistRow[] = [...rows, { ...rows[0], symbol: "ZZZ/NA", slug: "ZZZ-NA", quote: naQuote, ai_status: null, position: 99 }];

  test("no sort keeps the server order (position)", () => {
    assert.deepEqual(sortRows(rows, null), rows);
  });

  test("numeric sort both ways; unknown values always last", () => {
    const desc = sortRows(withNa, { key: "change", dir: "desc" });
    const asc = sortRows(withNa, { key: "change", dir: "asc" });
    const val = (r: WatchlistRow) => r.quote?.change_24h_pct as number;
    assert.equal(desc[desc.length - 1].symbol, "ZZZ/NA");
    assert.equal(asc[asc.length - 1].symbol, "ZZZ/NA");
    for (let i = 1; i < desc.length - 1; i++) assert.ok(val(desc[i - 1]) >= val(desc[i]));
    for (let i = 1; i < asc.length - 1; i++) assert.ok(val(asc[i - 1]) <= val(asc[i]));
  });

  test("text, AI status and trend sorts", () => {
    const bySym = sortRows(rows, { key: "symbol", dir: "asc" }).map((r) => r.symbol);
    assert.deepEqual(bySym, [...bySym].sort());
    const ai = sortRows(withNa, { key: "ai", dir: "desc" });
    assert.notEqual(ai[0].ai_status, "NO TRADE", "WAIT ranks above NO TRADE");
    assert.equal(ai[ai.length - 1].symbol, "ZZZ/NA");
    const tr = sortRows(withNa, { key: "trend", dir: "desc" });
    assert.equal(tr[tr.length - 1].symbol, "ZZZ/NA");
  });

  test("sort is stable and does not mutate the input", () => {
    const copy = [...rows];
    sortRows(rows, { key: "price", dir: "asc" });
    assert.deepEqual(rows, copy);
    const same = rows.map((r) => ({ ...r, quote: naQuote }));
    assert.deepEqual(
      sortRows(same, { key: "price", dir: "desc" }).map((r) => r.symbol),
      same.map((r) => r.symbol),
    );
  });

  test("nextSort toggles the same key, starts numeric keys descending", () => {
    assert.deepEqual(nextSort(null, "change"), { key: "change", dir: "desc" });
    assert.deepEqual(nextSort({ key: "change", dir: "desc" }, "change"), { key: "change", dir: "asc" });
    assert.deepEqual(nextSort({ key: "change", dir: "asc" }, "symbol"), { key: "symbol", dir: "asc" });
  });
});

describe("time", () => {
  test("timeAgo", () => {
    const now = 1_800_000_000;
    assert.equal(timeAgo(now - 20, now), "току-що");
    assert.equal(timeAgo(now - 300, now), "преди 5 мин");
    assert.equal(timeAgo(now - 3 * 3600, now), "преди 3 ч");
    assert.equal(timeAgo(now - 4 * 86400, now), "преди 4 дни");
    assert.equal(timeAgo(null, now), "—");
  });

  test("fmtCountdown", () => {
    assert.equal(fmtCountdown(45 * 60), "45 мин");
    assert.equal(fmtCountdown(2 * 3600 + 15 * 60), "2 ч 15 мин");
    assert.equal(fmtCountdown(3 * 3600), "3 ч");
    assert.equal(fmtCountdown(3 * 86400 + 4 * 3600), "3 дни 4 ч");
    assert.equal(fmtCountdown(10), "1 мин");
    assert.equal(fmtCountdown(null), "—");
  });
});

describe("calendar relevance", () => {
  test("forex pairs map both currencies, others the quote currency", () => {
    assert.deepEqual(relevantCountries({ symbol: "EUR/USD", asset_class: "forex", currency: "USD" }).sort(), ["DE", "ES", "EU", "FR", "IT", "US"]);
    assert.deepEqual(relevantCountries({ symbol: "USD/JPY", asset_class: "forex", currency: "JPY" }).sort(), ["JP", "US"]);
    assert.deepEqual(relevantCountries({ symbol: "BTC/USDT", asset_class: "crypto", currency: "USDT" }), ["US"]);
    assert.deepEqual(relevantCountries({ symbol: "XYZ", asset_class: "stock", currency: "" }), []);
  });
});

describe("SymbolPicker class contract", () => {
  test("layout classes → wrapper, typography / padding → text field", () => {
    assert.deepEqual(splitPickerClass("w-full"), { wrapper: "w-full", input: "" });
    assert.deepEqual(splitPickerClass("!py-1 text-xs"), { wrapper: "", input: "!py-1 text-xs" });
    assert.deepEqual(splitPickerClass("w-full sm:w-auto sm:max-w-[15rem]"), { wrapper: "w-full sm:w-auto sm:max-w-[15rem]", input: "" });
    assert.deepEqual(splitPickerClass("min-w-0 flex-1"), { wrapper: "min-w-0 flex-1", input: "" });
    assert.deepEqual(splitPickerClass(undefined), { wrapper: "", input: "" });
    assert.deepEqual(splitPickerClass("pl-3 font-bold mt-2"), { wrapper: "mt-2", input: "pl-3 font-bold" });
  });

  test("hasWidthClass", () => {
    assert.ok(hasWidthClass("w-full"));
    assert.ok(hasWidthClass("min-w-0 flex-1"));
    assert.ok(hasWidthClass("sm:max-w-[15rem]"));
    assert.ok(!hasWidthClass(""));
    assert.ok(!hasWidthClass("mt-2 ml-auto"));
  });
});
