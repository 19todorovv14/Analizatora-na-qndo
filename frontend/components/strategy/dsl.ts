/*
 * Pure Strategy DSL v2 helpers for the S6 UI (no React / network imports, so they are unit-testable with
 * `node --test`). Labels mirror the backend (app/strategies/rules.py Operand.label / Condition.label);
 * everything data-driven comes from GET /strategies/meta with local fallbacks for an older backend.
 */
import type {
  BlockKey,
  BuilderMeta,
  ConditionV2,
  DefinitionV2,
  OperandV2,
  OperatorInfo,
  PresetMeta,
  RuleTypeMeta,
  StructureMeta,
} from "./types";

/* ───────────────────────────────────────────────────────── labels */

export const IND_LABEL: Record<string, string> = {
  sma: "SMA",
  ema: "EMA",
  rsi: "RSI",
  macd: "MACD",
  bb: "Bollinger",
  atr: "ATR",
  vwap: "VWAP",
  volume_sma: "Avg volume",
  adx: "ADX",
  highest: "Highest (N)",
  lowest: "Lowest (N)",
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

/** Max conditions per block (the backend accepts more, the builder keeps definitions readable). */
export const MAX_CONDITIONS = 12;

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

/** false for "is true" / "is false" (the right operand is hidden and ignored by the backend). */
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

/** UI operand type: "Candle pattern" is a backend `structure` operand whose catalogue group is candle_pattern. */
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
    return {
      kind: "indicator",
      name,
      params: { ...(meta.indicators[name]?.params ?? {}), ...(name === "ema" ? { period: 50 } : {}) },
      output: meta.indicators[name]?.outputs[0] ?? "value",
    };
  }
  const list = (meta.structures ?? []).filter((s) => (kind === "candle_pattern" ? s.group === "candle_pattern" : s.group !== "candle_pattern"));
  return { kind: "structure", name: list[0]?.name ?? (kind === "candle_pattern" ? "bullish_engulfing" : "higher_high"), params: {} };
}

/** true when the operand uses the advanced extras (multiplier ≠ 1 or bars back ≠ 0). */
export function hasExtras(o: OperandV2 | null | undefined): boolean {
  if (!o || o.kind === "value") return false;
  return Number(o.mult ?? 1) !== 1 || Number(o.shift ?? 0) !== 0;
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
  if (o.mult !== undefined && o.mult !== null && o.mult !== 1) base += ` × ${fmtParam(o.mult)}`;
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

/** Plain-language Bulgarian sentence for a condition (beginner helper line under each row). */
export function conditionSentence(c: ConditionV2, meta: BuilderMeta): string {
  const op = operatorList(meta).find((o) => o.op === c.op);
  const left = operandText(c.left, meta);
  if (c.op === "is_true") return `${left} — да (условието е вярно на затворената свещ)`;
  if (c.op === "is_false") return `${left} — не (условието НЕ е вярно на затворената свещ)`;
  return `${left} ${op?.text ?? c.op} ${c.right ? operandText(c.right, meta) : "—"}`;
}

/**
 * Changing the LEFT operand of a condition keeps the sentence valid: a structure / candle pattern switches the
 * operator to "is true" (right operand becomes the ignored placeholder); leaving a boolean condition for a
 * numeric operand restores a comparison.
 */
export function withLeft(c: ConditionV2, left: OperandV2, meta: BuilderMeta): ConditionV2 {
  const wasBool = !needsRight(c.op, meta);
  const isStruct = left.kind === "structure";
  if (isStruct && !wasBool) return { left, op: "is_true", right: { kind: "value", value: 0 } };
  if (!isStruct && wasBool && c.left.kind === "structure") return { left, op: ">", right: defaultOperand("value", meta) };
  return { ...c, left };
}

/** Changing the operator: comparisons need a real right operand, boolean ops keep a placeholder. */
export function withOperator(c: ConditionV2, op: string, meta: BuilderMeta): ConditionV2 {
  const right = needsRight(op, meta) ? (c.right ?? defaultOperand("value", meta)) : (c.right ?? { kind: "value", value: 0 });
  return { ...c, op, right };
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

/** Default condition added by "+ Условие" (direction-aware). */
export function starterCondition(key: BlockKey): ConditionV2 {
  switch (key) {
    case "entry_long":
      return { left: { kind: "indicator", name: "rsi", params: { period: 14 }, output: "value" }, op: ">", right: { kind: "value", value: 50 } };
    case "entry_short":
      return { left: { kind: "indicator", name: "rsi", params: { period: 14 }, output: "value" }, op: "<", right: { kind: "value", value: 50 } };
    case "exit_long":
      return { left: { kind: "price", field: "close" }, op: "crosses_below", right: { kind: "indicator", name: "ema", params: { period: 20 }, output: "value" } };
    default:
      return { left: { kind: "price", field: "close" }, op: "crosses_above", right: { kind: "indicator", name: "ema", params: { period: 20 }, output: "value" } };
  }
}

/** Structural equality on the meaningful parts of a condition (for preset de-duplication). */
export function sameCondition(a: ConditionV2, b: ConditionV2): boolean {
  const op = (o?: OperandV2 | null) =>
    o
      ? JSON.stringify([
          o.kind,
          o.name ?? null,
          o.kind === "price" ? (o.field ?? "close") : null,
          o.kind === "value" ? Number(o.value) : null,
          Object.entries(o.params ?? {})
            .map(([k, v]) => [k, Number(v)])
            .sort(),
          o.output && o.output !== "value" ? o.output : null,
          Number(o.mult ?? 1),
          Number(o.shift ?? 0),
        ])
      : "∅";
  const boolOp = a.op === "is_true" || a.op === "is_false";
  return a.op === b.op && op(a.left) === op(b.left) && (boolOp || op(a.right) === op(b.right));
}

/** Adds a preset's condition to a block (deep copy, de-duplicated, capped at MAX_CONDITIONS). Returns the new block. */
export function addPresetCondition(block: DefinitionV2["entry_long"], preset: PresetMeta): NonNullable<DefinitionV2["entry_long"]> {
  const cond: ConditionV2 = JSON.parse(JSON.stringify(preset.condition));
  if (!block) return { logic: "all", conditions: [cond] };
  if (block.conditions.some((c) => sameCondition(c, preset.condition))) return block;
  if (block.conditions.length >= MAX_CONDITIONS) return block;
  return { ...block, conditions: [...block.conditions, cond] };
}

/* ─────────────────────────────────────────────────────── presets */

/** The platform's "presets row": the spec's examples first (direction-aware), the full catalogue on demand. */
export const FEATURED_PRESETS: Record<"long" | "short", string[]> = {
  long: ["price_above_ema200", "rsi_above_50", "higher_high", "volume_above_average", "ema20_cross_up_ema50"],
  short: ["price_below_ema200", "rsi_below_50", "lower_low", "volume_above_average", "ema20_cross_down_ema50"],
};

export function featuredPresets(presets: PresetMeta[], side: "long" | "short", limit = 6): PresetMeta[] {
  const byKey = new Map(presets.map((p) => [p.key, p]));
  const out = FEATURED_PRESETS[side].map((k) => byKey.get(k)).filter((p): p is PresetMeta => !!p);
  for (const p of presets) {
    if (out.length >= limit) break;
    if (!out.includes(p) && (p.side === side || p.side === "both")) out.push(p);
  }
  return out.slice(0, limit);
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

/** Short text for a stop rule ("ATR × 2", "1.5%", "swing (10 свещи)"). */
export function stopText(s: DefinitionV2["stop"] | null | undefined): string {
  if (!s) return "—";
  if (s.type === "atr") return `ATR × ${s.value}`;
  if (s.type === "percent") return `${s.value}%`;
  return `swing (${s.lookback ?? 10} свещи)`;
}

/** Short text for a take-profit rule ("2R", "ATR × 3", "2%", "няма"). */
export function targetText(t: DefinitionV2["take_profit"] | null | undefined): string {
  if (!t) return "—";
  if (t.type === "r_multiple") return `${t.value}R`;
  if (t.type === "atr") return `ATR × ${t.value}`;
  if (t.type === "percent") return `${t.value}%`;
  return "няма";
}
