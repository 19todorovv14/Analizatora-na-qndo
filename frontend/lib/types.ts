export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Point = { time: number; value: number };

export type DataSource = { id: string; name: string; is_live: boolean; disclaimer: string };

export type IndicatorPayload = {
  name: string;
  params: Record<string, number>;
  pane: "price" | "separate" | "volume";
  series: Record<string, Point[]>;
};

export type CandlesResponse = {
  symbol: string;
  timeframe: string;
  precision: number;
  source: DataSource;
  execution: string;
  candles: Candle[];
  indicators: Record<string, IndicatorPayload>;
  server_time: number;
};

export type Asset = {
  symbol: string;
  name: string;
  asset_class: string;
  price_precision: number;
  qty_step: number;
  min_qty: number;
  spread_bps: number;
  maker_fee: number;
  taker_fee: number;
  max_leverage: number;
  description: string;
  source: DataSource;
};

export type User = {
  id: number;
  email: string;
  display_name: string;
  is_guest: boolean;
  mode: "beginner" | "advanced";
  xp: number;
};

export type Metrics = {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  net_pnl: number;
  return_pct: number | null;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number | null;
  average_win: number | null;
  average_loss: number | null;
  largest_win: number | null;
  largest_loss: number | null;
  average_r: number | null;
  average_win_r: number | null;
  average_loss_r: number | null;
  expectancy: number | null;
  expectancy_r: number | null;
  max_drawdown: number;
  max_drawdown_pct: number;
  fees_total: number;
  average_holding_seconds: number | null;
  max_consecutive_losses: number;
  sqn: number | null;
  final_equity?: number;
  buy_and_hold_pct?: number | null;
  signals?: number;
  time_in_market_pct?: number | null;
  slippage_cost_est?: number;
};

export type Position = {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  initial_qty: number;
  entry_price: number;
  mark_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  initial_stop: number | null;
  leverage: number;
  margin: number;
  unrealized_pnl: number;
  unrealized_r: number | null;
  realized_pnl: number;
  liquidation_price: number | null;
  opened_ts: number;
  precision: number;
  setup: string | null;
  timeframe: string | null;
  risk_pct: number | null;
};

export type Order = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop";
  qty: number;
  filled_qty: number;
  price: number | null;
  avg_fill_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  fees: number;
  slippage_cost: number;
  reject_reason: string | null;
  created_ts: number;
};

export type Trade = {
  id: string;
  position_id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_price: number;
  exit_price: number;
  stop_price: number | null;
  target_price: number | null;
  gross_pnl: number;
  fees: number;
  net_pnl: number;
  risk_amount: number | null;
  r_multiple: number | null;
  exit_reason: string;
  opened_ts: number;
  closed_ts: number;
  meta: Record<string, unknown>;
};

export type AccountView = {
  account: {
    id: number;
    name: string;
    kind: string;
    initial_balance: number;
    leverage: number;
    execution: Record<string, unknown>;
  };
  balance: number;
  equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
  fees_paid: number;
  used_margin: number;
  free_margin: number;
  margin_level: number | null;
  exposure: number;
  day_pnl: number;
  max_drawdown_pct: number;
  metrics: Metrics;
  positions: Position[];
  orders: Order[];
  virtual_funds_notice: string;
};

export type RiskFinding = { kind: string; severity: "info" | "warn" | "high"; message: string; explanation: string };

export type OrderPreview = {
  symbol: string;
  entry_estimate: number;
  bid: number;
  ask: number;
  spread: number;
  plan: {
    notional: number;
    risk_pct: number | null;
    potential_loss: number | null;
    potential_profit: number | null;
    reward_risk: number | null;
  };
  findings: RiskFinding[];
  leverage: number;
  margin_required: number;
  free_margin: number;
  fee_estimate: number;
};

export type Review = {
  title: string;
  position_id: string;
  symbol: string;
  side: string;
  entry: string;
  exit: string;
  result: string;
  net_pnl: number;
  r_multiple: number | null;
  what_happened: string;
  did_well: string[];
  did_poorly: string[];
  main_lesson: string;
  process_score: number;
  grade: string;
  lessons: string[];
  narrative?: string;
};

export type Level = { price: number; touches: number };

export type Analysis = {
  market: string;
  timeframe: string;
  data_source: string;
  time: number;
  price: number;
  regime: { regime: string; reasons: string[]; metrics: Record<string, unknown> };
  trend: string;
  structure: { trend: string; text: string; swings: { time: number; price: number; kind: string; label: string | null }[] };
  momentum: { label: string; rsi: number; macd_hist: number };
  volatility: { label: string; atr: number; atr_pct: number; rank: number };
  support: Level[];
  resistance: Level[];
  indicators: Record<string, number | null>;
  candle: { patterns: string[]; explanation: string };
  setup: null | {
    side: "long" | "short";
    name: string;
    entry: number;
    invalidation: number;
    target: number;
    reward_risk: number | null;
    risk_text: string;
    reward_text: string;
  };
  wait_reason: string | null;
  no_trade_reasons: { code: string; title: string; text: string }[];
  decision: string;
  signal: string;
  confidence: string;
  confidence_note: string;
  confidence_factors: string[];
  observation: string[];
  analysis: string[];
  hypothesis: string[];
  teach_me_why: string[];
  conclusion: string;
  pipeline: { stage: string; detail: string }[];
  disclaimer: string;
};

export type Operand = {
  kind: "indicator" | "price" | "value";
  name?: string;
  params?: Record<string, number>;
  output?: string;
  field?: string;
  value?: number;
  shift?: number;
  mult?: number;
};
export type Condition = { left: Operand; op: string; right: Operand };
export type Block = { logic: "all" | "any"; conditions: Condition[] };
export type StrategyDefinition = {
  entry_long: Block | null;
  entry_short: Block | null;
  exit_long: Block | null;
  exit_short: Block | null;
  stop: { type: "atr" | "percent" | "swing"; value: number; atr_period?: number; lookback?: number };
  take_profit: { type: "r_multiple" | "atr" | "percent" | "none"; value: number };
  risk_per_trade_pct: number;
  regime_filter: string[];
};
export type Strategy = {
  id: number;
  name: string;
  description: string;
  is_template: boolean;
  symbol: string;
  timeframe: string;
  definition: StrategyDefinition;
  summary: string[];
  rules_count: number;
};
