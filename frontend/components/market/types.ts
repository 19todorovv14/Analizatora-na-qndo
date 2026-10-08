/*
 * Response shapes of the markets API (work package S1 backend — see backend/app/services/markets_service.py)
 * and of the F1 catalog endpoints (/api/market/search, /catalog, /favorites, /recent, /instrument).
 * Everything that comes from a market data provider is nullable: a missing value is shown as
 * DATA NOT AVAILABLE / "—", never invented.
 */
import type { SourceLike } from "@/components/ui";

export type AssetClass = "crypto" | "stock" | "etf" | "forex" | "index" | "commodity";

/** Quote snapshot status (backend app/market/overview.py). Only "ok" carries values. */
export type QuoteStatus = "ok" | "unavailable" | "error" | "pending" | "on_demand" | "unknown";

export type Trend = "up" | "down" | "sideways";

/** The "quote" object of every list item / asset page / watchlist row. */
export type Quote = {
  symbol: string;
  available: boolean;
  status: QuoteStatus;
  code: string | null;
  reason: string | null;
  /** Binance only: 24h fields present, daily-candle fields (7d, trend, regime, sparkline) still loading */
  partial?: boolean;
  price: number | null;
  change_24h_pct: number | null;
  /** "rolling_24h" (demo, Binance) | "session" (Twelve Data: vs previous daily close) */
  change_basis?: string | null;
  high_24h: number | null;
  low_24h: number | null;
  volume_24h: number | null;
  volume_24h_usd: number | null;
  range_24h_pct: number | null;
  change_7d_pct: number | null;
  atr_pct_1d?: number | null;
  trend: Trend | null;
  regime: string | null;
  sparkline: number[];
  /** "1h" (demo) | "1d" (Binance / Twelve Data) */
  sparkline_tf?: string | null;
  precision: number | null;
  currency?: string | null;
  source: SourceLike | null;
  as_of: number | null;
};

/** F1 asset_summary (search / catalog / favorites / recent / list items). */
export type AssetSummary = {
  symbol: string;
  slug: string;
  name: string;
  asset_class: string | null;
  category?: string | null;
  sector?: string | null;
  exchange?: string | null;
  country?: string | null;
  currency?: string | null;
  base?: string | null;
  popularity?: number | null;
  curated?: boolean;
  catalog_source?: string | null;
  available: boolean;
  unavailable_reason?: string | null;
  source?: SourceLike | null;
  price_precision?: number | null;
  max_leverage?: number | null;
  /** search only */
  score?: number;
  /** stale symbols (no longer in the catalog) */
  code?: string | null;
};

/** asset_summary + "quote" — every list/overview/related item. */
export type MarketItem = AssetSummary & { quote?: Quote | null };

export type ListKind = "gainers" | "losers" | "most_volume" | "high_volatility" | "low_volatility" | "trending" | "popular";

export type Coverage = {
  ranked: number;
  eligible: number;
  unavailable: number;
  rate_limited: number;
  missing: number;
  excluded_classes: string[];
};

/** GET /api/markets/list (and overview.lists[kind]). */
export type MarketList = {
  kind: ListKind;
  label: string;
  label_bg?: string | null;
  metric?: string | null;
  description?: string | null;
  page: number;
  page_size: number;
  /** false → show DATA NOT AVAILABLE with `reason` */
  available: boolean;
  /** ok | unavailable | warming */
  status: string;
  items: MarketItem[];
  total: number;
  pages: number;
  reason: string | null;
  code: string | null;
  coverage?: Coverage | null;
  note?: string | null;
  asset_class?: string | null;
  category?: string | null;
  as_of?: number | null;
};

export type HeatmapTile = {
  symbol: string;
  slug: string;
  name: string;
  sector?: string | null;
  category?: string | null;
  group?: string | null;
  change_24h_pct: number | null;
  volume_24h_usd: number | null;
  market_cap: number | null;
  size: number;
  price: number | null;
  precision?: number | null;
  source_status?: string | null;
};

/** GET /api/markets/heatmap */
export type HeatmapPayload = {
  asset_class: string;
  as_of?: number | null;
  source?: SourceLike | null;
  deduplicated_by_base?: boolean;
  coverage?: Coverage | null;
  available: boolean;
  reason: string | null;
  code: string | null;
  tiles: HeatmapTile[];
  excluded?: { symbol: string; reason: string }[];
  size_basis: "market_cap" | "volume";
  note?: string | null;
  market_cap_source?: SourceLike | null;
};

/** GET /api/markets/quotes */
export type QuotesPayload = { quotes: Record<string, Quote>; as_of?: number | null };

/** sessions.market_status */
export type MarketStatus = {
  status: "open" | "closed" | "break" | string;
  label?: string | null;
  session?: string | null;
  session_name?: string | null;
  timezone?: string | null;
  next_change_ts?: number | null;
  note?: string | null;
};

/** F1 instrument payload (asset page "instrument"). */
export type Instrument = AssetSummary & {
  industry?: string | null;
  qty_step?: number | null;
  min_qty?: number | null;
  spread_bps?: number | null;
  maker_fee?: number | null;
  taker_fee?: number | null;
  description?: string | null;
  aliases?: string[];
  provider_symbols?: Record<string, string>;
  session?: string | null;
  demo_capable?: boolean;
  market_status?: MarketStatus | null;
};

/** A block of the asset page that may be unavailable. */
export type Unavailable = { available: false; status?: string; code?: string | null; reason?: string | null };

export type RegimeBlock =
  | {
      available: true;
      status?: string;
      code?: null;
      reason?: null;
      timeframe: string;
      regime: string | null;
      trend: string | null;
      volatility_pct: number | null;
      reasons: string[];
    }
  | Unavailable;

export type LessonLink = { slug: string; title: string; module?: string | null; summary?: string | null; href: string };

export type NewsItem = {
  id: number | string;
  headline: string;
  summary?: string | null;
  source?: string | null;
  url?: string | null;
  ts?: number | null;
  category?: string | null;
  related?: string | null;
};

/** GET /api/markets/news (and asset page "news"). */
export type NewsPayload = {
  available: boolean;
  provider?: string | null;
  code?: string | null;
  reason?: string | null;
  how_to_enable?: string | null;
  scope?: string | null;
  symbol?: string | null;
  category?: string | null;
  items: NewsItem[];
  fetched_ts?: number | null;
  disclaimer?: string | null;
};

export type EconomicEvent = {
  time?: string | null;
  ts?: number | null;
  country?: string | null;
  event: string;
  impact?: string | null;
  actual?: number | string | null;
  estimate?: number | string | null;
  prev?: number | string | null;
  unit?: string | null;
};

export type EarningsEvent = {
  date: string;
  symbol: string;
  hour?: string | null;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  revenue_estimate?: number | null;
  revenue_actual?: number | null;
  quarter?: number | null;
  year?: number | null;
  in_catalog?: boolean;
  slug?: string | null;
  name?: string | null;
};

/** GET /api/markets/calendar */
export type CalendarPayload = {
  available: boolean;
  provider?: string | null;
  kind: "economic" | "earnings" | null;
  note?: string | null;
  code?: string | null;
  reason?: string | null;
  how_to_enable?: string | null;
  items: (EconomicEvent | EarningsEvent)[];
  fetched_ts?: number | null;
  disclaimer?: string | null;
  from?: string | null;
  to?: string | null;
};

/** POST /api/markets/news/explain */
export type ExplainPayload = {
  sections: { key: string; title: string; body: string }[];
  provider: string;
  disclaimer: string;
  event_type?: string | null;
  event_label?: string | null;
  symbol?: string | null;
  safety_removed?: string[];
};

/** GET /api/markets/asset/{slug} */
export type AssetPagePayload = {
  symbol: string;
  slug: string;
  available: boolean;
  code: string | null;
  reason: string | null;
  instrument: Instrument;
  quote: Quote;
  market_status: MarketStatus | null;
  regime: { "1h"?: RegimeBlock; "1d"?: RegimeBlock };
  volatility: { atr_pct_1d?: number | null; range_24h_pct?: number | null; atr_pct_1h?: number | null } | null;
  related: MarketItem[];
  lessons: LessonLink[];
  news: NewsPayload;
  is_favorite: boolean | null;
  in_watchlist: boolean | null;
  authenticated?: boolean;
  as_of?: number | null;
};

export type AiStatus = "LONG SETUP" | "SHORT SETUP" | "NO TRADE" | "WAIT";

/** GET /api/markets/watchlist row */
export type WatchlistRow = MarketItem & {
  position: number;
  ai_status: AiStatus | null;
  ai_reason: string | null;
  ai_confidence?: string | null;
  ai_pending?: boolean;
  ai_as_of?: number | null;
};

export type WatchlistPayload = {
  items: WatchlistRow[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
  as_of?: number | null;
};

/** GET /api/markets/membership */
export type Membership = { watchlist: string[]; favorites: string[] };

/** GET /api/market/search */
export type SearchPayload = { query: string; total: number; results: AssetSummary[] };

/** GET /api/market/catalog */
export type CatalogPayload = {
  items: AssetSummary[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
  sort: string;
  facets: { asset_class?: Record<string, number>; category?: Record<string, number>; sector?: Record<string, number> };
};

/** GET /api/market/favorites | /api/market/recent */
export type PersonalPayload = { items: (AssetSummary & { favorited_ts?: number; viewed_ts?: number; views?: number })[] };
