"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import { Badge, Button, Card, Empty, ErrorText, Field, InfoTip, Loading, Notice, RegimeBadge } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { cx, fmtMoney, fmtPct, pnlClass } from "@/lib/format";
import type { Strategy } from "@/lib/types";

type BotRow = {
  id: number;
  name: string;
  symbol: string;
  timeframe: string;
  status: string;
  pause_reason: string | null;
  equity: number;
  pnl: number;
  drawdown_pct: number;
  regime: string | null;
  last_signal: { signal?: string; reason?: string | null };
  run_mode: string;
  trades: number;
  win_rate: number | null;
};

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export default function BotsPage() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ bots: BotRow[] }>("/bots", fetcher, { refreshInterval: 30000 });
  const { data: strategies } = useSWR<{ strategies: Strategy[] }>("/strategies", fetcher);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "Мой paper бот",
    symbol: "BTC/USDT",
    timeframe: "1h",
    strategy_id: 0,
    run_mode: "warm_start",
    warm_start_days: 30,
    risk_per_trade_pct: 1,
    max_open_positions: 1,
    daily_loss_limit_pct: 3,
    start_hour: 0,
    end_hour: 24,
    days: [0, 1, 2, 3, 4, 5, 6],
    allow_short: true,
    initial_balance: 10000,
    stop_type: "",
    stop_value: 2,
    tp_type: "",
    tp_value: 2,
  });

  useEffect(() => {
    if (!strategies || f.strategy_id) return;
    const pre = Number(new URLSearchParams(window.location.search).get("strategy"));
    const s = strategies.strategies.find((x) => x.id === pre) ?? strategies.strategies.find((x) => !x.is_template) ?? strategies.strategies[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preselect strategy once loaded
    if (s) setF((x) => ({ ...x, strategy_id: s.id, symbol: s.symbol, timeframe: s.timeframe }));
  }, [strategies, f.strategy_id]);

  if (!data || !strategies) return <Loading />;
  const strategy = strategies.strategies.find((s) => s.id === f.strategy_id);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const bot = await post<{ id: number }>("/bots", {
        name: f.name,
        symbol: f.symbol,
        timeframe: f.timeframe,
        strategy_id: f.strategy_id,
        run_mode: f.run_mode,
        stop: f.stop_type ? { type: f.stop_type, value: Number(f.stop_value) } : undefined,
        take_profit: f.tp_type ? { type: f.tp_type, value: Number(f.tp_value) } : undefined,
        config: {
          risk_per_trade_pct: Number(f.risk_per_trade_pct),
          max_open_positions: Number(f.max_open_positions),
          daily_loss_limit_pct: Number(f.daily_loss_limit_pct),
          trading_hours: { start: Number(f.start_hour), end: Number(f.end_hour), days: f.days },
          allow_short: f.allow_short,
          initial_balance: Number(f.initial_balance),
          warm_start_days: Number(f.warm_start_days),
        },
      });
      mutate();
      router.push(`/bots/${bot.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">BOT LAB</h1>
        <Notice tone="warn" title="Ботовете работят САМО в paper-trading среда.">
          Всеки бот има собствена виртуална сметка. Няма връзка с реална борса, няма API ключове, няма реални поръчки.
        </Notice>
      </div>

      <Card title="Моите ботове">
        {data.bots.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1">Bot</th>
                  <th>Market</th>
                  <th>Status</th>
                  <th>Equity</th>
                  <th>P/L</th>
                  <th>Trades</th>
                  <th>Win rate</th>
                  <th>Drawdown</th>
                  <th>Regime</th>
                  <th>Last signal</th>
                </tr>
              </thead>
              <tbody>
                {data.bots.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="py-2">
                      <Link href={`/bots/${b.id}`} className="font-semibold hover:text-accent2">
                        {b.name}
                      </Link>
                    </td>
                    <td className="text-xs">
                      {b.symbol} · {b.timeframe}
                    </td>
                    <td>
                      <Badge tone={b.status === "RUNNING" ? "up" : b.status === "PAUSED" ? "warn" : "neutral"}>{b.status}</Badge>
                    </td>
                    <td className="num">{fmtMoney(b.equity)}</td>
                    <td className={cx("num", pnlClass(b.pnl))}>{fmtMoney(b.pnl, true)}</td>
                    <td className="num">{b.trades}</td>
                    <td className="num">{fmtPct(b.win_rate, 0)}</td>
                    <td className="num">{fmtPct(b.drawdown_pct)}</td>
                    <td>
                      <RegimeBadge regime={b.regime} />
                    </td>
                    <td className="text-xs text-muted">{b.last_signal?.signal ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Още нямаш ботове. Създай първия отдолу.</Empty>
        )}
      </Card>

      <Card title="Нов simulation bot">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Bot name">
            <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Market">
            <SymbolPicker value={f.symbol} onChange={(s) => set("symbol", s)} className="w-full" />
          </Field>
          <Field label="Timeframe">
            <TimeframeBar value={f.timeframe} onChange={(tf) => set("timeframe", tf)} />
          </Field>
          <Field label="Strategy">
            <select className="input" value={f.strategy_id} onChange={(e) => set("strategy_id", Number(e.target.value))}>
              {strategies.strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.is_template ? "📋 " : ""}
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Run mode" hint="Forward = само нови свещи от сега нататък (реално време). Warm start = първо симулира последните N дни върху история, после продължава в реално време.">
            <select className="input" value={f.run_mode} onChange={(e) => set("run_mode", e.target.value)}>
              <option value="warm_start">Warm start (history → live)</option>
              <option value="forward">Forward only</option>
            </select>
          </Field>
          {f.run_mode === "warm_start" ? (
            <Field label="Warm start days">
              <input className="input num" value={f.warm_start_days} onChange={(e) => set("warm_start_days", e.target.value)} />
            </Field>
          ) : (
            <div />
          )}
        </div>

        {strategy && (
          <div className="mt-3 rounded-md border border-line bg-panel2 p-3">
            <div className="label">Entry rules / Exit rules (от стратегията)</div>
            <ul className="num space-y-0.5 text-xs text-text/90">
              {strategy.summary.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Field label="Stop loss (override)">
            <div className="flex gap-1">
              <select className="input" value={f.stop_type} onChange={(e) => set("stop_type", e.target.value)}>
                <option value="">от стратегията</option>
                <option value="atr">ATR ×</option>
                <option value="percent">Percent</option>
              </select>
              {f.stop_type && <input className="input num w-16" value={f.stop_value} onChange={(e) => set("stop_value", e.target.value)} />}
            </div>
          </Field>
          <Field label="Take profit (override)">
            <div className="flex gap-1">
              <select className="input" value={f.tp_type} onChange={(e) => set("tp_type", e.target.value)}>
                <option value="">от стратегията</option>
                <option value="r_multiple">Risk ×</option>
                <option value="atr">ATR ×</option>
                <option value="percent">Percent</option>
              </select>
              {f.tp_type && <input className="input num w-16" value={f.tp_value} onChange={(e) => set("tp_value", e.target.value)} />}
            </div>
          </Field>
          <Field label="Risk per trade %">
            <input className="input num" value={f.risk_per_trade_pct} onChange={(e) => set("risk_per_trade_pct", e.target.value)} />
          </Field>
          <Field label="Max open positions">
            <input className="input num" value={f.max_open_positions} onChange={(e) => set("max_open_positions", e.target.value)} />
          </Field>
          <Field label="Daily loss limit %" hint="При достигане ботът спира да отваря нови сделки до края на деня (UTC).">
            <input className="input num" value={f.daily_loss_limit_pct} onChange={(e) => set("daily_loss_limit_pct", e.target.value)} />
          </Field>
          <Field label="Virtual balance">
            <input className="input num" value={f.initial_balance} onChange={(e) => set("initial_balance", e.target.value)} />
          </Field>
          <Field label="Trading hours (UTC)">
            <div className="flex items-center gap-1">
              <input className="input num w-14" value={f.start_hour} onChange={(e) => set("start_hour", e.target.value)} />
              <span className="text-muted">–</span>
              <input className="input num w-14" value={f.end_hour} onChange={(e) => set("end_hour", e.target.value)} />
            </div>
          </Field>
          <Field label="Days">
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const on = f.days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set("days", on ? f.days.filter((x) => x !== i) : [...f.days, i].sort())}
                    className={cx("rounded border px-1.5 py-0.5 text-[11px]", on ? "border-accent bg-accent/15" : "border-line text-muted")}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.allow_short} onChange={(e) => set("allow_short", e.target.checked)} /> Allow SHORT
          <InfoTip text="Ако стратегията има SHORT правила, ботът може да отваря и къси (виртуални) позиции." />
        </label>
        <ErrorText error={error} />
        <Button className="mt-3" onClick={create} disabled={busy || !f.strategy_id}>
          Create paper bot
        </Button>
      </Card>
    </div>
  );
}
