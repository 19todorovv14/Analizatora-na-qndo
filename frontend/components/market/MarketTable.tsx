"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClassBadge, ClassIcon } from "@/components/market/ClassBadge";
import { assetHref, pricePrecision, quoteOk, type SortKey, type SortState } from "@/components/market/model";
import { ChangeCell, PriceCell, QuoteSparkline, RangeCell, TrendBadge, VolumeCell } from "@/components/market/QuoteCells";
import type { MarketItem } from "@/components/market/types";
import { RegimeBadge, Skeleton, SourceBadge, Term, VirtualList } from "@/components/ui";
import { cx } from "@/lib/format";

export type MarketColumnKey =
  | "symbol"
  | "name"
  | "class"
  | "price"
  | "change"
  | "change7d"
  | "volume"
  | "range"
  | "trend"
  | "regime"
  | "sparkline"
  | "source"
  | "exchange"
  | "sector";

export type MarketColumn<T> = {
  key: string;
  header: React.ReactNode;
  /** CSS grid track, e.g. "96px" or "minmax(160px,2fr)" */
  width: string;
  align?: "left" | "right" | "center";
  /** makes the header clickable when MarketTable gets onSort */
  sortKey?: SortKey;
  render: (row: T) => React.ReactNode;
};

export type MarketTableProps<T extends MarketItem> = {
  rows: T[];
  /** built-in column keys and/or custom columns (default: symbol, price, change, 7d, volume, range, trend, sparkline, source) */
  columns?: (MarketColumnKey | MarketColumn<T>)[];
  /** row click (default: open /markets/{slug}) */
  onRowClick?: (row: T) => void;
  /** window the rows with VirtualList (long lists) */
  virtualized?: boolean;
  /** viewport height of the virtualized list (default: up to 12 rows) */
  height?: number;
  rowHeight?: number;
  sort?: SortState | null;
  onSort?: (key: SortKey) => void;
  loading?: boolean;
  /** shown instead of rows when there are none */
  empty?: React.ReactNode;
  /** below this width the table scrolls horizontally (default 760 px) */
  minWidth?: number;
  activeSymbol?: string | null;
  className?: string;
  ariaLabel?: string;
};

export const DEFAULT_COLUMNS: MarketColumnKey[] = ["symbol", "price", "change", "change7d", "volume", "range", "trend", "sparkline", "source"];

/** Built-in column definitions (exported so pages can mix them with their own columns). */
export function builtinColumn<T extends MarketItem>(key: MarketColumnKey): MarketColumn<T> {
  switch (key) {
    case "symbol":
      return {
        key,
        header: "Инструмент",
        width: "minmax(190px,2.2fr)",
        sortKey: "symbol",
        render: (r) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <ClassIcon cls={r.asset_class} size={24} />
            <span className="min-w-0">
              <Link href={assetHref(r)} prefetch={false} className="num block truncate text-[13px] font-semibold leading-4 text-text hover:text-accent2 focus-visible:text-accent2 focus-visible:outline-none">
                {r.symbol}
              </Link>
              <span className="block truncate text-[11px] leading-4 text-muted">{r.name}</span>
            </span>
          </span>
        ),
      };
    case "name":
      return { key, header: "Име", width: "minmax(140px,1.5fr)", sortKey: "name", render: (r) => <span className="truncate text-muted">{r.name}</span> };
    case "class":
      return { key, header: "Клас", width: "104px", render: (r) => <ClassBadge cls={r.asset_class} /> };
    case "price":
      return {
        key,
        header: "Цена",
        width: "112px",
        align: "right",
        sortKey: "price",
        render: (r) => <PriceCell quote={r.quote} precision={pricePrecision(r)} className="text-[12.5px]" />,
      };
    case "change":
      return { key, header: "24h", width: "86px", align: "right", sortKey: "change", render: (r) => <ChangeCell quote={r.quote} /> };
    case "change7d":
      return { key, header: "7d", width: "86px", align: "right", sortKey: "change7d", render: (r) => <ChangeCell quote={r.quote} field="change_7d_pct" /> };
    case "volume":
      return {
        key,
        header: <Term k="volume">Volume 24h</Term>,
        width: "104px",
        align: "right",
        sortKey: "volume",
        render: (r) => <VolumeCell quote={r.quote} className="text-[12px]" />,
      };
    case "range":
      return {
        key,
        header: <Term k="volatility">Range 24h</Term>,
        width: "92px",
        align: "right",
        sortKey: "range",
        render: (r) => <RangeCell quote={r.quote} className="text-[12px]" />,
      };
    case "trend":
      return { key, header: <Term k="trend">Trend</Term>, width: "112px", sortKey: "trend", render: (r) => <TrendBadge trend={quoteOk(r.quote) ? r.quote.trend : null} /> };
    case "regime":
      return {
        key,
        header: <Term k="regime">Regime</Term>,
        width: "150px",
        sortKey: "regime",
        render: (r) => (quoteOk(r.quote) && r.quote.regime ? <RegimeBadge regime={r.quote.regime} /> : <span className="text-xs text-faint">—</span>),
      };
    case "sparkline":
      return { key, header: "Графика", width: "86px", align: "center", render: (r) => <QuoteSparkline quote={r.quote} width={72} height={22} /> };
    case "source":
      return {
        key,
        header: "Данни",
        width: "92px",
        align: "right",
        render: (r) => {
          const src = r.quote?.source ?? r.source;
          return r.available === false ? (
            <span title={`DATA NOT AVAILABLE — ${r.unavailable_reason ?? ""}`} className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
              N/A
            </span>
          ) : (
            <SourceBadge source={src} />
          );
        },
      };
    case "exchange":
      return { key, header: "Борса", width: "104px", render: (r) => <span className="truncate text-xs text-muted">{r.exchange || "—"}</span> };
    case "sector":
      return { key, header: "Сектор", width: "minmax(120px,1fr)", render: (r) => <span className="truncate text-xs text-muted">{r.sector || r.category || "—"}</span> };
  }
}

const ALIGN = { left: "justify-start text-left", right: "justify-end text-right", center: "justify-center text-center" } as const;

/**
 * Dense, sortable instrument table (div grid with table roles). Rows open /markets/{slug} unless
 * onRowClick is given. `virtualized` windows the rows (VirtualList); narrow screens scroll sideways.
 */
export function MarketTable<T extends MarketItem>({
  rows,
  columns = DEFAULT_COLUMNS,
  onRowClick,
  virtualized,
  height,
  rowHeight = 46,
  sort,
  onSort,
  loading,
  empty,
  minWidth = 760,
  activeSymbol,
  className,
  ariaLabel = "Инструменти",
}: MarketTableProps<T>) {
  const router = useRouter();
  const cols = columns.map((c) => (typeof c === "string" ? builtinColumn<T>(c) : c));
  const template = cols.map((c) => c.width).join(" ");

  const open = (row: T) => (onRowClick ? onRowClick(row) : router.push(assetHref(row)));

  const renderRow = (row: T) => {
    const active = !!activeSymbol && activeSymbol.toUpperCase() === row.symbol.toUpperCase();
    return (
      <div
        role="row"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button,input,select,[role=button]")) return;
          open(row);
        }}
        className={cx(
          "grid h-full cursor-pointer items-center gap-3 border-b border-white/[0.045] px-3 transition-colors duration-100",
          active ? "bg-accent/[0.08]" : "hover:bg-white/[0.035]",
        )}
        style={{ gridTemplateColumns: template }}
      >
        {cols.map((c) => (
          <div key={c.key} role="cell" className={cx("flex min-w-0 items-center", ALIGN[c.align ?? "left"])}>
            {c.render(row)}
          </div>
        ))}
      </div>
    );
  };

  const header = (
    <div
      role="row"
      className="grid h-9 items-center gap-3 border-b border-white/[0.07] bg-surface/80 px-3 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-faint"
      style={{ gridTemplateColumns: template }}
    >
      {cols.map((c) => {
        const sorted = sort && c.sortKey && sort.key === c.sortKey ? sort.dir : null;
        const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : c.sortKey && onSort ? "none" : undefined;
        return (
          <div key={c.key} role="columnheader" aria-sort={ariaSort} className={cx("flex min-w-0 items-center", ALIGN[c.align ?? "left"])}>
            {c.sortKey && onSort ? (
              <button
                type="button"
                onClick={() => onSort(c.sortKey as SortKey)}
                className={cx(
                  "inline-flex min-w-0 items-center gap-1 rounded uppercase tracking-[0.07em] transition-colors hover:text-text",
                  sorted ? "text-text" : "text-faint",
                )}
              >
                <span className="truncate">{c.header}</span>
                {sorted === "asc" ? (
                  <ArrowUp size={11} strokeWidth={2.5} aria-hidden />
                ) : sorted === "desc" ? (
                  <ArrowDown size={11} strokeWidth={2.5} aria-hidden />
                ) : (
                  <ChevronsUpDown size={11} strokeWidth={2} className="opacity-50" aria-hidden />
                )}
              </button>
            ) : (
              <span className="truncate">{c.header}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  let body: React.ReactNode;
  if (loading && !rows.length) {
    body = (
      <div role="rowgroup" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="grid items-center gap-3 border-b border-white/[0.04] px-3" style={{ gridTemplateColumns: template, height: rowHeight }} aria-hidden>
            {cols.map((c, j) => (
              <Skeleton key={c.key} className={cx("h-3", c.align === "right" && "ml-auto")} style={{ width: j === 0 ? "70%" : `${40 + ((i * 7 + j * 13) % 40)}%` }} />
            ))}
          </div>
        ))}
      </div>
    );
  } else if (!rows.length) {
    body = <div className="p-4">{empty ?? <p className="text-center text-sm text-muted">Няма инструменти.</p>}</div>;
  } else if (virtualized) {
    const h = height ?? Math.min(rows.length, 12) * rowHeight;
    body = (
      <VirtualList
        items={rows}
        rowHeight={rowHeight}
        height={h}
        renderRow={(row) => renderRow(row)}
        getKey={(row) => row.slug || row.symbol}
        ariaLabel={ariaLabel}
      />
    );
  } else {
    body = (
      <div role="rowgroup">
        {rows.map((row) => (
          <div key={row.slug || row.symbol} style={{ height: rowHeight }}>
            {renderRow(row)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cx("min-w-0 overflow-x-auto", className)}>
      <div role="table" aria-label={ariaLabel} aria-rowcount={rows.length + 1} style={{ minWidth }}>
        {header}
        {body}
      </div>
    </div>
  );
}
