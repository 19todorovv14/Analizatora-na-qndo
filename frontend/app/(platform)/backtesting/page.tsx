"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

import { BacktestResults, type BacktestDetail } from "@/components/backtest/BacktestResults";
import { SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import { Badge, Button, Card, ErrorText, Field, InfoTip, Loading, Spinner } from "@/components/ui";
import { del, errorMessage, fetcher, post } from "@/lib/api";
import { cx, fmtDate, fmtMoney, fromDateInput, pnlClass, toDateInput } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Strategy } from "@/lib/types";

function initialForm() {
  const now = Math.floor(Date.now() / 1000);
  return {
    strategy_id: 0,
    symbol: "BTC/USDT",
    timeframe: "1h",
    start: toDateInput(now - 180 * 86400),
    end: toDateInput(now),
    initial_balance: 10000,
    risk_per_trade_pct: 1,
    fees_enabled: true,
    fee_bps: "",
    slippage_bps: 1,
    spread_enabled: true,
    allow_short: true,
    intrabar_policy: "worst_case",
  };
}

type BtRow = { id: number; strategy_name: string; symbol: string; timeframe: string; status: string; start_ts: number; end_ts: number; metrics: { net_pnl?: number; total_trades?: number } };

export default function BacktestingPage() {
  const { beginner } = useSession();
  const { data: strategies } = useSWR<{ strategies: Strategy[] }>("/strategies", fetcher);
  const { data: list, mutate } = useSWR<{ backtests: BtRow[] }>("/backtests", fetcher);
  const [form, setForm] = useState(initialForm);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: detail } = useSWR<BacktestDetail>(activeId ? `/backtests/${activeId}` : null, fetcher, {
    refreshInterval: (d) => (d && (d.status === "pending" || d.status === "running") ? 1500 : 0),
  });

  useEffect(() => {
    if (!strategies || form.strategy_id) return;
    const pre = Number(new URLSearchParams(window.location.search).get("strategy"));
    const s = strategies.strategies.find((x) => x.id === pre) ?? strategies.strategies.find((x) => !x.is_template) ?? strategies.strategies[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preselect strategy once loaded
    if (s) setForm((f) => ({ ...f, strategy_id: s.id, symbol: s.symbol, timeframe: s.timeframe }));
  }, [strategies, form.strategy_id]);

  useEffect(() => {
    if (detail && (detail.status === "done" || detail.status === "failed")) mutate();
  }, [detail?.status, detail, mutate]);

  const run = async () => {
    setError(null);
    try {
      const bt = await post<BtRow>("/backtests", {
        strategy_id: form.strategy_id,
        symbol: form.symbol,
        timeframe: form.timeframe,
        start_ts: fromDateInput(form.start),
        end_ts: fromDateInput(form.end) + 86399,
        initial_balance: Number(form.initial_balance),
        risk_per_trade_pct: Number(form.risk_per_trade_pct),
        fees_enabled: form.fees_enabled,
        fee_bps: form.fee_bps === "" ? undefined : Number(form.fee_bps),
        slippage_bps: Number(form.slippage_bps),
        spread_enabled: form.spread_enabled,
        allow_short: form.allow_short,
        intrabar_policy: form.intrabar_policy,
      });
      setActiveId(bt.id);
      mutate();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!strategies) return <Loading />;
  const set = (k: keyof typeof form, v: unknown) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-3">
        <Card title="Backtesting Lab">
          <div className="space-y-3">
            <Field label="Strategy">
              <select
                className="input"
                value={form.strategy_id}
                onChange={(e) => {
                  const s = strategies.strategies.find((x) => x.id === Number(e.target.value));
                  setForm({ ...form, strategy_id: Number(e.target.value), ...(s ? { symbol: s.symbol, timeframe: s.timeframe } : {}) });
                }}
              >
                {strategies.strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.is_template ? "📋 " : ""}
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Asset">
              <SymbolPicker value={form.symbol} onChange={(s) => set("symbol", s)} className="w-full" />
            </Field>
            <Field label="Timeframe">
              <TimeframeBar value={form.timeframe} onChange={(tf) => set("timeframe", tf)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">
                <input type="date" className="input" value={form.start} onChange={(e) => set("start", e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" className="input" value={form.end} onChange={(e) => set("end", e.target.value)} />
              </Field>
              <Field label="Initial balance">
                <input className="input num" value={form.initial_balance} onChange={(e) => set("initial_balance", e.target.value)} />
              </Field>
              <Field label="Risk per trade %">
                <input className="input num" value={form.risk_per_trade_pct} onChange={(e) => set("risk_per_trade_pct", e.target.value)} />
              </Field>
              <Field label="Fees (bps)" hint="Празно = таксите на инструмента. 10 bps = 0.1% на страна.">
                <input className="input num" value={form.fee_bps} placeholder="default" onChange={(e) => set("fee_bps", e.target.value)} disabled={!form.fees_enabled} />
              </Field>
              <Field label="Slippage (bps)">
                <input className="input num" value={form.slippage_bps} onChange={(e) => set("slippage_bps", e.target.value)} />
              </Field>
            </div>
            <div className="space-y-1 text-sm">
              {(
                [
                  ["fees_enabled", "Fees"],
                  ["spread_enabled", "Spread"],
                  ["allow_short", "Allow SHORT"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={form[k] as boolean} onChange={(e) => set(k, e.target.checked)} /> {label}
                </label>
              ))}
              <label className="flex items-center gap-2">
                <select className="input w-auto !py-1 text-xs" value={form.intrabar_policy} onChange={(e) => set("intrabar_policy", e.target.value)}>
                  <option value="worst_case">Worst case (SL first)</option>
                  <option value="path">OHLC path</option>
                </select>
                <InfoTip text="Ако SL и TP са в една и съща свещ, не знаем кое е първо. Worst case приема, че първо е ударен стопът — консервативно." />
              </label>
            </div>
            <ErrorText error={error} />
            <Button className="w-full" onClick={run} disabled={!form.strategy_id}>
              Run backtest
            </Button>
            <p className="text-[11px] text-faint">Сигнал на close → вход на open на следващата свещ (без lookahead). Същият paper engine с такси и slippage.</p>
          </div>
        </Card>
        <Card title="История">
          <ul className="space-y-1">
            {(list?.backtests ?? []).map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <button onClick={() => setActiveId(b.id)} className={cx("flex-1 rounded px-2 py-1 text-left text-xs hover:bg-panel2", activeId === b.id && "bg-accent/15")}>
                  <span className="font-semibold">{b.strategy_name}</span>
                  <span className="block text-muted">
                    {b.symbol} {b.timeframe} · {fmtDate(b.start_ts)} · {b.metrics?.total_trades ?? "—"} tr.{" "}
                    <span className={pnlClass(b.metrics?.net_pnl)}>{fmtMoney(b.metrics?.net_pnl, true)}</span>
                  </span>
                </button>
                <Badge tone={b.status === "done" ? "up" : b.status === "failed" ? "down" : "warn"}>{b.status}</Badge>
                <button className="text-faint hover:text-down" onClick={() => del(`/backtests/${b.id}`).then(() => mutate())}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div>
        {!activeId && (
          <Card>
            <p className="text-sm text-muted">
              Избери стратегия и период и натисни <b>Run backtest</b>. Ще видиш метрики, equity curve, списък сделки и validation панел с sample size,
              market regime, drawdown, overfitting, разходи, slippage и out-of-sample резултат.
            </p>
          </Card>
        )}
        {activeId && !detail && <Loading />}
        {detail && (detail.status === "pending" || detail.status === "running") && (
          <Card>
            <div className="flex items-center gap-2 text-sm">
              <Spinner /> Backtest-ът се изпълнява (включително out-of-sample и sensitivity проверки)…
            </div>
          </Card>
        )}
        {detail?.status === "failed" && <ErrorText error={detail.error} />}
        {detail?.status === "done" && <BacktestResults bt={detail} beginner={beginner} />}
      </div>
    </div>
  );
}
