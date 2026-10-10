/*
 * Response / request shapes of the S5 Historical Replay V2 endpoints (backend/app/api/replay.py).
 * Every field the backend may omit for legacy sessions is optional.
 */
import type { AccountView, Candle, DataSource, Review, RiskFinding, Order } from "@/lib/types";

export type ReplayMode = "trade" | "predict";
export type ReplayAction = "long" | "short" | "wait";
export type PresetKey = "random" | "trend" | "range" | "high_volatility" | "breakout";
export type Grade = "A" | "B" | "C" | "D";

export type ReplayPreset = {
  key: PresetKey | string;
  label: string;
  label_bg?: string;
  description?: string;
};

export type ReplayStrategyInfo = {
  id: number;
  name: string;
  is_template: boolean;
  source?: "selected" | "recent" | "template" | string;
  template_key?: string | null;
  timeframe?: string | null;
};

export type ReplaySessionInfo = {
  id: number;
  symbol: string;
  timeframe: string;
  start_ts: number;
  cursor_ts: number;
  end_ts: number;
  status: "active" | "finished" | string;
  remaining: number;
  mode?: ReplayMode;
  precision?: number;
  bars?: number;
  revealed?: number;
  score?: number | null;
  grade?: Grade | null;
  preset?: ReplayPreset | null;
  strategy?: ReplayStrategyInfo | null;
  created_ts?: number;
  has_review?: boolean;
};

export type FlagSeverity = "info" | "warning" | string;

export type DecisionFlag = {
  key: string;
  label: string;
  severity: FlagSeverity;
  text: string;
  lesson?: string | null;
  level?: number | null;
  clean_move?: string | null;
};

export type TradeOutcome = {
  status: "open" | "target" | "stop" | "expired";
  bars_held: number;
  r_result: number | null;
  mfe_r?: number | null;
  mae_r?: number | null;
  exit_price?: number | null;
  exit_ts?: number | null;
  last_ts?: number | null;
  same_bar_stop_and_target?: boolean;
  gap?: boolean;
  horizon?: number;
};

export type WaitOutcome = {
  status: "open" | "resolved";
  right_to_wait: boolean | null;
  bars_observed?: number;
  clean_move?: "up" | "down" | null;
  bars_to_move?: number | null;
  max_up_atr?: number | null;
  max_down_atr?: number | null;
  atr?: number | null;
  horizon?: number;
  explanation?: string;
};

export type DecisionOutcome = TradeOutcome | WaitOutcome;

export type ScoreComponent = {
  score: number;
  text?: string;
  value?: number | null;
  distance_atr?: number | null;
  regime?: string | null;
};

export type DecisionContext = {
  available?: boolean;
  atr?: number | null;
  ema20?: number | null;
  ema20_distance_atr?: number | null;
  regime?: string | null;
  structure?: string | null;
  support?: number | null;
  resistance?: number | null;
  swing_low_below?: {
    price: number;
    time: number;
    label?: string | null;
  } | null;
  swing_high_above?: {
    price: number;
    time: number;
    label?: string | null;
  } | null;
  [k: string]: unknown;
};

export type ReplayDecision = {
  id: number | null;
  bar_ts: number;
  action: ReplayAction;
  entry_price: number;
  stop: number | null;
  target: number | null;
  note?: string | null;
  planned_rr: number | null;
  risk?: number | null;
  risk_atr?: number | null;
  outcome: DecisionOutcome;
  score: number | null;
  score_final?: boolean;
  entry_score?: number | null;
  grade?: Grade | null;
  components?: Record<string, ScoreComponent>;
  flags: DecisionFlag[];
  correct: boolean | null;
  context?: DecisionContext;
  order_id?: string | null;
  created_ts?: number;
};

export type DecisionsSummary = {
  total: number;
  long: number;
  short: number;
  wait: number;
  resolved: number;
  open: number;
  correct: number;
  wrong: number;
  total_r: number | null;
  avg_planned_rr: number | null;
  avg_score: number | null;
  flags: Record<string, number>;
  last_bar_ts: number | null;
};

export type LiveScore = {
  value: number | null;
  grade: Grade | null;
  scored: number;
  pending: number;
};

export type IndicatorSeries = {
  name: string;
  params?: Record<string, number>;
  pane?: string;
  series: Record<string, { time: number; value: number }[]>;
};

export type ReplayEvent = {
  id: number;
  ts: number;
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

export type ResolvedItem = {
  id: number;
  bar_ts: number;
  action: ReplayAction;
  status: string;
  r_result: number | null;
  right_to_wait: boolean | null;
  score: number | null;
  correct: boolean | null;
};

export type ReplayState = {
  session: ReplaySessionInfo;
  candles: Candle[];
  account: AccountView;
  events: ReplayEvent[];
  mode?: ReplayMode;
  precision?: number;
  source?: DataSource | null;
  score?: LiveScore;
  decisions?: ReplayDecision[];
  decisions_summary?: DecisionsSummary;
  current_decision?: ReplayDecision | null;
  can_trade?: boolean;
  indicators?: Record<string, IndicatorSeries> | null;
  /** /step only: decisions that became final on this step */
  resolved?: ResolvedItem[];
};

export type DecisionResponse = ReplayState & {
  decision: ReplayDecision;
  order: Order | null;
  findings: RiskFinding[];
  replaced: boolean;
};

export type DecisionPreview = { preview: true; decision: ReplayDecision };

export type OrderResponse = ReplayState & {
  order: Order;
  findings: RiskFinding[];
};

export type PaperTradeRow = {
  id: string;
  position_id: string;
  side: "long" | "short";
  qty: number;
  entry_price: number;
  exit_price: number;
  stop_price: number | null;
  target_price: number | null;
  net_pnl: number;
  fees: number;
  r_multiple: number | null;
  exit_reason: string;
  opened_ts: number;
  closed_ts: number;
};

export type CompactDecision = {
  id: number;
  bar_ts: number;
  action: ReplayAction;
  entry_price: number;
  status: string;
  r_result: number | null;
  right_to_wait: boolean | null;
  score: number | null;
  text: string;
};

export type FlagItem = {
  id: number;
  bar_ts: number;
  action: ReplayAction;
  entry_price: number;
  text: string;
  level?: number | null;
  lesson?: string | null;
};

export type FlagSummary = {
  key: string;
  label: string;
  severity: FlagSeverity;
  count: number;
  lesson?: string | null;
};

export type Prediction = {
  id: number;
  bar_ts: number;
  action: ReplayAction;
  entry_price: number;
  stop: number | null;
  target: number | null;
  planned_rr: number | null;
  note?: string | null;
  outcome: DecisionOutcome;
  score: number | null;
  grade?: Grade | null;
  score_final?: boolean;
  correct: boolean | null;
  flags: DecisionFlag[];
  comment: string;
};

export type SwingPoint = {
  index?: number;
  time: number;
  price: number;
  kind: "high" | "low" | string;
  label?: string | null;
};

export type WhatHappened = {
  available: boolean;
  reason?: string | null;
  start_ts?: number;
  end_ts?: number;
  bars?: number;
  start_price?: number;
  end_price?: number;
  change_pct?: number;
  change_atr?: number | null;
  high?: { price: number; time: number; pct_from_start?: number } | null;
  low?: { price: number; time: number; pct_from_start?: number } | null;
  max_up_pct?: number;
  max_down_pct?: number;
  max_up_atr?: number | null;
  max_down_atr?: number | null;
  regime_start?: string | null;
  regime_end?: string | null;
  regimes?: { regime: string; bars: number; pct: number }[];
  regime_segments?: {
    regime: string;
    start_ts: number;
    end_ts: number;
    bars: number;
  }[];
  key_swings?: SwingPoint[];
  structure_end?: { trend: string; text: string } | null;
  next?: {
    bars: number;
    end_ts: number;
    end_price: number;
    change_pct: number;
    high: number;
    low: number;
  } | null;
  setup?: {
    preset: string;
    label: string;
    label_bg?: string;
    matched?: boolean;
    text?: string;
  } | null;
  text?: string[];
};

export type RrAssessment = {
  decisions: number;
  with_target: number;
  without_target: number;
  avg_planned_rr: number | null;
  min_planned_rr: number | null;
  max_planned_rr: number | null;
  good: number;
  low: number;
  poor: number;
  total_r: number | null;
  resolved: number;
  verdict: "good" | "mixed" | "poor" | "n/a" | string;
  text: string[];
};

export type InvalidationLevel = {
  id: number;
  bar_ts: number;
  action: ReplayAction;
  entry_price: number;
  stop: number | null;
  level: number | null;
  structural_level: number | null;
  structural_label: string | null;
  hit: boolean;
  hit_ts: number | null;
  text: string;
};

export type StrategyTrade = {
  side: "long" | "short";
  entry_ts: number;
  exit_ts: number;
  entry_price: number;
  exit_price: number;
  qty: number;
  net_pnl: number;
  fees: number;
  r_multiple: number | null;
  exit_reason: string;
};

export type StrategyComparison = {
  available: boolean;
  reason: string | null;
  sentence: string;
  strategy?: ReplayStrategyInfo | null;
  rules?: string[];
  period?: { start_ts: number; end_ts: number } | null;
  trades: StrategyTrade[];
  metrics: {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    win_rate: number | null;
    net_pnl: number;
    return_pct: number;
    profit_factor: number | null;
    expectancy_r: number | null;
    total_r: number | null;
    max_drawdown_pct: number;
    fees_total: number;
    buy_and_hold_pct: number | null;
    start_equity?: number;
    window_bars?: number;
    warmup_bars?: number;
  } | null;
  costs?: Record<string, unknown> | null;
  text?: string[];
  disclaimer?: string;
};

export type ReviewLesson = {
  slug: string;
  title: string;
  reason: string;
  href?: string;
  flag?: string;
  flags?: string[];
  count?: number;
};

export type TeacherSection = { key: string; title: string; body: string[] };

export type HistoryReview = {
  version?: number;
  generated_ts?: number;
  end_ts?: number;
  symbol: string;
  timeframe: string;
  mode: ReplayMode;
  precision: number;
  score: number | null;
  grade: Grade | null;
  score_basis?: "decisions" | "trades" | null;
  what_happened: WhatHappened;
  predictions: Prediction[];
  correct: CompactDecision[];
  wrong: CompactDecision[];
  undetermined?: CompactDecision[];
  entered_too_early: FlagItem[];
  chased: FlagItem[];
  ignored_structure: FlagItem[];
  flags_summary: FlagSummary[];
  rr_assessment: RrAssessment;
  invalidation_levels: InvalidationLevel[];
  strategy_comparison: StrategyComparison;
  lessons: ReviewLesson[];
  sections: TeacherSection[];
  summary: string[];
  provider?: string;
  provider_label?: string;
  fallback?: boolean;
  safety_note?: string | null;
  disclaimer?: string;
};

export type ReplayMetrics = {
  total_trades: number;
  net_pnl: number;
  win_rate: number | null;
  [k: string]: unknown;
};

/** POST /replay/{sid}/finish */
export type FinishResponse = ReplayState & {
  metrics: ReplayMetrics;
  reviews: Review[];
  summary: string[];
  what_happened_next: Candle[];
  paper_trades?: PaperTradeRow[];
  history_review?: HistoryReview | null;
};

/** GET /replay/{sid}/review */
export type StoredReviewResponse = {
  session: ReplaySessionInfo;
  precision: number;
  source?: DataSource | null;
  candles: Candle[];
  what_happened_next: Candle[];
  decisions: ReplayDecision[];
  paper_trades?: PaperTradeRow[];
  history_review: HistoryReview;
};

/** Normalised data of the review screen (finish response or stored review). */
export type ReviewData = {
  session: ReplaySessionInfo;
  precision: number;
  source: DataSource | null;
  candles: Candle[];
  next: Candle[];
  decisions: ReplayDecision[];
  paperTrades: PaperTradeRow[];
  review: HistoryReview | null;
  /** legacy finish keys (only right after finishing) */
  reviews: Review[];
  summary: string[];
  metrics: ReplayMetrics | null;
};

export type SessionRow = {
  id: number;
  symbol: string;
  timeframe: string;
  start_ts: number;
  cursor_ts?: number;
  status: string;
  end_ts?: number;
  mode?: ReplayMode;
  score?: number | null;
  grade?: Grade | null;
  preset?: string | null;
  decisions?: number;
  created_ts?: number;
  has_review?: boolean;
};

export type ReplayStats = {
  sessions: number;
  finished: number;
  active?: number;
  avg_score: number | null;
  best_score: number | null;
  last_scores: {
    id: number;
    symbol: string;
    timeframe: string;
    mode?: ReplayMode;
    preset?: string | null;
    score: number | null;
    grade?: Grade | null;
    created_ts?: number;
  }[];
  common_flags: (FlagSummary & { lesson_title?: string; href?: string })[];
  decisions?: number;
  correct?: number;
  wrong?: number;
  accuracy_pct?: number | null;
};

export type ReplayOptions = {
  modes: {
    key: ReplayMode;
    label: string;
    label_bg?: string;
    description?: string;
  }[];
  presets: ReplayPreset[];
  actions?: ReplayAction[];
  defaults?: {
    mode?: ReplayMode;
    bars?: number;
    balance?: number;
    preset?: string | null;
  };
  limits?: {
    bars?: { min: number; max: number };
    balance?: { min: number; max: number };
    step_max?: number;
    next_bars?: number;
  };
  rules?: Record<string, unknown>;
  flags?: {
    key: string;
    label: string;
    severity: FlagSeverity;
    lesson?: string;
    lesson_title?: string;
    href?: string;
  }[];
  strategy_sentence?: string;
  disclaimer?: string;
};

export type ReplaySetupValues = {
  symbol: string;
  timeframe: string;
  /** "date" = start_ts from the date picker; otherwise a preset key */
  period: "date" | PresetKey;
  /** yyyy-mm-dd */
  start: string;
  bars: number;
  mode: ReplayMode;
  /** null = automatic (the user's latest strategy, else the default template) */
  strategyId: number | null;
};
