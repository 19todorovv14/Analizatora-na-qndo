"use client";

import { BookOpen, Building2, Clock, GraduationCap, Info, Sigma } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ClassIcon } from "@/components/market/ClassBadge";
import { MarketStatusDot } from "@/components/market/MarketStatusDot";
import {
  assetHref,
  classLabel,
  fmtCompact,
  fmtCountdown,
  fmtPctPlain,
  fmtPctSigned,
  fmtQuotePrice,
  fmtUsdCompact,
  pricePrecision,
  quoteOk,
  trendMeta,
} from "@/components/market/model";
import { ChangeCell, PriceCell, QuoteSparkline } from "@/components/market/QuoteCells";
import type { AssetPagePayload, MarketItem, RegimeBlock } from "@/components/market/types";
import { Badge, Card, EmptyState, InfoTip, RegimeBadge, Term } from "@/components/ui";
import { cx, fmtTime } from "@/lib/format";

/** Current unix time (s), refreshed every `ms` (client only). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/* ─────────────────────────────────────────────────────────── stat cell */

export function MiniStat({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0 px-3 py-2", className)}>
      <div className="flex items-center gap-1 truncate text-[10.5px] font-medium uppercase leading-4 tracking-[0.06em] text-faint">{label}</div>
      <div className={cx("num mt-0.5 truncate text-[13.5px] font-semibold leading-5", tone ?? "text-text")}>{value}</div>
      {sub && <div className="truncate text-[11px] leading-4 text-muted">{sub}</div>}
    </div>
  );
}

const regimeOk = (r: RegimeBlock | undefined): r is Extract<RegimeBlock, { available: true }> => !!r && r.available === true;

export function RegimeValue({ block }: { block: RegimeBlock | undefined }) {
  if (!regimeOk(block)) {
    return (
      <span className="text-xs font-medium text-faint" title={block && !block.available ? (block.reason ?? undefined) : undefined}>
        N/A
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <RegimeBadge regime={block.regime} />
      {!!block.reasons?.length && <InfoTip text={block.reasons.join(" ")} />}
    </span>
  );
}

/* ──────────────────────────────────────────────────────── key stats */

/** Detailed statistics grid of the asset page (advanced mode shows the trading-cost details too). */
export function KeyStatsCard({ data, advanced }: { data: AssetPagePayload; advanced: boolean }) {
  const q = quoteOk(data.quote) ? data.quote : null;
  const inst = data.instrument;
  const p = pricePrecision({ quote: data.quote, price_precision: inst.price_precision });
  const base = inst.base || data.symbol.split("/")[0];
  const trend = trendMeta(q?.trend);
  const rows: { k: string; label: React.ReactNode; value: React.ReactNode; tone?: string; sub?: React.ReactNode; adv?: boolean }[] = [
    { k: "chg24", label: "24h промяна", value: fmtPctSigned(q?.change_24h_pct), tone: toneOf(q?.change_24h_pct), sub: q?.change_basis === "session" ? "спрямо предишното затваряне" : "rolling 24h" },
    { k: "chg7", label: "7d промяна", value: fmtPctSigned(q?.change_7d_pct), tone: toneOf(q?.change_7d_pct) },
    { k: "hi", label: "24h High", value: fmtQuotePrice(q?.high_24h, p) },
    { k: "lo", label: "24h Low", value: fmtQuotePrice(q?.low_24h, p) },
    { k: "range", label: <Term k="volatility">Range 24h</Term>, value: fmtPctPlain(q?.range_24h_pct) },
    { k: "atr", label: <Term k="atr">ATR 1d</Term>, value: fmtPctPlain(data.volatility?.atr_pct_1d), sub: "среден дневен диапазон" },
    { k: "atr1h", label: <Term k="atr">ATR 1h</Term>, value: fmtPctPlain(data.volatility?.atr_pct_1h), adv: true },
    { k: "vol", label: <Term k="volume">Volume 24h</Term>, value: q?.volume_24h !== null && q?.volume_24h !== undefined ? `${fmtCompact(q.volume_24h)} ${base}` : "—" },
    { k: "volusd", label: "Volume 24h (USD)", value: fmtUsdCompact(q?.volume_24h_usd) },
    { k: "trend", label: <Term k="trend">Trend (1D)</Term>, value: trend?.label ?? "—", tone: trend ? toneOf(trend.tone === "up" ? 1 : trend.tone === "down" ? -1 : 0) : undefined },
    { k: "r1h", label: <Term k="regime">Regime 1H</Term>, value: <RegimeValue block={data.regime?.["1h"]} /> },
    { k: "r1d", label: <Term k="regime">Regime 1D</Term>, value: <RegimeValue block={data.regime?.["1d"]} /> },
    { k: "spread", label: <Term k="spread">Spread</Term>, value: inst.spread_bps !== null && inst.spread_bps !== undefined ? `${inst.spread_bps} bps` : "—", sub: "симулиран (paper)" },
    {
      k: "fees",
      label: <Term k="fees">Fees</Term>,
      value: inst.taker_fee !== null && inst.taker_fee !== undefined ? `${(inst.taker_fee * 100).toFixed(3)}%` : "—",
      sub: inst.maker_fee !== null && inst.maker_fee !== undefined ? `maker ${(inst.maker_fee * 100).toFixed(3)}% · taker` : undefined,
      adv: true,
    },
    { k: "qty", label: "Min qty / step", value: inst.min_qty !== null && inst.min_qty !== undefined ? `${inst.min_qty} / ${inst.qty_step ?? "—"}` : "—", adv: true },
    { k: "asof", label: "Данни към", value: q?.as_of ? fmtTime(q.as_of) : "—", adv: true },
  ];
  const shown = rows.filter((r) => advanced || !r.adv);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Sigma size={15} strokeWidth={2} className="text-accent2" aria-hidden />
          Key stats
        </span>
      }
      right={!advanced ? <span className="text-[10.5px] text-faint">Advanced показва и разходите</span> : null}
      bodyClass="p-0"
    >
      {!q && (
        <p className="border-b border-white/[0.05] px-3 py-2 text-[11px] text-faint">
          DATA NOT AVAILABLE — {data.quote?.reason ?? "няма котировка от доставчика"}. Показваме само данните за инструмента.
        </p>
      )}
      <div className="grid grid-cols-2 divide-white/[0.05] [&>*]:border-b [&>*]:border-white/[0.05] [&>*:nth-child(odd)]:border-r">
        {shown.map((r) => (
          <MiniStat key={r.k} label={r.label} value={r.value} tone={r.tone} sub={r.sub} />
        ))}
      </div>
    </Card>
  );
}

function toneOf(v: number | null | undefined): string | undefined {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? "text-up" : "text-down";
}

/* ──────────────────────────────────────────────────────────── about */

export function AboutCard({ data, advanced }: { data: AssetPagePayload; advanced: boolean }) {
  const inst = data.instrument;
  const ms = data.market_status ?? inst.market_status ?? null;
  const now = useNow();
  const demo = (data.quote?.source?.status ?? inst.source?.status) === "demo";
  const left = ms?.next_change_ts ? ms.next_change_ts - now : null;
  const facts: [string, React.ReactNode][] = [
    ["Клас", classLabel(inst.asset_class)],
    ["Категория", inst.category || "—"],
    ["Сектор", inst.sector || "—"],
    ["Industry", inst.industry || "—"],
    ["Борса", inst.exchange || "—"],
    ["Държава", inst.country || "—"],
    ["Валута", inst.currency || "—"],
  ];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Info size={15} strokeWidth={2} className="text-info" aria-hidden />
          About
        </span>
      }
    >
      {inst.description && <p className="text-sm leading-relaxed text-text/90">{inst.description}</p>}
      <dl className={cx("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs", inst.description && "mt-3")}>
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="min-w-0 truncate text-text/90">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
            <Clock size={12} strokeWidth={2} aria-hidden /> Trading hours
          </span>
          {ms && <MarketStatusDot status={ms} showLabel />}
        </div>
        <p className="mt-1 text-xs text-text/90">{ms?.session_name || "—"}</p>
        {ms?.timezone && <p className="text-[11px] text-faint">Часова зона: {ms.timezone}</p>}
        {left !== null && left > 0 && (
          <p className="mt-1 text-[11px] text-muted">
            {ms?.status === "open" ? "Затваря" : "Отваря"} след <span className="num text-text">{fmtCountdown(left)}</span>
          </p>
        )}
        {ms?.note && <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{ms.note}</p>}
        {demo && !(ms?.note ?? "").includes("24/7") && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-warn/90">DEMO: синтетичните данни се генерират 24/7, независимо от часовете на реалния пазар.</p>
        )}
      </div>

      {advanced && (inst.aliases?.length || inst.provider_symbols) && (
        <div className="mt-3 space-y-1.5 text-[11px]">
          {!!inst.aliases?.length && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-faint">Търси се и като:</span>
              {inst.aliases.slice(0, 8).map((a) => (
                <Badge key={a} tone="neutral" className="normal-case tracking-normal">
                  {a}
                </Badge>
              ))}
            </div>
          )}
          {inst.provider_symbols && Object.keys(inst.provider_symbols).length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-faint">
              <Building2 size={11} strokeWidth={2} aria-hidden />
              {Object.entries(inst.provider_symbols)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────────────────────────────────────── education */

export function EducationCard({ lessons }: { lessons: AssetPagePayload["lessons"] }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <GraduationCap size={15} strokeWidth={2} className="text-up" aria-hidden />
          Education
        </span>
      }
      bodyClass="p-0"
    >
      {lessons.length ? (
        <ul className="divide-y divide-white/[0.05]">
          {lessons.map((l) => (
            <li key={l.slug}>
              <Link href={l.href || `/learn/${l.slug}`} prefetch={false} className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/[0.035]">
                <BookOpen size={14} strokeWidth={1.9} className="mt-0.5 shrink-0 text-faint group-hover:text-accent2" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-snug text-text group-hover:text-accent2">{l.title}</span>
                  {l.summary && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{l.summary}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-3">
          <EmptyState compact icon={GraduationCap} title="Няма свързани уроци" action={<Link href="/learn" className="text-xs font-medium text-accent2">Към Academy →</Link>} />
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────── related */

export function RelatedAssets({ items }: { items: MarketItem[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Related assets">
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Related assets</h2>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {items.map((it) => (
          <Link
            key={it.slug}
            href={assetHref(it)}
            prefetch={false}
            className="card hover-lift flex min-w-0 flex-col gap-1.5 px-3 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ClassIcon cls={it.asset_class} size={20} />
              <span className="num min-w-0 truncate text-[12.5px] font-semibold text-text">{it.symbol}</span>
            </span>
            <span className="truncate text-[11px] text-muted">{it.name}</span>
            <span className="flex items-end justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <PriceCell quote={it.quote} precision={pricePrecision(it)} className="truncate text-[12px]" />
                <ChangeCell quote={it.quote} className="mt-1 self-start" />
              </span>
              <QuoteSparkline quote={it.quote} width={56} height={24} className="shrink-0" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
