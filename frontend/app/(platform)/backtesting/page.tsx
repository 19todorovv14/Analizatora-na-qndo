"use client";

import { CheckCircle2, CircleDashed, FlaskConical, History, Layers, SplitSquareHorizontal, TestTubeDiagonal } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { BacktestForm, defaultForm, toPayload, type BacktestFormState } from "@/components/backtest/BacktestForm";
import { BacktestHistory } from "@/components/backtest/BacktestHistory";
import { BacktestResults } from "@/components/backtest/BacktestResults";
import type { BacktestDetail, BacktestRow } from "@/components/backtest/types";
import type { StrategyRow } from "@/components/strategy/types";
import {
  Badge,
  Card,
  ChartSkeleton,
  Checklist,
  DataNotAvailable,
  EmptyState,
  ErrorState,
  PageHeader,
  PaperBadge,
  Skeleton,
  SkeletonText,
} from "@/components/ui";
import { ApiError, del, errorMessage, fetcher, post } from "@/lib/api";
import { TIMEFRAMES } from "@/lib/format";
import { useSession } from "@/lib/session";

const NOT_AVAILABLE = /DATA[_ ]NOT[_ ]AVAILABLE|not available|няма налични данни|недостъпн/i;

function FormSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

function RunningCard({ bt }: { bt: BacktestRow | BacktestDetail | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const started = bt?.created_ts ? bt.created_ts * 1000 : now;
  const secs = Math.max(0, Math.round((now - started) / 1000));
  const steps = [
    { label: "Основен тест (сигнал на close → вход на следващия open)", icon: TestTubeDiagonal },
    { label: "In-sample / out-of-sample 70 / 30", icon: SplitSquareHorizontal },
    { label: "Walk-forward на фиксираните правила", icon: Layers },
    { label: "Stress test и sensitivity на параметрите", icon: FlaskConical },
  ];
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent2">
            <CircleDashed size={20} strokeWidth={2} className="animate-spin [animation-duration:2.4s]" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-text">Backtest-ът се изпълнява…</div>
            <div className="text-xs text-muted">
              {bt ? `${bt.strategy_name} · ${bt.symbol} · ${bt.timeframe}` : "Подготовка"} · <span className="num">{secs} s</span>
            </div>
          </div>
          <Badge tone="info" className="ml-auto">
            {bt?.status ?? "pending"}
          </Badge>
        </div>
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent_0%,rgb(138_180_255/0.85)_50%,transparent_100%)] bg-[length:45%_100%] bg-no-repeat" />
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-xs text-muted">
              <s.icon size={14} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-faint">Дълъг период на малък timeframe може да отнеме 10–20 секунди.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 px-4 py-3.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <ChartSkeleton height={300} />
    </div>
  );
}

function IntroCard() {
  return (
    <div className="card p-4 sm:p-6">
      <EmptyState
        icon={TestTubeDiagonal}
        title="Тествай правилата върху история"
        description="Избери стратегия, инструмент и период и натисни Run backtest. Резултатът е симулация с виртуални пари — инструмент за учене, не обещание."
      />
      <div className="mx-auto mt-5 max-w-xl">
        <Checklist
          items={[
            { label: "KPI: win rate, profit factor, expectancy, average R, max drawdown, best / worst trade, серии", pass: true },
            { label: "Equity curve и drawdown със синхронизирана времева ос", pass: true },
            { label: "Validation: overfitting risk, sample size, in-sample vs out-of-sample, walk-forward", pass: true },
            { label: "Stress test (3× slippage), sensitivity на параметрите, разбивка по пазарен режим и разходи", pass: true },
          ]}
        />
      </div>
    </div>
  );
}

function BacktestingInner() {
  const { beginner } = useSession();
  const params = useSearchParams();
  const qStrategy = Number(params.get("strategy")) || 0;
  const qSymbol = params.get("symbol");
  const qTimeframe = params.get("timeframe");
  const qRegime = params.get("regime");

  const { data: strategies, error: stratError, mutate: retryStrategies } = useSWR<{ strategies: StrategyRow[] }>("/strategies", fetcher);
  const { data: list, mutate: mutateList } = useSWR<{ backtests: BacktestRow[] }>("/backtests", fetcher);
  const [form, setForm] = useState<BacktestFormState>(defaultForm);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusRegime, setFocusRegime] = useState<string | null>(qRegime);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { data: detail, error: detailError, mutate: retryDetail } = useSWR<BacktestDetail>(activeId ? `/backtests/${activeId}` : null, fetcher, {
    refreshInterval: (d) => (d && (d.status === "pending" || d.status === "running") ? 1500 : 0),
  });

  // prefill once strategies arrive (and again when the query string changes, e.g. a coach link)
  const prefillKey = `${qStrategy}|${qSymbol}|${qTimeframe}`;
  const [prefilled, setPrefilled] = useState<string | null>(null);
  if (strategies && prefilled !== prefillKey) {
    const all = strategies.strategies;
    const s = all.find((x) => x.id === qStrategy) ?? (form.strategy_id ? all.find((x) => x.id === form.strategy_id) : undefined) ?? all.find((x) => !x.is_template) ?? all[0];
    setPrefilled(prefillKey);
    setFocusRegime(qRegime);
    if (s) {
      setForm((f) => ({
        ...f,
        strategy_id: s.id,
        symbol: qSymbol || s.symbol,
        timeframe: qTimeframe && (TIMEFRAMES as readonly string[]).includes(qTimeframe) ? qTimeframe : s.timeframe,
        risk_per_trade_pct: s.definition.risk_per_trade_pct ?? f.risk_per_trade_pct,
      }));
    }
  }

  // returning user without a deep link → show the latest result
  const [autoOpened, setAutoOpened] = useState(false);
  if (!autoOpened && list) {
    setAutoOpened(true);
    if (!activeId && !qStrategy && list.backtests[0]) setActiveId(list.backtests[0].id);
  }

  const status = detail?.status;
  useEffect(() => {
    if (status === "done" || status === "failed") mutateList();
  }, [status, mutateList]);

  const run = async () => {
    setError(null);
    setUnavailable(null);
    setSubmitting(true);
    try {
      const bt = await post<BacktestRow>("/backtests", toPayload(form));
      setActiveId(bt.id);
      mutateList();
      if (window.innerWidth < 1280) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 503 || NOT_AVAILABLE.test(e.message))) setUnavailable(e.message);
      else setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await del(`/backtests/${id}`);
      if (activeId === id) setActiveId(null);
      mutateList();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const activeRow = useMemo(() => list?.backtests.find((b) => b.id === activeId), [list, activeId]);
  const running = !!detail && (detail.status === "pending" || detail.status === "running");

  let results: React.ReactNode;
  if (unavailable) results = <DataNotAvailable reason={unavailable} provider={form.symbol} />;
  else if (!activeId) results = <IntroCard />;
  else if (detailError && !detail) results = <ErrorState title="Резултатът не се зареди" description={errorMessage(detailError)} onRetry={() => retryDetail()} />;
  else if (!detail || running) results = <RunningCard bt={detail ?? activeRow} />;
  else if (detail.status === "failed")
    results = NOT_AVAILABLE.test(detail.error ?? "") ? (
      <DataNotAvailable reason={detail.error ?? undefined} provider={detail.symbol} />
    ) : (
      <ErrorState title="Backtest-ът не успя" description={detail.error ?? "Неизвестна грешка."} onRetry={run} />
    );
  else results = <BacktestResults bt={detail} beginner={beginner} focusRegime={focusRegime} />;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Backtesting Lab"
        icon={TestTubeDiagonal}
        subtitle="Тествай правилата на стратегия върху история — същият paper engine с такси, spread и slippage, плюс проверки за overfitting."
        badge={<PaperBadge compact />}
        actions={
          <Link
            href={form.strategy_id ? `/strategies?strategy=${form.strategy_id}` : "/strategies"}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
          >
            Strategy Builder →
          </Link>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4 xl:sticky xl:top-4">
          <Card title="Настройки на теста" right={focusRegime ? <Badge tone="warn">фокус: {focusRegime.replace(/_/g, " ")}</Badge> : undefined}>
            {stratError && !strategies ? (
              <ErrorState title="Стратегиите не се заредиха" onRetry={() => retryStrategies()} />
            ) : !strategies ? (
              <FormSkeleton />
            ) : (
              <BacktestForm
                strategies={strategies.strategies}
                form={form}
                onChange={setForm}
                onRun={run}
                running={submitting || running}
                error={error}
                beginner={beginner}
              />
            )}
          </Card>
          <Card
            title={
              <>
                <History size={15} strokeWidth={2} className="text-accent2" aria-hidden />
                История
              </>
            }
            right={list ? <span className="num text-[11px] text-muted">{list.backtests.length}</span> : undefined}
          >
            {!list ? <SkeletonText lines={4} /> : <BacktestHistory rows={list.backtests} activeId={activeId} onOpen={(id) => setActiveId(id)} onDelete={remove} />}
          </Card>
        </div>
        <div ref={resultsRef} className="min-w-0 scroll-mt-4">
          {results}
          {detail?.status === "done" && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
              <CheckCircle2 size={12} strokeWidth={2} aria-hidden /> Backtest #{detail.id} · завършен{" "}
              {detail.finished_ts ? new Date(detail.finished_ts * 1000).toLocaleString("bg-BG") : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BacktestingPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1600px] space-y-5">
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="card p-4">
              <FormSkeleton />
            </div>
            <ChartSkeleton height={360} />
          </div>
        </div>
      }
    >
      <BacktestingInner />
    </Suspense>
  );
}
