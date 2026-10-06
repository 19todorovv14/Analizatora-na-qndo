"use client";

import useSWR from "swr";

import type {
  BlockKey,
  BuilderMeta,
  ConditionV2,
  DefinitionV2,
  OperandV2,
  OperatorInfo,
  RuleTypeMeta,
  StructureMeta,
} from "@/components/strategy/types";
import { fetcher } from "@/lib/api";

/** GET /strategies/meta — public, static per deploy. */
export function useBuilderMeta() {
  return useSWR<BuilderMeta>("/strategies/meta", fetcher, { revalidateOnFocus: false, dedupingInterval: 600_000 });
}

/* ───────────────────────────────────────────────────────── labels */

export const IND_LABEL: Record<string, string> = {
  sma: "SMA",
  ema: "EMA",
  rsi: "RSI",
  macd: "MACD",
  bb: "Bollinger Bands",
  atr: "ATR",
  vwap: "VWAP",
  volume_sma: "Average volume",
  adx: "ADX",
  highest: "Highest high (N)",
  lowest: "Lowest low (N)",
};

export const PRICE_LABEL: Record<string, string> = { open: "Open", high: "High", low: "Low", close: "Close (цена)", volume: "Volume" };

export const REGIMES = ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCLEAR"];

export const REGIME_LABEL: Record<string, string> = {
  TRENDING_UP: "Тренд нагоре",
  TRENDING_DOWN: "Тренд надолу",
  RANGING: "Range (странично)",
  HIGH_VOLATILITY: "Висока волатилност",
  LOW_VOLATILITY: "Ниска волатилност",
  UNCLEAR: "Неясен режим",
};

export const PRESET_GROUP_LABEL: Record<string, string> = {
  trend: "Trend",
  momentum: "Momentum",
  structure: "Structure",
  volume: "Volume",
  candle_pattern: "Candle patterns",
};

export const BLOCK_FALLBACK: { key: BlockKey; label: string; then: string }[] = [
  { key: "entry_long", label: "LONG entry", then: "Potential LONG Setup" },
  { key: "entry_short", label: "SHORT entry", then: "Potential SHORT Setup" },
  { key: "exit_long", label: "Exit LONG", then: "Close LONG" },
  { key: "exit_short", label: "Exit SHORT", then: "Close SHORT" },
];

/** glossary key for an operand (explain mode) */
export function operandTerm(o: OperandV2): string | undefined {
  if (o.kind === "indicator") return o.name === "volume_sma" ? "volume" : (o.name ?? undefined);
  if (o.kind === "price") return o.field === "volume" ? "volume" : undefined;
  if (o.kind === "structure") {
    const m: Record<string, string> = {
      higher_high: "hh",
      higher_low: "hl",
      lower_high: "lh",
      lower_low: "ll",
      uptrend: "trend",
      downtrend: "trend",
      break_above_swing_high: "breakout",
      break_below_swing_low: "breakout",
    };
    return m[o.name ?? ""] ?? "candlestick";
  }
  return undefined;
}

/* ─────────────────────────────────────────────────────── operators */

const OP_FALLBACK: Record<string, Omit<OperatorInfo, "op">> = {
  "<": { label: "<", text: "е под", needs_right: true },
  ">": { label: ">", text: "е над", needs_right: true },
  "<=": { label: "≤", text: "е под или равно на", needs_right: true },
  ">=": { label: "≥", text: "е над или равно на", needs_right: true },
  crosses_above: { label: "crosses above", text: "пресича нагоре", needs_right: true },
  crosses_below: { label: "crosses below", text: "пресича надолу", needs_right: true },
  is_true: { label: "is true", text: "е вярно (стойност > 0)", needs_right: false },
  is_false: { label: "is false", text: "НЕ е вярно (стойност ≤ 0)", needs_right: false },
};

export function operatorList(meta: BuilderMeta): OperatorInfo[] {
  if (meta.operator_info?.length) return meta.operator_info;
  return meta.operators.map((op) => ({ op, ...(OP_FALLBACK[op] ?? { label: op, text: op, needs_right: true }) }));
}

export function needsRight(op: string, meta?: BuilderMeta): boolean {
  const info = meta?.operator_info?.find((o) => o.op === op);
  if (info) return info.needs_right;
  return OP_FALLBACK[op]?.needs_right ?? true;
}

/* ──────────────────────────────────────────────────────── operands */

export type UiKind = "indicator" | "price" | "value" | "structure" | "candle_pattern";

export const UI_KIND_LABEL: Record<UiKind, string> = {
  indicator: "Indicator",
  price: "Price",
  value: "Value",
  structure: "Structure",
  candle_pattern: "Candle pattern",
};

export function structureOf(meta: BuilderMeta | undefined, name?: string | null): StructureMeta | undefined {
  return meta?.structures?.find((s) => s.name === name);
}

export function uiKind(o: OperandV2, meta?: BuilderMeta): UiKind {
  if (o.kind !== "structure") return o.kind;
  return structureOf(meta, o.name)?.group === "candle_pattern" ? "candle_pattern" : "structure";
}

export function uiKinds(meta: BuilderMeta): UiKind[] {
  const out: UiKind[] = ["indicator", "price", "value"];
  if (meta.structures?.some((s) => s.group !== "candle_pattern")) out.push("structure");
  if (meta.structures?.some((s) => s.group === "candle_pattern")) out.push("candle_pattern");
  return out;
}

export function defaultOperand(kind: UiKind, meta: BuilderMeta): OperandV2 {
  if (kind === "value") return { kind: "value", value: 50 };
  if (kind === "price") return { kind: "price", field: "close" };
  if (kind === "indicator") {
    const name = meta.indicators.ema ? "ema" : Object.keys(meta.indicators)[0];
    return { kind: "indicator", name, params: { ...(meta.indicators[name]?.params ?? {}), ...(name === "ema" ? { period: 50 } : {}) }, output: meta.indicators[name]?.outputs[0] ?? "value" };
  }
  const list = (meta.structures ?? []).filter((s) => (kind === "candle_pattern" ? s.group === "candle_pattern" : s.group !== "candle_pattern"));
  return { kind: "structure", name: list[0]?.name ?? "higher_high", params: {} };
}

const fmtParam = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));

/** Short readable label, mirrors the backend Operand.label(). */
export function operandText(o: OperandV2, meta?: BuilderMeta): string {
  let base: string;
  if (o.kind === "value") return fmtParam(Number(o.value ?? 0));
  if (o.kind === "price") base = (o.field ?? "close").replace(/^\w/, (c) => c.toUpperCase());
  else if (o.kind === "structure") {
    base = structureOf(meta, o.name)?.label ?? (o.name ?? "").replace(/_/g, " ");
    const p = o.params ?? {};
    if (p.left !== undefined || p.right !== undefined) base += ` (L${fmtParam(p.left ?? 3)}/R${fmtParam(p.right ?? 3)})`;
  } else {
    const params = Object.values(o.params ?? {}).map(fmtParam).join(",");
    base = `${IND_LABEL[o.name ?? ""]?.split(" ")[0] ?? (o.name ?? "").toUpperCase()}${params ? `(${params})` : ""}`;
    if (o.name === "volume_sma") base = `Avg volume(${params || 20})`;
    if (o.output && o.output !== "value") base += `.${o.output}`;
  }
  if (o.mult !== undefined && o.mult !== 1) base += ` × ${fmtParam(o.mult)}`;
  if (o.shift) base += ` [${o.shift} назад]`;
  return base;
}

/** One-line readable condition, e.g. "Close > EMA(200)", "Higher High", "НЕ Inside bar". */
export function conditionText(c: ConditionV2, meta?: BuilderMeta): string {
  if (c.op === "is_true") return operandText(c.left, meta);
  if (c.op === "is_false") return `НЕ ${operandText(c.left, meta)}`;
  const op = operatorList(meta ?? { indicators: {}, operators: [c.op], price_fields: [], templates: [] }).find((o) => o.op === c.op)?.label ?? c.op;
  return `${operandText(c.left, meta)} ${op} ${c.right ? operandText(c.right, meta) : "—"}`;
}

/* ─────────────────────────────────────────────────────── definitions */

/** Builder starter = the platform's example: Price > EMA 200 AND RSI > 50 AND Higher High AND Volume > Average. */
export function emptyDefinition(): DefinitionV2 {
  return {
    entry_long: {
      logic: "all",
      conditions: [
        { left: { kind: "price", field: "close" }, op: ">", right: { kind: "indicator", name: "ema", params: { period: 200 }, output: "value" } },
        { left: { kind: "indicator", name: "rsi", params: { period: 14 }, output: "value" }, op: ">", right: { kind: "value", value: 50 } },
        { left: { kind: "structure", name: "higher_high", params: {} }, op: "is_true" },
        { left: { kind: "price", field: "volume" }, op: ">", right: { kind: "indicator", name: "volume_sma", params: { period: 20 }, output: "value" } },
      ],
    },
    entry_short: null,
    exit_long: null,
    exit_short: null,
    stop: { type: "atr", value: 2, atr_period: 14, lookback: 10 },
    take_profit: { type: "r_multiple", value: 2 },
    risk_per_trade_pct: 1,
    regime_filter: [],
  };
}

/** Fill missing optional fields so the editor can rely on them (old rows, partial definitions). */
export function normalizeDefinition(d: Partial<DefinitionV2> | null | undefined): DefinitionV2 {
  const base = emptyDefinition();
  if (!d) return base;
  return {
    entry_long: d.entry_long ?? null,
    entry_short: d.entry_short ?? null,
    exit_long: d.exit_long ?? null,
    exit_short: d.exit_short ?? null,
    stop: { ...base.stop, ...(d.stop ?? {}) },
    take_profit: { ...base.take_profit, ...(d.take_profit ?? {}) },
    risk_per_trade_pct: d.risk_per_trade_pct ?? 1,
    regime_filter: Array.isArray(d.regime_filter) ? d.regime_filter : [],
  };
}

/** Structural equality on the meaningful parts of a condition (for preset de-duplication). */
export function sameCondition(a: ConditionV2, b: ConditionV2): boolean {
  const op = (o?: OperandV2 | null) =>
    o
      ? JSON.stringify([o.kind, o.name ?? null, o.field ?? null, o.kind === "value" ? Number(o.value) : null, Object.entries(o.params ?? {}).map(([k, v]) => [k, Number(v)]).sort(), o.output && o.output !== "value" ? o.output : null, Number(o.mult ?? 1), Number(o.shift ?? 0)])
      : "∅";
  const boolOp = a.op === "is_true" || a.op === "is_false";
  return a.op === b.op && op(a.left) === op(b.left) && (boolOp || op(a.right) === op(b.right));
}

export function ruleTypes(meta: BuilderMeta | undefined, which: "stop" | "take_profit"): RuleTypeMeta[] {
  const fromMeta = which === "stop" ? meta?.stop_types : meta?.take_profit_types;
  if (fromMeta?.length) return fromMeta;
  return which === "stop"
    ? [
        { type: "atr", label: "ATR × n", defaults: { value: 2, atr_period: 14 } },
        { type: "percent", label: "% от цената", defaults: { value: 1 } },
        { type: "swing", label: "Зад swing low / high", defaults: { value: 1, lookback: 10 } },
      ]
    : [
        { type: "r_multiple", label: "n R (Risk × n)", defaults: { value: 2 } },
        { type: "atr", label: "ATR × n", defaults: { value: 3 } },
        { type: "percent", label: "% от цената", defaults: { value: 2 } },
        { type: "none", label: "Без фиксирана цел", defaults: { value: 2 } },
      ];
}

export function countConditions(d: DefinitionV2): number {
  return [d.entry_long, d.entry_short, d.exit_long, d.exit_short].reduce((n, b) => n + (b?.conditions.length ?? 0), 0);
}

/** Readable number for checklist values: big prices without decimals, small values with 2–4. */
export function fmtValue(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
