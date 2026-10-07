"use client";

import { Activity, ArrowLeft, Bot, CircleAlert, Cog, Layers, LineChart, ListOrdered, Pause, ScrollText, Square, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import { EXIT_LABEL, exitTone, fmtTradePrice, shortTime, signTone } from "@/components/backtest/format";
import { BotCoach } from "@/components/bots/BotCoach";
import { filterLogs, hoursText, withStartPoint, type LogLevelFilter } from "@/components/bots/formState";
import { PaperBotLabel, StatusPill } from "@/components/bots/StatusPill";
import type { BotView, CoachResponse } from "@/components/bots/types";
import { EquityChart } from "@/components/charts/EquityChart";
import { BLOCK_TITLE, ConditionChecklist, signalTone } from "@/components/strategy/SignalCheck";
import { RulesPreview } from "@/components/strategy/StrategySelect";
import {
  Badge,
  Button,
  Card,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  ErrorText,
  IconButton,
  Modal,
  Notice,
  PageHeader,
  RegimeBadge,
  Segmented,
  Skeleton,
  Spinner,
  StatTile,
  type Tone,
} from "@/components/ui";
import { ApiError, del, errorMessage, fetcher, post } from "@/lib/api";
import { TF_LABEL, TF_SECONDS, cx, fmtMoney, fmtPct, fmtPrice, fmtR, fmtTime, pnlClass } from "@/lib/format";
import { useSession } from "@/lib/session";

const LEVEL_TONE: Record<string, Tone> = { info: "neutral", signal: "info", trade: "up", warn: "warn", error: "down" };

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-72" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 px-4 py-3.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <ChartSkeleton height={320} />
    </div>
  );
}

export default function BotDashboard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { beginner } = useSession();
  const { data: bot, error: botError, mutate } = useSWR<BotView>(`/bots/${id}`, fetcher, { refreshInterval: 15_000 });
  const {
    data: coach,
    error: coachError,
    mutate: mutateCoach,
  } = useSWR<CoachResponse>(bot ? `/bots/${id}/coach` : null, fetcher, {
    refreshInterval: 60_000,
  });
  const [busy, setBusy] = useState<"start" | "pause" | "stop" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logLevel, setLogLevel] = useState<LogLevelFilter>("all");

  if (botError && !bot) {
    if (botError instanceof ApiError && botError.status === 404)
      return (
        <div className="mx-auto max-w-3xl pt-6">
          <EmptyState
            icon={Bot}
            title="Ботът не е намерен"
            description="Може да е изтрит или да принадлежи на друг профил."
            action={
              <Link href="/bots" className="text-sm font-medium text-accent2 hover:text-text">
                ← Към Bot Lab
              </Link>
            }
          />
        </div>
      );
    return <ErrorState title="Ботът не се зареди" description={errorMessage(botError)} onRetry={() => mutate()} />;
  }
  if (!bot) return <DetailSkeleton />;

  const act = async (action: "start" | "pause" | "stop") => {
    setBusy(action);
    setError(null);
    try {
      await mutate(await post<BotView>(`/bots/${id}/${action}`), { revalidate: false });
      mutateCoach();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      await del(`/bots/${id}`);
      router.push("/bots");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  const m = bot.metrics;
  const cfg = bot.config;
  const barSec = TF_SECONDS[bot.timeframe] ?? 3600;
  const firstTs = bot.evaluation_stats?.first_ts ?? null;
  const eq = withStartPoint(bot.equity_curve, bot.initial_balance, firstTs, barSec);
  const dd = bot.drawdown_curve?.length ? withStartPoint(bot.drawdown_curve, 0, firstTs, barSec) : undefined;
  const conditions = Object.entries(bot.last_signal?.conditions ?? {});
  const logs = filterLogs(bot.logs, logLevel);
  const trades = [...bot.trades].sort((a, b) => b.closed_ts - a.closed_ts);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <Link href="/bots" className="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-text">
        <ArrowLeft size={13} strokeWidth={2} aria-hidden /> Bot Lab
      </Link>
      <PageHeader
        title={bot.name}
        icon={Bot}
        subtitle={
          <span>
            <span className="num text-text/90">{bot.symbol}</span> · <span className="num">{TF_LABEL[bot.timeframe] ?? bot.timeframe}</span> ·{" "}
            {bot.run_mode === "warm_start" ? `warm start ${cfg.warm_start_days ?? 30} дни` : "forward only"}
            {bot.last_processed_ts ? (
              <>
                {" "}
                · последна свещ <span className="num">{shortTime(bot.last_processed_ts)}</span>
              </>
            ) : null}
          </span>
        }
        badge={
          <>
            <StatusPill status={bot.status} size="md" />
            <PaperBotLabel compact />
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-black/20 p-1">
              <Button size="sm" variant="up" disabled={!!busy || bot.status === "RUNNING"} onClick={() => act("start")}>
                {busy === "start" ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : null}▶ Start
              </Button>
              <Button size="sm" variant="warn" disabled={!!busy || bot.status !== "RUNNING"} onClick={() => act("pause")}>
                {busy === "pause" ? <Spinner className="h-3.5 w-3.5" /> : <Pause size={13} strokeWidth={2.5} aria-hidden />}
                Pause
              </Button>
              <Button size="sm" variant="down" disabled={!!busy || bot.status === "STOPPED"} onClick={() => act("stop")}>
                {busy === "stop" ? (
                  <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" />
                ) : (
                  <Square size={12} strokeWidth={2.5} aria-hidden />
                )}
                Stop
              </Button>
            </div>
            <IconButton
              icon={Trash2}
              label="Изтрий бота"
              variant="glass"
              onClick={() => setConfirmDelete(true)}
              disabled={!!busy}
              className="hover:!text-down"
            />
          </>
        }
      />

      {bot.pause_reason && (
        <Notice tone="warn" title="Ботът е на пауза">
          {bot.pause_reason}
        </Notice>
      )}
      {bot.status === "STOPPED" && !bot.last_processed_ts && (
        <Notice tone="info" title="Ботът още не е стартиран">
          Натисни <b className="text-text">▶ Start</b>.{" "}
          {bot.run_mode === "warm_start"
            ? `Първо ще симулира последните ${cfg.warm_start_days ?? 30} дни върху история, после продължава с нови свещи.`
            : "Ще обработва само нови затворени свещи от сега нататък."}
        </Notice>
      )}
      <ErrorText error={error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
        <StatTile
          label="Equity"
          term="equity"
          value={fmtMoney(bot.equity)}
          sub={`старт ${fmtMoney(bot.initial_balance)}`}
          icon={Wallet}
          tone="accent"
        />
        <StatTile
          label="P/L (virtual)"
          value={fmtMoney(bot.pnl, true)}
          tone={signTone(bot.pnl)}
          sub={fmtPct(bot.initial_balance ? (bot.pnl / bot.initial_balance) * 100 : null, 2, true)}
        />
        <StatTile label="Win rate" term="winrate" value={fmtPct(m.win_rate, 0)} sub={`${m.winning_trades ?? 0} W · ${m.losing_trades ?? 0} L`} />
        <StatTile label="Trades" value={m.total_trades} sub={m.trades_per_month ? `${m.trades_per_month.toFixed(1)} / месец` : "затворени"} />
        <StatTile label="Average R" term="r" value={fmtR(m.average_r)} tone={signTone(m.average_r)} sub={`exp. ${fmtR(m.expectancy_r)}`} />
        <StatTile
          label="Max drawdown"
          term="drawdown"
          value={fmtPct(-Math.abs(m.max_drawdown_pct ?? bot.drawdown_pct), 2)}
          tone={(m.max_drawdown_pct ?? 0) > 10 ? "warn" : "neutral"}
          sub={`сега ${fmtPct(bot.drawdown_pct)}`}
        />
        <StatTile
          label="Open positions"
          value={`${bot.positions.length} / ${bot.max_positions ?? cfg.max_open_positions ?? 1}`}
          sub={`unrealized ${fmtMoney(bot.unrealized_pnl, true)}`}
          icon={Layers}
        />
        <StatTile
          label="Errors"
          value={bot.error_count}
          tone={bot.error_count ? "down" : "neutral"}
          icon={CircleAlert}
          sub={bot.error_count ? "виж Logs" : "няма"}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title={
            <>
              <LineChart size={15} strokeWidth={2} className="text-accent2" aria-hidden />
              Equity · Drawdown
            </>
          }
          right={<span className="text-[11px] text-faint">виртуална сметка на бота</span>}
        >
          {eq.length > 1 ? (
            <EquityChart points={eq} drawdown={dd} baseline={bot.initial_balance} height={340} />
          ) : (
            <EmptyState
              compact
              icon={LineChart}
              title="Няма затворени сделки"
              description="Equity кривата се появява след първата затворена paper сделка."
            />
          )}
        </Card>

        <Card
          title={
            <>
              <Activity size={15} strokeWidth={2} className="text-accent2" aria-hidden />
              Last signal
            </>
          }
          right={bot.last_signal?.ts ? <span className="num text-[11px] text-faint">{fmtTime(bot.last_signal.ts)}</span> : undefined}
        >
          {bot.last_signal?.signal ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={signalTone(bot.last_signal.signal)} className="!px-2 !py-1 !text-xs">
                  {bot.last_signal.signal}
                </Badge>
                <span className="text-[11px] text-muted">режим</span>
                <RegimeBadge regime={bot.last_signal.regime ?? bot.regime} />
              </div>
              {bot.last_signal.reason && (
                <p className="rounded-md border border-warn/25 bg-warn/[0.06] px-2.5 py-1.5 text-xs text-warn">Причина: {bot.last_signal.reason}</p>
              )}
              {conditions.length ? (
                <div className="space-y-4">
                  {conditions.map(([k, conds]) => (
                    <ConditionChecklist
                      key={k}
                      title={BLOCK_TITLE[k] ?? k}
                      conditions={conds}
                      passed={conds.length > 0 && conds.every((c) => c.passed)}
                      compact
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">Няма детайли за условията.</p>
              )}
            </div>
          ) : (
            <EmptyState compact icon={Activity} title="Още няма сигнал" description="Ботът още не е обработил затворена свещ. Натисни ▶ Start." />
          )}
        </Card>
      </div>

      <BotCoach data={coach} error={coachError} onRetry={() => mutateCoach()} advanced={!beginner} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card
          title={
            <>
              <Layers size={15} strokeWidth={2} className="text-accent2" aria-hidden />
              Open positions <span className="num font-normal text-muted">({bot.positions.length})</span>
            </>
          }
        >
          {bot.positions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">
                  <tr className="border-b border-white/[0.07]">
                    <th className="py-1.5 font-semibold">Side</th>
                    <th className="py-1.5 text-right font-semibold">Qty</th>
                    <th className="py-1.5 text-right font-semibold">Entry</th>
                    <th className="py-1.5 text-right font-semibold">SL</th>
                    <th className="py-1.5 text-right font-semibold">TP</th>
                    <th className="py-1.5 text-right font-semibold">R</th>
                    <th className="py-1.5 text-right font-semibold">Unrealized</th>
                  </tr>
                </thead>
                <tbody>
                  {bot.positions.map((p) => (
                    <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                      <td className="py-2">
                        <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
                      </td>
                      <td className="num py-2 text-right">{p.qty}</td>
                      <td className="num py-2 text-right">{fmtPrice(p.entry_price, p.precision)}</td>
                      <td className="num py-2 text-right text-down">{fmtPrice(p.stop_loss, p.precision)}</td>
                      <td className="num py-2 text-right text-up">{fmtPrice(p.take_profit, p.precision)}</td>
                      <td className={cx("num py-2 text-right", pnlClass(p.unrealized_r))}>{fmtR(p.unrealized_r)}</td>
                      <td className={cx("num py-2 text-right font-medium", pnlClass(p.unrealized_pnl))}>{fmtMoney(p.unrealized_pnl, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              icon={Layers}
              title="Няма отворени позиции"
              description="Ботът чака setup, при който всички условия и филтри са изпълнени."
            />
          )}
        </Card>

        <Card
          title={
            <>
              <Cog size={15} strokeWidth={2} className="text-accent2" aria-hidden />
              Стратегия и настройки
            </>
          }
          right={
            bot.strategy_id ? (
              <Link href={`/strategies?strategy=${bot.strategy_id}`} className="text-xs font-medium text-accent2 hover:text-text">
                Strategy Builder →
              </Link>
            ) : undefined
          }
        >
          <RulesPreview lines={bot.strategy_description} dense />
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {(
              [
                ["Risk / trade", `${cfg.risk_per_trade_pct ?? 1}%`],
                ["Max positions", String(bot.max_positions ?? cfg.max_open_positions ?? 1)],
                ["Daily loss limit", `${cfg.daily_loss_limit_pct ?? 3}%`],
                ["SHORT", cfg.allow_short === false ? "забранени" : "разрешени"],
                ["Часове", hoursText(cfg)],
                ["Виртуален баланс", fmtMoney(bot.initial_balance)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="glass-inset min-w-0 px-2.5 py-2">
                <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{k}</dt>
                <dd className="num mt-0.5 truncate text-text" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          {!beginner && bot.runs && bot.runs.length > 0 && (
            <div className="mt-3">
              <div className="label">Runs</div>
              <ul className="space-y-1 text-[11px]">
                {bot.runs.slice(0, 5).map((r) => (
                  <li key={r.started_ts} className="num flex flex-wrap gap-x-2 text-muted">
                    <span>{fmtTime(r.started_ts)}</span>→<span>{r.stopped_ts ? fmtTime(r.stopped_ts) : "сега"}</span>
                    <span className={pnlClass(r.end_equity !== null ? r.end_equity - r.start_equity : null)}>
                      {r.end_equity !== null ? fmtMoney(r.end_equity - r.start_equity, true) : r.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card
          title={
            <>
              <ListOrdered size={15} strokeWidth={2} className="text-accent2" aria-hidden />
              Trades{" "}
              <span className="num font-normal text-muted">
                ({m.total_trades > bot.trades.length ? `последните ${bot.trades.length} от ${m.total_trades}` : bot.trades.length})
              </span>
            </>
          }
        >
          {trades.length ? (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[660px] text-xs">
                <thead className="sticky top-0 z-[1] bg-surface text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">
                  <tr className="border-b border-white/[0.07]">
                    <th className="py-1.5 font-semibold">Closed</th>
                    <th className="py-1.5 font-semibold">Side</th>
                    <th className="py-1.5 font-semibold">Entry → Exit</th>
                    <th className="py-1.5 font-semibold">Exit</th>
                    <th className="py-1.5 font-semibold">Regime</th>
                    <th className="py-1.5 text-right font-semibold">R</th>
                    <th className="py-1.5 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                      <td className="num whitespace-nowrap py-1.5 text-muted" title={`${fmtTime(t.opened_ts)} → ${fmtTime(t.closed_ts)}`}>
                        {shortTime(t.closed_ts)}
                      </td>
                      <td className="py-1.5">
                        <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                      </td>
                      <td className="num py-1.5 text-text/90">
                        {fmtTradePrice(t.entry_price)} <span className="text-faint">→</span> {fmtTradePrice(t.exit_price)}
                      </td>
                      <td className="py-1.5">
                        <Badge tone={exitTone(t.exit_reason)}>{EXIT_LABEL[t.exit_reason] ?? t.exit_reason.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="py-1.5">
                        {typeof t.meta?.regime === "string" ? <RegimeBadge regime={t.meta.regime} /> : <span className="text-faint">—</span>}
                      </td>
                      <td className={cx("num py-1.5 text-right", pnlClass(t.r_multiple))}>{fmtR(t.r_multiple)}</td>
                      <td className={cx("num py-1.5 text-right font-medium", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              icon={ListOrdered}
              title="Няма затворени сделки"
              description="Сделките се появяват, когато ботът затвори позиция по stop, target или exit правило."
            />
          )}
        </Card>

        <Card
          title={
            <>
              <ScrollText size={15} strokeWidth={2} className="text-accent2" aria-hidden />
              Logs
            </>
          }
          right={
            <Segmented
              size="sm"
              ariaLabel="Филтър на логовете"
              value={logLevel}
              onChange={setLogLevel}
              options={[
                { value: "all", label: "Всички" },
                { value: "signal", label: "Signal" },
                { value: "trade", label: "Trade" },
                { value: "warn", label: "Warn" },
              ]}
            />
          }
        >
          {logs.length ? (
            <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1 text-xs">
              {logs.map((l, i) => (
                <li
                  key={`${l.ts}-${i}`}
                  className="grid grid-cols-[86px_auto_minmax(0,1fr)] items-start gap-2 rounded-md px-1.5 py-1 hover:bg-white/[0.02]"
                >
                  <span className="num whitespace-nowrap pt-0.5 text-[10.5px] text-faint" title={fmtTime(l.ts)}>
                    {shortTime(l.ts)}
                  </span>
                  <Badge tone={LEVEL_TONE[l.level] ?? "neutral"}>{l.level}</Badge>
                  <span className="min-w-0 leading-relaxed text-text/90">{l.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-muted">Няма записи за този филтър.</p>
          )}
          {bot.errors.length > 0 && (
            <div className="mt-3 rounded-lg border border-down/25 bg-down/[0.05] p-2.5">
              <div className="label !text-down">Errors</div>
              <ul className="space-y-1">
                {bot.errors.map((e) => (
                  <li key={e.ts} className="num text-xs text-down">
                    {fmtTime(e.ts)} · {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Изтриване на бот">
        <p className="text-sm text-muted">
          Да изтрия ли <b className="text-text">{bot.name}</b>? Виртуалната му история и логовете ще бъдат премахнати. Реални пари не са засегнати —
          ботът е само paper.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Отказ
          </Button>
          <Button variant="down" onClick={remove} disabled={busy === "delete"}>
            {busy === "delete" ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : <Trash2 size={14} strokeWidth={2} aria-hidden />}
            Изтрий
          </Button>
        </div>
      </Modal>
    </div>
  );
}
