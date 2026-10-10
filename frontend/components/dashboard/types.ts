/*
 * GET /api/dashboard (v2) — the TRADING COMMAND CENTER payload. Additive over v1: every v1 key is kept.
 */
import type { RiskStatus } from "@/components/analytics/types";
import type { MarketItem } from "@/components/market/types";
import type { SourceLike } from "@/components/ui";
import type { Position, Trade } from "@/lib/types";

/** market_overview / watchlist row (snapshot of one instrument; numbers are null when unavailable). */
export type OverviewRow = {
  symbol: string;
  slug: string | null;
  name?: string;
  asset_class?: string | null;
  category?: string | null;
  price?: number | null;
  change_24h_pct?: number | null;
  volume_24h?: number | null;
  volume_24h_usd?: number | null;
  volatility_pct?: number | null;
  trend?: string | null;
  regime?: string | null;
  source?: SourceLike | null;
  precision?: number;
  sparkline?: number[];
  available: boolean;
  status?: string;
  code?: string | null;
  reason?: string | null;
  as_of?: number;
  href: string | null;
  error?: string;
};

export type MarketClassCode = null | "DATA_NOT_AVAILABLE" | "PLAN_LIMIT" | "WARMING" | string;

export type MarketClass = {
  asset_class: string;
  label: string;
  available: boolean;
  reason: string | null;
  code: MarketClassCode;
  source: SourceLike | null;
  ranked: number;
  advancers: number;
  decliners: number;
  average_change_pct: number | null;
  top_mover: MarketItem | null;
  href: string;
};

export type MarketBlock = {
  as_of: number;
  movers: { gainers: MarketItem[]; losers: MarketItem[]; most_volume: MarketItem[] };
  classes: MarketClass[];
  coverage: { ranked: number; eligible: number; unavailable: number; rate_limited: number; missing: number; excluded_classes: string[] };
  note: string | null;
  heatmap_href: string;
  markets_href: string;
};

export type DashAccount = {
  balance: number;
  equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
  day_pnl: number;
  free_margin: number;
  max_drawdown_pct: number;
  currency?: string;
  used_margin?: number;
  available_margin?: number;
  margin_level?: number | null;
  margin_level_pct?: number | null;
  exposure?: number;
  exposure_pct?: number;
  effective_leverage?: number;
  open_positions?: number;
  initial_balance?: number;
};

export type SkillBrief = { key: string; title: string; title_bg: string; score: number };

export type DashLearning = {
  xp: number;
  level: number;
  categories: { category: string; percent: number }[];
  lessons_completed: number;
  lessons_total: number;
  next_module: { key: string; title: string; percent: number } | null;
  current_level?: { level: number; key?: string; title: string; title_bg?: string; status?: string; percent?: number } | null;
  next?: { type: string; href: string; title: string; level?: number; slug?: string; module?: string } | null;
  xp_level?: number;
  xp_progress?: { level_start: number; next_level_at: number; into_level: number; needed: number; percent: number } | null;
  levels_completed?: number;
  levels_total?: number;
  quiz_avg_score?: number | null;
  quizzes_passed?: number;
  quizzes_total?: number;
  replay_score?: number | null;
  replay_sessions?: number;
  replay_finished?: number;
  paper_trades?: number;
  risk_discipline?: {
    score: number | null;
    trades: number;
    components: { with_stop_pct: number | null; within_risk_rule_pct: number | null; no_widened_stops_pct: number | null; rr_ok_pct: number | null };
    rules?: { max_risk_per_trade_pct: number; min_reward_risk: number };
  } | null;
  strongest_skill?: SkillBrief | null;
  weakest_skill?: SkillBrief | null;
  most_common_mistake?: { key: string; title: string; title_bg?: string | null; count: number; lesson: string | null; href: string | null } | null;
  recommendations?: { kind?: string; title: string; href: string; reason: string }[];
};

export type DashBot = {
  id: number;
  name: string;
  symbol: string;
  timeframe: string;
  status: string;
  regime: string | null;
  last_signal: string | null;
  pause_reason?: string | null;
  coach_headline?: string | null;
  setups_generated?: number | null;
  all_conditions_met?: number | null;
  entries?: number | null;
  last_processed_ts?: number | null;
  href?: string;
};

export type StrategyPerf = {
  id: number;
  strategy: string;
  symbol: string;
  timeframe: string;
  status: string;
  net_pnl: number | null;
  trades: number | null;
  profit_factor: number | null;
};

export type Insight = {
  kind: "behavior" | "market" | "next_step" | string;
  key?: string;
  title: string;
  text: string;
  why?: string | null;
  lesson?: string | null;
  href?: string | null;
  lesson_href?: string | null;
  action?: { label: string; href: string } | null;
  severity?: "warn" | "info" | string;
  available?: boolean;
  count?: number | null;
  sample?: number | null;
  symbol?: string;
  timeframe?: string;
  regime?: string | null;
  trend?: string | null;
  volatility_pct?: number | null;
  source?: SourceLike | null;
};

export type NextAction = { key: "learn" | "first_trade" | "replay" | "journal" | "risk" | string; label: string; href: string; reason: string };

export type DashboardData = {
  user: { display_name: string; mode?: string; xp: number; is_guest: boolean; app_mode?: "learn" | "trade"; explain_mode?: boolean };
  market_overview: OverviewRow[];
  market?: MarketBlock | null;
  watchlist: OverviewRow[];
  watchlist_total?: number;
  watchlist_limit?: number;
  account: DashAccount;
  open_positions: Position[];
  recent_trades: Trade[];
  learning: DashLearning;
  bots: DashBot[];
  strategy_performance: StrategyPerf[];
  risk: RiskStatus;
  ai_insights: Insight[];
  next_actions?: NextAction[];
  tour_done?: boolean;
  as_of?: number;
};
