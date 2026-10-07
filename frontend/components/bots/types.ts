/* Bot Lab API shapes (GET /bots, GET /bots/{id}, GET /bots/{id}/coach) incl. the S6 v2 additions. */
import type { MetricsV2 } from "@/components/backtest/types";
import type { DefinitionV2 } from "@/components/strategy/types";
import type { Position, Trade } from "@/lib/types";

export type BotStatus = "RUNNING" | "PAUSED" | "STOPPED";

export type SignalConditions = Record<string, { label: string; passed: boolean; left: number | null; right: number | null }[]>;

export type LastSignal = {
  ts?: number;
  signal?: string;
  reason?: string | null;
  regime?: string;
  conditions?: SignalConditions;
};

export type FilterKey =
  | "regime"
  | "trading_hours"
  | "max_positions"
  | "daily_loss"
  | "paused"
  | "pending_order"
  | "short_disabled"
  | "conflict"
  | "stop_unavailable"
  | "position_size"
  | "margin";

export type SideStats = { setups: number; all_met: number; rejected: number; entries: number };

export type EvaluationStats = {
  version?: number;
  bars_evaluated: number;
  setups_generated: number;
  all_conditions_met: number;
  rejected: number;
  entries: number;
  rejected_by_condition: Record<string, number>;
  rejected_by_filters: Partial<Record<FilterKey | string, number>>;
  by_side?: { long?: SideStats; short?: SideStats };
  first_ts?: number | null;
  last_ts?: number | null;
};

export type BotRow = {
  id: number;
  name: string;
  symbol: string;
  timeframe: string;
  status: BotStatus | string;
  pause_reason: string | null;
  equity: number;
  pnl: number;
  drawdown_pct: number;
  regime: string | null;
  last_signal: LastSignal;
  run_mode: string;
  trades: number;
  win_rate: number | null;
  // v2
  strategy_id?: number;
  max_positions?: number;
  average_r?: number | null;
  last_processed_ts?: number | null;
  setups_generated?: number;
  all_conditions_met?: number;
  rejected?: number;
  coach_headline?: string;
};

export type BotConfig = {
  risk_per_trade_pct?: number;
  max_open_positions?: number;
  daily_loss_limit_pct?: number;
  trading_hours?: { start: number; end: number; days: number[] };
  allow_short?: boolean;
  initial_balance?: number;
  warm_start_days?: number;
  [k: string]: unknown;
};

export type BotView = {
  id: number;
  name: string;
  symbol: string;
  timeframe: string;
  status: BotStatus;
  pause_reason: string | null;
  run_mode: string;
  strategy_id?: number;
  config: BotConfig;
  strategy?: DefinitionV2;
  strategy_description: string[];
  balance: number;
  equity: number;
  pnl: number;
  initial_balance: number;
  unrealized_pnl: number;
  metrics: MetricsV2;
  drawdown_pct: number;
  positions: Position[];
  trades: Trade[];
  equity_curve: [number, number][];
  last_signal: LastSignal;
  regime: string | null;
  last_processed_ts: number | null;
  errors: { ts: number; message: string }[];
  error_count: number;
  logs: { ts: number; level: string; message: string }[];
  runs?: { started_ts: number; stopped_ts: number | null; start_equity: number; end_equity: number | null; status: string }[];
  paper_only_notice: string;
  // v2
  max_positions?: number;
  drawdown_curve?: [number, number][];
  evaluation_stats?: EvaluationStats;
  coach_headline?: string;
};

export type CoachGroup = {
  value: string;
  label: string;
  trades: number;
  win_rate: number | null;
  average_r: number | null;
  net_pnl: number;
  enough_trades?: boolean;
};

export type CoachResponse = {
  bot_id: number;
  name: string;
  symbol: string;
  timeframe: string;
  status: string;
  title: string;
  source: "bot" | "estimate" | "unavailable" | string;
  source_label: string;
  period?: { from_ts: number | null; to_ts: number | null; bars_evaluated: number } | null;
  headline: string;
  setups_generated: number;
  all_conditions_met: number;
  rejected: number;
  entries: number;
  rejected_by_condition: Record<string, number>;
  rejected_by_filters: Record<string, number>;
  by_side?: { long?: SideStats; short?: SideStats };
  top_blockers: { label: string; count: number; kind: "condition" | "filter" | string; key?: string }[];
  trades: number;
  win_rate: number | null;
  average_r: number | null;
  net_pnl: number;
  main_losing_condition: {
    attribute: string;
    attribute_label: string;
    value: string;
    description: string;
    trades: number;
    average_r: number | null;
    win_rate: number | null;
    net_pnl: number;
  } | null;
  worst_regime: { regime: string; trades: number; average_r: number | null; win_rate: number | null; net_pnl: number } | null;
  best_regime: { regime: string; trades: number; average_r: number | null; win_rate: number | null; net_pnl: number } | null;
  breakdowns?: { side?: CoachGroup[]; regime?: CoachGroup[]; session?: CoachGroup[]; volatility?: CoachGroup[] };
  insights: string[];
  next_steps: { kind: string; title: string; href: string }[];
  disclaimer: string;
  paper_only_notice?: string;
};

export const COACH_DISCLAIMER = "Analysis of past simulated behaviour, not a guarantee.";
