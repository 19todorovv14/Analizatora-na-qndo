"use client";

import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { assetHref, fmtPctSigned, fmtQuotePrice, fmtUsdCompact } from "@/components/market/model";
import { colorLimit, heatColor, layoutGroups, legendStops, type Placed } from "@/components/market/treemap";
import type { HeatmapPayload, HeatmapTile } from "@/components/market/types";
import { DataNotAvailable, EmptyState, ErrorState, Skeleton, SourceBadge, Term } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";

export type HeatmapProps = {
  /** crypto | stock | etf (the classes the backend can build a heatmap for) */
  assetClass: "crypto" | "stock" | "etf";
  /** desktop height in px (default 440; phones get 80%) */
  height?: number;
  /** mini version: no notes, smaller labels */
  compact?: boolean;
  /** tile click; default: open /markets/{slug} */
  onSelect?: (tile: HeatmapTile) => void;
  className?: string;
};

const tileLabel = (t: HeatmapTile) => (t.symbol.includes("/") ? t.symbol.split("/")[0] : t.symbol);

function tileAria(t: HeatmapTile, basis: HeatmapPayload["size_basis"]) {
  const parts = [`${t.name} (${t.symbol})`, `24h ${fmtPctSigned(t.change_24h_pct)}`];
  parts.push(basis === "market_cap" ? `market cap ${fmtUsdCompact(t.market_cap)}` : `24h volume ${fmtUsdCompact(t.volume_24h_usd)}`);
  return parts.join(", ");
}

/**
 * Market heatmap (GET /api/markets/heatmap): squarified treemap grouped by sector; tile area =
 * market cap when a real provider supplies it, otherwise 24h volume (USD) — the basis is always
 * labelled. Colour = 24h change on a diverging red ← slate → green scale. Never invents a market cap.
 */
export function Heatmap({ assetClass, height = 440, compact, onSelect, className }: HeatmapProps) {
  const { data, error, isLoading, mutate } = useSWR<HeatmapPayload>(`/markets/heatmap?asset_class=${assetClass}`, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ tile: HeatmapTile; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const h = width && width < 640 ? Math.round(height * 0.8) : height;
  const fresh = data && data.asset_class === assetClass ? data : undefined;
  const tiles = useMemo(() => fresh?.tiles ?? [], [fresh]);
  const limit = useMemo(() => colorLimit(tiles.map((t) => t.change_24h_pct)), [tiles]);
  const groups = useMemo(
    () =>
      width > 0
        ? layoutGroups(tiles, { x: 0, y: 0, w: width, h }, {
            value: (t) => t.size,
            group: (t) => t.group || t.sector || "Other",
            headerH: compact ? 0 : 18,
            minHeaderW: compact ? 1e9 : 96,
          })
        : [],
    [tiles, width, h, compact],
  );

  if (error && !fresh) {
    return <ErrorState title="Heatmap-ът не се зареди" onRetry={() => mutate()} className={className} />;
  }
  if (fresh && !fresh.available) {
    return <DataNotAvailable reason={fresh.reason ?? "DATA NOT AVAILABLE"} className={className} />;
  }

  const basisLabel =
    fresh?.size_basis === "market_cap" ? (
      <>
        Размер: <Term k="market_cap">market cap</Term>
      </>
    ) : (
      <>
        Размер: <Term k="volume">24h volume</Term> (USD)
      </>
    );

  return (
    <div className={cx("min-w-0", className)}>
      <div ref={setEl} className="relative w-full overflow-hidden rounded-lg bg-black/20" style={{ height: h }} onPointerLeave={() => setHover(null)}>
        {(!fresh || !width) && (isLoading || !fresh) && <Skeleton className="absolute inset-0 !rounded-lg" />}
        {fresh && !tiles.length && (
          <EmptyState icon={LayoutGrid} compact title="Няма данни за heatmap" description="Нито един инструмент няма 24h данни в момента." className="h-full" />
        )}
        {groups.map((g) => (
          <div key={g.key} className="absolute" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
            {g.header > 0 && (
              <div className="absolute inset-x-1 top-0 truncate text-[10px] font-semibold uppercase leading-[18px] tracking-[0.07em] text-muted">
                {g.label}
              </div>
            )}
          </div>
        ))}
        {groups.flatMap((g) =>
          g.tiles.map((p: Placed<HeatmapTile>) => {
            const t = p.item;
            const big = p.w >= 110 && p.h >= 64;
            const showSym = p.w >= 30 && p.h >= 16;
            const showChg = p.w >= 42 && p.h >= 32;
            const fs = Math.max(9, Math.min(compact ? 14 : 20, Math.sqrt(p.w * p.h) / 6.5));
            const style: React.CSSProperties = { left: p.x, top: p.y, width: p.w, height: p.h, background: heatColor(t.change_24h_pct, limit) };
            const inner = (
              <>
                {showSym && (
                  <span className="num block max-w-full truncate px-1 font-semibold leading-tight text-white" style={{ fontSize: fs }}>
                    {tileLabel(t)}
                  </span>
                )}
                {showChg && (
                  <span className="num block max-w-full truncate px-1 leading-tight text-white/85" style={{ fontSize: Math.max(9, fs * 0.72) }}>
                    {fmtPctSigned(t.change_24h_pct)}
                  </span>
                )}
                {big && !compact && <span className="block max-w-full truncate px-1.5 pt-0.5 text-[10px] leading-tight text-white/60">{t.name}</span>}
              </>
            );
            const common = {
              style,
              "aria-label": tileAria(t, fresh?.size_basis ?? "volume"),
              onPointerMove: (e: React.PointerEvent) => {
                const r = el?.getBoundingClientRect();
                if (r) setHover({ tile: t, x: e.clientX - r.left, y: e.clientY - r.top });
              },
              className:
                "absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] text-center shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)] transition-[filter] duration-100 hover:brightness-125 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/80",
            };
            return onSelect ? (
              <button key={t.slug} type="button" onClick={() => onSelect(t)} {...common}>
                {inner}
              </button>
            ) : (
              <Link key={t.slug} href={assetHref(t)} prefetch={false} {...common}>
                {inner}
              </Link>
            );
          }),
        )}
        {hover && <HeatTooltip hover={hover} width={width} height={h} basis={fresh?.size_basis ?? "volume"} />}
      </div>

      {fresh && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted">
          <div className="flex items-center gap-2">
            <span className="num text-faint">{fmtPctSigned(-limit, 1)}</span>
            <span className="flex h-2 w-32 overflow-hidden rounded-full" aria-hidden>
              {legendStops(limit, 9).map((s, i) => (
                <span key={i} className="h-full flex-1" style={{ background: s.color }} />
              ))}
            </span>
            <span className="num text-faint">{fmtPctSigned(limit, 1)}</span>
            <span className="text-faint">24h</span>
          </div>
          <span>{basisLabel}</span>
          <SourceBadge source={fresh.source} />
          {fresh.market_cap_source && <SourceBadge source={fresh.market_cap_source} />}
          {!compact && fresh.note && <span className="w-full leading-relaxed text-faint">{fresh.note}</span>}
          {!compact && !!fresh.excluded?.length && (
            <span className="w-full text-faint" title={fresh.excluded.map((x) => `${x.symbol}: ${x.reason}`).join("\n")}>
              Извън картата: {fresh.excluded.length} инструмента (DATA NOT AVAILABLE).
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function HeatTooltip({
  hover,
  width,
  height,
  basis,
}: {
  hover: { tile: HeatmapTile; x: number; y: number };
  width: number;
  height: number;
  basis: HeatmapPayload["size_basis"];
}) {
  const t = hover.tile;
  const W = 220;
  const left = Math.max(6, Math.min(hover.x + 14, width - W - 6));
  const top = hover.y + 14 + 120 > height ? Math.max(6, hover.y - 128) : hover.y + 14;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg border border-white/10 bg-popover px-3 py-2 text-xs shadow-pop"
      style={{ left, top, width: W }}
      role="tooltip"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="num font-semibold text-text">{t.symbol}</span>
        <span className={cx("num font-semibold", (t.change_24h_pct ?? 0) > 0 ? "text-up" : (t.change_24h_pct ?? 0) < 0 ? "text-down" : "text-muted")}>
          {fmtPctSigned(t.change_24h_pct)}
        </span>
      </div>
      <div className="truncate text-muted">{t.name}</div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        {t.group && (
          <>
            <dt className="text-faint">Сектор</dt>
            <dd className="truncate text-right text-text/90">{t.group}</dd>
          </>
        )}
        <dt className="text-faint">Цена</dt>
        <dd className="num text-right text-text/90">{fmtQuotePrice(t.price, t.precision ?? 2)}</dd>
        <dt className="text-faint">Volume 24h</dt>
        <dd className="num text-right text-text/90">{fmtUsdCompact(t.volume_24h_usd)}</dd>
        <dt className="text-faint">Market cap</dt>
        <dd className={cx("num text-right", t.market_cap === null ? "text-faint" : "text-text/90")}>
          {t.market_cap === null ? "DATA NOT AVAILABLE" : fmtUsdCompact(t.market_cap)}
        </dd>
      </dl>
      <div className="mt-1.5 text-[10px] text-faint">Размер по {basis === "market_cap" ? "market cap" : "24h volume (USD)"}</div>
    </div>
  );
}
