"use client";

import { ArrowRight, Eye, Plus, X } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { ClassIcon } from "@/components/market/ClassBadge";
import { useAddToWatchlist, useWatchlistToggle } from "@/components/market/hooks";
import { AI_STATUS_META, aiStatusTone, assetHref, pricePrecision } from "@/components/market/model";
import { AiStatusBadge, ChangeCell, PriceCell, QuoteSparkline } from "@/components/market/QuoteCells";
import type { AiStatus, WatchlistPayload, WatchlistRow } from "@/components/market/types";
import { Button, EmptyState, ErrorState, Skeleton, Tooltip } from "@/components/ui";
import { cx } from "@/lib/format";
import { fetcher } from "@/lib/api";

export type WatchlistPanelProps = {
  /** highlighted row (e.g. the terminal's current chart symbol) */
  activeSymbol?: string | null;
  /** row click → this callback (e.g. switch the chart); default: open /markets/{slug} */
  onSelect?: (symbol: string) => void;
  /** narrow side panel: no sparkline / name line, AI status as a dot */
  compact?: boolean;
  /** rows loaded (default 100 — the full list lives on /watchlist) */
  pageSize?: number;
  className?: string;
};

/** Instruments offered as one-click "Add popular assets" when the list is empty. */
export const POPULAR_WATCH: { symbol: string; asset_class: string }[] = [
  { symbol: "BTC/USDT", asset_class: "crypto" },
  { symbol: "ETH/USDT", asset_class: "crypto" },
  { symbol: "EUR/USD", asset_class: "forex" },
  { symbol: "XAU/USD", asset_class: "commodity" },
  { symbol: "AAPL", asset_class: "stock" },
  { symbol: "SPX", asset_class: "index" },
];

export function watchlistKey(page = 1, pageSize = 100) {
  return `/markets/watchlist?page=${page}&page_size=${pageSize}`;
}

const DOT: Record<string, string> = { up: "bg-up", down: "bg-down", warn: "bg-warn", neutral: "bg-faint" };

/**
 * The user's watchlist as a self-contained panel (terminal right panel, dashboard card): add via
 * search, remove on hover, price + 24h change + AI status per row. Fills its parent's height and
 * scrolls inside; polls every 15 s (5 s while AI statuses are still computing).
 */
export function WatchlistPanel({ activeSymbol, onSelect, compact, pageSize = 100, className }: WatchlistPanelProps) {
  const { data, error, isLoading, mutate } = useSWR<WatchlistPayload>(watchlistKey(1, pageSize), fetcher, {
    refreshInterval: (d) => (d?.items.some((r) => r.ai_pending) ? 5_000 : 15_000),
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const { toggle, busy: removing } = useWatchlistToggle();
  const adder = useAddToWatchlist();
  const rows = data?.items ?? [];
  const more = data ? Math.max(0, data.total - rows.length) : 0;

  return (
    <div className={cx("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <AssetSearchCombobox
          value=""
          onChange={(symbol) => void adder.add([symbol])}
          clearOnSelect
          size="sm"
          className="min-w-0 flex-1"
          placeholder="Добави инструмент…"
          ariaLabel="Добави инструмент в watchlist"
          markedSymbols={rows.map((r) => r.symbol)}
          markedLabel="в списъка"
        />
        {data && <span className="num shrink-0 text-[11px] text-faint">{data.total}</span>}
      </div>
      {adder.error && <p className="px-3 pb-1 text-[11px] text-down">{adder.error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && !data ? (
          <div className="p-3">
            <ErrorState title="Watchlist-ът не се зареди" description="Провери връзката и опитай пак." onRetry={() => mutate()} className="py-6" />
          </div>
        ) : isLoading && !data ? (
          <div className="space-y-px px-1" role="status" aria-busy="true">
            <span className="sr-only">Зареждане…</span>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-11 items-center gap-2.5 px-2" aria-hidden>
                <Skeleton className="h-[22px] w-[22px] !rounded-md" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : !rows.length ? (
          <div className="p-3">
            <EmptyState
              compact
              icon={Eye}
              title="Watchlist-ът е празен"
              description="Добави инструменти, които искаш да следиш — цена, промяна и AI статус на едно място."
              action={
                <Button size="sm" variant="outline" disabled={adder.busy} onClick={() => void adder.add(POPULAR_WATCH.map((p) => p.symbol))}>
                  <Plus size={13} strokeWidth={2.25} aria-hidden /> Add popular assets
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="px-1 pb-1">
            {rows.map((r) => (
              <PanelRow
                key={r.symbol}
                row={r}
                compact={compact}
                active={!!activeSymbol && activeSymbol.toUpperCase() === r.symbol.toUpperCase()}
                onSelect={onSelect}
                onRemove={() => void toggle(r.symbol, false)}
                removing={removing}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2 text-[11px]">
        <span className="text-faint">{more > 0 ? `+${more} още` : "AI статус: правила, не сигнал"}</span>
        <Link href="/watchlist" className="inline-flex items-center gap-1 font-medium text-accent2 transition-colors hover:text-text">
          Пълен списък <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function PanelRow({
  row,
  compact,
  active,
  onSelect,
  onRemove,
  removing,
}: {
  row: WatchlistRow;
  compact?: boolean;
  active: boolean;
  onSelect?: (symbol: string) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const tone = aiStatusTone(row.ai_status);
  const aiHint = row.ai_status ? `${row.ai_status}${row.ai_reason ? ` — ${row.ai_reason}` : ""}. ${AI_STATUS_META[row.ai_status as AiStatus]?.hint ?? ""}` : null;
  const main = (
    <>
      <ClassIcon cls={row.asset_class} size={22} />
      <span className="min-w-0 flex-1">
        <span className="num block truncate text-[12.5px] font-semibold leading-4 text-text">{row.symbol}</span>
        {!compact && <span className="block truncate text-[11px] leading-4 text-muted">{row.name}</span>}
      </span>
      {!compact && <QuoteSparkline quote={row.quote} width={48} height={18} className="hidden shrink-0 xl:block" />}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <PriceCell quote={row.quote} precision={pricePrecision(row)} className="text-[12px] leading-4" />
        <ChangeCell quote={row.quote} className="!px-1 !py-0 text-[10.5px]" />
      </span>
      {compact ? (
        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", row.ai_status ? DOT[tone] : "bg-white/15")} aria-label={row.ai_status ?? "Без AI статус"} />
      ) : (
        <span className="hidden w-[78px] shrink-0 justify-end sm:flex">
          <AiStatusBadge status={row.ai_status} pending={row.ai_pending} />
        </span>
      )}
    </>
  );
  const cls = cx(
    "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-1 text-left outline-none transition-colors duration-100 focus-visible:bg-white/[0.06]",
    active ? "bg-accent/[0.1] shadow-[inset_2px_0_0_0_var(--color-accent)]" : "hover:bg-white/[0.04]",
  );
  return (
    <li className="group relative flex items-center">
      <Tooltip content={aiHint} side="left" className="flex min-w-0 flex-1" disabled={!aiHint}>
        {onSelect ? (
          <button type="button" className={cls} onClick={() => onSelect(row.symbol)} aria-current={active || undefined}>
            {main}
          </button>
        ) : (
          <Link href={assetHref(row)} prefetch={false} className={cls}>
            {main}
          </Link>
        )}
      </Tooltip>
      <button
        type="button"
        aria-label={`Премахни ${row.symbol} от watchlist`}
        title="Премахни"
        disabled={removing}
        onClick={onRemove}
        className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-[opacity,color,background-color] hover:bg-down/10 hover:text-down focus-visible:opacity-100 disabled:opacity-30 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
      >
        <X size={13} strokeWidth={2.25} aria-hidden />
      </button>
    </li>
  );
}
