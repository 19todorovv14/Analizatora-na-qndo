/*
 * Backtest API shapes (GET /backtests, GET /backtests/{id}) — v1 keys plus the S6 v2 additions
 * (drawdown_curve, extended metrics, overfitting, walk-forward, IS/OOS comparison). v2 keys are optional
 * so results stored before v2 still render.
 */
import type { Metrics } from "@/lib/types";

export type RunSummary = {
  total_trades: number;
  net_pnl: number;
  win_rate: number | null;
  profit_factor: number | null;
  expectancy_r: number | null;
  max_drawdown_pct: number;
  return_pct: number | null;
};

export type TradeExtreme = { pnl: number; r: number | null; entry_ts: number; exit_ts?: number; side: string; exit_reason?: string };

export type MetricsV2 = Metrics & {
  avg_win_r?: number | null;
  avg_loss_r?: number | null;
  longest_win_streak?: number;
  longest_loss_streak?: number;
  best_trade?: TradeExtreme | null;
  worst_trade?: TradeExtreme | null;
  max_drawdown_duration_bars?: number;
  trades_per_month?: number | null;
  exposure_pct?: number | null;
  test_bars?: number;
  bars?: number;
  warmup_bars?: number;
  sharpe_like?: number | null;
};

export type BacktestTrade = {
  side: string;
  entry_ts: number;
  exit_ts: number;
  entry_price: number;
  exit_price: number;
  qty: number;
  net_pnl: number;
  fees: number;
  r_multiple: number | null;
  exit_reason: string;
  regime: string | null;
};

export type Overfitting = {
  risk: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  reasons: string[];
  factors?: { key: string; points: number; text: string }[];
  text?: string;
  inputs?: Record<string, number | null>;
  disclaimer?: string;
};

export type WalkForwardWindow = {
  index: number;
  start_ts: number;
  end_ts: number;
  bars: number;
  start_equity: number;
  end_equity: number;
  trades: number;
  net_pnl: number;
  return_pct: number | null;
  win_rate: number | null;
  profit_factor: number | null;
  expectancy_r: number | null;
  max_drawdown_pct: number | null;
  exposure_pct?: number | null;
  profitable: boolean;
};

export type WalkForward = {
  method: string;
  note?: string;
  disclaimer?: string;
  available: boolean;
  k?: number;
  windows: WalkForwardWindow[];
  windows_with_trades?: number;
  profitable_windows?: number;
  profitable_fraction?: number | null;
  verdict: "consistent" | "inconsistent" | "insufficient" | string;
  text?: string;
};

export type OosComparisonRow = { key: string; label: string; in_sample: number | null; out_of_sample: number | null; delta: number | null };

export type OutOfSample = {
  in_sample: RunSummary;
  out_of_sample: RunSummary;
  split_ts: number;
  in_sample_period?: { start_ts: number; end_ts: number };
  out_of_sample_period?: { start_ts: number; end_ts: number };
  comparison?: OosComparisonRow[];
  degradation?: { verdict: string; text: string };
};

export type Validation = {
  headline: string;
  robustness: string;
  disclaimer: string;
  sample_size: { trades: number; verdict: string; text: string };
  regime_distribution: Record<string, number>;
  results_by_regime: { regime: string; trades: number; net_pnl: number; win_rate: number | null }[];
  costs: { fees: number; slippage_est: number; gross_pnl_before_fees: number; net_pnl: number };
  stress_test: RunSummary;
  out_of_sample: OutOfSample | null;
  sensitivity: (RunSummary & { variant: string })[];
  complexity: { conditions: number; parameters: number };
  warnings: { code: string; severity: string; text: string }[];
  // v2
  overfitting?: Overfitting;
  walk_forward?: WalkForward;
};

export type BacktestSettings = {
  initial_balance?: number;
  risk_per_trade_pct?: number | null;
  fees_enabled?: boolean;
  fee_bps?: number | null;
  slippage_bps?: number;
  spread_enabled?: boolean;
  allow_short?: boolean;
  intrabar_policy?: string;
  max_open_positions?: number;
  [k: string]: unknown;
};

export type BacktestDetail = {
  id: number;
  strategy_id?: number;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  start_ts: number;
  end_ts: number;
  status: string;
  error: string | null;
  data_source: string;
  settings: BacktestSettings;
  metrics: MetricsV2;
  /** empty object while pending/running */
  validation: Validation;
  created_ts?: number;
  finished_ts?: number | null;
  equity_curve?: [number, number][];
  drawdown_curve?: [number, number][];
  strategy_description?: string[];
  trades?: BacktestTrade[];
};

/** Row of GET /backtests (no trades / curves). */
export type BacktestRow = Omit<BacktestDetail, "trades" | "equity_curve" | "drawdown_curve" | "strategy_description" | "metrics" | "validation"> & {
  metrics: Partial<MetricsV2>;
  validation: Partial<Validation>;
};

export const PAST_PERFORMANCE = "Past backtest performance does not guarantee future results.";
