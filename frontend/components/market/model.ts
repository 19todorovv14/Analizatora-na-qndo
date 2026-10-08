/*
 * Pure helpers of the markets UI (no React, no DOM) — unit-tested in __tests__/model.test.ts.
 * Labels: Bulgarian text with English trading terms, as in the rest of the app.
 */
import type { AiStatus, AssetSummary, ListKind, MarketItem, Quote, Trend } from "@/components/market/types";

/* ───────────────────────────────────────────────────────── asset classes */

export type ClassMeta = { label: string; plural: string; bg: string };

export const CLASS_META: Record<string, ClassMeta> = {
  crypto: { label: "Crypto", plural: "Crypto", bg: "Криптовалути" },
  stock: { label: "Stock", plural: "Stocks", bg: "Акции" },
  etf: { label: "ETF", plural: "ETFs", bg: "Борсово търгувани фондове" },
  forex: { label: "Forex", plural: "Forex", bg: "Валутни двойки" },
  index: { label: "Index", plural: "Indices", bg: "Индекси" },
  commodity: { label: "Commodity", plural: "Commodities", bg: "Суровини" },
};

export function classLabel(cls: string | null | undefined): string {
  if (!cls) return "—";
  return CLASS_META[cls]?.label ?? cls.charAt(0).toUpperCase() + cls.slice(1);
}

/* ─────────────────────────────────────────────────────── category tabs */

export type CategoryTabKey = "all" | "crypto" | "stock" | "etf" | "forex" | "index" | "commodity" | "metal" | "energy" | "agriculture";

export type CategoryTab = {
  key: CategoryTabKey;
  label: string;
  bg: string;
  /** catalog filter (GET /market/catalog) */
  filter: { asset_class?: string; category?: string };
  /** `asset_class` param of GET /markets/list (accepts the metal / energy / agriculture aliases); null = all */
  listClass: string | null;
  /** heatmap class to show for this tab (only crypto / stock / etf have a heatmap) */
  heatmap: HeatmapClass | null;
};

export type HeatmapClass = "crypto" | "stock" | "etf";

export const CATEGORY_TABS: CategoryTab[] = [
  { key: "all", label: "All", bg: "Всички", filter: {}, listClass: null, heatmap: null },
  { key: "crypto", label: "Crypto", bg: "Крипто", filter: { asset_class: "crypto" }, listClass: "crypto", heatmap: "crypto" },
  { key: "stock", label: "Stocks", bg: "Акции", filter: { asset_class: "stock" }, listClass: "stock", heatmap: "stock" },
  { key: "etf", label: "ETFs", bg: "ETF", filter: { asset_class: "etf" }, listClass: "etf", heatmap: "etf" },
  { key: "forex", label: "Forex", bg: "Валути", filter: { asset_class: "forex" }, listClass: "forex", heatmap: null },
  { key: "index", label: "Indices", bg: "Индекси", filter: { asset_class: "index" }, listClass: "index", heatmap: null },
  { key: "commodity", label: "Commodities", bg: "Суровини", filter: { asset_class: "commodity" }, listClass: "commodity", heatmap: null },
  { key: "metal", label: "Metals", bg: "Метали", filter: { asset_class: "commodity", category: "metal" }, listClass: "metal", heatmap: null },
  { key: "energy", label: "Energy", bg: "Енергия", filter: { asset_class: "commodity", category: "energy" }, listClass: "energy", heatmap: null },
  {
    key: "agriculture",
    label: "Agriculture",
    bg: "Земеделие",
    filter: { asset_class: "commodity", category: "agriculture" },
    listClass: "agriculture",
    heatmap: null,
  },
];

export const TAB_BY_KEY: Record<string, CategoryTab> = Object.fromEntries(CATEGORY_TABS.map((t) => [t.key, t]));

export function isTabKey(v: unknown): v is CategoryTabKey {
  return typeof v === "string" && v in TAB_BY_KEY;
}

/** Instrument count of a tab from the UNFILTERED catalog facets (null while unknown). */
export function tabCount(
  tab: CategoryTab,
  facets: { asset_class?: Record<string, number>; category?: Record<string, number> } | undefined,
  total?: number,
): number | null {
  if (!facets) return null;
  if (tab.key === "all") return total ?? Object.values(facets.asset_class ?? {}).reduce((a, b) => a + b, 0);
  if (tab.filter.category) return facets.category?.[tab.filter.category] ?? 0;
  return facets.asset_class?.[tab.filter.asset_class ?? ""] ?? 0;
}

/** Does an asset belong to a tab? (client-side filter for favorites / recently viewed) */
export function inTab(a: Pick<AssetSummary, "asset_class" | "category">, tab: CategoryTab): boolean {
  if (tab.filter.asset_class && a.asset_class !== tab.filter.asset_class) return false;
  if (tab.filter.category && a.category !== tab.filter.category) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────── links */

/** Mirror of backend slug_for(): upper case, "/" → "-", spaces and other unsafe characters → "_". */
export function slugFor(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/\//g, "-")
    .replace(/ /g, "_")
    .replace(/[^A-Z0-9._-]/g, "_");
}

export function assetHref(a: { slug?: string | null; symbol: string } | string): string {
  const slug = typeof a === "string" ? slugFor(a) : a.slug || slugFor(a.symbol);
  return `/markets/${encodeURIComponent(slug)}`;
}

const withSymbol = (path: string, symbol: string) => `${path}?symbol=${encodeURIComponent(symbol)}`;
export const chartHref = (symbol: string) => withSymbol("/charts", symbol);
export const tradeHref = (symbol: string) => withSymbol("/trade", symbol);
export const replayHref = (symbol: string) => withSymbol("/replay", symbol);
export const askAiHref = (symbol: string) => withSymbol("/ai", symbol);

/* ─────────────────────────────────────────────────────────── numbers */

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 31_791_898_723 → "31.79B", 12_500 → "12.5K", 950 → "950"; null → "—". */
export function fmtCompact(v: number | null | undefined, digits = 2): string {
  if (!finite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(1)}K`;
  if (a >= 100) return `${sign}${Math.round(a).toLocaleString("en-US")}`;
  return `${sign}${a.toLocaleString("en-US", { maximumFractionDigits: a >= 1 ? 2 : 6 })}`;
}

export function fmtUsdCompact(v: number | null | undefined): string {
  return finite(v) ? `$${fmtCompact(v)}` : "—";
}

/** Percent without sign colouring: 6.391 → "6.39%". */
export function fmtPctPlain(v: number | null | undefined, digits = 2): string {
  return finite(v) ? `${v.toFixed(digits)}%` : "—";
}

/** Signed percent: 1.27 → "+1.27%". */
export function fmtPctSigned(v: number | null | undefined, digits = 2): string {
  if (!finite(v)) return "—";
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? "+" : ""}${(r === 0 ? 0 : r).toFixed(digits)}%`;
}

/** Price with the instrument's precision (quote → summary → 2). */
export function pricePrecision(item: { quote?: Quote | null; price_precision?: number | null } | null | undefined): number {
  const p = item?.quote?.precision ?? item?.price_precision;
  return finite(p) ? Math.max(0, Math.min(10, p)) : 2;
}

export function fmtQuotePrice(v: number | null | undefined, precision = 2): string {
  if (!finite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

/* ─────────────────────────────────────────────────────────── quotes */

/** True when the quote carries real values (status "ok"). */
export function quoteOk(q: Quote | null | undefined): q is Quote & { status: "ok" } {
  return !!q && q.status === "ok" && q.available !== false;
}

export type QuoteState = { kind: "ok" | "pending" | "na" | "on_demand" | "error" | "missing"; label: string; detail: string | null };

/** How to present a quote that is not "ok" (short label for a table cell + the reason as detail). */
export function quoteState(q: Quote | null | undefined): QuoteState {
  if (!q) return { kind: "missing", label: "—", detail: null };
  if (quoteOk(q)) return { kind: "ok", label: "", detail: q.partial ? q.reason : null };
  switch (q.status) {
    case "pending":
      return { kind: "pending", label: "Зарежда се…", detail: q.reason ?? "Данните се изтеглят от доставчика — опресни след малко." };
    case "on_demand":
      return {
        kind: "on_demand",
        label: "On demand",
        detail: q.reason ?? "Доставчикът се пита само на страницата на актива и в watchlist (лимит на заявките).",
      };
    case "error":
      return { kind: "error", label: "N/A", detail: q.reason ?? "Грешка от доставчика на данни." };
    case "unknown":
      return { kind: "na", label: "N/A", detail: q.reason ?? "Непознат инструмент." };
    default:
      return { kind: "na", label: "N/A", detail: q.reason ?? "DATA NOT AVAILABLE" };
  }
}

/** Quotes of a page of instruments: GET /markets/quotes?symbols=… (≤ 100, encoded, de-duplicated). */
export const MAX_QUOTES = 100;

export function quotesKey(symbols: string[]): string | null {
  const uniq = Array.from(new Set(symbols.filter(Boolean))).slice(0, MAX_QUOTES);
  if (!uniq.length) return null;
  return `/markets/quotes?symbols=${uniq.map(encodeURIComponent).join(",")}`;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ─────────────────────────────────────────────────────────── lists */

export type ListMetric = "change" | "change7d" | "volume" | "range" | "none";

export type ListMeta = { title: string; bg: string; metric: ListMetric; metricLabel: string; term?: string };

export const LIST_META: Record<ListKind, ListMeta> = {
  gainers: { title: "Top gainers", bg: "Най-голям ръст за 24 часа", metric: "change", metricLabel: "24h" },
  losers: { title: "Top losers", bg: "Най-голям спад за 24 часа", metric: "change", metricLabel: "24h" },
  most_volume: { title: "Most volume", bg: "Най-голям 24h обем (USD)", metric: "volume", metricLabel: "Vol 24h", term: "volume" },
  high_volatility: { title: "High volatility", bg: "Най-широк 24h диапазон", metric: "range", metricLabel: "Range 24h", term: "volatility" },
  low_volatility: { title: "Low volatility", bg: "Най-тесен 24h диапазон", metric: "range", metricLabel: "Range 24h", term: "volatility" },
  trending: { title: "Trending", bg: "Ясен дневен тренд (EMA 20 / EMA 50), по 7d промяна", metric: "change7d", metricLabel: "7d", term: "trend" },
  popular: { title: "Popular", bg: "Най-следваните инструменти", metric: "none", metricLabel: "" },
};

export const LIST_KINDS = Object.keys(LIST_META) as ListKind[];

export function isListKind(v: unknown): v is ListKind {
  return typeof v === "string" && v in LIST_META;
}

export function listKey(kind: ListKind, opts: { assetClass?: string | null; category?: string | null; page?: number; pageSize?: number } = {}): string {
  const p = new URLSearchParams({ kind });
  if (opts.assetClass) p.set("asset_class", opts.assetClass);
  if (opts.category) p.set("category", opts.category);
  p.set("page", String(Math.max(1, opts.page ?? 1)));
  p.set("page_size", String(Math.max(1, Math.min(100, opts.pageSize ?? 6))));
  return `/markets/list?${p.toString()}`;
}

/** The secondary value a list row shows next to the change pill (volume / range); null for none. */
export function listMetricText(kind: ListKind, q: Quote | null | undefined): string | null {
  const m = LIST_META[kind].metric;
  if (!quoteOk(q)) return null;
  if (m === "volume") return fmtUsdCompact(q.volume_24h_usd);
  if (m === "range") return fmtPctPlain(q.range_24h_pct);
  return null;
}

/* ─────────────────────────────────────────────── trend / regime / AI */

export const TREND_META: Record<Trend, { label: string; tone: "up" | "down" | "neutral" }> = {
  up: { label: "Uptrend", tone: "up" },
  down: { label: "Downtrend", tone: "down" },
  sideways: { label: "Sideways", tone: "neutral" },
};

export function trendMeta(t: string | null | undefined) {
  if (!t) return null;
  const k = t.toLowerCase();
  if (k === "up" || k === "uptrend") return TREND_META.up;
  if (k === "down" || k === "downtrend") return TREND_META.down;
  if (k === "sideways" || k === "range" || k === "flat") return TREND_META.sideways;
  return null;
}

export const AI_STATUS_META: Record<AiStatus, { tone: "up" | "down" | "warn" | "neutral"; hint: string }> = {
  "LONG SETUP": { tone: "up", hint: "Правилата виждат възможен LONG setup — хипотеза, не гаранция." },
  "SHORT SETUP": { tone: "down", hint: "Правилата виждат възможен SHORT setup — хипотеза, не гаранция." },
  WAIT: { tone: "warn", hint: "Има идея, но условията още не са изпълнени — изчакай потвърждение." },
  "NO TRADE": { tone: "neutral", hint: "Условията за setup не са изпълнени — „no trade“ също е решение." },
};

export function aiStatusTone(s: string | null | undefined): "up" | "down" | "warn" | "neutral" {
  return (s && AI_STATUS_META[s as AiStatus]?.tone) || "neutral";
}

/** AI decision of /ai/analyze → tone. */
export function decisionTone(d: string | null | undefined): "up" | "down" | "warn" | "neutral" {
  if (!d) return "neutral";
  const u = d.toUpperCase();
  if (u.includes("LONG")) return "up";
  if (u.includes("SHORT")) return "down";
  if (u.includes("WAIT")) return "warn";
  return "neutral";
}

/* ─────────────────────────────────────────────────────────── sorting */

export type SortKey = "symbol" | "name" | "price" | "change" | "change7d" | "volume" | "range" | "trend" | "regime" | "ai" | "position";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

const TREND_RANK: Record<string, number> = { up: 2, sideways: 1, down: 0 };
const AI_RANK: Record<string, number> = { "LONG SETUP": 3, "SHORT SETUP": 2, WAIT: 1, "NO TRADE": 0 };

type SortableRow = MarketItem & { ai_status?: string | null; position?: number };

/** The comparable value of a row for a sort key (null = unknown → always sorted last). */
export function sortValue(row: SortableRow, key: SortKey): number | string | null {
  const q = quoteOk(row.quote) ? row.quote : null;
  switch (key) {
    case "symbol":
      return row.symbol.toUpperCase();
    case "name":
      return (row.name || row.symbol).toLowerCase();
    case "price":
      return q?.price ?? null;
    case "change":
      return q?.change_24h_pct ?? null;
    case "change7d":
      return q?.change_7d_pct ?? null;
    case "volume":
      return q?.volume_24h_usd ?? null;
    case "range":
      return q?.range_24h_pct ?? null;
    case "trend":
      return q?.trend ? (TREND_RANK[q.trend] ?? null) : null;
    case "regime":
      return q?.regime ?? null;
    case "ai":
      return row.ai_status ? (AI_RANK[row.ai_status] ?? null) : null;
    case "position":
      return row.position ?? null;
  }
}

/** Stable sort; unknown values (null / unavailable quotes) always go last, whatever the direction. */
export function sortRows<T extends SortableRow>(rows: T[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: sortValue(row, sort.key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === "string" || typeof b.v === "string" ? String(a.v).localeCompare(String(b.v)) : (a.v as number) - (b.v as number);
      return c !== 0 ? c * dir : a.i - b.i;
    })
    .map((x) => x.row);
}

/** Header click: same key toggles the direction, a new key starts with its natural direction. */
export function nextSort(cur: SortState | null, key: SortKey): SortState {
  if (cur?.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  const textual = key === "symbol" || key === "name" || key === "regime" || key === "position";
  return { key, dir: textual ? "asc" : "desc" };
}

/* ──────────────────────────────────────────────────────────── time */

/** Unix seconds → "преди 5 мин" / "преди 3 ч" / "преди 2 дни". */
export function timeAgo(ts: number | null | undefined, now: number = Date.now() / 1000): string {
  if (!finite(ts) || ts <= 0) return "—";
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return "току-що";
  const m = Math.round(s / 60);
  if (m < 60) return `преди ${m} мин`;
  const h = Math.round(m / 60);
  if (h < 48) return `преди ${h} ч`;
  return `преди ${Math.round(h / 24)} дни`;
}

/** Seconds → "2 ч 15 мин" / "45 мин" / "3 дни 4 ч" (countdown to the next session change). */
export function fmtCountdown(seconds: number | null | undefined): string {
  if (!finite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d} дни ${h} ч` : `${d} дни`;
  if (h > 0) return m ? `${h} ч ${m} мин` : `${h} ч`;
  return `${Math.max(1, m)} мин`;
}

/* ───────────────────────────────────────────────────────── calendar */

const CURRENCY_COUNTRY: Record<string, string[]> = {
  USD: ["US"],
  EUR: ["EU", "DE", "FR", "IT", "ES"],
  GBP: ["GB", "UK"],
  JPY: ["JP"],
  CHF: ["CH"],
  CAD: ["CA"],
  AUD: ["AU"],
  NZD: ["NZ"],
  CNY: ["CN"],
  CNH: ["CN"],
  HKD: ["HK"],
  SEK: ["SE"],
  NOK: ["NO"],
  MXN: ["MX"],
  ZAR: ["ZA"],
  TRY: ["TR"],
  SGD: ["SG"],
  INR: ["IN"],
};

/**
 * Countries whose economic events typically matter for an instrument: both currencies of a forex
 * pair, the quote currency otherwise (US for USD-quoted stocks, indices, commodities).
 */
export function relevantCountries(a: { symbol: string; asset_class?: string | null; currency?: string | null; country?: string | null }): string[] {
  const out = new Set<string>();
  if (a.asset_class === "forex") {
    a.symbol
      .split("/")
      .map((c) => c.trim().toUpperCase())
      .forEach((c) => (CURRENCY_COUNTRY[c] ?? []).forEach((x) => out.add(x)));
  }
  const cur = (a.currency ?? "").toUpperCase();
  (CURRENCY_COUNTRY[cur === "USDT" || cur === "USDC" ? "USD" : cur] ?? []).forEach((x) => out.add(x));
  return Array.from(out);
}

/* ──────────────────────────────────────────────────────── pickers */

/**
 * SymbolPicker keeps its old {className} contract (the class used to land on a <select class="input">).
 * Typography/padding classes belong to the text field, layout classes (width, flex, margins) to the wrapper.
 */
export function splitPickerClass(className: string | undefined): { wrapper: string; input: string } {
  const wrapper: string[] = [];
  const input: string[] = [];
  for (const cls of (className ?? "").split(/\s+/).filter(Boolean)) {
    const base = cls.replace(/^([a-z0-9-]+:)+/, "").replace(/^!/, "");
    if (/^(p[xytrbl]?|text|font|leading|tracking|rounded|bg|border|h|min-h)-/.test(base) || base === "rounded") input.push(cls);
    else wrapper.push(cls);
  }
  return { wrapper: wrapper.join(" "), input: input.join(" ") };
}

/** True when a class list already decides the element's width (so a default width is not added). */
export function hasWidthClass(className: string | undefined): boolean {
  return /(^|\s)([a-z0-9-]+:)*!?(w-|min-w-|max-w-|flex-1|flex-auto|grow|basis-)/.test(className ?? "");
}
