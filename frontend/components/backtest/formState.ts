/*
 * Pure state helpers for the Backtesting Lab form (unit-tested with node --test): defaults, quick ranges,
 * the MAX_BARS guard, the POST /backtests payload and deep-link prefill (?strategy=&symbol=&timeframe=).
 */
import type { StrategyRow } from "../strategy/types";
import { TF_SECONDS, TIMEFRAMES, fromDateInput, toDateInput } from "@/lib/format";

/** Backend limit (app/services/backtest_service.MAX_BARS): requested range + warm-up. */
export const MAX_BARS = 20_000;
export const WARMUP_BARS = 200;

export type BacktestFormState = {
  strategy_id: number;
  symbol: string;
  timeframe: string;
  start: string;
  end: string;
  range: string | null;
  initial_balance: number;
  risk_per_trade_pct: number;
  fees_enabled: boolean;
  fee_bps: number | null;
  slippage_bps: number;
  spread_enabled: boolean;
  allow_short: boolean;
  intrabar_policy: "worst_case" | "path";
  max_open_positions: number;
};

export const RANGES: { key: string; label: string; days: number }[] = [
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 91 },
  { key: "6M", label: "6M", days: 182 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "2Y", label: "2Y", days: 730 },
];

export function todayInput(now: number = Date.now()): string {
  return toDateInput(Math.floor(now / 1000));
}

export function rangeStart(end: string, days: number): string {
  return toDateInput(fromDateInput(end) - days * 86400);
}

export function defaultForm(now: number = Date.now()): BacktestFormState {
  const end = todayInput(now);
  return {
    strategy_id: 0,
    symbol: "BTC/USDT",
    timeframe: "1h",
    start: rangeStart(end, 182),
    end,
    range: "6M",
    initial_balance: 10_000,
    risk_per_trade_pct: 1,
    fees_enabled: true,
    fee_bps: null,
    slippage_bps: 1,
    spread_enabled: true,
    allow_short: true,
    intrabar_policy: "worst_case",
    max_open_positions: 1,
  };
}

/** Bars the backend will load (requested range + warm-up), used for the MAX_BARS guard. */
export function estimateBars(f: Pick<BacktestFormState, "start" | "end" | "timeframe">): number {
  const sec = TF_SECONDS[f.timeframe] ?? 3600;
  const span = fromDateInput(f.end) + 86399 - fromDateInput(f.start);
  return Math.max(0, Math.floor(span / sec)) + WARMUP_BARS;
}

/** Longest start date (for the current end + timeframe) that stays under MAX_BARS. */
export function fitStart(f: Pick<BacktestFormState, "end" | "timeframe">): string {
  const sec = TF_SECONDS[f.timeframe] ?? 3600;
  const days = Math.floor(((MAX_BARS - WARMUP_BARS - 50) * sec) / 86400);
  return rangeStart(f.end, days);
}

/** Form problems that block "Run backtest" (null = ready). */
export function formProblem(f: BacktestFormState): "strategy" | "dates" | "too_long" | null {
  if (!f.strategy_id) return "strategy";
  if (fromDateInput(f.end) <= fromDateInput(f.start)) return "dates";
  if (estimateBars(f) > MAX_BARS) return "too_long";
  return null;
}

export function toPayload(f: BacktestFormState) {
  return {
    strategy_id: f.strategy_id,
    symbol: f.symbol,
    timeframe: f.timeframe,
    start_ts: fromDateInput(f.start),
    end_ts: fromDateInput(f.end) + 86399,
    initial_balance: f.initial_balance,
    risk_per_trade_pct: f.risk_per_trade_pct,
    fees_enabled: f.fees_enabled,
    fee_bps: f.fees_enabled && f.fee_bps !== null ? f.fee_bps : undefined,
    slippage_bps: f.slippage_bps,
    spread_enabled: f.spread_enabled,
    allow_short: f.allow_short,
    intrabar_policy: f.intrabar_policy,
    max_open_positions: f.max_open_positions,
  };
}

export type Prefill = { strategy?: number | null; symbol?: string | null; timeframe?: string | null };

export function isTimeframe(tf: string | null | undefined): tf is string {
  return !!tf && (TIMEFRAMES as readonly string[]).includes(tf);
}

/**
 * Picks the strategy for a deep link (?strategy=&symbol=&timeframe= from the Strategy Builder or the BOT AI
 * COACH): the requested one, else the currently selected one, else the user's first strategy, else the first
 * template. Symbol / timeframe from the query win over the strategy's own; unknown timeframes are ignored.
 */
export function pickStrategy(strategies: StrategyRow[], q: Prefill, current = 0): StrategyRow | undefined {
  return (
    (q.strategy ? strategies.find((x) => x.id === q.strategy) : undefined) ??
    (current ? strategies.find((x) => x.id === current) : undefined) ??
    strategies.find((x) => !x.is_template) ??
    strategies[0]
  );
}

export function applyPrefill(f: BacktestFormState, strategies: StrategyRow[], q: Prefill): BacktestFormState {
  const s = pickStrategy(strategies, q, f.strategy_id);
  if (!s) return f;
  return {
    ...f,
    strategy_id: s.id,
    symbol: q.symbol || s.symbol,
    timeframe: isTimeframe(q.timeframe) ? q.timeframe : s.timeframe,
    risk_per_trade_pct: s.definition?.risk_per_trade_pct ?? f.risk_per_trade_pct,
  };
}

/** Choosing a strategy in the form adopts its asset, timeframe and risk (the user can still change them). */
export function withStrategy(f: BacktestFormState, s: StrategyRow): BacktestFormState {
  return { ...f, strategy_id: s.id, symbol: s.symbol, timeframe: s.timeframe, risk_per_trade_pct: s.definition?.risk_per_trade_pct ?? f.risk_per_trade_pct };
}
