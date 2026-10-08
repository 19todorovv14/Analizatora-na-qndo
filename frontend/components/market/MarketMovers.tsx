"use client";

import { Activity, ChevronLeft, ChevronRight, Flame, Gauge, Loader, Star, TrendingDown, TrendingUp, Waves, type LucideIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { LIST_META, listKey } from "@/components/market/model";
import { QuoteList } from "@/components/market/QuoteList";
import type { ListKind, MarketList } from "@/components/market/types";
import { Card, DataNotAvailable, EmptyState, ErrorState, InfoTip, SourceBadge, Term } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";

type ScopedList = MarketList & { __scope?: string };

const KIND_ICON: Record<ListKind, { icon: LucideIcon; ink: string }> = {
  gainers: { icon: TrendingUp, ink: "text-up" },
  losers: { icon: TrendingDown, ink: "text-down" },
  most_volume: { icon: Activity, ink: "text-info" },
  high_volatility: { icon: Flame, ink: "text-warn" },
  low_volatility: { icon: Waves, ink: "text-accent2" },
  trending: { icon: Gauge, ink: "text-violet" },
  popular: { icon: Star, ink: "text-gold" },
};

export type MarketMoversProps = {
  /** gainers | losers | most_volume | high_volatility | low_volatility | trending | popular */
  kind: ListKind;
  /** crypto | stock | etf | forex | index | commodity, or the commodity aliases metal | energy | agriculture */
  assetClass?: string | null;
  category?: string | null;
  /** rows per page (default 6, ≤ 100) */
  limit?: number;
  /** override the card title */
  title?: React.ReactNode;
  /** dense rows without sparklines (dashboards, side panels) */
  compact?: boolean;
  /** ‹ 1/13 › pager in the header (default: on unless compact) */
  pager?: boolean;
  className?: string;
};

/**
 * Market movers card for one list of GET /api/markets/list (Top gainers, Top losers, Most volume,
 * High / Low volatility, Trending, Popular) with sparkline + change pill per row. Shows DATA NOT
 * AVAILABLE when the configured provider cannot compute the list; polls every 30 s.
 */
export function MarketMovers({ kind, assetClass, category, limit = 6, title, compact, pager, className }: MarketMoversProps) {
  const scope = `${assetClass ?? ""}|${category ?? ""}|${kind}`;
  const [pageState, setPageState] = useState({ scope, page: 1 });
  const page = pageState.scope === scope ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ scope, page: p });

  const { data, error, isLoading, mutate } = useSWR<ScopedList>(
    listKey(kind, { assetClass, category, page, pageSize: limit }),
    (key: string) => fetcher<MarketList>(key).then((d) => ({ ...d, __scope: scope })),
    {
      refreshInterval: (d) => (d?.status === "warming" ? 5_000 : 30_000),
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  );
  // keepPreviousData keeps the old page while paging; another class / kind is never shown as this one
  const fresh = data?.__scope === scope ? data : undefined;

  const meta = LIST_META[kind];
  const { icon: Icon, ink } = KIND_ICON[kind];
  const showPager = (pager ?? !compact) && !!fresh?.available && (fresh?.pages ?? 0) > 1;
  const source = fresh?.items.find((i) => i.quote?.source)?.quote?.source ?? fresh?.items[0]?.source;

  const heading = (
    <span className="flex min-w-0 items-center gap-2">
      <Icon size={15} strokeWidth={2} className={cx("shrink-0", ink)} aria-hidden />
      <span className="truncate">{title ?? (meta.term ? <Term k={meta.term}>{meta.title}</Term> : meta.title)}</span>
      {!compact && <InfoTip text={fresh?.description || meta.bg} />}
    </span>
  );

  const right = (
    <>
      {!compact && source && <SourceBadge source={source} />}
      {showPager && fresh && (
        <span className="flex items-center gap-0.5 text-[11px] text-faint">
          <button
            type="button"
            aria-label="Предишна страница"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-30"
          >
            <ChevronLeft size={14} strokeWidth={2} aria-hidden />
          </button>
          <span className="num min-w-[38px] text-center">
            {page}/{fresh.pages}
          </span>
          <button
            type="button"
            aria-label="Следваща страница"
            disabled={page >= fresh.pages}
            onClick={() => setPage(Math.min(fresh.pages, page + 1))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-30"
          >
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
          </button>
        </span>
      )}
    </>
  );

  let body: React.ReactNode;
  if (error && !fresh) {
    body = (
      <div className="p-3">
        <ErrorState title="Списъкът не се зареди" description="Опитай отново след малко." onRetry={() => mutate()} className="py-6" />
      </div>
    );
  } else if (!fresh) {
    body = <QuoteList items={[]} loading rows={Math.min(limit, 6)} dense={compact} />;
  } else if (fresh.status === "warming") {
    body = (
      <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted" role="status">
        <Loader size={14} strokeWidth={2} className="animate-spin text-info" aria-hidden />
        Данните се подготвят (warm-up) — списъкът ще се появи след няколко секунди.
      </div>
    );
  } else if (!fresh.available) {
    body = (
      <div className="p-3">
        <DataNotAvailable compact reason={fresh.reason ?? "The configured provider plan cannot compute this list"} />
      </div>
    );
  } else if (!fresh.items.length) {
    body = (
      <div className="p-3">
        <EmptyState compact title="Няма инструменти в тази класация" description="В момента нито един инструмент не отговаря на условието." />
      </div>
    );
  } else {
    body = <QuoteList items={fresh.items} kind={kind} sparkline={!compact} dense={compact} loading={isLoading && !fresh} />;
  }

  return (
    <Card title={heading} right={right} className={cx("flex flex-col", className)} bodyClass="p-0 flex-1">
      {body}
      {fresh?.note && !compact && <p className="border-t border-white/[0.04] px-3 py-1.5 text-[10.5px] leading-4 text-faint">{fresh.note}</p>}
    </Card>
  );
}
