/*
 * Payload types of the S7 analytics endpoints (GET /api/stats/performance, /api/stats/report,
 * /api/stats/behavior, /api/ai/coach, /api/risk/status, /api/risk/rules). Shapes follow the backend
 * report; every field the UI does not strictly need is optional so older payloads still render.
 */
import type { SourceLike } from "@/components/ui";
import type { Metrics } from "@/lib/types";

/* ───────────────────────────────────────────────────────────── risk */

export type RiskRules = {
  max_risk_per_trade_pct: number;
  warn_risk_pct: number;
  max_daily_loss_pct: number;
  max_open_positions: number;
  max_portfolio_exposure_pct: number;
  min_reward_risk: number;
  require_stop_loss: boolean;
};

export type RiskEvent = { ts: number; kind: string; severity: string; message: string };

export type ExposureBySymbol = { symbol: string; side: string; notional: number; pct_of_equity: number };
export type ExposureByClass = { asset_class: string; label: string; notional: number; pct_of_equity: number };

export type RiskStatus = {
  status: "OK" | "WARNING" | "LIMIT" | string;
  rules: RiskRules;
  equity: number;
  day_pnl: number;
  day_loss_pct: number;
  daily_loss_limit_remaining: number;
  open_positions: number;
  exposure: number;
  exposure_pct: number;
  margin_level: number | null;
  max_drawdown_pct: number;
  recent_events: RiskEvent[];
  max_exposure_pct?: number;
  used_margin?: number;
  available_margin?: number;
  exposure_breakdown?: { by_symbol: ExposureBySymbol[]; by_class: ExposureByClass[] };
};

/* ─────────────────────────────────────────────────────── performance */

export type PerfMetrics = Metrics & {
  payoff_ratio?: number | null;
  breakeven_trades?: number;
  longest_win_streak?: number;
  longest_loss_streak?: number;
  trades_per_month?: number | null;
};

export type SampleLevel = "very_small" | "small" | "moderate" | "large" | string;

export type ConfidenceStat = {
  value: number | null;
  stdev?: number | null;
  stderr?: number | null;
  ci95?: [number, number] | null;
  n: number;
  note: string | null;
};

export type BreakdownRow = {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  net_pnl: number;
  average_pnl: number | null;
  with_r: number;
  average_r: number | null;
  profit_factor: number | null;
  enough_data: boolean;
};

export type BreakdownKey = "asset" | "asset_class" | "timeframe" | "setup" | "strategy" | "side" | "weekday" | "hour";

export type MonthCell = { month: number; pnl: number; return_pct: number | null; trades: number } | null;
export type MonthlyRow = { year: number; months: MonthCell[]; pnl: number; return_pct: number | null; trades: number };

export type RBucket = { key: string; label: string; from: number | null; to: number | null; count: number; pct: number };

export type TradeBrief = {
  position_id: string;
  symbol: string;
  side: string;
  opened_ts: number;
  closed_ts: number;
  holding_seconds: number | null;
  net_pnl: number;
  r: number | null;
  timeframe: string | null;
  setup: string | null;
  strategy: string | null;
  exit_reason: string | null;
};

export type PerformanceScope = "manual" | "bots" | "all";

export type Performance = {
  version: number;
  scope: PerformanceScope;
  scopes: PerformanceScope[];
  currency: string;
  reference_capital: number;
  reference_capital_note: string | null;
  enough_data: boolean;
  message: string | null;
  positions: number;
  trades: number;
  summary: PerfMetrics;
  confidence: {
    sample: { positions: number; with_r: number; level: SampleLevel; note: string | null };
    expectancy_r?: ConfidenceStat;
    expectancy?: ConfidenceStat;
    win_rate?: ConfidenceStat;
    profit_factor?: ConfidenceStat;
  };
  curves: { equity: [number, number][]; drawdown: [number, number][]; pnl: [number, number][] };
  breakdowns: Partial<Record<BreakdownKey, BreakdownRow[]>>;
  breakdown_min_trades: number;
  monthly_returns: MonthlyRow[];
  r_distribution: { buckets: RBucket[]; with_r: number; without_r: number; average_r: number | null; median_r: number | null; note: string | null };
  best_trades: TradeBrief[];
  worst_trades: TradeBrief[];
  streaks: { max_wins: number; max_losses: number; current: { kind: "win" | "loss" | null; length: number } | null };
};

/* ─────────────────────────────────────────────────── stats report */

export type Group = { key: string; trades: number; net_pnl: number; win_rate: number | null; average_r?: number | null };

export type BehaviorFinding = { kind: string; title: string; severity: string; count: number; text: string; lesson: string };

export type StatsReport = {
  enough_data: boolean;
  message: string | null;
  metrics: PerfMetrics;
  best_setup: Group | null;
  worst_setup: Group | null;
  most_common_mistake: { mistake: string; count: number } | null;
  behavioral_mistakes: BehaviorFinding[];
  discipline_score: number;
  strategy_stability: null | {
    first_half: { expectancy_r: number | null; win_rate: number | null; trades: number };
    second_half: { expectancy_r: number | null; win_rate: number | null; trades: number };
    verdict: string;
  };
  by_symbol: Group[];
  by_exit_reason: Record<string, number>;
  equity_curve: [number, number][];
};

/* ─────────────────────────────────────────────────────── AI coach */

export type CoachFinding = {
  key: string;
  title: string;
  evidence: string;
  impact: string;
  severity: "warn" | "high" | "info" | string;
  count: number | null;
  sample: number | null;
  lesson: { slug: string; title: string; href: string } | null;
  position_ids?: string[];
  data?: Record<string, unknown>;
};

export type CoachCheck = { key: string; title: string; status: "found" | "ok" | "insufficient_data" | string; detail: string };

export type Coach = {
  title: string;
  period: { from: number; to: number };
  summary: string[];
  strengths: string[];
  weaknesses: string[];
  week_stats?: PerfMetrics | null;
  overall_stats?: PerfMetrics | null;
  biggest_mistake: { kind?: string; key?: string; title: string; text?: string; lesson?: string } | null;
  next_lessons: { slug: string; title: string; reason: string; href?: string }[];
  discipline_score: number | null;
  provider: string;
  text: string;
  disclaimer?: string;
  version?: number;
  findings?: CoachFinding[];
  checks?: CoachCheck[];
  sample?: { positions: number; with_r: number; note: string | null };
  next_lesson?: { slug: string; title: string; href: string; why: string; completed: boolean } | null;
  practice_exercise?: { key: string; title: string; description: string; href: string; success_criteria: string[]; reason: string } | null;
};

/* ───────────────────────────────────────────────── market (dashboard) */

export type SourceRef = SourceLike | null;
