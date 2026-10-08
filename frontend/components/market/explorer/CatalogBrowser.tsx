"use client";

import { ChevronLeft, ChevronRight, Library, Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { useQuotes } from "@/components/market/hooks";
import { MarketTable, builtinColumn, type MarketColumn } from "@/components/market/MarketTable";
import type { CategoryTab } from "@/components/market/model";
import type { CatalogPayload, MarketItem } from "@/components/market/types";
import { Button, Card, EmptyState, ErrorState } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

export const CATALOG_PAGE_SIZE = 50;

/** Catalog columns; on narrower screens 7d, then the sparkline, then the sector make room (hidePriority). */
const CATALOG_COLUMNS: MarketColumn<MarketItem>[] = [
  builtinColumn("symbol"),
  builtinColumn("price"),
  builtinColumn("change"),
  { ...builtinColumn<MarketItem>("change7d"), hidePriority: 3 },
  builtinColumn("volume"),
  builtinColumn("range"),
  builtinColumn("trend"),
  { ...builtinColumn<MarketItem>("sparkline"), hidePriority: 2 },
  { ...builtinColumn<MarketItem>("sector"), hidePriority: 1 },
  builtinColumn("source"),
];

/** "" = server default: relevance while filtering by text, popularity otherwise */
type Sort = "" | "popularity" | "relevance" | "symbol" | "name";
const SORTS: { value: Sort; label: string }[] = [
  { value: "", label: "Подредба: авто" },
  { value: "popularity", label: "Популярност" },
  { value: "relevance", label: "Релевантност" },
  { value: "symbol", label: "Символ A–Z" },
  { value: "name", label: "Име A–Z" },
];

type Filters = { q: string; category: string; sector: string; sort: Sort; page: number };
const EMPTY: Filters = { q: "", category: "", sector: "", sort: "", page: 1 };

export function catalogKey(tab: CategoryTab, f: Omit<Filters, "q"> & { q: string }, pageSize = CATALOG_PAGE_SIZE): string {
  const p = new URLSearchParams();
  if (tab.filter.asset_class) p.set("asset_class", tab.filter.asset_class);
  const category = tab.filter.category ?? f.category;
  if (category) p.set("category", category);
  if (f.sector) p.set("sector", f.sector);
  if (f.q) p.set("q", f.q);
  if (f.sort) p.set("sort", f.sort);
  p.set("page", String(f.page));
  p.set("page_size", String(pageSize));
  return `/market/catalog?${p.toString()}`;
}

function facetOptions(facet: Record<string, number> | undefined): { value: string; label: string }[] {
  return Object.entries(facet ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({ value, label: `${value} (${n})` }));
}

/**
 * Full catalog browser of the explorer: GET /market/catalog (50 per page) with facets for category
 * and sector, a text filter and sorting; the visible page gets its quotes from /markets/quotes.
 */
export function CatalogBrowser({ tab }: { tab: CategoryTab }) {
  const [state, setState] = useState<{ tab: string; f: Filters }>({ tab: tab.key, f: EMPTY });
  const f = state.tab === tab.key ? state.f : EMPTY;
  const set = (patch: Partial<Filters>) => setState({ tab: tab.key, f: { ...f, page: 1, ...patch } });
  const dq = useDebounced(f.q.trim(), 250);

  const key = catalogKey(tab, { ...f, q: dq });
  const { data, error, isLoading, mutate } = useSWR<CatalogPayload>(key, fetcher, { keepPreviousData: true, revalidateOnFocus: false });
  const quotes = useQuotes(useMemo(() => (data?.items ?? []).map((a) => a.symbol), [data]));
  const rows: MarketItem[] = useMemo(() => (data?.items ?? []).map((a) => ({ ...a, quote: quotes.data?.quotes[a.symbol] ?? null })), [data, quotes.data]);

  const categories = facetOptions(data?.facets.category);
  const sectors = facetOptions(data?.facets.sector);
  const pages = data?.pages ?? 1;
  const from = data && data.total ? (data.page - 1) * data.page_size + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.page_size) : 0;

  const pager = (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" aria-label="Предишна страница" disabled={f.page <= 1} onClick={() => set({ page: f.page - 1 })}>
        <ChevronLeft size={14} strokeWidth={2} aria-hidden />
      </Button>
      <span className="num min-w-[72px] text-center text-xs text-muted">
        {f.page} / {Math.max(1, pages)}
      </span>
      <Button variant="outline" size="sm" aria-label="Следваща страница" disabled={f.page >= pages} onClick={() => set({ page: f.page + 1 })}>
        <ChevronRight size={14} strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Library size={15} strokeWidth={2} className="text-accent2" aria-hidden />
          Всички инструменти{tab.key !== "all" ? ` · ${tab.label}` : ""}
        </span>
      }
      right={data ? <span className="num text-[11px] text-faint">{data.total.toLocaleString("en-US")} инструмента</span> : null}
      bodyClass="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <label className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <span className="sr-only">Филтрирай каталога</span>
          <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            className="input h-8 py-0 pl-8 text-xs"
            placeholder="Филтър: символ, име, сектор…"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            spellCheck={false}
          />
        </label>
        {!tab.filter.category && categories.length > 1 && (
          <select aria-label="Категория" className="input h-8 w-auto max-w-[200px] py-0 text-xs" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Всички категории</option>
            {categories.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {sectors.length > 1 && (
          <select aria-label="Сектор" className="input h-8 w-auto max-w-[220px] py-0 text-xs" value={f.sector} onChange={(e) => set({ sector: e.target.value })}>
            <option value="">Всички сектори</option>
            {sectors.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Подреди" className="input h-8 w-auto py-0 text-xs" value={f.sort} onChange={(e) => set({ sort: e.target.value as Sort })}>
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {(f.q || f.category || f.sector) && (
          <Button variant="ghost" size="sm" onClick={() => set({ q: "", category: "", sector: "" })}>
            Изчисти
          </Button>
        )}
        <div className="ml-auto hidden md:block">{pager}</div>
      </div>

      {error && !data ? (
        <div className="p-4">
          <ErrorState title="Каталогът не се зареди" onRetry={() => mutate()} />
        </div>
      ) : (
        <div className={cx("transition-opacity", isLoading && data && "opacity-60")}>
          <MarketTable
            rows={rows}
            loading={!data}
            virtualized
            height={Math.min(Math.max(rows.length, 1), 12) * 46}
            columns={CATALOG_COLUMNS}
            minWidth={640}
            ariaLabel="Каталог с инструменти"
            empty={
              <EmptyState
                compact
                icon={SearchX}
                title="Няма инструменти по тези филтри"
                description="Промени филтъра или изчисти търсенето."
                action={
                  <Button variant="outline" size="sm" onClick={() => set({ q: "", category: "", sector: "" })}>
                    Изчисти филтрите
                  </Button>
                }
              />
            }
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2 text-[11px] text-faint">
        <span className="num">
          {data ? `${from}–${to} от ${data.total.toLocaleString("en-US")}` : "—"} · {CATALOG_PAGE_SIZE} на страница
        </span>
        {pager}
      </div>
    </Card>
  );
}
