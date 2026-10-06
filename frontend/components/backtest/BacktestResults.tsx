"use client";

import { EquityChart } from "@/components/charts/EquityChart";
import { Badge, Card, Notice, Stat } from "@/components/ui";
import { cx, fmtDate, fmtDuration, fmtMoney, fmtPct, fmtR, fmtTime, pnlClass } from "@/lib/format";
import type { Metrics } from "@/lib/types";

type Summary = { total_trades: number; net_pnl: number; win_rate: number | null; profit_factor: number | null; expectancy_r: number | null; max_drawdown_pct: number; return_pct: number | null };

export type BacktestDetail = {
  id: number;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  start_ts: number;
  end_ts: number;
  status: string;
  error: string | null;
  data_source: string;
  settings: Record<string, unknown>;
  metrics: Metrics;
  equity_curve?: [number, number][];
  strategy_description?: string[];
  trades?: { side: string; entry_ts: number; exit_ts: number; entry_price: number; exit_price: number; qty: number; net_pnl: number; fees: number; r_multiple: number | null; exit_reason: string; regime: string | null }[];
  validation: {
    headline: string;
    robustness: string;
    disclaimer: string;
    sample_size: { trades: number; verdict: string; text: string };
    regime_distribution: Record<string, number>;
    results_by_regime: { regime: string; trades: number; net_pnl: number; win_rate: number | null }[];
    costs: { fees: number; slippage_est: number; gross_pnl_before_fees: number; net_pnl: number };
    stress_test: Summary;
    out_of_sample: null | { in_sample: Summary; out_of_sample: Summary; split_ts: number };
    sensitivity: (Summary & { variant: string })[];
    complexity: { conditions: number; parameters: number };
    warnings: { code: string; severity: string; text: string }[];
  };
};

const pf = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v > 1e6 ? "∞" : v.toFixed(2));

function SummaryRow({ label, s }: { label: string; s: Summary }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 font-medium">{label}</td>
      <td className="num">{s.total_trades}</td>
      <td className={cx("num", pnlClass(s.net_pnl))}>{fmtMoney(s.net_pnl, true)}</td>
      <td className="num">{fmtPct(s.win_rate, 0)}</td>
      <td className="num">{pf(s.profit_factor)}</td>
      <td className="num">{fmtR(s.expectancy_r)}</td>
      <td className="num">{fmtPct(s.max_drawdown_pct)}</td>
    </tr>
  );
}

export function BacktestResults({ bt, beginner }: { bt: BacktestDetail; beginner: boolean }) {
  const m = bt.metrics;
  const v = bt.validation;
  return (
    <div className="space-y-4">
      <Card
        title={`${bt.strategy_name} · ${bt.symbol} · ${bt.timeframe.toUpperCase()} · ${fmtDate(bt.start_ts)} – ${fmtDate(bt.end_ts)}`}
        right={<Badge tone="info">{bt.data_source} data</Badge>}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          <Stat label="Total trades" value={m.total_trades} />
          <Stat label="Winning trades" value={m.winning_trades} tone="text-up" />
          <Stat label="Losing trades" value={m.losing_trades} tone="text-down" />
          <Stat label="Win rate" term="winrate" value={fmtPct(m.win_rate, 1)} />
          <Stat label="Net P/L" value={fmtMoney(m.net_pnl, true)} tone={pnlClass(m.net_pnl)} sub={fmtPct(m.return_pct, 2, true)} />
          <Stat label="Profit factor" term="profitfactor" value={pf(m.profit_factor)} />
          <Stat label="Max drawdown" term="drawdown" value={fmtPct(m.max_drawdown_pct)} sub={fmtMoney(m.max_drawdown)} />
          <Stat label="Average R" term="r" value={fmtR(m.average_r)} />
          <Stat label="Expectancy" term="expectancy" value={fmtMoney(m.expectancy)} sub={fmtR(m.expectancy_r)} />
          <Stat label="Largest win" value={fmtMoney(m.largest_win)} tone="text-up" />
          <Stat label="Largest loss" value={fmtMoney(m.largest_loss)} tone="text-down" />
          <Stat label="Fees" term="fees" value={fmtMoney(m.fees_total)} />
          {!beginner && (
            <>
              <Stat label="Buy & hold" value={fmtPct(m.buy_and_hold_pct, 1, true)} />
              <Stat label="Avg holding" value={fmtDuration(m.average_holding_seconds)} />
              <Stat label="Max consec. losses" value={m.max_consecutive_losses} />
              <Stat label="Time in market" value={fmtPct(m.time_in_market_pct, 0)} />
              <Stat label="SQN" term="sqn" value={m.sqn?.toFixed(2) ?? "—"} />
              <Stat label="Slippage (est.)" term="slippage" value={fmtMoney(m.slippage_cost_est)} />
            </>
          )}
        </div>
        <div className="mt-4">
          <div className="label">Equity curve</div>
          <EquityChart points={bt.equity_curve ?? []} baseline={Number(bt.settings.initial_balance ?? 10000)} />
        </div>
      </Card>

      <Card title="Strategy validation" right={<Badge tone="warn">не е доказателство за предимство</Badge>}>
        <div className="space-y-3">
          <Notice tone={m.net_pnl > 0 ? "warn" : "info"} title={v.headline}>
            {v.robustness}
          </Notice>
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm font-semibold text-warn">{v.disclaimer}</p>
          {v.warnings.length > 0 && (
            <ul className="space-y-1.5">
              {v.warnings.map((w) => (
                <li key={w.code + w.text} className="flex gap-2 text-sm">
                  <Badge tone={w.severity === "high" ? "down" : "warn"}>{w.code.replace(/_/g, " ")}</Badge>
                  <span className="text-text/90">{w.text}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="label">Sample size</div>
              <p className="text-sm">
                <Badge tone={v.sample_size.verdict === "adequate" ? "up" : v.sample_size.verdict === "limited" ? "warn" : "down"}>{v.sample_size.verdict}</Badge>{" "}
                {v.sample_size.text}
              </p>
              <div className="label mt-3">Market regime (разпределение на периода)</div>
              <div className="space-y-1">
                {Object.entries(v.regime_distribution).map(([k, pct]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0">{k}</span>
                    <div className="h-2 flex-1 rounded bg-panel3">
                      <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="num w-10 text-right">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="label">Резултати по режим</div>
              <table className="w-full text-xs">
                <tbody>
                  {v.results_by_regime.map((r) => (
                    <tr key={r.regime} className="border-t border-line">
                      <td className="py-1">{r.regime}</td>
                      <td className="num">{r.trades} tr.</td>
                      <td className="num">{fmtPct(r.win_rate, 0)}</td>
                      <td className={cx("num text-right", pnlClass(r.net_pnl))}>{fmtMoney(r.net_pnl, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="label mt-3">Transaction costs</div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-muted">Брутно (преди такси)</span>
                <span className={cx("num text-right", pnlClass(v.costs.gross_pnl_before_fees))}>{fmtMoney(v.costs.gross_pnl_before_fees, true)}</span>
                <span className="text-muted">Такси</span>
                <span className="num text-right">{fmtMoney(-v.costs.fees)}</span>
                <span className="text-muted">Slippage (оценка)</span>
                <span className="num text-right">{fmtMoney(-v.costs.slippage_est)}</span>
                <span className="text-muted">Нетно</span>
                <span className={cx("num text-right font-bold", pnlClass(v.costs.net_pnl))}>{fmtMoney(v.costs.net_pnl, true)}</span>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="label">Out-of-sample · stress test · sensitivity</div>
            <table className="w-full text-xs">
              <thead className="text-left uppercase text-muted">
                <tr>
                  <th className="py-1">Вариант</th>
                  <th>Trades</th>
                  <th>Net</th>
                  <th>Win</th>
                  <th>PF</th>
                  <th>Exp.</th>
                  <th>DD</th>
                </tr>
              </thead>
              <tbody>
                {v.out_of_sample && (
                  <>
                    <SummaryRow label={`In-sample (до ${fmtDate(v.out_of_sample.split_ts)})`} s={v.out_of_sample.in_sample} />
                    <SummaryRow label="Out-of-sample" s={v.out_of_sample.out_of_sample} />
                  </>
                )}
                <SummaryRow label="Stress: 3× slippage, 2× spread" s={v.stress_test} />
                {v.sensitivity.map((s) => (
                  <SummaryRow key={s.variant} label={s.variant} s={s} />
                ))}
              </tbody>
            </table>
            {beginner && (
              <p className="mt-2 text-xs text-muted">
                Ако малки промени в параметрите (±10–25%) обръщат резултата, стратегията е „напасната“ към миналото (overfitting). Устойчивите идеи
                работят приблизително еднакво и при съседни параметри.
              </p>
            )}
          </div>
        </div>
      </Card>

      {bt.strategy_description && (
        <Card title="Правила">
          <ul className="num space-y-0.5 text-xs text-text/90">
            {bt.strategy_description.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Trade list (${bt.trades?.length ?? 0})`}>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel text-left uppercase text-muted">
              <tr>
                <th className="py-1">Entry</th>
                <th>Side</th>
                <th>Entry → Exit</th>
                <th>Qty</th>
                <th>Exit</th>
                <th>Regime</th>
                <th>R</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {(bt.trades ?? []).map((t, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 text-muted">{fmtTime(t.entry_ts)}</td>
                  <td>
                    <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                  </td>
                  <td className="num">
                    {t.entry_price} → {t.exit_price}
                  </td>
                  <td className="num">{t.qty}</td>
                  <td>{t.exit_reason}</td>
                  <td className="text-muted">{t.regime}</td>
                  <td className="num">{fmtR(t.r_multiple)}</td>
                  <td className={cx("num text-right", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
