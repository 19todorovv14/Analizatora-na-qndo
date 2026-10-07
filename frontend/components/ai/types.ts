/*
 * Types of the AI Trading Teacher API (backend app/api/teacher.py, app/ai/modes.py, app/strategies/view.py).
 * Shapes mirror the real JSON — every field the UI does not strictly need is optional so older/partial
 * payloads still render.
 */

export type TeacherMode = "explain" | "analyze" | "teach" | "review_trade" | "review_strategy" | "quiz" | "why" | "compare";

/** GET /api/teacher/modes item. */
export type ModeInfo = {
  key: TeacherMode;
  label: string;
  description: string;
  /** lucide icon name, e.g. "ScanSearch" */
  icon?: string;
  needs?: string[];
  optional?: string[];
  sections?: { key: string; title: string }[];
  extra_sections?: { key: string; title: string }[];
  context?: string[];
};

export type AnswerSection = { key: string; title: string; body: string[] };

export type FollowUp = { label: string; mode: TeacherMode; payload: Record<string, unknown> };

/** "What the teacher knows" chip (context_used item). */
export type ContextItem = {
  key: string;
  label: string;
  available: boolean;
  detail?: string;
  values?: Record<string, string>;
};

export type Swing = { index?: number; time: number; price: number; kind: "high" | "low" | string; label: string | null };

export type OverlaySetup = { side: "long" | "short"; entry: number; stop: number | null; target: number | null; source?: string };

export type ChartOverlay = {
  support?: number[];
  resistance?: number[];
  swings?: Swing[];
  setup?: OverlaySetup | null;
  draft?: (OverlaySetup & { risk_per_unit?: number | null }) | null;
};

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  source?: "academy" | "chart" | string;
  module?: string | null;
  module_title?: string | null;
  lesson?: string | null;
};

export type Quiz = {
  questions: QuizQuestion[];
  focus?: { module: string; title: string; reason: string }[];
  sources?: Record<string, number>;
  pass_score?: number;
};

export type ComparisonSide = { symbol: string; timeframe: string; label: string; available: boolean };
export type ComparisonRow = { key: string; label: string; left: string; right: string; different: boolean };
export type Comparison = { left: ComparisonSide; right: ComparisonSide; rows: ComparisonRow[]; note?: string };

export type LessonLink = { slug: string; title: string; href: string; module?: string | null };

export type ExamplesSummary = {
  available: boolean;
  basis?: string;
  horizon?: number;
  bars_scanned?: number;
  count?: number;
  regime?: string | null;
  rsi_band?: number[] | null;
  direction?: string;
  criteria?: string;
  median_move_atr?: number | null;
  p25_move_atr?: number | null;
  p75_move_atr?: number | null;
  plus_first_pct?: number | null;
  minus_first_pct?: number | null;
  neither_pct?: number | null;
  r_unit?: string;
  reliable?: boolean;
  note?: string;
  summary?: string;
  reason?: string;
};

export type AnswerStrategy = { id: number | null; name: string; selected?: boolean; source?: string; result?: string | null };

export type TradeReviewInfo = {
  position_id: string;
  symbol: string;
  side: string;
  result?: string;
  process_score?: number;
  grade?: string;
  lessons?: string[];
  net_pnl?: number | null;
  r_multiple?: number | null;
  risk_pct?: number | null;
  planned_rr?: number | null;
};

/** POST /api/teacher/ask response. */
export type TeacherAnswerData = {
  mode: TeacherMode;
  title: string;
  symbol?: string | null;
  timeframe?: string | null;
  sections: AnswerSection[];
  follow_ups?: FollowUp[];
  context_used?: ContextItem[];
  provider: string;
  provider_label?: string;
  fallback?: boolean;
  llm_rejected_sections?: string[];
  disclaimer: string;
  safety_removed?: string[];
  safety_note?: string | null;
  data_available?: boolean | null;
  generated_ts?: number;
  examples?: ExamplesSummary | null;
  strategy?: AnswerStrategy | null;
  overlay?: ChartOverlay | null;
  quiz?: Quiz | null;
  comparison?: Comparison | null;
  lesson?: LessonLink | null;
  next_lesson?: LessonLink | null;
  review?: TradeReviewInfo | null;
  backtest?: { id: number; symbol: string; timeframe: string } | null;
  session_id?: number;
};

/** Draft order from the trading terminal ("Explain this setup"). */
export type DraftOrder = {
  side: "long" | "short" | "buy" | "sell";
  entry: number | null | undefined;
  stop?: number | null;
  target?: number | null;
  qty?: number | null;
};

/** POST /api/teacher/ask request body. */
export type AskRequest = {
  mode: TeacherMode;
  symbol?: string;
  timeframe?: string;
  indicators?: string[];
  strategy_id?: number;
  position_id?: string;
  backtest_id?: number;
  compare_symbol?: string;
  compare_timeframe?: string;
  question?: string;
  topic?: string;
  draft?: { side: "long" | "short" | "buy" | "sell"; entry: number; stop?: number; target?: number; qty?: number };
  session_id?: number;
};

/** GET /api/teacher/context response. */
export type TeacherContext = { symbol: string; timeframe: string; context_used: ContextItem[]; summary: string };

/* ─────────────────────────────────────────── strategy view */

export type SetupResult = "POSSIBLE LONG SETUP" | "POSSIBLE SHORT SETUP" | "NO SETUP";

export type ConditionCheck = {
  label: string;
  passed: boolean;
  left_value: number | null;
  right_value: number | null;
  explanation: string;
};

export type RiskPlan = {
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number | null;
  rr: number | null;
  risk_per_unit?: number | null;
  stop_atr?: number | null;
  stop_rule?: string;
  target_rule?: string;
  risk_per_trade_pct?: number | null;
  note?: string;
};

export type StrategyViewSource = { id?: string; name?: string; is_live?: boolean; disclaimer?: string; status?: "live" | "delayed" | "demo" | "unavailable" | null };

/** POST /api/teacher/strategy-view response. */
export type StrategyViewData = {
  symbol: string;
  timeframe: string;
  strategy: {
    id: number | null;
    name: string;
    is_template?: boolean;
    selected?: boolean;
    source?: string;
    symbol?: string;
    timeframe?: string;
    summary?: string[];
  };
  closed_candles_only?: boolean;
  disclaimer: string;
  available: boolean;
  reason?: string;
  time?: number | null;
  price?: number | null;
  data_source?: string;
  regime?: { regime: string; reasons?: string[] } | null;
  structure?: { trend?: string; text?: string; last_high_label?: string | null; last_low_label?: string | null; swings?: Swing[] } | null;
  momentum?: { label: string; rsi: number | null; macd_hist?: number | null } | null;
  volatility?: { label: string; atr: number | null; atr_pct: number | null; rank?: number | null } | null;
  support?: { price: number; touches?: number }[];
  resistance?: { price: number; touches?: number }[];
  conditions: { long: ConditionCheck[]; short: ConditionCheck[] };
  logic?: { long?: "all" | "any" | string; short?: "all" | "any" | string };
  long_passed?: boolean;
  short_passed?: boolean;
  regime_filter: { required: string[]; actual: string | null; passed: boolean };
  result: SetupResult | string;
  why: string[];
  warnings?: { code: string; title: string; text: string }[];
  risk_plan: RiskPlan | null;
  source?: StrategyViewSource | null;
};

/* ─────────────────────────────────────────── misc API rows used by pickers */

export type ClosedTrade = {
  id: string;
  position_id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_price: number;
  exit_price: number;
  net_pnl: number;
  r_multiple: number | null;
  exit_reason: string;
  opened_ts: number;
  closed_ts: number;
};

export type StrategyOption = { id: number; name: string; is_template: boolean; symbol?: string; timeframe?: string };

export type BacktestOption = { id: number; strategy_id?: number | null; symbol?: string; timeframe?: string; status?: string; created_ts?: number };

export type TeacherSessionRow = {
  id: number;
  mode: TeacherMode | null;
  title: string;
  created_ts: number;
  provider: string | null;
  context: { symbol?: string | null; timeframe?: string | null; strategy_id?: number | null; position_id?: string | null };
};
