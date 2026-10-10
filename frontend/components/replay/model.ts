/*
 * Pure logic of the Historical Replay V2 screens (no React): setup → request body, level validation and
 * planned R:R (mirrors backend app/replay/scoring.validate_levels), ATR-based level suggestions, chart
 * markers / price lines for decisions, strategy trades and paper trades, outcome labels, toasts, the
 * normalisation of the finish / stored review responses and the URL query.
 */
import type { MarkerDef, PriceLineDef } from "@/components/charts/TradingChart";
import type { Tone } from "@/components/ui";
import { fmtPrice, fmtR, toDateInput, fromDateInput } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";
import type { Candle } from "@/lib/types";

import type {
  DecisionFlag,
  FinishResponse,
  Grade,
  PaperTradeRow,
  PresetKey,
  ReplayAction,
  ReplayDecision,
  ReplayMode,
  ReplayPreset,
  ReplaySetupValues,
  ReplayState,
  ResolvedItem,
  ReviewData,
  StoredReviewResponse,
  StrategyTrade,
  TradeOutcome,
  WaitOutcome,
} from "@/components/replay/types";

/* ───────────────────────────────────────────────────────────── constants */

export const DAY = 86_400;
export const DEFAULT_SYMBOL = "BTC/USDT";
export const DEFAULT_TIMEFRAME = "1h";
export const DEFAULT_BARS = 200;
export const BARS_LIMITS = { min: 20, max: 1000 } as const;
/** ATR multiple of the suggested stop and the R multiple of the suggested target (L / S hotkeys). */
export const SUGGEST_STOP_ATR = 1.5;
export const SUGGEST_TARGET_R = 2;
export const AUTO_SPEEDS = [
  { value: 1500, label: "0.5×" },
  { value: 900, label: "1×" },
  { value: 450, label: "2×" },
] as const;
export const EMA_KEY = "ema_20";
export const INDICATORS_QUERY = "ema:20";

/** Fallback when GET /replay/options is unavailable (same keys / labels as the backend). */
export const FALLBACK_PRESETS: ReplayPreset[] = [
  { key: "random", label: "Random", label_bg: "Случаен период", description: "Произволен минал период." },
  { key: "trend", label: "Trend", label_bg: "Тренд", description: "Период с ясен тренд (посоката не се казва предварително)." },
  { key: "range", label: "Range", label_bg: "Диапазон", description: "Цената се движи странично в диапазон." },
  { key: "high_volatility", label: "High volatility", label_bg: "Висока волатилност", description: "Големи свещи и резки движения — тест за stop и размер." },
  { key: "breakout", label: "Breakout", label_bg: "Пробив", description: "Консолидация, последвана от пробив (кога и накъде — откриваш сам)." },
];
export const PRESET_KEYS: PresetKey[] = ["random", "trend", "range", "high_volatility", "breakout"];

export const MODE_META: Record<ReplayMode, { label: string; title: string; text: string }> = {
  trade: {
    label: "Trade",
    title: "Trade с paper поръчки",
    text: "BUY / SELL paper поръчки по историческите свещи (виртуални пари) + LONG / SHORT / WAIT решения с оценка.",
  },
  predict: {
    label: "Predict",
    title: "Predict — само прогнози",
    text: "LONG / SHORT / WAIT прогнози със stop и target — без поръчки по сметка. Всяка прогноза се оценява по разкритите свещи.",
  },
};

export const ACTION_META: Record<ReplayAction, { label: string; tone: Tone; color: string; hotkey: string }> = {
  long: { label: "LONG", tone: "up", color: PALETTE.up, hotkey: "L" },
  short: { label: "SHORT", tone: "down", color: PALETTE.down, hotkey: "S" },
  wait: { label: "WAIT", tone: "neutral", color: PALETTE.muted, hotkey: "W" },
};

/* ───────────────────────────────────────────────────────────── numbers */

export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function roundTo(v: number, precision: number): number {
  const p = Math.max(0, Math.min(10, Math.round(precision)));
  const f = 10 ** p;
  return Math.round(v * f) / f;
}

/** Price as an input string with the instrument's decimals (no thousands separators). */
export function priceInput(v: number | null | undefined, precision: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return roundTo(v, precision).toFixed(Math.max(0, precision));
}

export function gradeOf(score: number | null | undefined): Grade | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

export function scoreTone(score: number | null | undefined): Tone {
  const g = gradeOf(score);
  if (g === "A" || g === "B") return "up";
  if (g === "C") return "warn";
  if (g === "D") return "down";
  return "neutral";
}

export const TONE_COLOR: Record<Tone, string> = {
  up: PALETTE.up,
  down: PALETTE.down,
  warn: PALETTE.warn,
  info: PALETTE.info,
  accent: PALETTE.accent2,
  violet: PALETTE.violet,
  gold: PALETTE.gold,
  neutral: PALETTE.muted,
};

/* ───────────────────────────────────────────────────────────── setup */

export function defaultSetup(now: number = Math.floor(Date.now() / 1000)): ReplaySetupValues {
  return {
    symbol: DEFAULT_SYMBOL,
    timeframe: DEFAULT_TIMEFRAME,
    period: "date",
    start: toDateInput(now - 60 * DAY),
    bars: DEFAULT_BARS,
    mode: "trade",
    strategyId: null,
  };
}

export type SetupIssue = { field: "symbol" | "start" | "bars"; message: string };

export function validateSetup(s: ReplaySetupValues, now: number = Math.floor(Date.now() / 1000)): SetupIssue[] {
  const out: SetupIssue[] = [];
  if (!s.symbol.trim()) out.push({ field: "symbol", message: "Избери инструмент." });
  if (!Number.isFinite(s.bars) || s.bars < BARS_LIMITS.min || s.bars > BARS_LIMITS.max)
    out.push({ field: "bars", message: `Свещите трябва да са между ${BARS_LIMITS.min} и ${BARS_LIMITS.max}.` });
  if (s.period === "date") {
    const ts = s.start ? fromDateInput(s.start) : NaN;
    if (!Number.isFinite(ts)) out.push({ field: "start", message: "Избери начална дата." });
    else if (ts >= now - DAY) out.push({ field: "start", message: "Началото трябва да е в миналото — бъдещите свещи трябва да съществуват." });
  }
  return out;
}

export type CreateBody = {
  symbol: string;
  timeframe: string;
  bars: number;
  mode: ReplayMode;
  start_ts?: number;
  preset?: PresetKey;
  strategy_id?: number;
};

export function buildCreateBody(s: ReplaySetupValues): CreateBody {
  const body: CreateBody = { symbol: s.symbol, timeframe: s.timeframe, bars: Math.round(s.bars), mode: s.mode };
  if (s.period === "date") body.start_ts = fromDateInput(s.start);
  else body.preset = s.period;
  if (s.strategyId) body.strategy_id = s.strategyId;
  return body;
}

/** ?symbol= &tf= &session= &preset= &mode= of /replay */
export type ReplayQuery = { symbol: string | null; timeframe: string | null; session: number | null; preset: PresetKey | null; mode: ReplayMode | null };

export function readReplayQuery(search: string): ReplayQuery {
  const p = new URLSearchParams(search);
  const sid = Number(p.get("session"));
  const preset = p.get("preset") as PresetKey | null;
  const mode = p.get("mode");
  return {
    symbol: p.get("symbol")?.trim() || null,
    timeframe: p.get("tf")?.trim() || null,
    session: Number.isInteger(sid) && sid > 0 ? sid : null,
    preset: preset && PRESET_KEYS.includes(preset) ? preset : null,
    mode: mode === "trade" || mode === "predict" ? mode : null,
  };
}

/** The /replay URL of an open session (kept in the address bar so a reload resumes it). */
export function sessionUrl(id: number | null): string {
  return id ? `/replay?session=${id}` : "/replay";
}

/* ───────────────────────────────────────────────────────────── levels */

export type LevelCheck = { stopError: string | null; targetError: string | null; ok: boolean };

/** Same rules as the backend: LONG → stop < entry < target, SHORT → target < entry < stop. Stop required. */
export function checkLevels(action: ReplayAction, entry: number | null, stop: number | null, target: number | null, precision = 2): LevelCheck {
  if (action === "wait") return { stopError: null, targetError: null, ok: true };
  let stopError: string | null = null;
  let targetError: string | null = null;
  const long = action === "long";
  if (stop === null) stopError = `Постави stop — къде ${long ? "LONG" : "SHORT"} идеята е грешна.`;
  else if (stop <= 0) stopError = "Stop трябва да е положителна цена.";
  else if (entry !== null && (long ? stop >= entry : stop <= entry))
    stopError = `За ${long ? "LONG" : "SHORT"} stop-ът трябва да е ${long ? "ПОД" : "НАД"} текущата цена ${fmtPrice(entry, precision)}.`;
  if (target !== null) {
    if (target <= 0) targetError = "Target трябва да е положителна цена.";
    else if (entry !== null && (long ? target <= entry : target >= entry))
      targetError = `За ${long ? "LONG" : "SHORT"} target-ът трябва да е ${long ? "НАД" : "ПОД"} текущата цена.`;
  }
  return { stopError, targetError, ok: !stopError && !targetError };
}

export function plannedRR(action: ReplayAction, entry: number | null, stop: number | null, target: number | null): number | null {
  if (action === "wait" || entry === null || stop === null || target === null) return null;
  const risk = action === "long" ? entry - stop : stop - entry;
  const reward = action === "long" ? target - entry : entry - target;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

export function rrTone(rr: number | null): Tone {
  if (rr === null) return "neutral";
  if (rr >= 1.5) return "up";
  if (rr >= 1) return "warn";
  return "down";
}

/** Wilder ATR of the last `period` bars (null with too few candles). */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  let a = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

/** Starting levels for a fresh LONG / SHORT draft: stop 1.5 ATR away, target at 2R (the user moves them). */
export function suggestLevels(action: "long" | "short", candles: Candle[], precision: number): { stop: number; target: number } | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const a = atr(candles) ?? last.close * 0.01;
  if (!(a > 0)) return null;
  const dist = a * SUGGEST_STOP_ATR;
  const sign = action === "long" ? 1 : -1;
  const stop = roundTo(last.close - sign * dist, precision);
  const target = roundTo(last.close + sign * dist * SUGGEST_TARGET_R, precision);
  if (stop <= 0 || target <= 0) return null;
  return { stop, target };
}

/** A click on the chart while LONG / SHORT is armed: below the entry = stop for LONG, target for SHORT. */
export function levelForClick(action: ReplayAction, entry: number, price: number): "stop" | "target" | null {
  if (action === "wait" || price === entry) return null;
  const below = price < entry;
  if (action === "long") return below ? "stop" : "target";
  return below ? "target" : "stop";
}

/* ───────────────────────────────────────────────────────────── outcomes */

export const isWaitOutcome = (d: { action: ReplayAction; outcome: unknown }): d is { action: "wait"; outcome: WaitOutcome } => d.action === "wait";

export type OutcomeView = { label: string; tone: Tone; final: boolean; r: number | null };

export function outcomeView(d: Pick<ReplayDecision, "action" | "outcome">): OutcomeView {
  if (d.action === "wait") {
    const o = d.outcome as WaitOutcome;
    if (o.status !== "resolved" || o.right_to_wait === null || o.right_to_wait === undefined)
      return { label: "WAIT · наблюдава се", tone: "neutral", final: false, r: null };
    return o.right_to_wait
      ? { label: "Правилно изчакване", tone: "up", final: true, r: null }
      : { label: `Пропуснато движение${o.clean_move === "up" ? " ↑" : o.clean_move === "down" ? " ↓" : ""}`, tone: "warn", final: true, r: null };
  }
  const o = d.outcome as TradeOutcome;
  const r = o.r_result ?? null;
  switch (o.status) {
    case "target":
      return { label: `Target ${fmtR(r)}`, tone: "up", final: true, r };
    case "stop":
      return { label: `Stop ${fmtR(r)}`, tone: "down", final: true, r };
    case "expired":
      return { label: `Изтекла ${fmtR(r)}`, tone: r !== null && r > 0 ? "up" : r !== null && r < 0 ? "down" : "neutral", final: true, r };
    default:
      return { label: `Отворена ${r !== null && o.bars_held ? fmtR(r) : ""}`.trim(), tone: "accent", final: false, r };
  }
}

/** Colour of a decision on the chart: open = accent, target / right wait = up, stop = down, missed move = warn. */
export function decisionColor(d: Pick<ReplayDecision, "action" | "outcome">): string {
  const v = outcomeView(d);
  if (!v.final) return d.action === "wait" ? PALETTE.faint : PALETTE.accent2;
  return TONE_COLOR[v.tone];
}

export type MarkerOpts = { selectedId?: number | null };

/** Entry arrows (+ exit dots for resolved LONG / SHORT predictions) — TradingChart filters unknown times. */
export function decisionMarkers(decisions: ReplayDecision[], opts: MarkerOpts = {}): MarkerDef[] {
  const out: MarkerDef[] = [];
  for (const d of decisions) {
    const color = decisionColor(d);
    const sel = opts.selectedId !== undefined && opts.selectedId !== null && d.id === opts.selectedId;
    if (d.action === "wait") {
      out.push({ time: d.bar_ts, position: "aboveBar", shape: "circle", color, text: sel ? "▶ W" : "W" });
      continue;
    }
    const long = d.action === "long";
    out.push({
      time: d.bar_ts,
      position: long ? "belowBar" : "aboveBar",
      shape: long ? "arrowUp" : "arrowDown",
      color,
      text: `${sel ? "▶ " : ""}${long ? "L" : "S"}${d.planned_rr ? ` ${d.planned_rr.toFixed(1)}R` : ""}`,
    });
    const o = d.outcome as TradeOutcome;
    if ((o.status === "target" || o.status === "stop" || o.status === "expired") && o.exit_ts) {
      const above = (o.status === "target") === long;
      out.push({ time: o.exit_ts, position: above ? "aboveBar" : "belowBar", shape: "circle", color, text: fmtR(o.r_result ?? null) });
    }
  }
  return out;
}

export type DraftLevels = { action: ReplayAction | null; stop: number | null; target: number | null };

/** Stop / target lines: the draft + the still-open LONG / SHORT predictions (latest 3) or one selected decision. */
export function decisionLines(decisions: ReplayDecision[], draft: DraftLevels | null, precision: number, opts: { selectedId?: number | null; maxOpen?: number } = {}): PriceLineDef[] {
  const out: PriceLineDef[] = [];
  if (draft && draft.action && draft.action !== "wait") {
    const tag = draft.action === "long" ? "LONG" : "SHORT";
    if (draft.stop !== null) out.push({ id: "draft-stop", price: roundTo(draft.stop, precision), color: PALETTE.down, title: `SL ${tag} (план)`, dashed: true });
    if (draft.target !== null) out.push({ id: "draft-target", price: roundTo(draft.target, precision), color: PALETTE.up, title: `TP ${tag} (план)`, dashed: true });
  }
  const selected = opts.selectedId ?? null;
  const shown =
    selected !== null
      ? decisions.filter((d) => d.id === selected)
      : decisions.filter((d) => d.action !== "wait" && (d.outcome as TradeOutcome).status === "open").slice(-(opts.maxOpen ?? 3));
  for (const d of shown) {
    if (d.action === "wait") continue;
    const n = d.id ?? d.bar_ts;
    const tag = `${d.action === "long" ? "L" : "S"}#${n}`;
    if (d.stop !== null) out.push({ id: `d${n}-stop`, price: d.stop, color: withAlpha(PALETTE.down, 0.75), title: `SL ${tag}`, dashed: true });
    if (d.target !== null) out.push({ id: `d${n}-target`, price: d.target, color: withAlpha(PALETTE.up, 0.75), title: `TP ${tag}`, dashed: true });
  }
  return out;
}

const EXIT_LABEL: Record<string, string> = {
  stop_loss: "SL",
  take_profit: "TP",
  exit_signal: "exit",
  end_of_test: "край",
  manual: "ръчно",
  liquidation: "ликв.",
};

export function exitLabel(reason: string): string {
  return EXIT_LABEL[reason] ?? reason.replace(/_/g, " ");
}

/** The comparison strategy's trades (violet) on the review chart. */
export function strategyTradeMarkers(trades: StrategyTrade[]): MarkerDef[] {
  const out: MarkerDef[] = [];
  for (const t of trades) {
    const long = t.side === "long";
    out.push({ time: t.entry_ts, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", color: PALETTE.violet, text: `Strategy ${long ? "LONG" : "SHORT"}` });
    out.push({
      time: t.exit_ts,
      position: long ? "aboveBar" : "belowBar",
      shape: "square",
      color: PALETTE.violet,
      text: `${exitLabel(t.exit_reason)} ${t.r_multiple !== null ? fmtR(t.r_multiple) : ""}`.trim(),
    });
  }
  return out;
}

/** Paper trades of a trade-mode session (gold). */
export function paperTradeMarkers(trades: PaperTradeRow[]): MarkerDef[] {
  const out: MarkerDef[] = [];
  for (const t of trades) {
    const long = t.side === "long";
    out.push({ time: t.opened_ts, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", color: PALETTE.gold, text: long ? "BUY" : "SELL" });
    out.push({ time: t.closed_ts, position: long ? "aboveBar" : "belowBar", shape: "square", color: PALETTE.gold, text: exitLabel(t.exit_reason) });
  }
  return out;
}

/** Candles snap to bar opens: marker times inside a bar are moved to that bar's open. */
export function snapMarkers(markers: MarkerDef[], candles: Candle[]): MarkerDef[] {
  if (!candles.length) return [];
  const times = candles.map((c) => c.time);
  const first = times[0];
  const last = times[times.length - 1];
  const step = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 0;
  return markers.flatMap((m) => {
    if (m.time < first || m.time > last + step) return [];
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= m.time) lo = mid;
      else hi = mid - 1;
    }
    return [{ ...m, time: times[lo] }];
  });
}

export function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of a) map.set(c.time, c);
  for (const c of b) map.set(c.time, c);
  return [...map.values()].sort((x, y) => x.time - y.time);
}

/* ───────────────────────────────────────────────────────────── progress / HUD */

export function progress(s: { bars?: number; revealed?: number; remaining: number }): { revealed: number; total: number; pct: number } {
  const total = Math.max(0, s.bars ?? (s.revealed ?? 0) + s.remaining);
  const revealed = Math.max(0, s.revealed ?? total - s.remaining);
  return { revealed, total, pct: total ? Math.min(100, Math.round((revealed / total) * 100)) : 0 };
}

/** Default replay order qty: ≈10 % of equity in notional, 2 significant digits (0.01 BTC at ~90k). */
export function defaultQty(price: number | null | undefined, equity: number | null | undefined): string {
  if (!price || price <= 0) return "1";
  const raw = ((equity && equity > 0 ? equity : 10_000) * 0.1) / price;
  if (!(raw > 0)) return "1";
  const mag = 10 ** (Math.floor(Math.log10(raw)) - 1);
  const v = Math.max(mag, Math.round(raw / mag) * mag);
  const digits = Math.max(0, -Math.floor(Math.log10(mag)));
  return v.toFixed(Math.min(8, digits));
}

/* ───────────────────────────────────────────────────────────── toasts */

export type ToastSpec = { id: string; tone: Tone; title: string; text?: string };

/** Flag chips that deserve a toast when a decision is recorded (warnings: "Chasing?", "Against structure", …). */
export function flagToasts(flags: DecisionFlag[], key: string): ToastSpec[] {
  return flags
    .filter((f) => f.severity === "warning")
    .map((f) => ({ id: `${key}-${f.key}`, tone: "warn" as Tone, title: f.label, text: f.text }));
}

export function resolvedToast(r: ResolvedItem): ToastSpec {
  const tag = ACTION_META[r.action]?.label ?? r.action.toUpperCase();
  if (r.action === "wait") {
    return r.right_to_wait
      ? { id: `res-${r.id}`, tone: "up", title: "WAIT беше правилно", text: "Нямаше чисто движение — търпението беше решение." }
      : { id: `res-${r.id}`, tone: "warn", title: "WAIT пропусна движение", text: "Имаше чиста възможност — виж прегледа в края." };
  }
  if (r.status === "target") return { id: `res-${r.id}`, tone: "up", title: `${tag} → target ${fmtR(r.r_result)}`, text: r.score !== null ? `Оценка ${Math.round(r.score)}/100` : undefined };
  if (r.status === "stop") return { id: `res-${r.id}`, tone: "down", title: `${tag} → stop ${fmtR(r.r_result)}`, text: "Загуба с ограничен риск е нормална цена — провери дали stop-ът беше на правилното място." };
  return { id: `res-${r.id}`, tone: "neutral", title: `${tag} изтече ${fmtR(r.r_result)}`, text: "Нито stop, нито target за 50 свещи." };
}

/* ───────────────────────────────────────────────────────────── review data */

export function normalizeFinish(r: FinishResponse): ReviewData {
  return {
    session: r.session,
    precision: r.precision ?? r.session.precision ?? 2,
    source: r.source ?? null,
    candles: r.candles ?? [],
    next: r.what_happened_next ?? [],
    decisions: r.decisions ?? [],
    paperTrades: r.paper_trades ?? [],
    review: r.history_review ?? null,
    reviews: r.reviews ?? [],
    summary: r.summary ?? [],
    metrics: r.metrics ?? null,
  };
}

export function normalizeStored(r: StoredReviewResponse): ReviewData {
  return {
    session: r.session,
    precision: r.precision ?? r.session.precision ?? 2,
    source: r.source ?? null,
    candles: r.candles ?? [],
    next: r.what_happened_next ?? [],
    decisions: r.decisions ?? [],
    paperTrades: r.paper_trades ?? [],
    review: r.history_review ?? null,
    reviews: [],
    summary: r.history_review?.summary ?? [],
    metrics: null,
  };
}

/** A new state keeps the last EMA overlay when the endpoint (order / action) does not send indicators. */
export function mergeState(prev: ReplayState | null, next: ReplayState): ReplayState {
  if (next.indicators || !prev || prev.session.id !== next.session.id) return next;
  return { ...next, indicators: prev.indicators };
}

export function precisionOf(state: { precision?: number; session: { precision?: number } } | null, fallbackPrice?: number | null): number {
  const p = state?.precision ?? state?.session.precision;
  if (typeof p === "number" && p >= 0) return p;
  if (fallbackPrice && fallbackPrice < 10) return 4;
  return 2;
}

export function presetLabel(key: string | null | undefined, presets: ReplayPreset[] = FALLBACK_PRESETS): string | null {
  if (!key) return null;
  return presets.find((p) => p.key === key)?.label ?? key;
}

/** "Here is what a rule-based strategy would have done." — exact sentence of the backend review. */
export const STRATEGY_SENTENCE = "Here is what a rule-based strategy would have done.";
export const STRATEGY_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement.";
