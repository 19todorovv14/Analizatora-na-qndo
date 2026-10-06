"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import { EquityChart } from "@/components/charts/EquityChart";
import { Badge, Button, Card, Empty, ErrorText, Loading, Notice, RegimeBadge, Stat } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtPrice, fmtR, fmtTime, pnlClass } from "@/lib/format";
import type { Metrics, Position, Trade } from "@/lib/types";

type BotView = {
  id: number;
  name: string;
  symbol: string;
  timeframe: string;
  status: "STOPPED" | "RUNNING" | "PAUSED";
  pause_reason: string | null;
  run_mode: string;
  config: Record<string, unknown>;
  strategy_description: string[];
  balance: number;
  equity: number;
  pnl: number;
  initial_balance: number;
  unrealized_pnl: number;
  metrics: Metrics;
  drawdown_pct: number;
  positions: Position[];
  trades: Trade[];
  equity_curve: [number, number][];
  last_signal: { ts?: number; signal?: string; reason?: string | null; regime?: string; conditions?: Record<string, { label: string; passed: boolean; left: number | null; right: number | null }[]> };
  regime: string | null;
  last_processed_ts: number | null;
  errors: { ts: number; message: string }[];
  error_count: number;
  logs: { ts: number; level: string; message: string }[];
  paper_only_notice: string;
};

const LEVEL_TONE: Record<string, "neutral" | "up" | "warn" | "down" | "info"> = { info: "neutral", signal: "info", trade: "up", warn: "warn", error: "down" };

export default function BotDashboard() {
  const { id } = useParams<{ id: string }>();
  const { data: bot, mutate } = useSWR<BotView>(`/bots/${id}`, fetcher, { refreshInterval: 15000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!bot) return <Loading />;

  const act = async (action: "start" | "pause" | "stop") => {
    setBusy(true);
    setError(null);
    try {
      await mutate(await post<BotView>(`/bots/${id}/${action}`), { revalidate: false });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const m = bot.metrics;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/bots" className="text-xs text-muted hover:text-text">
          ← Bot Lab
        </Link>
        <h1 className="text-lg font-bold">{bot.name}</h1>
        <span className="text-sm text-muted">
          {bot.symbol} · {bot.timeframe.toUpperCase()} · {bot.run_mode}
        </span>
        <Badge tone={bot.status === "RUNNING" ? "up" : bot.status === "PAUSED" ? "warn" : "neutral"}>{bot.status}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="up" disabled={busy || bot.status === "RUNNING"} onClick={() => act("start")}>
            ▶ Start
          </Button>
          <Button size="sm" variant="warn" disabled={busy || bot.status !== "RUNNING"} onClick={() => act("pause")}>
            ⏸ Pause
          </Button>
          <Button size="sm" variant="down" disabled={busy || bot.status === "STOPPED"} onClick={() => act("stop")}>
            ■ Stop
          </Button>
        </div>
      </div>
      <Notice tone="warn">{bot.paper_only_notice}</Notice>
      {bot.pause_reason && <Notice tone="warn" title="Paused">{bot.pause_reason}</Notice>}
      <ErrorText error={error} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Bot balance" term="balance" value={fmtMoney(bot.balance)} />
        <Stat label="Equity" term="equity" value={fmtMoney(bot.equity)} />
        <Stat label="P/L" value={fmtMoney(bot.pnl, true)} tone={pnlClass(bot.pnl)} />
        <Stat label="Win rate" term="winrate" value={fmtPct(m.win_rate, 0)} />
        <Stat label="Drawdown" term="drawdown" value={fmtPct(bot.drawdown_pct)} />
        <Stat label="Trades" value={m.total_trades} />
        <Stat label="Expectancy" term="expectancy" value={fmtR(m.expectancy_r)} />
        <Stat label="Errors" value={bot.error_count} tone={bot.error_count ? "text-down" : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Last signal" className="xl:col-span-1">
          {bot.last_signal?.signal ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={bot.last_signal.signal.includes("LONG") ? "up" : bot.last_signal.signal.includes("SHORT") ? "down" : "neutral"}>
                  {bot.last_signal.signal}
                </Badge>
                <span className="text-xs text-muted">{fmtTime(bot.last_signal.ts)}</span>
              </div>
              {bot.last_signal.reason && <p className="text-xs text-warn">Причина: {bot.last_signal.reason}</p>}
              <div className="flex items-center gap-2 text-xs">
                Current market regime: <RegimeBadge regime={bot.regime} />
              </div>
              <div className="label mt-2">Strategy conditions (последна затворена свещ)</div>
              {Object.entries(bot.last_signal.conditions ?? {}).map(([block, conds]) => (
                <div key={block}>
                  <div className="text-[11px] font-semibold uppercase text-muted">{block.replace("_", " ")}</div>
                  {conds.map((c) => (
                    <div key={c.label} className="flex gap-1.5 text-xs">
                      <span className={c.passed ? "text-up" : "text-down"}>{c.passed ? "✓" : "✗"}</span>
                      <span className="num">{c.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <Empty>Ботът още не е обработил затворена свещ. Натисни Start.</Empty>
          )}
        </Card>
        <Card title="Equity" className="xl:col-span-2">
          {bot.equity_curve.length ? <EquityChart points={[[bot.equity_curve[0][0] - 1, bot.initial_balance], ...bot.equity_curve]} baseline={bot.initial_balance} /> : <Empty>Няма затворени сделки.</Empty>}
          <div className="mt-3">
            <div className="label">Strategy</div>
            <ul className="num text-xs text-text/90">
              {bot.strategy_description.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Current positions (${bot.positions.length})`}>
          {bot.positions.length ? (
            <table className="w-full text-sm">
              <tbody>
                {bot.positions.map((p) => (
                  <tr key={p.id} className="border-t border-line first:border-0">
                    <td className="py-1.5">
                      <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
                    </td>
                    <td className="num">{p.qty}</td>
                    <td className="num text-xs">
                      @ {fmtPrice(p.entry_price, p.precision)} · SL {fmtPrice(p.stop_loss, p.precision)} · TP {fmtPrice(p.take_profit, p.precision)}
                    </td>
                    <td className={cx("num text-right", pnlClass(p.unrealized_pnl))}>{fmtMoney(p.unrealized_pnl, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Няма отворени позиции.</Empty>
          )}
          {bot.errors.length > 0 && (
            <div className="mt-3">
              <div className="label text-down">Errors</div>
              {bot.errors.map((e) => (
                <p key={e.ts} className="text-xs text-down">
                  {fmtTime(e.ts)} {e.message}
                </p>
              ))}
            </div>
          )}
        </Card>
        <Card title="Logs">
          <div className="max-h-80 space-y-1 overflow-y-auto text-xs">
            {bot.logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-24 shrink-0 text-muted">{fmtTime(l.ts)}</span>
                <Badge tone={LEVEL_TONE[l.level] ?? "neutral"}>{l.level}</Badge>
                <span className="text-text/90">{l.message}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={`Trades (${bot.trades.length})`}>
        {bot.trades.length ? (
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-muted">
              <tr>
                <th className="py-1">Closed</th>
                <th>Side</th>
                <th>Entry → Exit</th>
                <th>Reason</th>
                <th>R</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {bot.trades.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="py-1 text-muted">{fmtTime(t.closed_ts)}</td>
                  <td>
                    <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                  </td>
                  <td className="num">
                    {t.entry_price} → {t.exit_price}
                  </td>
                  <td>{t.exit_reason}</td>
                  <td className="num">{fmtR(t.r_multiple)}</td>
                  <td className={cx("num text-right", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Няма сделки.</Empty>
        )}
      </Card>
    </div>
  );
}
