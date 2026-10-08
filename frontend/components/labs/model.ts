/*
 * Pure logic of the S3b labs (Candlestick Lab, Market Structure Lab, Leverage Academy, Trade Simulator).
 * No React, no DOM — numbers and labels in, numbers and labels out (unit-tested in components/labs/__tests__).
 */
import type { MarkerDef } from "@/components/charts/TradingChart";
import type { Tone } from "@/components/ui";
import { PALETTE, withAlpha } from "@/lib/theme";
import type { Candle } from "@/lib/types";

import type {
  CheckedMark,
  CurveFamily,
  CurvePoint,
  LeverageRequest,
  LeverageResult,
  MissedEvent,
  MissedSwing,
  PatternBias,
  PatternCard,
  PatternExample,
  PatternType,
  PracticeRound,
  RefEvent,
  RefSwing,
  RiskLevel,
  Side,
  StructureAnchor,
  StructureCheck,
  StructureLabel,
  StructureMark,
  TrendRequirement,
} from "@/components/labs/types";

/* ═══════════════════════════════════════════════════════ shared helpers */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Decimals that keep a price readable without inventing precision (2 for ≥ 10, more for small prices). */
export function decimalsFor(price: number | null | undefined): number {
  const p = Math.abs(price ?? 0);
  if (!Number.isFinite(p) || p === 0 || p >= 10) return 2;
  if (p >= 1) return 3;
  if (p >= 0.1) return 4;
  return 5;
}

/** Display precision for a candle series: the decimals of its largest price. */
export function candlePrecision(candles: { high: number }[]): number {
  if (!candles.length) return 2;
  return decimalsFor(Math.max(...candles.map((c) => Math.abs(c.high))));
}

/** "+1.25%" / "−0.40%" (true minus sign); "—" for null. */
export function signedPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : `${s}%`;
}

/** "$1,234" (whole dollars when ≥ 1,000, cents otherwise); signed → "+$12.50" / "−$12.50". */
export function usd(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : 2;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return `${sign}$${s}`;
}

/** Parses a user-typed number ("12,5" / "1,234.5" / "1 234" / "") → number | null. */
export function parseNum(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  let norm = t;
  if (t.includes(",") && t.includes(".")) norm = t.replace(/,/g, "");
  // "1,234" / "12,345,678" are thousands; any other single comma is a decimal comma ("12,5")
  else if (t.includes(",")) norm = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

/* ══════════════════════════════════════════════════════ Candlestick Lab */

export const BIAS_META: Record<PatternBias, { label: string; tone: Tone; short: string }> = {
  bullish: { label: "Bullish", tone: "up", short: "бичи" },
  bearish: { label: "Bearish", tone: "down", short: "мечи" },
  neutral: { label: "Neutral", tone: "neutral", short: "неутрален" },
  "context-dependent": { label: "Зависи от контекста", tone: "violet", short: "според контекста" },
};

export const TYPE_META: Record<PatternType, { label: string; bars: number }> = {
  single: { label: "1 свещ", bars: 1 },
  double: { label: "2 свещи", bars: 2 },
  triple: { label: "3 свещи", bars: 3 },
};

export const TREND_LABEL: Record<TrendRequirement, string> = {
  any: "Всякакъв контекст",
  up: "След покачване",
  down: "След спад",
  down_or_flat: "След спад или странично",
  up_or_flat: "След покачване или странично",
};

export type TypeFilter = "all" | PatternType;
export type BiasFilter = "all" | PatternBias;

export function filterPatterns(patterns: PatternCard[], type: TypeFilter, bias: BiasFilter): PatternCard[] {
  return patterns.filter((p) => (type === "all" || p.type === type) && (bias === "all" || p.bias === bias));
}

/** Previous / next pattern in the (filtered) list, wrapping around. */
export function neighbourKey(keys: string[], current: string, dir: 1 | -1): string | null {
  if (!keys.length) return null;
  const i = keys.indexOf(current);
  if (i < 0) return keys[0];
  return keys[(i + dir + keys.length) % keys.length];
}

/** Pixel geometry of a small candle render (cards, practice rounds). */
export function miniGeometry(candles: { high: number; low: number }[], width: number, height: number, pad = 6) {
  const n = Math.max(1, candles.length);
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const slot = (width - pad * 2) / n;
  const bodyW = clamp(slot * 0.56, 2, 22);
  return {
    slot,
    bodyW,
    x: (i: number) => pad + slot * (i + 0.5),
    y: (p: number) => pad + ((hi - p) / span) * (height - pad * 2),
  };
}

/** Chart markers for the "find it on a real chart" panel (selected example drawn larger + labelled). */
export function exampleMarkers(examples: PatternExample[], bias: PatternBias, selected: number | null, name: string): MarkerDef[] {
  const color = bias === "bullish" ? PALETTE.up : bias === "bearish" ? PALETTE.down : PALETTE.violet;
  const above = bias === "bearish";
  return examples.map((e) => ({
    time: e.time,
    position: above ? "aboveBar" : "belowBar",
    shape: bias === "bullish" ? "arrowUp" : bias === "bearish" ? "arrowDown" : "circle",
    color: e.time === selected ? PALETTE.gold : withAlpha(color, 0.9),
    text: e.time === selected ? name : undefined,
  }));
}

/** Logical range that centres the chart on candle `index` (for "jump to example"). */
export function rangeAround(index: number, total: number, width = 60): { from: number; to: number } {
  const half = Math.round(width / 2);
  const from = clamp(index - half, -5, Math.max(0, total - width));
  return { from, to: from + width };
}

/** Part of the candle the interactive anatomy highlights first for a pattern (wick-led vs body-led patterns). */
export const ANATOMY_FOCUS: Record<string, string> = {
  hammer: "lower_wick",
  hanging_man: "lower_wick",
  dragonfly_doji: "lower_wick",
  tweezer_bottom: "lower_wick",
  inverted_hammer: "upper_wick",
  shooting_star: "upper_wick",
  gravestone_doji: "upper_wick",
  tweezer_top: "upper_wick",
};

export function anatomyFocus(key: string): string {
  return ANATOMY_FOCUS[key] ?? "body";
}

export const OUTCOME_TONE: Record<string, string> = { up: "text-up", down: "text-down", flat: "text-muted" };

/** Body for POST /learn/candlesticks/practice — every round of the set, unanswered ones as null. */
export function practiceBody(rounds: PracticeRound[], answers: Record<number, string | null>) {
  return { answers: rounds.map((r) => ({ token: r.token, answer: answers[r.index] ?? null })) };
}

/* ═════════════════════════════════════════════════ Market Structure Lab */

export const SWING_LABELS = ["HH", "HL", "LH", "LL"] as const;
export const EVENT_LABELS = ["BREAKOUT", "RETEST", "FAKEOUT"] as const;

/** Which end of the candle a label snaps to. */
export function labelKind(label: StructureLabel): "high" | "low" | "event" {
  if (label === "HH" || label === "LH") return "high";
  if (label === "HL" || label === "LL") return "low";
  return "event";
}

export const LABEL_META: Record<StructureLabel, { title: string; short: string; term: string; hint: string }> = {
  HH: { title: "Higher High", short: "HH", term: "hh", hint: "Връх над предходния връх" },
  HL: { title: "Higher Low", short: "HL", term: "hl", hint: "Дъно над предходното дъно" },
  LH: { title: "Lower High", short: "LH", term: "lh", hint: "Връх под предходния връх" },
  LL: { title: "Lower Low", short: "LL", term: "ll", hint: "Дъно под предходното дъно" },
  BREAKOUT: { title: "Breakout", short: "Breakout", term: "breakout", hint: "Първо затваряне отвъд последния swing" },
  RETEST: { title: "Retest", short: "Retest", term: "retest", hint: "Връщане до пробитото ниво" },
  FAKEOUT: { title: "Fakeout", short: "Fakeout", term: "fakeout", hint: "Пробив, който бързо се връща обратно" },
};

/** Index of the candle whose time is closest to `time` (candles sorted by time). */
export function nearestIndex(candles: { time: number }[], time: number): number {
  const n = candles.length;
  if (!n) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(candles[lo - 1].time - time) <= Math.abs(candles[lo].time - time)) return lo - 1;
  return lo;
}

/**
 * A click on candle `index` with the selected label → the mark to place: HH/LH snap to the candle's High,
 * HL/LL to its Low; events keep the clicked price clamped into the candle's range (close when unknown).
 */
export function snapMark(candles: Candle[], index: number, label: StructureLabel, clickPrice: number | null): StructureMark | null {
  const c = candles[index];
  if (!c) return null;
  const kind = labelKind(label);
  const price =
    kind === "high" ? c.high : kind === "low" ? c.low : clickPrice !== null && Number.isFinite(clickPrice) ? clamp(clickPrice, c.low, c.high) : c.close;
  return { time: c.time, price, label };
}

/** The slot a mark occupies on its candle: one swing high, one swing low and one mark per event type. */
const slotOf = (m: StructureMark) => `${m.time}:${labelKind(m.label) === "event" ? m.label : labelKind(m.label)}`;

/**
 * Places `mark`, replacing whatever sat in the same slot (e.g. HH → LH on the same candle). Placing the exact
 * same label again removes it (click to toggle). The list stays sorted by time.
 */
export function upsertMark(marks: StructureMark[], mark: StructureMark, max = 200): StructureMark[] {
  const slot = slotOf(mark);
  const existing = marks.find((m) => slotOf(m) === slot);
  const rest = marks.filter((m) => slotOf(m) !== slot);
  if (existing && existing.label === mark.label) return rest;
  if (rest.length >= max) return marks;
  return [...rest, mark].sort((a, b) => a.time - b.time || a.label.localeCompare(b.label));
}

/** Removes every mark of candle `time` (eraser tool), or only `label` when given. */
export function removeMarks(marks: StructureMark[], time: number, label?: StructureLabel): StructureMark[] {
  return marks.filter((m) => !(m.time === time && (label === undefined || m.label === label)));
}

export const VERDICT_META: Record<CheckedMark["verdict"], { label: string; tone: Tone; color: string; glyph: string }> = {
  CORRECT: { label: "CORRECT", tone: "up", color: PALETTE.up, glyph: "✓" },
  INCORRECT: { label: "INCORRECT", tone: "down", color: PALETTE.down, glyph: "✗" },
  "NOT A SWING": { label: "NOT A SWING", tone: "warn", color: PALETTE.warn, glyph: "✗" },
  REFERENCE: { label: "REFERENCE", tone: "violet", color: PALETTE.violet, glyph: "•" },
};

const EVENT_SHORT: Record<string, string> = { BREAKOUT: "Breakout", RETEST: "Retest", FAKEOUT: "Fakeout" };

function markPosition(m: StructureMark, candles: Candle[]): MarkerDef["position"] {
  const k = labelKind(m.label);
  if (k === "high") return "aboveBar";
  if (k === "low") return "belowBar";
  const c = candles[nearestIndex(candles, m.time)];
  return c && m.price >= (c.high + c.low) / 2 ? "aboveBar" : "belowBar";
}

export type StructureMarkerInput = {
  candles: Candle[];
  anchors: StructureAnchor[];
  marks: StructureMark[];
  check?: StructureCheck | null;
  showAnswer?: boolean;
};

/**
 * Chart markers of the structure lab: anchors (REF), the user's labels (before the check: accent; after it:
 * CORRECT/INCORRECT/NOT A SWING colours with ✓ / ✗), missed swings and events as ghost markers, and with
 * `showAnswer` the full reference answer (skipping swings the user already matched).
 */
export function structureMarkers({ candles, anchors, marks, check, showAnswer }: StructureMarkerInput): MarkerDef[] {
  const out: MarkerDef[] = [];
  const ghost = withAlpha(PALETTE.muted, 0.75);
  for (const a of anchors) {
    out.push({ time: a.time, position: a.kind === "high" ? "aboveBar" : "belowBar", shape: "circle", color: PALETTE.violet, text: "REF" });
  }
  if (check) {
    for (const m of check.marks) {
      if (m.verdict === "REFERENCE") continue; // the anchor marker already sits there
      const meta = VERDICT_META[m.verdict];
      const tail = m.verdict === "INCORRECT" && m.expected_label ? ` → ${m.expected_label}` : "";
      out.push({
        time: m.time,
        position: markPosition(m, candles),
        shape: labelKind(m.label) === "event" ? "square" : "circle",
        color: meta.color,
        text: `${EVENT_SHORT[m.label] ?? m.label} ${meta.glyph}${tail}`,
      });
    }
    const matched = new Set(check.marks.filter((m) => m.verdict === "CORRECT" && m.matched_swing).map((m) => `${m.matched_swing!.time}:${m.matched_swing!.kind}`));
    const missed: (MissedSwing | RefSwing)[] = showAnswer
      ? check.reference.swings.filter((s) => !s.anchor && s.label && !matched.has(`${s.time}:${s.kind}`))
      : check.missed;
    for (const s of missed) {
      out.push({
        time: s.time,
        position: s.kind === "high" ? "aboveBar" : "belowBar",
        shape: "circle",
        color: showAnswer ? withAlpha(PALETTE.accent2, 0.85) : ghost,
        text: s.label ?? "",
      });
    }
    const events: (MissedEvent | RefEvent)[] = showAnswer ? check.reference.events : check.missed_events;
    for (const e of events) {
      const type = "type" in e ? e.type : "";
      out.push({
        time: e.time,
        position: e.direction === "up" ? "belowBar" : "aboveBar",
        shape: e.direction === "up" ? "arrowUp" : "arrowDown",
        color: showAnswer ? withAlpha(PALETTE.accent2, 0.85) : ghost,
        text: EVENT_SHORT[type] ?? type,
      });
    }
  } else {
    for (const m of marks) {
      out.push({
        time: m.time,
        position: markPosition(m, candles),
        shape: labelKind(m.label) === "event" ? "square" : "circle",
        color: PALETTE.accent2,
        text: EVENT_SHORT[m.label] ?? m.label,
      });
    }
  }
  return out;
}

/** True when the marks the user sees differ from the ones that were checked (re-check needed). */
export function marksChanged(marks: StructureMark[], check: StructureCheck | null | undefined): boolean {
  if (!check) return marks.length > 0;
  const a = marks.map((m) => `${m.time}:${m.label}`).sort();
  const b = check.marks.map((m) => `${m.time}:${m.label}`).sort();
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}

export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  return score >= 70 ? "up" : score >= 40 ? "warn" : "down";
}

export const STRUCTURE_META: Record<string, { label: string; tone: Tone }> = {
  uptrend: { label: "Uptrend", tone: "up" },
  downtrend: { label: "Downtrend", tone: "down" },
  range: { label: "Range", tone: "info" },
};

export const DIFFICULTY_META: Record<string, { label: string; hint: string }> = {
  easy: { label: "Easy", hint: "Ясен тренд" },
  medium: { label: "Medium", hint: "Тренд с пробиви и ретестове" },
  hard: { label: "Hard", hint: "Range с fakeout" },
};

/* ══════════════════════════════════════════════════════ Leverage Academy */

/** The leverage chips (none of them is "recommended"). */
export const LEVERAGES = [1, 2, 5, 10, 20, 50, 100] as const;

/**
 * Ordinal one-hue ramp for the leverage lines (1x → 100x, dim → bright on the dark surface). Validated with the
 * dataviz palette checker (--ordinal, surface #0b111e): monotone lightness, adjacent ΔL ≥ 0.06, light end 2.5:1.
 */
export const LEVERAGE_RAMP = ["#21539c", "#3f6cad", "#5d84bf", "#7a9dd0", "#99b6e1", "#b8d0f2", "#d8e9ff"] as const;

export function leverageColor(leverage: number): string {
  const i = LEVERAGES.indexOf(leverage as (typeof LEVERAGES)[number]);
  if (i >= 0) return LEVERAGE_RAMP[i];
  // between chips: the nearest lower chip's colour
  let k = 0;
  LEVERAGES.forEach((l, j) => {
    if (leverage >= l) k = j;
  });
  return LEVERAGE_RAMP[k];
}

export const LEVERAGE_WARNING = "Higher leverage magnifies exposure and liquidation risk.";

/** The warning line of a simulation, guaranteed to contain the platform's leverage sentence. */
export function leverageWarning(res: { warning?: string | null } | null | undefined): string {
  const w = res?.warning?.trim() ?? "";
  return w.includes(LEVERAGE_WARNING) ? w : `${LEVERAGE_WARNING}${w ? ` ${w}` : ""}`;
}

export const RISK_META: Record<RiskLevel, { label: string; tone: Tone; text: string }> = {
  low: { label: "Нисък", tone: "info", text: "Ликвидацията е далеч спрямо типичното дневно движение (или не е достижима при cross margin)." },
  elevated: { label: "Повишен", tone: "warn", text: "Ликвидацията е на 3–8 типични дневни движения." },
  high: { label: "Висок", tone: "down", text: "Ликвидацията е на 1–3 типични дневни движения." },
  extreme: { label: "Екстремен", tone: "down", text: "Ликвидацията е по-близо от едно типично дневно движение." },
};

/** Isolated-margin liquidation distance ≈ (1 − maintenance ratio) / leverage, in % of the entry price. */
export function isolatedLiqMovePct(leverage: number, maintenance = 0.5): number {
  return ((1 - maintenance) / leverage) * 100;
}

/** P/L of a position for a price move (no fees). */
export function pnlAtMove(notional: number, movePct: number, side: Side = "long"): number {
  return notional * (movePct / 100) * (side === "long" ? 1 : -1);
}

/**
 * Cross-margin liquidation move in % of the entry price (fees ignored) — the paper broker's rule: the account is
 * stopped out when equity falls to `maintenance` × used margin, so the loss room is equity − maintenance ×
 * notional / leverage. 0 = the position cannot even be held; null = unreachable (a long cannot lose more than 100 %).
 */
export function crossLiqMovePct(equity: number, notional: number, leverage: number, maintenance = 0.5): number | null {
  if (!(notional > 0) || !(leverage > 0)) return null;
  const room = equity - maintenance * (notional / leverage);
  if (room <= 0) return 0;
  const move = (room / notional) * 100;
  return move >= 100 ? null : move;
}

/** Moves (in %) listed in the table view of the equity chart. */
export const TABLE_MOVES = [-20, -10, -5, -2, 0, 2, 5, 10, 20] as const;

/** Equity of every series at `moves` (the chart's table view); a cell is null when the series has no such point. */
export function curveTable(family: CurveFamily, moves: readonly number[]) {
  return family.series.map((s) => ({
    leverage: s.leverage,
    canOpen: s.can_open,
    liquidationMove: s.liquidation_move_pct,
    cells: moves.map((m) => s.points.find((p) => !p.at_liquidation && p.move_pct === m) ?? null),
  }));
}

export type SizeMode = "notional" | "margin";

export type SimulatorInput = {
  leverage: number;
  mode: SizeMode;
  amount: number;
  side: Side;
  move: number;
  equity?: number;
};

/** Body of POST /learn/leverage/simulate for the Leverage Academy simulator. */
export function leverageRequest(input: SimulatorInput, includeCurves: boolean): LeverageRequest {
  const body: LeverageRequest = {
    leverage: input.leverage,
    equity: input.equity ?? 10_000,
    side: input.side,
    price_move_pct: clamp(input.move, -99, 1000),
    include_curves: includeCurves,
  };
  if (input.mode === "margin") body.margin = input.amount;
  else body.position_notional = input.amount;
  return body;
}

/** "Nice" round axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export type CurveLayout = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * Scales + SVG paths of the "equity vs price move" chart (one polyline per leverage, liquidation points).
 * `domain` fixes the equity axis (e.g. [0, 2 × equity] so every view keeps one scale — the caller clips what
 * leaves it); without it the axis fits the data.
 */
export function curveGeometry(family: CurveFamily, layout: CurveLayout, domain?: [number, number]) {
  const { width, height, left, right, top, bottom } = layout;
  const moves = family.moves_pct;
  const x0 = Math.min(...moves);
  const x1 = Math.max(...moves);
  let y0: number;
  let y1: number;
  let ticks: number[];
  if (domain) {
    [y0, y1] = domain;
    ticks = niceTicks(y0, y1, 5).filter((t) => t >= y0 - 1e-9 && t <= y1 + 1e-9);
  } else {
    const all = family.series.flatMap((s) => s.points.map((p) => p.equity));
    y0 = Math.min(...all, family.equity);
    y1 = Math.max(...all, family.equity);
    const padY = (y1 - y0) * 0.06 || Math.max(1, Math.abs(y1) * 0.02);
    y0 -= padY;
    y1 += padY;
    ticks = niceTicks(y0, y1, 5);
    y0 = Math.min(y0, ticks[0] ?? y0);
    y1 = Math.max(y1, ticks[ticks.length - 1] ?? y1);
  }
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  const x = (m: number) => left + ((m - x0) / (x1 - x0 || 1)) * plotW;
  const y = (v: number) => top + ((y1 - v) / (y1 - y0 || 1)) * plotH;
  const series = family.series.map((s) => {
    const pts = [...s.points].sort((a, b) => a.move_pct - b.move_pct || Number(a.at_liquidation) - Number(b.at_liquidation));
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.move_pct).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
    const liq = pts.filter((p) => p.at_liquidation).map((p) => ({ x: x(p.move_pct), y: y(p.equity), move: p.move_pct, equity: p.equity }));
    const last = pts[pts.length - 1];
    return { leverage: s.leverage, d, liq, end: last ? { x: x(last.move_pct), y: y(last.equity), equity: last.equity } : null, series: s };
  });
  return { x, y, x0, x1, y0, y1, ticks, series, plotW, plotH };
}

/** The move (from the family's grid) closest to `m` — the crosshair snaps to it. */
export function snapMove(moves: number[], m: number): number {
  let best = moves[0] ?? 0;
  for (const v of moves) if (Math.abs(v - m) < Math.abs(best - m)) best = v;
  return best;
}

/** The regular (non-liquidation) point of each series closest to move `m` (tooltip read-out). */
export function pointsAt(family: CurveFamily, m: number) {
  return family.series.map((s) => {
    const regular = s.points.filter((p) => !p.at_liquidation);
    const pool = regular.length ? regular : s.points;
    let best = pool[0];
    for (const p of pool) if (Math.abs(p.move_pct - m) < Math.abs(best.move_pct - m)) best = p;
    return { leverage: s.leverage, point: best };
  });
}

/**
 * Equity of a series at any move — linear between its points, which is exact: P/L is linear between them and
 * the liquidation kink is one of the points (after it the line stays flat: the position is closed).
 */
export function equityAtMove(points: CurvePoint[], m: number): number | null {
  if (!points.length) return null;
  const pts = [...points].sort((a, b) => a.move_pct - b.move_pct);
  if (m <= pts[0].move_pct) return pts[0].equity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (m <= b.move_pct) {
      const span = b.move_pct - a.move_pct;
      return span > 0 ? a.equity + ((m - a.move_pct) / span) * (b.equity - a.equity) : b.equity;
    }
  }
  return pts[pts.length - 1].equity;
}

/** "$12k" / "$9.5k" / "$800" — compact axis labels. */
export function usdCompact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}$${+(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1000) return `${sign}$${+(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/* ═════════════════════════════════════════════════════════ Trade Simulator */

/** Leverage chips allowed for an instrument: the standard chips ≤ max plus the max itself. */
export function allowedLeverages(max: number | null | undefined): number[] {
  const cap = max && max >= 1 ? Math.min(100, max) : 100;
  const chips: number[] = LEVERAGES.filter((l) => l <= cap);
  if (!chips.includes(cap)) chips.push(cap);
  return chips.sort((a, b) => a - b);
}

/** The leverage actually used: the chosen chip when allowed, otherwise the largest allowed one below it. */
export function effectiveLeverage(chosen: number, allowed: number[]): number {
  if (allowed.includes(chosen)) return chosen;
  const below = allowed.filter((l) => l <= chosen);
  return below.length ? below[below.length - 1] : (allowed[0] ?? 1);
}

/** Executable price for the side: a long buys at the ask, a short sells at the bid (mid when missing). */
export function marketPrice(q: { bid: number | null; ask: number | null; mid: number | null } | null | undefined, side: Side): number | null {
  if (!q) return null;
  const v = side === "long" ? (q.ask ?? q.mid) : (q.bid ?? q.mid);
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0 ? v : null;
}

/** Rounds a price to the instrument's precision. */
export function roundTo(v: number, precision: number): number {
  const k = 10 ** clamp(Math.round(precision), 0, 10);
  return Math.round(v * k) / k;
}

/**
 * Example stop / target for the what-if (always labelled as examples, never as advice): one typical daily move
 * against the position for the stop and two in its favour for the target.
 */
export function exampleLevels(entry: number, side: Side, dailyVolPct: number | null | undefined, precision: number): { stop: number; target: number } | null {
  if (!(entry > 0) || !dailyVolPct || !(dailyVolPct > 0)) return null;
  const d = entry * (Math.min(dailyVolPct, 50) / 100);
  const dir = side === "long" ? 1 : -1;
  return { stop: roundTo(entry - dir * d, precision), target: roundTo(entry + dir * 2 * d, precision) };
}

/** Position units with sensible decimals: "1,250" · "12.5" · "0.01907". */
export function fmtUnits(u: number | null | undefined): string {
  if (u === null || u === undefined || !Number.isFinite(u)) return "—";
  const a = Math.abs(u);
  const digits = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
  return u.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Client-side mirror of the backend's stop/target side check (null = OK). */
export function planError(side: Side, entry: number | null, stop: number | null, target: number | null): string | null {
  if (entry === null || entry <= 0) return null;
  if (stop !== null) {
    if (stop <= 0) return "Stop loss трябва да е положително число.";
    if (side === "long" && stop >= entry) return "При LONG stop loss трябва да е ПОД цената на влизане.";
    if (side === "short" && stop <= entry) return "При SHORT stop loss трябва да е НАД цената на влизане.";
  }
  if (target !== null) {
    if (target <= 0) return "Take profit трябва да е положително число.";
    if (side === "long" && target <= entry) return "При LONG take profit трябва да е НАД цената на влизане.";
    if (side === "short" && target >= entry) return "При SHORT take profit трябва да е ПОД цената на влизане.";
  }
  return null;
}

export type TradePlanInput = {
  side: Side;
  entry: number;
  stop: number | null;
  target: number | null;
  leverage: number;
  sizing: "risk" | "notional";
  riskPct: number | null;
  notional: number | null;
  /** USD per 1 unit of the quote currency (1 for USD-quoted instruments) */
  rate: number;
  feeRate: number;
  spreadBps: number;
  dailyVolPct: number | null;
  equity?: number;
};

/**
 * Body of POST /learn/leverage/simulate for the Trade Simulator. Prices are converted to USD with the quote
 * currency's rate (all else equal), so margin, P/L and costs come out in the account currency for every
 * instrument; `rescaleResult` converts the price fields back.
 */
export function tradeRequest(p: TradePlanInput): LeverageRequest | null {
  if (!(p.entry > 0) || !(p.rate > 0)) return null;
  const r = p.rate;
  const body: LeverageRequest = {
    leverage: p.leverage,
    equity: p.equity ?? 10_000,
    side: p.side,
    entry_price: p.entry * r,
    price_move_pct: 0,
    fee_rate: p.feeRate,
    spread_bps: p.spreadBps,
    scenario_moves: [-10, -5, -2, -1, 1, 2, 5, 10],
    include_curves: false,
  };
  if (p.dailyVolPct && p.dailyVolPct > 0) body.daily_vol_pct = p.dailyVolPct;
  if (p.stop !== null) body.stop_price = p.stop * r;
  if (p.target !== null) body.target_price = p.target * r;
  if (p.sizing === "risk") {
    if (p.riskPct === null || !(p.riskPct > 0) || p.stop === null) return null;
    body.risk_pct = p.riskPct;
  } else {
    if (p.notional === null || !(p.notional > 0)) return null;
    body.position_notional = p.notional;
  }
  return body;
}

/** Converts the price fields of a simulation made in USD terms back to the instrument's quote currency. */
export function rescaleResult(res: LeverageResult, rate: number): LeverageResult {
  if (!(rate > 0) || rate === 1) return res;
  const k = (v: number | null) => (v === null ? null : v / rate);
  return {
    ...res,
    entry_price: res.entry_price / rate,
    mid_price: res.mid_price / rate,
    price_after_move: res.price_after_move / rate,
    price_change: res.price_change / rate,
    exit_price: res.exit_price / rate,
    liquidation_price: k(res.liquidation_price),
    isolated_liquidation_price: k(res.isolated_liquidation_price),
    scenarios: res.scenarios.map((s) => ({ ...s, price: s.price / rate })),
    plan: res.plan ? { ...res.plan, stop_price: k(res.plan.stop_price), target_price: k(res.plan.target_price) } : null,
  };
}

/** "Open in Paper Trading" link: the symbol (+ the plan as optional prefill params for the terminal). */
export function tradeHref(p: { symbol: string; side: Side; entry?: number | null; stop?: number | null; target?: number | null; leverage?: number | null }): string {
  const q = new URLSearchParams({ symbol: p.symbol, side: p.side === "long" ? "buy" : "sell" });
  if (p.entry) q.set("entry", String(p.entry));
  if (p.stop) q.set("stop", String(p.stop));
  if (p.target) q.set("target", String(p.target));
  if (p.leverage) q.set("leverage", String(p.leverage));
  return `/trade?${q.toString()}`;
}
