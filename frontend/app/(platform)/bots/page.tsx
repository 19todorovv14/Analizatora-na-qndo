"use client";

import { Activity, Bot, CirclePlay, List, Plus, ShieldCheck, Wallet } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";

import { BotForm } from "@/components/bots/BotForm";
import { applyBotPrefill, botPayload, defaultBotForm, type BotFormState } from "@/components/bots/formState";
import { BotList } from "@/components/bots/BotList";
import { PaperBotLabel } from "@/components/bots/StatusPill";
import type { BotRow } from "@/components/bots/types";
import type { StrategyRow } from "@/components/strategy/types";
import { Card, ErrorState, PageHeader, Skeleton, SkeletonText, StatTile, TableSkeleton, pnlTone } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { LearnHint } from "@/lib/workspace";

function BotsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qStrategy = Number(params.get("strategy")) || 0;
  const qSymbol = params.get("symbol");
  const qTimeframe = params.get("timeframe");

  const { data, error: listError, mutate } = useSWR<{ bots: BotRow[] }>("/bots", fetcher, { refreshInterval: 30_000 });
  const { data: strategies, error: stratError, mutate: retryStrategies } = useSWR<{ strategies: StrategyRow[] }>("/strategies", fetcher);
  const [form, setForm] = useState<BotFormState>(defaultBotForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // prefill from ?strategy=&symbol=&timeframe= (Strategy Builder "Create paper bot →")
  const prefillKey = `${qStrategy}|${qSymbol}|${qTimeframe}`;
  const [prefilled, setPrefilled] = useState<string | null>(null);
  if (strategies && prefilled !== prefillKey) {
    setPrefilled(prefillKey);
    setForm((f) => applyBotPrefill(f, strategies.strategies, { strategy: qStrategy, symbol: qSymbol, timeframe: qTimeframe }));
  }

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const bot = await post<{ id: number }>("/bots", botPayload(form));
      mutate();
      router.push(`/bots/${bot.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const bots = data?.bots ?? [];
  const running = bots.filter((b) => b.status === "RUNNING").length;
  const paused = bots.filter((b) => b.status === "PAUSED").length;
  const totalPnl = bots.reduce((a, b) => a + (b.pnl ?? 0), 0);
  const totalTrades = bots.reduce((a, b) => a + (b.trades ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="Bot Lab"
        icon={Bot}
        subtitle="Paper ботове, които следват правилата на стратегия върху нови свещи — с отделна виртуална сметка, лимити за риск и BOT AI COACH."
        badge={<PaperBotLabel />}
        actions={
          <a
            href="#new-bot"
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] transition-colors hover:border-white/[0.18] hover:bg-white/[0.07] xl:hidden"
          >
            <Plus size={15} strokeWidth={2} aria-hidden />
            Нов бот
          </a>
        }
      />

      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3">
        <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
          Ботовете работят <b className="text-text">САМО в paper-trading среда</b>. Всеки бот има собствена виртуална сметка. Няма връзка с реална
          борса, няма API ключове, няма реални поръчки.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Ботове" value={data ? bots.length : "—"} icon={Bot} tone="accent" sub={data ? `${bots.length - running - paused} спрени` : undefined} loading={!data && !listError} />
        <StatTile label="Running" value={data ? running : "—"} icon={CirclePlay} tone={running ? "up" : "neutral"} sub={data ? `${paused} на пауза` : undefined} loading={!data && !listError} />
        <StatTile label="P/L (virtual)" value={data ? fmtMoney(totalPnl, true) : "—"} icon={Wallet} tone={pnlTone(totalPnl)} sub="сума от всички ботове" loading={!data && !listError} />
        <StatTile label="Сделки" value={data ? totalTrades : "—"} icon={Activity} sub="затворени paper сделки" loading={!data && !listError} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Card
            title={
              <>
                <List size={15} strokeWidth={2} className="text-accent2" aria-hidden />
                Моите ботове
              </>
            }
            right={<span className="text-[11px] text-faint">обновяване на 30 s</span>}
          >
            {listError && !data ? <ErrorState title="Ботовете не се заредиха" onRetry={() => mutate()} /> : !data ? <TableSkeleton rows={4} cols={7} /> : <BotList bots={bots} />}
          </Card>
          <LearnHint title="Как работи paper ботът">
            На всяка затворена свещ ботът проверява условията на стратегията. Ако всички са изпълнени и филтрите (режим, часове, max positions,
            дневен лимит) позволяват, отваря виртуална позиция на следващата свещ със stop и target. BOT AI COACH показва колко setups са
            отхвърлени и защо.
          </LearnHint>
        </div>

        <div id="new-bot" className="min-w-0 scroll-mt-20 xl:sticky xl:top-[calc(var(--spacing-topbar)+1rem)] xl:max-h-[calc(100dvh-var(--spacing-topbar)-2rem)] xl:overflow-y-auto xl:pr-1">
          <Card
            title={
              <>
                <Plus size={15} strokeWidth={2} className="text-accent2" aria-hidden />
                Нов paper бот
              </>
            }
          >
            {stratError && !strategies ? (
              <ErrorState title="Стратегиите не се заредиха" onRetry={() => retryStrategies()} />
            ) : !strategies ? (
              <div className="space-y-3">
                <Skeleton className="h-9 w-full rounded-lg" />
                <Skeleton className="h-9 w-full rounded-lg" />
                <SkeletonText lines={4} />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            ) : (
              <BotForm strategies={strategies.strategies} form={form} onChange={setForm} onSubmit={create} busy={busy} error={error} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function BotsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1600px] space-y-5">
          <Skeleton className="h-10 w-72" />
          <TableSkeleton rows={4} cols={6} />
        </div>
      }
    >
      <BotsInner />
    </Suspense>
  );
}
