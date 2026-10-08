"use client";

import Link from "next/link";

import { ClassIcon } from "@/components/market/ClassBadge";
import { LIST_META, assetHref, listMetricText, pricePrecision } from "@/components/market/model";
import { ChangeCell, PriceCell, QuoteSparkline } from "@/components/market/QuoteCells";
import type { ListKind, MarketItem } from "@/components/market/types";
import { Skeleton } from "@/components/ui";
import { cx } from "@/lib/format";

export type QuoteListProps = {
  items: MarketItem[];
  /** list kind → which secondary metric to show (volume / range / 7d change) */
  kind?: ListKind;
  /** rows become buttons calling this instead of links to /markets/{slug} */
  onSelect?: (item: MarketItem) => void;
  /** highlighted symbol */
  activeSymbol?: string | null;
  sparkline?: boolean;
  loading?: boolean;
  /** skeleton rows while loading */
  rows?: number;
  dense?: boolean;
  className?: string;
};

/**
 * Dense instrument rows: class icon · symbol / name · sparkline · price (+ metric) · change pill.
 * The list is a size container: in narrow cards (< 24rem — three cards per row at 1280 px, side panels)
 * the sparkline is smaller and the change pill drops its arrow (sign + colour stay), so the symbol keeps
 * its room; below 20rem the sparkline is left out.
 */
export function QuoteList({ items, kind, onSelect, activeSymbol, sparkline = true, loading, rows = 5, dense, className }: QuoteListProps) {
  if (loading && !items.length) {
    return (
      <div className={cx("divide-y divide-white/[0.04]", className)} role="status" aria-busy="true">
        <span className="sr-only">Зареждане…</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cx("flex items-center gap-2.5 px-3", dense ? "h-9" : "h-11")} aria-hidden>
            <Skeleton className="h-[22px] w-[22px] !rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    );
  }
  const field = kind && LIST_META[kind].metric === "change7d" ? "change_7d_pct" : "change_24h_pct";
  return (
    <ul className={cx("@container divide-y divide-white/[0.04]", className)}>
      {items.map((it) => {
        const metric = kind ? listMetricText(kind, it.quote) : null;
        const active = !!activeSymbol && activeSymbol.toUpperCase() === it.symbol.toUpperCase();
        const body = (
          <>
            <ClassIcon cls={it.asset_class} size={22} />
            <span className="min-w-0 flex-1">
              <span className="num block truncate text-[12.5px] font-semibold leading-4 text-text">{it.symbol}</span>
              <span className="block truncate text-[11px] leading-4 text-muted">{it.name}</span>
            </span>
            {sparkline && (
              <>
                <QuoteSparkline quote={it.quote} width={36} height={18} className="hidden shrink-0 @min-[20rem]:@max-[24rem]:block" />
                <QuoteSparkline quote={it.quote} width={52} height={20} className="hidden shrink-0 @min-[24rem]:block" />
              </>
            )}
            <span className="flex w-[74px] shrink-0 flex-col items-end leading-4 @min-[24rem]:w-[84px]">
              <PriceCell quote={it.quote} precision={pricePrecision(it)} className="text-[12px]" />
              {metric && <span className="num text-[10.5px] text-faint">{metric}</span>}
            </span>
            <span className="flex w-[58px] shrink-0 justify-end @min-[24rem]:w-[72px]">
              <ChangeCell quote={it.quote} field={field} className="@max-[24rem]:!px-1 @max-[24rem]:[&>svg]:hidden" />
            </span>
          </>
        );
        const rowCls = cx(
          "flex w-full items-center gap-2 px-3 text-left transition-colors duration-100 focus-visible:bg-white/[0.06] focus-visible:outline-none @min-[24rem]:gap-2.5",
          dense ? "h-9" : "h-11",
          active ? "bg-accent/[0.09] shadow-[inset_2px_0_0_0_var(--color-accent)]" : "hover:bg-white/[0.035]",
        );
        return (
          <li key={it.slug || it.symbol}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(it)} className={rowCls} aria-current={active || undefined}>
                {body}
              </button>
            ) : (
              <Link href={assetHref(it)} className={rowCls} prefetch={false}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
