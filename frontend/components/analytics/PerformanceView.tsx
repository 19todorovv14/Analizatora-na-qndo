"use client";

/*
 * PERFORMANCE (/performance) — GET /api/stats/performance?scope=manual|bots|all: KPIs with confidence
 * notes, equity + drawdown curves, breakdowns (asset, class, timeframe, setup, strategy, side, weekday,
 * hour UTC), monthly returns, R histogram, best / worst trades and streaks. Small samples are always
 * labelled — numbers from a handful of trades describe the past, they do not prove an edge.
 */
import { BarChart3, CandlestickChart, ChartNoAxesCombined, FlaskConical, Rewind, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import {
  BREAKDOWN_DIMS,
  ciIncludes,
  ciText,
  currentStreakText,
  fmtHold,
  fmtPF,
  pfTone,
  sampleMeta,
  sortBreakdown,
  type BreakdownSort,
} from "@/components/analytics/model";
import { BreakdownTable, MonthlyReturns, RHistogram, TradeBriefList } from "@/components/analytics/PerformanceParts";
import type { BreakdownKey, Performance, PerformanceScope } from "@/components/analytics/types";
import { EquityChart } from "@/components/charts/EquityChart";
import { linkButton } from "@/components/learn/linkButton";
import {
  Badge,
  Card,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  StatTile,
  Tabs,
  useStoredState,
  pnlTone,
} from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { LearnHint } from "@/lib/workspace";

const SCOPES: { value: PerformanceScope; label: string; title: string }[] = [
  { value: "manual", label: "Ръчни", title: "Само твоите ръчни paper сделки" },
  { value: "bots", label: "Ботове", title: "Само сделките на paper ботовете" },
  { value: "all", label: "Всички", title: "Ръчни + ботове" },
];

const SORTS: { value: BreakdownSort; label: string }[] = [
  { value: "default", label: "По ред" },
  { value: "trades", label: "Сделки" },
  { value: "net_pnl", label: "P/L" },
  { value: "average_r", label: "Avg R" },
];

const asScope = (v: unknown): PerformanceScope | undefined => (v === "manual" || v === "bots" || v === "all" ? v : undefined);
const asDim = (v: unknown): BreakdownKey | undefined => (BREAKDOWN_DIMS.some((d) => d.key === v) ? (v as BreakdownKey) : undefined);

export function performanceKey(scope: PerformanceScope) {
  return `/stats/performance?scope=${scope}`;
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Зареждане…</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] !rounded-xl" />
        ))}
      </div>
      <ChartSkeleton height={320} />
    </div>
  );
}

export function PerformanceView() {
  const { beginner } = useSession();
  const [scope, setScope] = useStoredState<PerformanceScope>("ta-perf-scope", "manual", { validate: asScope });
  const [dim, setDim] = useStoredState<BreakdownKey>("ta-perf-dim", "asset", { validate: asDim });
  const [sort, setSort] = useState<BreakdownSort>("default");
  const { data, error, isLoading, mutate } = useSWR<Performance>(performanceKey(scope), fetcher, { refreshInterval: 60_000 });

  const header = (
    <PageHeader
      icon={ChartNoAxesCombined}
      title="Performance"
      subtitle="Как се представят твоите paper сделки във времето — криви, разбивки, месечни резултати и разпределение на R."
      actions={<Segmented options={SCOPES} value={scope} onChange={setScope} ariaLabel="Обхват" />}
    />
  );

  if (!data) {
    return (
      <div className="space-y-5">
        {header}
        {error && !isLoading ? (
          <ErrorState title="Отчетът не се зареди" description="Опитай отново след малко." onRetry={() => void mutate()} />
        ) : (
          <PerformanceSkeleton />
        )}
      </div>
    );
  }

  if (!data.positions) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          icon={BarChart3}
          title={scope === "bots" ? "Ботовете още нямат затворени сделки" : "Още няма затворени paper сделки"}
          description="Performance отчетът се изгражда от затворените сделки: equity крива, drawdown, разбивки по актив / timeframe / setup, месечни резултати и R-разпределение."
          action={
            <>
              <Link href="/trade" className={linkButton("primary", "sm")}>
                <CandlestickChart size={13} strokeWidth={2.25} aria-hidden /> Първа paper сделка
              </Link>
              <Link href="/replay" className={linkButton("outline", "sm")}>
                <Rewind size={13} strokeWidth={2.25} aria-hidden /> Market Replay
              </Link>
              <Link href="/backtesting" className={linkButton("outline", "sm")}>
                <FlaskConical size={13} strokeWidth={2.25} aria-hidden /> Backtesting
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const m = data.summary;
  const conf = data.confidence;
  const sample = sampleMeta(conf.sample.level);
  const rows = sortBreakdown(data.breakdowns[dim] ?? [], sort);
  const dimMeta = BREAKDOWN_DIMS.find((d) => d.key === dim);
  const expR = conf.expectancy_r;
  const noEdgeYet = ciIncludes(expR);

  return (
    <div className="space-y-5">
      {header}

      <Notice tone={sample.tone === "warn" ? "warn" : "info"} title={`${sample.label} · ${data.positions} позиции`}>
        {conf.sample.note ?? data.message}
        {data.reference_capital_note && <span className="mt-0.5 block text-xs text-faint">{data.reference_capital_note}</span>}
      </Notice>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Net P/L" value={fmtMoney(m.net_pnl, true)} tone={pnlTone(m.net_pnl)} sub={m.return_pct !== null ? `${fmtPct(m.return_pct, 2, true)} спрямо капитала` : undefined} />
        <StatTile label="Win rate" term="winrate" value={fmtPct(m.win_rate, 1)} sub={ciText(conf.win_rate, (v) => `${Math.round(v)}%`) ?? `${m.winning_trades}W / ${m.losing_trades}L`} />
        <StatTile
          label="Expectancy"
          term="expectancy"
          value={fmtR(m.expectancy_r)}
          tone={pnlTone(m.expectancy_r)}
          sub={ciText(expR, (v) => fmtR(v)) ?? `${fmtMoney(m.expectancy, true)} на сделка`}
        />
        <StatTile
          label="Profit factor"
          term="profitfactor"
          value={fmtPF(m.profit_factor)}
          tone={pfTone(m.profit_factor)}
          sub={`от ${conf.profit_factor?.n ?? m.total_trades} сделки`}
        />
        <StatTile label="Max drawdown" term="drawdown" value={fmtPct(-Math.abs(m.max_drawdown_pct || 0), 2)} tone="down" sub={fmtMoney(-Math.abs(m.max_drawdown || 0))} />
        <StatTile label="Payoff ratio" value={m.payoff_ratio ? m.payoff_ratio.toFixed(2) : "—"} sub={`Avg win ${fmtR(m.average_win_r)} · loss ${fmtR(m.average_loss_r)}`} />
        <StatTile label="Avg holding" value={fmtHold(m.average_holding_seconds)} sub={`${data.trades} изпълнения`} />
        <StatTile
          label="Streaks"
          value={
            <span>
              <span className="text-up">{data.streaks.max_wins}W</span> <span className="text-faint">/</span> <span className="text-down">{data.streaks.max_losses}L</span>
            </span>
          }
          sub={`Сега: ${currentStreakText(data.streaks)}`}
        />
      </div>

      {expR && (
        <div className={cx("rounded-xl border px-4 py-3 text-sm leading-relaxed", noEdgeYet ? "border-warn/20 bg-warn/[0.05] text-muted" : "border-white/[0.07] bg-white/[0.025] text-muted")}>
          <span className="mr-1.5 inline-flex items-center gap-1 font-semibold text-text">
            {noEdgeYet && <TriangleAlert size={14} strokeWidth={2} className="text-warn" aria-hidden />} Доверие в числата:
          </span>
          {expR.note}
          {!beginner && conf.win_rate?.note && <span className="block text-xs text-faint">{conf.win_rate.note}</span>}
          {!beginner && conf.profit_factor?.note && <span className="block text-xs text-faint">{conf.profit_factor.note}</span>}
        </div>
      )}

      <Card
        title="Equity & drawdown"
        right={
          <span className="num text-[11px] text-faint">
            старт {fmtMoney(data.reference_capital)} {data.currency !== "USD" ? data.currency : ""}
          </span>
        }
      >
        {data.curves.equity.length > 1 ? (
          <EquityChart points={data.curves.equity} baseline={data.reference_capital} drawdown={data.curves.drawdown} height={340} />
        ) : (
          <p className="py-8 text-center text-sm text-muted">Нужни са поне 2 затворени сделки за крива.</p>
        )}
        <LearnHint className="mt-3">
          Горе: стойността на сметката след всяка затворена сделка. Долу: drawdown — колко % си под предишния връх. Гладка крива с малки
          спадове говори за дисциплиниран риск, не за бъдещи резултати.
        </LearnHint>
      </Card>

      <Card
        title="Разбивки"
        right={<Segmented options={SORTS} value={sort} onChange={setSort} size="sm" ariaLabel="Сортиране" />}
        bodyClass="p-0"
      >
        <Tabs tabs={BREAKDOWN_DIMS.map((d) => ({ key: d.key, label: d.label }))} value={dim} onChange={setDim} className="px-3 pt-2" />
        <div className="p-4">
          {dimMeta && (
            <p className="mb-3 text-xs text-muted">
              {dimMeta.hint} Групи под {data.breakdown_min_trades} сделки са маркирани като „малко“.
            </p>
          )}
          <BreakdownTable rows={rows} minTrades={data.breakdown_min_trades} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card title="Месечни резултати" className="xl:col-span-3">
          <MonthlyReturns rows={data.monthly_returns} currency={data.currency} />
        </Card>
        <Card title="R distribution" className="xl:col-span-2" right={<Badge tone="neutral">{data.r_distribution.with_r} сделки</Badge>}>
          <RHistogram dist={data.r_distribution} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Най-добри сделки">
          <TradeBriefList trades={data.best_trades} empty="Няма печеливши сделки." />
        </Card>
        <Card title="Най-лоши сделки">
          <TradeBriefList trades={data.worst_trades} empty="Няма губещи сделки." />
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Всички резултати са от paper сделки с виртуални пари. Миналите резултати не гарантират бъдещи — използвай отчета, за да подобриш процеса.
      </p>
    </div>
  );
}
