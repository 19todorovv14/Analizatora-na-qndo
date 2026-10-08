"use client";

import { ArrowDownUp, ChevronLeft, ChevronRight, Eye, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { ClassIcon } from "@/components/market/ClassBadge";
import { useAddToWatchlist, useWatchlistToggle } from "@/components/market/hooks";
import { MarketTable, builtinColumn, type MarketColumn } from "@/components/market/MarketTable";
import { AI_STATUS_META, nextSort, sortRows, type SortState } from "@/components/market/model";
import { AiStatusBadge } from "@/components/market/QuoteCells";
import type { AiStatus, WatchlistPayload, WatchlistRow } from "@/components/market/types";
import { POPULAR_WATCH, watchlistKey } from "@/components/market/WatchlistPanel";
import { Button, Card, EmptyState, ErrorState, IconButton, PageHeader, Term, Tooltip } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { LearnHint } from "@/lib/workspace";

export const WATCHLIST_PAGE_SIZE = 100;
const ROW_H = 48;

function aiColumn(): MarketColumn<WatchlistRow> {
  return {
    key: "ai",
    header: "AI status",
    width: "minmax(150px,1.3fr)",
    sortKey: "ai",
    render: (r) => {
      const hint = r.ai_status ? AI_STATUS_META[r.ai_status as AiStatus]?.hint : null;
      const content = r.ai_status ? (
        <span className="block max-w-[260px] space-y-1 text-left">
          <span className="block font-semibold text-text">
            {r.ai_status}
            {r.ai_confidence ? <span className="font-normal text-muted"> · confidence {r.ai_confidence}</span> : null}
          </span>
          {r.ai_reason && <span className="block text-muted">{r.ai_reason}</span>}
          {hint && <span className="block text-faint">{hint}</span>}
        </span>
      ) : null;
      return (
        <Tooltip content={content} side="left" disabled={!content} className="flex min-w-0 items-center gap-2">
          <AiStatusBadge status={r.ai_status} pending={r.ai_pending} />
          {r.ai_reason && <span className="hidden min-w-0 truncate text-[11px] text-faint 2xl:inline">{r.ai_reason}</span>}
        </Tooltip>
      );
    },
  };
}

/** /watchlist — the full, practically unlimited watchlist (server pages of 100 + VirtualList, sortable columns). */
export function WatchlistPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);
  const { data, error, isLoading, mutate } = useSWR<WatchlistPayload>(watchlistKey(page, WATCHLIST_PAGE_SIZE), fetcher, {
    refreshInterval: (d) => (d?.items.some((r) => r.ai_pending) ? 5_000 : 30_000),
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const { toggle, busy: removing } = useWatchlistToggle();
  const adder = useAddToWatchlist();

  const rows = useMemo(() => sortRows(data?.items ?? [], sort), [data, sort]);
  const pages = data?.pages ?? 1;
  const symbols = (data?.items ?? []).map((r) => r.symbol);

  const columns = useMemo<MarketColumn<WatchlistRow>[]>(
    () => [
      builtinColumn<WatchlistRow>("symbol"),
      builtinColumn<WatchlistRow>("price"),
      { ...builtinColumn<WatchlistRow>("change"), header: "Change 24h" },
      builtinColumn<WatchlistRow>("volume"),
      { ...builtinColumn<WatchlistRow>("range"), header: <Term k="volatility">Volatility</Term> },
      builtinColumn<WatchlistRow>("trend"),
      builtinColumn<WatchlistRow>("regime"),
      aiColumn(),
      {
        key: "remove",
        header: <span className="sr-only">Действия</span>,
        width: "44px",
        align: "right",
        render: (r) => (
          <IconButton icon={Trash2} size="sm" label={`Премахни ${r.symbol}`} disabled={removing} onClick={() => void toggle(r.symbol, false)} tooltipSide="left" />
        ),
      },
    ],
    [removing, toggle],
  );

  const add = (
    <AssetSearchCombobox
      value=""
      clearOnSelect
      onChange={(s) => void adder.add([s])}
      className="w-full sm:w-80"
      placeholder="Добави инструмент…"
      ariaLabel="Добави инструмент в watchlist"
      markedSymbols={symbols}
      markedLabel="в списъка"
    />
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHeader
        title="Watchlist"
        icon={Eye}
        subtitle="Инструментите, които следиш: цена, промяна, обем, волатилност, тренд, режим и AI статус. Кликни ред, за да отвориш актива."
        actions={add}
      />
      {adder.error && <p className="text-xs text-down">{adder.error}</p>}

      <LearnHint title="Какво е AI status?">
        Образователна оценка по правила върху последните затворени 1H свещи: LONG SETUP / SHORT SETUP означава, че условията на
        setup-а са изпълнени (хипотеза, не гаранция), WAIT — че липсва потвърждение, NO TRADE — че няма ясен setup. Не е сигнал за
        покупка или продажба.
      </LearnHint>

      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="num">{data ? `${data.total.toLocaleString("en-US")} инструмента` : "…"}</span>
            {sort ? (
              <button type="button" onClick={() => setSort(null)} className="inline-flex items-center gap-1 text-accent2 hover:text-text">
                <ArrowDownUp size={12} strokeWidth={2} aria-hidden /> Моята подредба
              </button>
            ) : (
              <span className="text-faint">Подредба: твоята · кликни колона, за да сортираш</span>
            )}
            {sort && pages > 1 && <span className="text-faint">(сортира се текущата страница)</span>}
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" aria-label="Предишна страница" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft size={14} strokeWidth={2} aria-hidden />
              </Button>
              <span className="num min-w-[64px] text-center text-xs text-muted">
                {page} / {pages}
              </span>
              <Button variant="outline" size="sm" aria-label="Следваща страница" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRight size={14} strokeWidth={2} aria-hidden />
              </Button>
            </div>
          )}
        </div>

        {error && !data ? (
          <div className="p-4">
            <ErrorState title="Watchlist-ът не се зареди" onRetry={() => mutate()} />
          </div>
        ) : data && !data.total ? (
          <div className="p-4">
            <EmptyState
              icon={Eye}
              title="Watchlist-ът е празен"
              description="Добави инструментите, които искаш да следиш — с едно натискане или чрез търсенето горе."
              action={
                <div className="flex max-w-xl flex-col items-center gap-3">
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {POPULAR_WATCH.map((p) => (
                      <button
                        key={p.symbol}
                        type="button"
                        disabled={adder.busy}
                        onClick={() => void adder.add([p.symbol])}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-text transition-colors hover:border-white/[0.2] hover:bg-white/[0.08] disabled:opacity-50"
                      >
                        <ClassIcon cls={p.asset_class} size={16} />
                        <span className="num">{p.symbol}</span>
                        <Plus size={11} strokeWidth={2.5} className="text-faint" aria-hidden />
                      </button>
                    ))}
                  </div>
                  <Button size="sm" disabled={adder.busy} onClick={() => void adder.add(POPULAR_WATCH.map((p) => p.symbol))}>
                    <Plus size={13} strokeWidth={2.25} aria-hidden /> Add popular assets
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <MarketTable<WatchlistRow>
            rows={rows}
            columns={columns}
            loading={isLoading && !data}
            virtualized
            rowHeight={ROW_H}
            height={Math.min(Math.max(rows.length, 1), 14) * ROW_H}
            sort={sort}
            onSort={(k) => setSort(nextSort(sort, k))}
            minWidth={1080}
            ariaLabel="Watchlist"
          />
        )}
      </Card>
    </div>
  );
}
