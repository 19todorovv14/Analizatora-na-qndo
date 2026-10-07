/*
 * Pure helpers for Bot Lab (unit-tested with node --test): create-form defaults, the POST /bots payload,
 * deep-link prefill from the Strategy Builder, schedule text, chart series and the coach funnel.
 */
import type { StrategyRow } from "../strategy/types";
import type { BotConfig, EvaluationStats } from "./types";
import { TIMEFRAMES } from "@/lib/format";

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export type BotFormState = {
  name: string;
  symbol: string;
  timeframe: string;
  strategy_id: number;
  run_mode: "warm_start" | "forward";
  warm_start_days: number;
  risk_per_trade_pct: number;
  max_positions: number;
  daily_loss_limit_pct: number;
  start_hour: number;
  end_hour: number;
  days: number[];
  allow_short: boolean;
  initial_balance: number;
  /** "" = keep the strategy's own stop / target */
  stop_type: "" | "atr" | "percent" | "swing";
  stop_value: number;
  tp_type: "" | "r_multiple" | "atr" | "percent" | "none";
  tp_value: number;
};

export function defaultBotForm(): BotFormState {
  return {
    name: "Мой paper бот",
    symbol: "BTC/USDT",
    timeframe: "1h",
    strategy_id: 0,
    run_mode: "warm_start",
    warm_start_days: 30,
    risk_per_trade_pct: 1,
    max_positions: 1,
    daily_loss_limit_pct: 3,
    start_hour: 0,
    end_hour: 24,
    days: [0, 1, 2, 3, 4, 5, 6],
    allow_short: true,
    initial_balance: 10_000,
    stop_type: "",
    stop_value: 2,
    tp_type: "",
    tp_value: 2,
  };
}

/** Problems that block "Create paper bot" (null = ready). */
export function botFormProblem(f: BotFormState): "strategy" | "hours" | "days" | null {
  if (!f.strategy_id) return "strategy";
  if (f.start_hour >= f.end_hour) return "hours";
  if (!f.days.length) return "days";
  return null;
}

/** POST /bots body: max_positions is sent both as the v2 field and as the v1 config key. */
export function botPayload(f: BotFormState) {
  return {
    name: f.name.trim() || "Paper бот",
    symbol: f.symbol,
    timeframe: f.timeframe,
    strategy_id: f.strategy_id,
    run_mode: f.run_mode,
    max_positions: f.max_positions,
    stop: f.stop_type ? (f.stop_type === "swing" ? { type: "swing", value: f.stop_value, lookback: 10 } : { type: f.stop_type, value: f.stop_value }) : undefined,
    take_profit: f.tp_type ? { type: f.tp_type, value: f.tp_value } : undefined,
    config: {
      risk_per_trade_pct: f.risk_per_trade_pct,
      max_open_positions: f.max_positions,
      daily_loss_limit_pct: f.daily_loss_limit_pct,
      trading_hours: { start: f.start_hour, end: f.end_hour, days: [...f.days].sort((a, b) => a - b) },
      allow_short: f.allow_short,
      initial_balance: f.initial_balance,
      warm_start_days: f.warm_start_days,
    },
  };
}

/** Choosing a strategy adopts its asset, timeframe and risk. */
export function withBotStrategy(f: BotFormState, s: StrategyRow): BotFormState {
  return { ...f, strategy_id: s.id, symbol: s.symbol, timeframe: s.timeframe, risk_per_trade_pct: s.definition?.risk_per_trade_pct ?? f.risk_per_trade_pct };
}

/** Prefill from /bots?strategy=&symbol=&timeframe= ("Create paper bot →" in the Strategy Builder). */
export function applyBotPrefill(
  f: BotFormState,
  strategies: StrategyRow[],
  q: { strategy?: number | null; symbol?: string | null; timeframe?: string | null },
): BotFormState {
  const s = (q.strategy ? strategies.find((x) => x.id === q.strategy) : undefined) ?? strategies.find((x) => !x.is_template) ?? strategies[0];
  if (!s) return f;
  return {
    ...withBotStrategy(f, s),
    symbol: q.symbol || s.symbol,
    timeframe: q.timeframe && (TIMEFRAMES as readonly string[]).includes(q.timeframe) ? q.timeframe : s.timeframe,
    name: q.strategy && s.id === q.strategy ? `Paper бот · ${s.name}`.slice(0, 100) : f.name,
  };
}

/** "24/7", "08:00–16:00 UTC · всеки ден" or "00:00–24:00 UTC · Пн, Вт…". */
export function hoursText(cfg: Pick<BotConfig, "trading_hours">): string {
  const h = cfg.trading_hours;
  if (!h) return "24/7";
  const allDays = !h.days || h.days.length === 7;
  if (h.start === 0 && h.end === 24 && allDays) return "24/7";
  const days = allDays ? "всеки ден" : [...h.days].sort((a, b) => a - b).map((d) => WEEKDAYS[d] ?? String(d)).join(", ");
  return `${String(h.start).padStart(2, "0")}:00–${String(h.end).padStart(2, "0")}:00 UTC · ${days}`;
}

type Pt = [number, number];

/**
 * Bot equity / drawdown curves only contain points at closed trades. Prepend the starting point (the first
 * evaluated candle, else one bar before the first point) so the chart starts at the initial balance / 0%.
 */
export function withStartPoint(curve: Pt[] | null | undefined, startValue: number, startTs?: number | null, barSeconds = 3600): Pt[] {
  if (!curve?.length) return [];
  const first = curve[0][0];
  const ts = startTs && startTs < first ? startTs : first - Math.max(1, barSeconds);
  return [[ts, startValue], ...curve];
}

export type FunnelStep = { key: "setups" | "met" | "rejected" | "trades"; value: number; pct: number | null };

/** Setups funnel: generated → all conditions met → rejected → paper trades (pct of generated). */
export function funnel(s: Pick<EvaluationStats, "setups_generated" | "all_conditions_met" | "rejected" | "entries">): FunnelStep[] {
  const g = s.setups_generated || 0;
  const pct = (v: number) => (g > 0 ? Math.round((v / g) * 1000) / 10 : null);
  return [
    { key: "setups", value: g, pct: g > 0 ? 100 : null },
    { key: "met", value: s.all_conditions_met || 0, pct: pct(s.all_conditions_met || 0) },
    { key: "rejected", value: s.rejected || 0, pct: pct(s.rejected || 0) },
    { key: "trades", value: s.entries || 0, pct: pct(s.entries || 0) },
  ];
}
