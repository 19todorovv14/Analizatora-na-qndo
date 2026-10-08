"use client";

import { BrainCircuit, ChartCandlestick, ChevronRight, History, LineChart, Newspaper, SearchX, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { ChartWorkspace } from "@/components/charts/ChartWorkspace";
import { AiAnalysisCard } from "@/components/market/asset/AiAnalysisCard";
import { AboutCard, EducationCard, KeyStatsCard, MiniStat, RegimeValue, RelatedAssets } from "@/components/market/asset/AssetSections";
import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { ClassBadge, ClassIcon } from "@/components/market/ClassBadge";
import { useRecordView } from "@/components/market/hooks";
import { LinkButton } from "@/components/market/LinkButton";
import { MarketStatusDot } from "@/components/market/MarketStatusDot";
import { FavoriteButton, WatchlistButton } from "@/components/market/MembershipButtons";
import {
  CATEGORY_TABS,
  askAiHref,
  assetHref,
  chartHref,
  fmtCompact,
  fmtPctPlain,
  fmtUsdCompact,
  pricePrecision,
  quoteOk,
  quoteState,
  replayHref,
  tradeHref,
  trendMeta,
} from "@/components/market/model";
import { NewsPanel } from "@/components/market/NewsPanel";
import { TrendBadge } from "@/components/market/QuoteCells";
import type { AssetPagePayload } from "@/components/market/types";
import { Badge, Card, ChangePill, ChartSkeleton, DataNotAvailable, EmptyState, ErrorState, PriceText, Skeleton, SkeletonText, SourceBadge, Term } from "@/components/ui";
import { ApiError, fetcher } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";
import { LearnHint } from "@/lib/workspace";

const classTab = (cls: string | null | undefined) => CATEGORY_TABS.find((t) => t.key === cls);

function AssetSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="card space-y-4 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 !rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-9 w-36" />
        </div>
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ChartSkeleton height={480} />
        <div className="card p-4">
          <SkeletonText lines={8} />
        </div>
      </div>
    </div>
  );
}

function NotFound({ slug }: { slug: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-2xl pt-6">
      <EmptyState
        icon={SearchX}
        title="Инструментът не е намерен"
        description={`Няма инструмент „${slug}“ в каталога. Потърси по символ или име — например BTC, Apple, EUR/USD.`}
        action={
          <div className="flex w-full max-w-md flex-col items-center gap-3">
            <AssetSearchCombobox value="" clearOnSelect onChange={() => {}} onSelectAsset={(a) => router.push(assetHref(a))} className="w-full" />
            <LinkButton href="/markets">← Всички пазари</LinkButton>
          </div>
        }
      />
    </div>
  );
}

/** /markets/[slug] — ASSET PAGE (header, chart, AI analysis, stats, about, news & events, education, related). */
export function AssetView({ slug }: { slug: string }) {
  const router = useRouter();
  const { beginner } = useSession();
  const [tf, setTf] = useState("1h");
  const { data, error, mutate } = useSWR<AssetPagePayload>(`/markets/asset/${encodeURIComponent(slug)}`, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
    shouldRetryOnError: (e: unknown) => !(e instanceof ApiError && e.status === 404),
  });
  useRecordView(data?.symbol);

  // /markets/btcusdt or /markets/BTC%2FUSDT → canonical /markets/BTC-USDT
  useEffect(() => {
    if (data?.slug && data.slug !== slug) router.replace(assetHref(data));
  }, [data, slug, router]);

  if (error instanceof ApiError && error.status === 404) return <NotFound slug={slug} />;
  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl pt-6">
        <ErrorState title="Страницата на актива не се зареди" description="Провери връзката с backend-а и опитай пак." onRetry={() => mutate()} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <AssetSkeleton />
      </div>
    );
  }

  const inst = data.instrument;
  const q = quoteOk(data.quote) ? data.quote : null;
  const qs = quoteState(data.quote);
  const p = pricePrecision({ quote: data.quote, price_precision: inst.price_precision });
  const source = data.quote?.source ?? inst.source;
  const ms = data.market_status ?? inst.market_status ?? null;
  const tab = classTab(inst.asset_class);
  const trend = trendMeta(q?.trend);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-faint">
        <Link href="/markets" className="hover:text-text">
          Markets
        </Link>
        {tab && (
          <>
            <ChevronRight size={12} strokeWidth={2} aria-hidden />
            <Link href={`/markets?class=${tab.key}`} className="hover:text-text">
              {tab.label}
            </Link>
          </>
        )}
        <ChevronRight size={12} strokeWidth={2} aria-hidden />
        <span className="num truncate text-muted" aria-current="page">
          {data.symbol}
        </span>
      </nav>

      {/* ── header ───────────────────────────────────────────────────── */}
      <section className="card overflow-hidden" aria-label="Обзор на актива">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <ClassIcon cls={inst.asset_class} size={48} className="!rounded-xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-text sm:text-2xl">{inst.name}</h1>
                <span className="num rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs font-semibold text-muted">{data.symbol}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted">
                <ClassBadge cls={inst.asset_class} />
                {inst.category && <Badge tone="neutral">{inst.category}</Badge>}
                {inst.exchange && <span>{inst.exchange}</span>}
                {inst.currency && <span className="text-faint">· {inst.currency}</span>}
                {ms && <MarketStatusDot status={ms} showLabel />}
                <SourceBadge source={source} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FavoriteButton symbol={data.symbol} initial={data.is_favorite} />
            <WatchlistButton symbol={data.symbol} initial={data.in_watchlist} />
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pb-4">
          <div className="min-w-0">
            {q && q.price !== null ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <PriceText value={q.price} precision={p} flash className="text-3xl font-semibold tracking-[-0.02em] text-text sm:text-[34px]" />
                <span className="text-sm text-faint">{q.currency ?? inst.currency}</span>
                <ChangePill value={q.change_24h_pct} className="text-[13px]" />
                <span className="text-xs text-faint">24h</span>
              </div>
            ) : (
              <DataNotAvailable compact reason={qs.detail ?? data.reason ?? "Няма котировка от доставчика."} />
            )}
            {q?.partial && <p className="mt-1 text-[11px] text-faint">{q.reason}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={chartHref(data.symbol)} variant="primary" size="md">
              <ChartCandlestick size={15} strokeWidth={2} aria-hidden /> Open chart
            </LinkButton>
            <LinkButton href={tradeHref(data.symbol)} size="md">
              <Wallet size={15} strokeWidth={2} aria-hidden /> Paper trade
            </LinkButton>
            <LinkButton href={replayHref(data.symbol)} size="md">
              <History size={15} strokeWidth={2} aria-hidden /> Replay
            </LinkButton>
            <LinkButton href={askAiHref(data.symbol)} size="md">
              <BrainCircuit size={15} strokeWidth={2} aria-hidden /> Ask AI
            </LinkButton>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-white/[0.06] bg-black/10 sm:grid-cols-4 xl:grid-cols-8 [&>*]:border-white/[0.05] max-sm:[&>*:nth-child(odd)]:border-r sm:[&>*:not(:nth-child(4n))]:border-r xl:[&>*]:border-r xl:[&>*:last-child]:border-r-0">
          <MiniStat label="24h High" value={q ? <PriceText value={q.high_24h} precision={p} /> : "—"} />
          <MiniStat label="24h Low" value={q ? <PriceText value={q.low_24h} precision={p} /> : "—"} />
          <MiniStat
            label={<Term k="volume">Volume 24h</Term>}
            value={q?.volume_24h_usd !== null && q?.volume_24h_usd !== undefined ? fmtUsdCompact(q.volume_24h_usd) : q ? fmtCompact(q.volume_24h) : "—"}
          />
          <MiniStat label={<Term k="volatility">Range 24h</Term>} value={fmtPctPlain(q?.range_24h_pct)} />
          <MiniStat label={<Term k="atr">Volatility (ATR 1d)</Term>} value={fmtPctPlain(data.volatility?.atr_pct_1d)} />
          <MiniStat label="7d" value={<ChangePill value={q?.change_7d_pct} />} />
          <MiniStat label={<Term k="trend">Trend</Term>} value={trend ? <TrendBadge trend={q?.trend} /> : "—"} />
          <MiniStat label={<Term k="regime">Regime 1D</Term>} value={<RegimeValue block={data.regime?.["1d"]} />} />
        </div>
      </section>

      {!data.available && (
        <DataNotAvailable
          reason={data.reason ?? "Нито един конфигуриран доставчик не обслужва този инструмент."}
          provider={inst.source?.name ?? undefined}
        />
      )}

      <LearnHint title="Как да използваш тази страница">
        Започни от по-високия timeframe (1D) за контекст, после виж 1H. AI анализът описва какво виждат правилата —
        не е прогноза. Преди paper trade определи <Term k="stoploss">stop loss</Term> и риск на сделка.
      </LearnHint>

      {/* ── main grid ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                <LineChart size={15} strokeWidth={2} className="text-accent2" aria-hidden />
                Chart
              </span>
            }
            bodyClass="p-3"
          >
            {data.available ? (
              <ChartWorkspace
                symbol={data.symbol}
                onSymbol={(s) => s && s !== data.symbol && router.push(assetHref(s))}
                timeframe={tf}
                onTimeframe={setTf}
                height={480}
                beginner={beginner}
                storageKey="asset"
              />
            ) : (
              <DataNotAvailable reason={data.reason ?? "DATA NOT AVAILABLE"} className="min-h-[320px]" />
            )}
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Newspaper size={15} strokeWidth={2} className="text-info" aria-hidden />
                News &amp; events
              </span>
            }
            right={data.news?.provider ? <Badge tone="neutral">{data.news.provider}</Badge> : null}
          >
            <NewsPanel news={data.news} asset={{ symbol: data.symbol, slug: data.slug, asset_class: inst.asset_class, currency: inst.currency, country: inst.country }} />
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <AiAnalysisCard symbol={data.symbol} precision={p} enabled={data.available} />
          <KeyStatsCard data={data} advanced={!beginner} />
          <AboutCard data={data} advanced={!beginner} />
          <EducationCard lessons={data.lessons ?? []} />
        </div>
      </div>

      <RelatedAssets items={data.related ?? []} />
      <p className={cx("text-center text-[11px] text-faint")}>
        Пазарните данни са само за четене. Всички сделки в платформата са виртуални (paper) — няма реални пари и реални поръчки.
      </p>
    </div>
  );
}
