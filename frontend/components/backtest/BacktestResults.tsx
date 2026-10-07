"use client";

import { CalendarRange, FileText, LineChart, ListOrdered, Sparkles } from "lucide-react";
import Link from "next/link";

import { TradesTable } from "@/components/backtest/TradesTable";
import { ValidationPanel } from "@/components/backtest/ValidationPanel";
import { barsToText, fmtPF, pfTone, signTone } from "@/components/backtest/format";
import type { BacktestDetail, MetricsV2 } from "@/components/backtest/types";
import { EquityChart } from "@/components/charts/EquityChart";
import { RulesPreview } from "@/components/strategy/StrategySelect";
import { Badge, Card, SourceBadge, Stat, StatTile } from "@/components/ui";
import { LearnHint } from "@/lib/workspace";
import { TF_LABEL, TF_SECONDS, fmtDate, fmtDuration, fmtMoney, fmtNum, fmtPct, fmtR } from "@/lib/format";

export type { BacktestDetail } from "@/components/backtest/types";

const INTRABAR: Record<string, string> = { worst_case: "Worst case", path: "OHLC path" };

/** Plain-language reading of the key numbers (beginner mode). */
function plainReading(m: MetricsV2): string[] {
  const out: string[] = [];
  if (!m.total_trades) return ["Няма сделки — условията не са се изпълнили. Пробвай по-дълъг период или по-малко условия."];
  out.push(
    `${m.total_trades} сделки, от които ${m.winning_trades} печеливши (win rate ${fmtPct(m.win_rate, 0)}). Win rate сам по себе си не казва дали стратегията печели — важно е колко печели средно печелившата спрямо губещата.`,
  );
  if (m.expectancy_r !== null && m.expectancy_r !== undefined)
    out.push(
      m.expectancy_r > 0
        ? `Expectancy ${fmtR(m.expectancy_r)}: средно всяка сделка е донесла ${m.expectancy_r.toFixed(2)} пъти риска. Положително, но малко предимство лесно изчезва при други пазарни условия.`
        : `Expectancy ${fmtR(m.expectancy_r)}: средно всяка сделка е губила част от риска. Правилата не са дали предимство в този период.`,
    );
  out.push(`Max drawdown ${fmtPct(m.max_drawdown_pct)}: в най-лошия момент сметката е била толкова под предишния си връх. Питай се дали би издържал(а) това психологически.`);
  return out;
}

/**
 * Results of a finished backtest: KPI tiles, equity + drawdown (synced time axes), virtualized trade list,
 * the "Strategy validation" card and the rules that were tested.
 */
export function BacktestResults({ bt, beginner, focusRegime }: { bt: BacktestDetail; beginner: boolean; focusRegime?: string | null }) {
  const m = bt.metrics;
  const v = bt.validation;
  const s = bt.settings;
  const initial = Number(s.initial_balance ?? 10000);
  const tfSec = TF_SECONDS[bt.timeframe];
  const best = m.best_trade;
  const worst = m.worst_trade;
  const source = bt.data_source === "demo" ? { status: "demo" as const, name: "Demo" } : { status: "live" as const, name: bt.data_source, disclaimer: "Исторически пазарни данни (read-only). Сделките са симулирани." };

  return (
    <div className="space-y-4">
      {/* header strip */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-text">{bt.strategy_name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="num font-medium text-text/90">{bt.symbol}</span>
            <span>·</span>
            <span className="num">{TF_LABEL[bt.timeframe] ?? bt.timeframe}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <CalendarRange size={12} strokeWidth={2} aria-hidden />
              {fmtDate(bt.start_ts)} – {fmtDate(bt.end_ts)}
            </span>
            {m.test_bars ? <span className="num text-faint">· {m.test_bars.toLocaleString("en-US")} свещи</span> : null}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <SourceBadge source={source} />
          <Badge tone="neutral">balance {fmtMoney(initial)}</Badge>
          <Badge tone="neutral">risk {s.risk_per_trade_pct ? `${s.risk_per_trade_pct}%` : "от стратегията"}</Badge>
          <Badge tone="neutral">{s.fees_enabled === false ? "без такси" : s.fee_bps !== null && s.fee_bps !== undefined ? `fees ${s.fee_bps} bps` : "fees default"}</Badge>
          <Badge tone="neutral">slippage {s.slippage_bps ?? 1} bps</Badge>
          {!beginner && <Badge tone="neutral">{INTRABAR[String(s.intrabar_policy)] ?? String(s.intrabar_policy ?? "")}</Badge>}
          {!beginner && (s.max_open_positions ?? 1) > 1 && <Badge tone="neutral">max {s.max_open_positions} позиции</Badge>}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        <StatTile label="Net P/L" value={fmtMoney(m.net_pnl, true)} tone={signTone(m.net_pnl)} sub={`${fmtPct(m.return_pct, 2, true)} · equity ${fmtMoney(m.final_equity ?? initial + m.net_pnl)}`} />
        <StatTile label="Total trades" value={m.total_trades} sub={`${m.winning_trades} W · ${m.losing_trades} L${m.trades_per_month ? ` · ${m.trades_per_month.toFixed(1)}/мес.` : ""}`} />
        <StatTile label="Win rate" term="winrate" value={fmtPct(m.win_rate, 1)} sub={`avg win ${fmtR(m.avg_win_r ?? m.average_win_r)} · loss ${fmtR(m.avg_loss_r ?? m.average_loss_r)}`} />
        <StatTile label="Profit factor" term="profitfactor" value={fmtPF(m.profit_factor)} tone={pfTone(m.profit_factor)} sub={`gross ${fmtMoney(m.gross_profit)} / ${fmtMoney(Math.abs(m.gross_loss))}`} />
        <StatTile label="Expectancy" term="expectancy" value={fmtR(m.expectancy_r)} tone={signTone(m.expectancy_r)} sub={`${fmtMoney(m.expectancy, true)} на сделка`} />
        <StatTile label="Average R" term="r" value={fmtR(m.average_r)} tone={signTone(m.average_r)} sub="среден резултат в R" />
        <StatTile
          label="Max drawdown"
          term="drawdown"
          value={fmtPct(-Math.abs(m.max_drawdown_pct), 2)}
          tone={m.max_drawdown_pct > 20 ? "down" : m.max_drawdown_pct > 10 ? "warn" : "neutral"}
          sub={`${fmtMoney(m.max_drawdown)}${m.max_drawdown_duration_bars ? ` · ${barsToText(m.max_drawdown_duration_bars, tfSec)} под връх` : ""}`}
        />
        <StatTile
          label="Best trade"
          value={best ? fmtMoney(best.pnl, true) : fmtMoney(m.largest_win, true)}
          tone="up"
          sub={best ? `${fmtR(best.r)} · ${best.side.toUpperCase()} · ${fmtDate(best.entry_ts)}` : "—"}
        />
        <StatTile
          label="Worst trade"
          value={worst ? fmtMoney(worst.pnl, true) : fmtMoney(m.largest_loss, true)}
          tone="down"
          sub={worst ? `${fmtR(worst.r)} · ${worst.side.toUpperCase()} · ${fmtDate(worst.entry_ts)}` : "—"}
        />
        <StatTile label="Longest losing streak" value={m.longest_loss_streak ?? m.max_consecutive_losses} tone={(m.longest_loss_streak ?? m.max_consecutive_losses) >= 6 ? "warn" : "neutral"} sub="поредни загуби" />
        <StatTile label="Longest winning streak" value={m.longest_win_streak ?? "—"} sub="поредни печалби" />
        <StatTile label="Fees" term="fees" value={fmtMoney(m.fees_total)} sub={`+ slippage ≈ ${fmtMoney(m.slippage_cost_est)}`} />
      </div>

      {!beginner && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          <Stat label="Return" value={fmtPct(m.return_pct, 2, true)} tone={signTone(m.return_pct) === "up" ? "text-up" : signTone(m.return_pct) === "down" ? "text-down" : undefined} />
          <Stat label="Buy & hold" value={fmtPct(m.buy_and_hold_pct, 1, true)} />
          <Stat label="Exposure" value={fmtPct(m.exposure_pct ?? m.time_in_market_pct, 0)} />
          <Stat label="Sharpe-like" value={m.sharpe_like !== null && m.sharpe_like !== undefined ? m.sharpe_like.toFixed(2) : "—"} />
          <Stat label="SQN" term="sqn" value={m.sqn !== null && m.sqn !== undefined ? m.sqn.toFixed(2) : "—"} />
          <Stat label="Avg holding" value={fmtDuration(m.average_holding_seconds)} />
          <Stat label="DD duration" value={barsToText(m.max_drawdown_duration_bars, tfSec)} sub={m.max_drawdown_duration_bars ? `${m.max_drawdown_duration_bars} свещи` : undefined} />
          <Stat label="Slippage (est.)" term="slippage" value={fmtMoney(m.slippage_cost_est)} />
        </div>
      )}

      {beginner && (
        <LearnHint title="Как да четеш резултата">
          <ul className="space-y-1">
            {plainReading(m).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </LearnHint>
      )}

      <Card
        title={
          <>
            <LineChart size={15} strokeWidth={2} className="text-accent2" aria-hidden />
            Equity curve · Drawdown
          </>
        }
        right={
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-accent" aria-hidden /> Equity
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-down/50" aria-hidden /> Drawdown %
            </span>
          </div>
        }
      >
        {bt.equity_curve && bt.equity_curve.length > 1 ? (
          <EquityChart points={bt.equity_curve} drawdown={bt.drawdown_curve} baseline={initial} height={380} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">Няма достатъчно точки за графика.</p>
        )}
        <p className="mt-2 text-[11px] text-faint">Двата панела споделят една времева ос — zoom и crosshair са синхронизирани. Drawdown = % под предишния връх на equity.</p>
      </Card>

      <ValidationPanel v={v} m={m} beginner={beginner} focusRegime={focusRegime} />

      <Card
        title={
          <>
            <ListOrdered size={15} strokeWidth={2} className="text-accent2" aria-hidden />
            Trade list
            <span className="num font-normal text-muted">({fmtNum(bt.trades?.length ?? 0, 0)})</span>
          </>
        }
      >
        <TradesTable trades={bt.trades ?? []} focusRegime={focusRegime} />
      </Card>

      <Card
        title={
          <>
            <FileText size={15} strokeWidth={2} className="text-accent2" aria-hidden />
            Тествани правила
          </>
        }
        right={
          bt.strategy_id ? (
            <Link href={`/strategies?strategy=${bt.strategy_id}`} className="text-xs font-medium text-accent2 hover:text-text">
              Strategy Builder →
            </Link>
          ) : undefined
        }
      >
        {bt.strategy_description?.length ? <RulesPreview lines={bt.strategy_description} columns /> : <p className="text-sm text-muted">Описанието не е налично.</p>}
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
          <Sparkles size={12} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          Snapshot на правилата към момента на теста — по-късни промени в стратегията не променят този резултат.
        </p>
      </Card>
    </div>
  );
}
