/*
 * Markets — public components for other packages (S2 terminal, S3b simulator, S5 replay, S7 command center).
 * All of them are client components that fetch their own data with SWR (keys = API paths without /api).
 * Missing market data is always shown as DATA NOT AVAILABLE / "N/A" — never invented numbers.
 *
 *   <AssetSearchCombobox value onChange placeholder? className? assetClass? />
 *     Instrument search (GET /market/search, 200 ms debounce) as an ARIA combobox: ↑ ↓ Enter Esc Tab,
 *     class badge + data availability (DEMO / LIVE / N/A) per row, empty query → popular instruments.
 *     value: string (symbol, "" = none) · onChange(symbol) · assetClass?: crypto|stock|etf|forex|index|commodity
 *     className → wrapper (layout; default width w-56). Optional extras: inputClassName, onSelectAsset(asset),
 *     clearOnSelect (e.g. "add to watchlist"), size "sm"|"md"|"lg", autoFocus, ariaLabel, disabled, limit,
 *     markedSymbols + markedLabel (check mark for e.g. symbols already in a list).
 *   SymbolPicker (components/charts/ChartControls) is built on it and keeps its {value, onChange, className}.
 *
 *   <WatchlistPanel activeSymbol? onSelect?(symbol) compact? pageSize? className? />
 *     The user's watchlist (GET /markets/watchlist): add via search, remove (×), price, 24h change,
 *     AI status (LONG SETUP / SHORT SETUP / WAIT / NO TRADE, reason on hover). Fills its parent's height
 *     (give the parent a height) and scrolls inside. Without onSelect rows open /markets/{slug}.
 *     No "Watchlist" heading inside — the host provides its own title / tab label.
 *
 *   <MarketMovers kind assetClass? category? limit? title? compact? pager? className? />
 *     A Card with one list of GET /markets/list: kind = gainers | losers | most_volume | high_volatility |
 *     low_volatility | trending | popular; assetClass also accepts metal | energy | agriculture.
 *     Sparkline + change pill per row, ‹ 1/N › pager, DATA NOT AVAILABLE when the provider plan cannot
 *     compute the list. compact → dense rows without sparklines / pager.
 *
 *   <Heatmap assetClass height? compact? onSelect?(tile) className? />
 *     Squarified treemap grouped by sector (GET /markets/heatmap?asset_class=crypto|stock|etf).
 *     Area = market cap only when a real provider supplies it, else 24h volume (labelled); colour = 24h change
 *     (diverging scale + legend); tooltip with price / volume / market cap. Tiles open /markets/{slug}.
 *
 *   <MarketTable rows columns? onRowClick? virtualized? height? rowHeight? sort? onSort? loading? empty? minWidth?
 *                activeSymbol? ariaLabel? className? />
 *     Dense sortable instrument table for asset_summary + quote rows. columns: built-in keys ("symbol",
 *     "price", "change", "change7d", "volume", "range", "trend", "regime", "sparkline", "source", "class",
 *     "exchange", "sector", "name") and/or custom {key, header, width, align?, sortKey?, render}.
 *     builtinColumn(key) returns a built-in definition to tweak; sort helpers: sortRows / nextSort (model.ts).
 *
 *   <FavoriteButton symbol variant?="icon"|"button" size? initial? />  ☆ / ★ (POST/DELETE /market/favorites)
 *   <WatchlistButton symbol variant?="button"|"icon" size? initial? />  (POST/DELETE /market/watchlist)
 *     Both read GET /markets/membership, update optimistically and refresh every watchlist view.
 *   <MarketStatusDot status showLabel? />  status = "open"|"closed"|"break" or the API market_status object.
 *   <QuoteList items kind? onSelect? activeSymbol? sparkline? loading? dense? />  compact instrument rows.
 *   Cells: PriceCell, ChangeCell, VolumeCell, RangeCell, QuoteSparkline, QuoteStatusChip, TrendBadge, AiStatusBadge.
 *   <ClassIcon cls size? />, <ClassBadge cls />, <EventExplainButton headline summary? symbol? />,
 *   <NewsPanel news asset />, <LinkButton href variant? size? />.
 *
 * Hooks: useMembership(), useFavoriteToggle(), useWatchlistToggle(), useAddToWatchlist(), useQuotes(symbols),
 * useRecordView(symbol). Links: assetHref(asset|symbol), chartHref / tradeHref / replayHref / askAiHref(symbol).
 */
export { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
export type { AssetSearchComboboxProps } from "@/components/market/AssetSearchCombobox";
export { ClassBadge, ClassIcon, CLASS_ICON } from "@/components/market/ClassBadge";
export { Heatmap } from "@/components/market/Heatmap";
export type { HeatmapProps } from "@/components/market/Heatmap";
export {
  useAddToWatchlist,
  useFavoriteToggle,
  useMembership,
  useQuotes,
  useRecordView,
  useWatchlistToggle,
} from "@/components/market/hooks";
export { LinkButton } from "@/components/market/LinkButton";
export { MarketMovers } from "@/components/market/MarketMovers";
export type { MarketMoversProps } from "@/components/market/MarketMovers";
export { MarketStatusDot } from "@/components/market/MarketStatusDot";
export type { MarketStatusDotProps } from "@/components/market/MarketStatusDot";
export { DEFAULT_COLUMNS, MarketTable, builtinColumn } from "@/components/market/MarketTable";
export type { MarketColumn, MarketColumnKey, MarketTableProps } from "@/components/market/MarketTable";
export { FavoriteButton, WatchlistButton } from "@/components/market/MembershipButtons";
export type { MembershipButtonProps } from "@/components/market/MembershipButtons";
export {
  askAiHref,
  assetHref,
  chartHref,
  replayHref,
  slugFor,
  sortRows,
  nextSort,
  tradeHref,
  quoteOk,
  CATEGORY_TABS,
  LIST_META,
} from "@/components/market/model";
export type { SortKey, SortState, CategoryTabKey } from "@/components/market/model";
export { EventExplainButton } from "@/components/market/NewsExplain";
export { NewsPanel } from "@/components/market/NewsPanel";
export { AiStatusBadge, ChangeCell, PriceCell, QuoteSparkline, QuoteStatusChip, RangeCell, TrendBadge, VolumeCell } from "@/components/market/QuoteCells";
export { QuoteList } from "@/components/market/QuoteList";
export type { QuoteListProps } from "@/components/market/QuoteList";
export { POPULAR_WATCH, WatchlistPanel } from "@/components/market/WatchlistPanel";
export type { WatchlistPanelProps } from "@/components/market/WatchlistPanel";
export type * from "@/components/market/types";
