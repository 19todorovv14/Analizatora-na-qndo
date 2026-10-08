/*
 * Response shapes of the S3b lab endpoints (backend/app/api/learn.py, below the S3b marker) and of the two
 * market/paper endpoints the Trade Simulator reads. Keep in sync with the backend report; every field the UI
 * reads is typed, extra fields are ignored.
 */
import type { SourceLike } from "@/components/ui";
import type { Candle } from "@/lib/types";

/* ───────────────────────────────────────────────────── Candlestick Lab */

export type PatternBias = "bullish" | "bearish" | "neutral" | "context-dependent";
export type PatternType = "single" | "double" | "triple";
export type TrendRequirement = "any" | "up" | "down" | "down_or_flat" | "up_or_flat";

/** GET /learn/candlesticks → patterns[] and GET /learn/candlesticks/{key} */
export type PatternCard = {
  key: string;
  name: string;
  type: PatternType;
  bars: number;
  bias: PatternBias;
  short: string;
  looks_like: string;
  means: string;
  does_not_mean: string;
  common_mistake: string;
  context_rule: string;
  confirmation: string;
  practice_hint: string;
  /** numeric detection rule (B = body, R = range) */
  rule: string;
  requires_trend: TrendRequirement;
  context: string;
  context_text: string;
  /** synthetic illustration: context candles + the pattern candles */
  candles: Candle[];
  /** index of the first pattern candle inside `candles` */
  pattern_start: number;
  /** indices of the pattern candles */
  highlight: number[];
  lesson: string | null;
  lesson_href: string | null;
  disclaimer: string;
};

export type PatternGallery = {
  patterns: PatternCard[];
  count: number;
  types: PatternType[];
  biases: PatternBias[];
  disclaimer: string;
};

export type ExampleOutcome = {
  bars: number;
  close: number;
  move: number;
  move_pct: number;
  move_atr: number | null;
  direction: "up" | "down" | "flat";
};

export type PatternExample = {
  /** time of the pattern's LAST candle (the detection bar — no lookahead) */
  time: number;
  start_time: number;
  index: number;
  start_index: number;
  bars: number;
  prior_trend: string;
  close: number;
  atr: number | null;
  /** one entry per horizon; null when there are not enough later candles yet */
  next: (ExampleOutcome | null)[];
};

export type ExampleStat = {
  bars: number;
  n: number;
  median_move_atr: number | null;
  median_move_pct: number | null;
  pct_up: number | null;
  pct_down: number | null;
};

/** GET /learn/candlesticks/{key}/examples */
export type PatternExamples = {
  key: string;
  name: string;
  bias: PatternBias;
  rule: string;
  symbol: string;
  timeframe: string;
  precision: number;
  horizons: number[];
  atr_period: number;
  disclaimer: string;
  available: boolean;
  code: string | null;
  reason: string | null;
  source: SourceLike | null;
  candles: Candle[];
  total_found: number;
  /** newest first, at most 30 */
  examples: PatternExample[];
  stats: ExampleStat[];
  sample_note: string | null;
};

export type PracticeOption = { key: string; name: string };

export type PracticeRound = {
  index: number;
  question: string;
  candles: Candle[];
  options: PracticeOption[];
  /** HMAC-signed round (the answer is not in the payload) */
  token: string;
};

/** GET /learn/candlesticks/practice?n= */
export type PracticeSet = {
  set_id: string;
  rounds: PracticeRound[];
  total: number;
  expires_ts: number;
  pass_score: number;
  module: string;
  disclaimer: string;
};

export type PracticeResultRow = {
  index: number | null;
  valid: boolean;
  correct: boolean;
  answer: string | null;
  answer_name?: string | null;
  expected: string | null;
  expected_name: string | null;
  bias?: PatternBias | null;
  explanation: string;
};

/** POST /learn/candlesticks/practice */
export type PracticeResult = {
  set_id: string;
  results: PracticeResultRow[];
  correct: number;
  answered: number;
  total: number;
  score: number;
  score_pct: number;
  passed: boolean;
  pass_score: number;
  stored: boolean;
  result_id: number | null;
  module: string;
};

/* ─────────────────────────────────────────────────── Market Structure Lab */

export type Difficulty = "easy" | "medium" | "hard";
export type SwingLabel = "HH" | "HL" | "LH" | "LL";
export type EventLabel = "BREAKOUT" | "RETEST" | "FAKEOUT";
export type StructureLabel = SwingLabel | EventLabel;
export type StructureKind = "uptrend" | "downtrend" | "range";

export type StructureAnchor = { time: number; price: number; kind: "high" | "low" };

/** GET /learn/structure/exercise */
export type StructureExercise = {
  token: string;
  symbol: string;
  timeframe: string;
  difficulty: Difficulty;
  difficulty_matched: boolean;
  precision: number;
  source: SourceLike | null;
  start: number;
  end: number;
  bars: number;
  candles: Candle[];
  anchors: StructureAnchor[];
  tasks: string[];
  tasks_bg: string[];
  labels: StructureLabel[];
  structures: StructureKind[];
  pivot: { left: number; right: number };
  atr: number;
  tolerance: { bars: number; atr_mult: number; price: number };
  hint: string | null;
  rules: string[];
  expires_ts: number;
  disclaimer: string;
};

/** A label the user placed on the chart (the body of POST /learn/structure/check). */
export type StructureMark = { time: number; price: number; label: StructureLabel };

export type MarkVerdict = "CORRECT" | "INCORRECT" | "NOT A SWING" | "REFERENCE";

export type CheckedMark = StructureMark & {
  verdict: MarkVerdict;
  expected_label: string | null;
  matched_swing: { time: number; price: number; kind: string; label: string | null } | null;
  scored: boolean;
  kind: "swing" | "event";
  explanation: string;
};

export type MissedSwing = { time: number; price: number; kind: "high" | "low"; label: SwingLabel; explanation: string };
export type MissedEvent = { type: EventLabel; time: number; price: number; direction: "up" | "down"; explanation: string };

export type RefSwing = {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
  label: SwingLabel | null;
  anchor: boolean;
  prev_price: number | null;
  prev_time: number | null;
};

export type RefEvent = {
  type: EventLabel;
  index: number;
  time: number;
  price: number;
  direction: "up" | "down";
  level_time: number;
  end_index: number;
  end_time: number;
  close: number;
  undetermined: boolean;
};

/** POST /learn/structure/check */
export type StructureCheck = {
  symbol: string;
  timeframe: string;
  difficulty: Difficulty;
  start: number;
  end: number;
  marks: CheckedMark[];
  missed: MissedSwing[];
  missed_events: MissedEvent[];
  structure: {
    answer: StructureKind | null;
    expected: StructureKind;
    correct: boolean;
    counts: Record<SwingLabel, number>;
    up_share: number | null;
    down_share: number | null;
    explanation: string;
  };
  score: number;
  components: { swings: number; structure: number; events: number; weights: { swings: number; structure: number; events: number } };
  counts: {
    reference_swings: number;
    reference_events: number;
    event_types_present: EventLabel[];
    event_types_found: EventLabel[];
    correct_swings: number;
    wrong_swing_marks: number;
    correct_events: number;
    wrong_event_marks: number;
  };
  summary: string;
  reference: { swings: RefSwing[]; events: RefEvent[]; structure: StructureKind; atr: number };
  ai_summary: string | null;
  checker: string;
  stored: boolean;
  attempt_id: number | null;
  note: string | null;
  disclaimer: string;
};

export type DifficultyStats = { count: number; best_score: number | null; avg_score: number | null };

/** GET /learn/structure/history */
export type StructureHistory = {
  attempts: {
    id: number;
    symbol: string;
    timeframe: string;
    difficulty: Difficulty;
    start: number;
    end: number;
    score: number;
    structure: { answer: StructureKind | null; expected: StructureKind; correct: boolean } | null;
    marks: number;
    summary: string;
    created_ts: number;
  }[];
  count: number;
  best_score: number | null;
  avg_score: number | null;
  last_score: number | null;
  by_difficulty: Record<Difficulty, DifficultyStats>;
};

/* ───────────────────────────────────────────────────────── Leverage Lab */

export type RiskLevel = "low" | "elevated" | "high" | "extreme";
export type Side = "long" | "short";

export type LeverageScenarioRow = {
  move_pct: number;
  price: number;
  pnl: number;
  pnl_pct_of_equity: number;
  pnl_pct_of_margin: number | null;
  equity_after: number;
  liquidated: boolean;
};

export type CurvePoint = {
  move_pct: number;
  pnl: number;
  equity: number;
  pnl_pct_of_equity: number;
  liquidated: boolean;
  at_liquidation: boolean;
};

export type CurveSeries = {
  leverage: number;
  position_notional: number;
  required_margin: number;
  can_open: boolean;
  liquidation_price: number | null;
  liquidation_move_pct: number | null;
  isolated_liquidation_move_pct: number | null;
  risk_level: RiskLevel;
  points: CurvePoint[];
};

export type CurveFamily = {
  basis: "margin" | "notional";
  margin: number | null;
  position_notional: number | null;
  equity: number;
  side: Side;
  moves_pct: number[];
  series: CurveSeries[];
};

export type LeveragePlan = {
  stop_price: number | null;
  target_price: number | null;
  stop_distance_pct: number | null;
  target_distance_pct: number | null;
  reward_risk: number | null;
  liquidation_before_stop: boolean;
  pnl_at_stop: number | null;
  risk_amount: number | null;
  risk_pct_of_equity: number | null;
  pnl_at_target: number | null;
  pnl_at_target_pct_of_equity: number | null;
  reward_risk_net: number | null;
};

/** POST /learn/leverage/simulate */
export type LeverageResult = {
  equity: number;
  leverage: number;
  side: Side;
  basis: "notional" | "margin" | "risk";
  risk_pct: number | null;
  margin_mode: string;
  entry_price: number;
  mid_price: number;
  position_notional: number;
  units: number;
  required_margin: number;
  entry_fee: number;
  fee_rate: number;
  spread_bps: number;
  spread_cost: number;
  round_trip_cost: number;
  free_margin: number;
  margin_level_pct: number | null;
  maintenance_ratio: number;
  maintenance_margin: number;
  effective_leverage: number;
  can_open: boolean;
  cannot_open_reason: string | null;
  price_move_pct: number;
  price_after_move: number;
  price_change: number;
  exit_price: number;
  gross_pnl_at_move: number;
  exit_fee: number;
  pnl_at_move: number;
  pnl_pct_of_equity: number;
  pnl_pct_of_margin: number | null;
  equity_after: number;
  liquidated_at_move: boolean;
  margin_level_at_move_pct: number | null;
  liquidation_price: number | null;
  liquidation_reachable: boolean;
  liquidation_distance_pct: number | null;
  liquidation_move_pct: number | null;
  isolated_liquidation_price: number | null;
  isolated_liquidation_distance_pct: number | null;
  daily_vol_pct: number | null;
  daily_vol_source: string;
  liquidation_distance_daily_moves: number | null;
  risk_level: RiskLevel;
  isolated_risk_level: RiskLevel;
  risk_levels: RiskLevel[];
  scenarios: LeverageScenarioRow[];
  plan: LeveragePlan | null;
  notes: string[];
  warning: string;
  virtual_notice: string;
  curves?: CurveFamily | null;
  curves_same_notional?: CurveFamily | null;
  asset?: {
    symbol: string;
    name: string;
    asset_class: string;
    currency: string;
    max_leverage: number;
    leverage_allowed: boolean;
    daily_vol_pct: number;
    taker_fee: number;
    spread_bps: number;
  } | null;
};

/** Body of POST /learn/leverage/simulate (exactly one of position_notional | margin | risk_pct). */
export type LeverageRequest = {
  leverage: number;
  equity?: number;
  position_notional?: number;
  margin?: number;
  risk_pct?: number;
  entry_price?: number;
  side?: Side;
  price_move_pct?: number;
  maintenance_ratio?: number;
  fee_rate?: number;
  spread_bps?: number;
  daily_vol_pct?: number;
  stop_price?: number;
  target_price?: number;
  scenario_moves?: number[];
  symbol?: string;
  include_curves?: boolean;
};

export type ScenarioStep = {
  leverage: number;
  margin: number;
  position_notional: number;
  pnl: number;
  pnl_pct_of_equity: number;
  pnl_pct_of_margin: number;
  equity_after: number;
  liquidated: boolean;
  liquidation_move_pct: number | null;
  isolated_liquidation_move_pct: number | null;
  risk_level: RiskLevel;
  can_open: boolean;
  text: string;
};

/** GET /learn/leverage/scenario */
export type LeverageWalkthrough = {
  title: string;
  stake: number;
  equity: number;
  move_pct: number;
  side: Side;
  steps: ScenarioStep[];
  same_notional: { position_notional: number; pnl: number; text: string };
  takeaways: string[];
  warning: string;
  virtual_notice: string;
};

/* ──────────────────────────────────────────────── Trade Simulator inputs */

/** GET /market/ticker */
export type TickerPayload = {
  symbol: string;
  price: number;
  ts: number;
  change_24h_pct: number | null;
  volume_24h: number | null;
  source: string;
  bid: number;
  ask: number;
  precision: number;
  source_info: SourceLike | null;
};

/** GET /paper/instrument (order-panel parameters; login required) */
export type PaperInstrument = {
  symbol: string;
  name: string;
  asset_class: string;
  price_precision: number;
  qty_step: number;
  min_qty: number;
  maker_fee: number;
  taker_fee: number;
  spread_bps: number;
  max_leverage: number;
  default_leverage: number;
  account_leverage: number;
  margin_mode: string;
  stop_out_level: number;
  currency: string;
  quote_currency: string;
  /** typical daily move as a fraction (0.03 = 3 %) */
  daily_vol: number;
  daily_vol_source: string;
  leverage_warning: string;
  available: boolean;
  unavailable_reason: string | null;
  code: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  source: SourceLike | null;
  conversion: {
    quote_currency: string;
    account_currency: string;
    method: "identity" | "inverse" | "cross" | "fixed";
    route: { currency: string; symbol: string; invert: boolean } | null;
    /** USD per 1 unit of the quote currency */
    rate: number | null;
    available: boolean;
    reason: string | null;
  } | null;
  market_status: { status: string; label: string; note?: string | null } | null;
};
