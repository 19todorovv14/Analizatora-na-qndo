/* Unit tests for the Strategy DSL v2 helpers of the visual builder (components/strategy/dsl.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_CONDITIONS,
  addPresetCondition,
  conditionSentence,
  conditionText,
  countConditions,
  defaultOperand,
  emptyDefinition,
  featuredPresets,
  fmtValue,
  hasExtras,
  needsRight,
  normalizeDefinition,
  operandTerm,
  operandText,
  operatorList,
  ruleTypes,
  sameCondition,
  starterCondition,
  stopText,
  structureOf,
  targetText,
  uiKind,
  uiKinds,
  withLeft,
  withOperator,
} from "../dsl";
import type { BlockV2, ConditionV2, OperandV2, PresetMeta } from "../types";
import { META, META_V1 } from "./fixtures";

const preset = (key: string): PresetMeta => {
  const p = META.presets?.find((x) => x.key === key);
  assert.ok(p, `preset ${key} exists in the backend meta`);
  return p;
};

const ema = (period: number): OperandV2 => ({ kind: "indicator", name: "ema", params: { period }, output: "value" });

describe("operators", () => {
  test("uses the backend operator_info when present", () => {
    const ops = operatorList(META);
    assert.deepEqual(
      ops.map((o) => o.op),
      ["<", ">", "<=", ">=", "crosses_above", "crosses_below", "is_true", "is_false"],
    );
    assert.equal(ops.find((o) => o.op === "is_true")?.label, "is true");
  });

  test("falls back to local labels for a v1 backend", () => {
    const ops = operatorList(META_V1);
    assert.equal(ops.length, 6);
    assert.equal(ops.find((o) => o.op === "<=")?.label, "≤");
    assert.equal(ops.find((o) => o.op === "crosses_above")?.needs_right, true);
  });

  test("is true / is false hide the right operand", () => {
    assert.equal(needsRight("is_true", META), false);
    assert.equal(needsRight("is_false", META), false);
    assert.equal(needsRight(">", META), true);
    assert.equal(needsRight("is_false"), false);
    assert.equal(needsRight("crosses_below"), true);
    assert.equal(needsRight("unknown_op"), true);
  });
});

describe("operand kinds", () => {
  test("candle patterns are structure operands whose catalogue group is candle_pattern", () => {
    assert.equal(uiKind({ kind: "structure", name: "hammer" }, META), "candle_pattern");
    assert.equal(uiKind({ kind: "structure", name: "higher_high" }, META), "structure");
    assert.equal(uiKind({ kind: "price", field: "close" }, META), "price");
    assert.equal(structureOf(META, "higher_high")?.label, "Higher High");
  });

  test("builder offers Indicator / Price / Value / Structure / Candle pattern (v1 backend: no structures)", () => {
    assert.deepEqual(uiKinds(META), ["indicator", "price", "value", "structure", "candle_pattern"]);
    assert.deepEqual(uiKinds(META_V1), ["indicator", "price", "value"]);
  });

  test("default operands per type", () => {
    assert.deepEqual(defaultOperand("value", META), { kind: "value", value: 50 });
    assert.deepEqual(defaultOperand("price", META), { kind: "price", field: "close" });
    assert.deepEqual(defaultOperand("indicator", META), ema(50));
    assert.deepEqual(defaultOperand("structure", META), { kind: "structure", name: "higher_high", params: {} });
    assert.deepEqual(defaultOperand("candle_pattern", META), { kind: "structure", name: "inside_bar", params: {} });
  });

  test("hasExtras only for a multiplier ≠ 1 or bars back ≠ 0", () => {
    assert.equal(hasExtras({ kind: "price", field: "volume", mult: 1, shift: 0 }), false);
    assert.equal(hasExtras({ kind: "price", field: "volume", mult: 1.5 }), true);
    assert.equal(hasExtras({ kind: "indicator", name: "ema", shift: 2 }), true);
    assert.equal(hasExtras({ kind: "value", value: 3, mult: 2 }), false);
    assert.equal(hasExtras(null), false);
  });

  test("glossary keys for explain mode", () => {
    assert.equal(operandTerm({ kind: "indicator", name: "rsi" }), "rsi");
    assert.equal(operandTerm({ kind: "indicator", name: "volume_sma" }), "volume");
    assert.equal(operandTerm({ kind: "price", field: "volume" }), "volume");
    assert.equal(operandTerm({ kind: "price", field: "close" }), undefined);
    assert.equal(operandTerm({ kind: "structure", name: "higher_low" }), "hl");
    assert.equal(operandTerm({ kind: "structure", name: "hammer" }), "candlestick");
  });
});

describe("readable text", () => {
  test("operand labels mirror the backend", () => {
    assert.equal(operandText({ kind: "price", field: "close" }), "Close");
    assert.equal(operandText(ema(200)), "EMA(200)");
    assert.equal(operandText({ kind: "indicator", name: "macd", params: { fast: 12, slow: 26, signal: 9 }, output: "signal" }), "MACD(12,26,9).signal");
    assert.equal(operandText({ kind: "indicator", name: "volume_sma", params: { period: 20 }, output: "value" }), "Avg volume(20)");
    assert.equal(operandText({ kind: "value", value: 50 }), "50");
    assert.equal(operandText({ kind: "value", value: 1.23456 }), "1.2346");
    assert.equal(operandText({ kind: "price", field: "volume", mult: 1.5 }), "Volume × 1.5");
    assert.equal(operandText({ kind: "price", field: "close", shift: 2 }), "Close [2 назад]");
    assert.equal(operandText({ kind: "structure", name: "higher_high", params: {} }, META), "Higher High");
    assert.equal(operandText({ kind: "structure", name: "higher_high", params: { left: 5, right: 2 } }, META), "Higher High (L5/R2)");
    assert.equal(operandText({ kind: "structure", name: "inside_bar" }), "inside bar");
  });

  test("conditions: comparisons, booleans and plain-language sentences", () => {
    const c: ConditionV2 = { left: { kind: "price", field: "close" }, op: ">", right: ema(200) };
    assert.equal(conditionText(c, META), "Close > EMA(200)");
    assert.equal(conditionSentence(c, META), "Close е над EMA(200)");
    const hh: ConditionV2 = { left: { kind: "structure", name: "higher_high", params: {} }, op: "is_true" };
    assert.equal(conditionText(hh, META), "Higher High");
    assert.match(conditionSentence(hh, META), /^Higher High — да/);
    const notInside: ConditionV2 = { left: { kind: "structure", name: "inside_bar", params: {} }, op: "is_false", right: { kind: "value", value: 0 } };
    assert.equal(conditionText(notInside, META), "НЕ Inside bar");
    assert.match(conditionSentence(notInside, META), /НЕ е вярно/);
    assert.equal(conditionText({ left: ema(20), op: "crosses_above", right: ema(50) }), "EMA(20) crosses above EMA(50)");
  });

  test("stop / target / value text", () => {
    assert.equal(stopText({ type: "atr", value: 2 }), "ATR × 2");
    assert.equal(stopText({ type: "percent", value: 1.5 }), "1.5%");
    assert.equal(stopText({ type: "swing", value: 1, lookback: 12 }), "swing (12 свещи)");
    assert.equal(stopText(null), "—");
    assert.equal(targetText({ type: "r_multiple", value: 2 }), "2R");
    assert.equal(targetText({ type: "atr", value: 3 }), "ATR × 3");
    assert.equal(targetText({ type: "percent", value: 2 }), "2%");
    assert.equal(targetText({ type: "none", value: 2 }), "няма");
    assert.equal(fmtValue(104665.12), "104,665");
    assert.equal(fmtValue(60.6712), "60.67");
    assert.equal(fmtValue(1.23456), "1.235");
    assert.equal(fmtValue(0.000123), "0.0001");
    assert.equal(fmtValue(null), "—");
    assert.equal(fmtValue(Number.NaN), "—");
  });
});

describe("editing keeps the sentence valid", () => {
  const cmp: ConditionV2 = { left: { kind: "indicator", name: "rsi", params: { period: 14 }, output: "value" }, op: ">", right: { kind: "value", value: 50 } };

  test("choosing a structure / candle pattern switches to 'is true' with the ignored placeholder", () => {
    const next = withLeft(cmp, { kind: "structure", name: "higher_high", params: {} }, META);
    assert.equal(next.op, "is_true");
    assert.deepEqual(next.right, { kind: "value", value: 0 });
    assert.equal(needsRight(next.op, META), false);
  });

  test("leaving a boolean condition for a numeric operand restores a comparison", () => {
    const bool: ConditionV2 = { left: { kind: "structure", name: "hammer", params: {} }, op: "is_true", right: { kind: "value", value: 0 } };
    const next = withLeft(bool, { kind: "price", field: "close" }, META);
    assert.equal(next.op, ">");
    assert.deepEqual(next.right, { kind: "value", value: 50 });
  });

  test("switching between structures keeps 'is false'", () => {
    const notHH: ConditionV2 = { left: { kind: "structure", name: "higher_high", params: {} }, op: "is_false", right: { kind: "value", value: 0 } };
    const next = withLeft(notHH, { kind: "structure", name: "lower_low", params: {} }, META);
    assert.equal(next.op, "is_false");
    assert.equal(next.left.name, "lower_low");
  });

  test("numeric → numeric keeps operator and right operand", () => {
    const next = withLeft(cmp, { kind: "price", field: "close" }, META);
    assert.equal(next.op, ">");
    assert.deepEqual(next.right, cmp.right);
  });

  test("operators: comparisons get a real right operand, booleans keep a placeholder", () => {
    const boolToCmp = withOperator({ left: { kind: "price", field: "close" }, op: "is_true" }, "<", META);
    assert.deepEqual(boolToCmp.right, { kind: "value", value: 50 });
    const cmpToBool = withOperator(cmp, "is_false", META);
    assert.equal(cmpToBool.op, "is_false");
    assert.deepEqual(cmpToBool.right, cmp.right);
    const bare = withOperator({ left: { kind: "structure", name: "hammer" }, op: "is_true" }, "is_false", META);
    assert.deepEqual(bare.right, { kind: "value", value: 0 });
  });
});

describe("definitions", () => {
  test("the builder starter is the platform example (EMA 200, RSI > 50, Higher High, Volume > Average, ATR × 2, 2R)", () => {
    const d = emptyDefinition();
    assert.deepEqual(
      d.entry_long?.conditions.map((c) => conditionText(c, META)),
      ["Close > EMA(200)", "RSI(14) > 50", "Higher High", "Volume > Avg volume(20)"],
    );
    assert.equal(d.entry_long?.logic, "all");
    assert.equal(d.entry_short, null);
    assert.deepEqual(d.stop, { type: "atr", value: 2, atr_period: 14, lookback: 10 });
    assert.deepEqual(d.take_profit, { type: "r_multiple", value: 2 });
    assert.equal(countConditions(d), 4);
    // a fresh copy every call (callers mutate drafts)
    assert.notEqual(emptyDefinition().entry_long, d.entry_long);
  });

  test("normalizeDefinition fills optional fields of old / partial rows", () => {
    const d = normalizeDefinition({ entry_long: { logic: "any", conditions: [cmpCond()] }, stop: { type: "percent", value: 1 } } as never);
    assert.equal(d.entry_long?.logic, "any");
    assert.equal(d.entry_short, null);
    assert.equal(d.exit_long, null);
    assert.deepEqual(d.stop, { type: "percent", value: 1, atr_period: 14, lookback: 10 });
    assert.deepEqual(d.take_profit, { type: "r_multiple", value: 2 });
    assert.equal(d.risk_per_trade_pct, 1);
    assert.deepEqual(d.regime_filter, []);
    assert.equal(countConditions(normalizeDefinition(null)), 4);
  });

  test("starter conditions are direction-aware", () => {
    assert.equal(conditionText(starterCondition("entry_long")), "RSI(14) > 50");
    assert.equal(conditionText(starterCondition("entry_short")), "RSI(14) < 50");
    assert.equal(conditionText(starterCondition("exit_long")), "Close crosses below EMA(20)");
    assert.equal(conditionText(starterCondition("exit_short")), "Close crosses above EMA(20)");
  });
});

function cmpCond(): ConditionV2 {
  return { left: { kind: "price", field: "close" }, op: ">", right: ema(200) };
}

describe("presets", () => {
  test("sameCondition ignores default mult / shift / output and the placeholder of boolean ops", () => {
    const a = preset("price_above_ema200").condition; // backend form: mult 1.0, shift 0
    assert.ok(sameCondition(a, cmpCond()));
    assert.ok(!sameCondition(a, { ...cmpCond(), right: ema(50) }));
    assert.ok(!sameCondition(a, { ...cmpCond(), op: ">=" }));
    const hh = preset("higher_high").condition;
    assert.ok(sameCondition(hh, { left: { kind: "structure", name: "higher_high", params: {} }, op: "is_true", right: { kind: "value", value: 0 } }));
    assert.ok(!sameCondition(hh, { left: { kind: "structure", name: "higher_high", params: { left: 5 } }, op: "is_true" }));
  });

  test("adding a preset deep-copies it, de-duplicates and respects the cap", () => {
    const p = preset("volume_above_average");
    const fresh = addPresetCondition(null, p);
    assert.equal(fresh.logic, "all");
    assert.equal(fresh.conditions.length, 1);
    assert.notEqual(fresh.conditions[0], p.condition);
    fresh.conditions[0].left.field = "close";
    assert.equal(p.condition.left.field, "volume", "the preset itself is never mutated");

    const block: BlockV2 = { logic: "all", conditions: [cmpCond()] };
    assert.equal(addPresetCondition(block, preset("price_above_ema200")), block, "duplicate → same block");
    const grown = addPresetCondition(block, preset("rsi_above_50"));
    assert.equal(grown.conditions.length, 2);
    assert.equal(block.conditions.length, 1, "input block untouched");

    const full: BlockV2 = { logic: "all", conditions: Array.from({ length: MAX_CONDITIONS }, (_, i) => ({ ...cmpCond(), right: ema(i + 2) })) };
    assert.equal(addPresetCondition(full, preset("rsi_above_50")), full);
  });

  test("featured presets: the spec's examples first, direction-aware", () => {
    const long = featuredPresets(META.presets ?? [], "long").map((p) => p.label);
    assert.deepEqual(long.slice(0, 5), ["Price > EMA 200", "RSI > 50", "Higher High", "Volume > Average", "EMA 20 crosses above EMA 50"]);
    assert.equal(long.length, 6);
    const short = featuredPresets(META.presets ?? [], "short");
    assert.ok(short.every((p) => p.side === "short" || p.side === "both"));
    assert.equal(short[0].key, "price_below_ema200");
    assert.deepEqual(featuredPresets([], "long"), []);
  });

  test("the backend user example preset set builds the exact v2 template conditions", () => {
    let block: BlockV2 | null = null;
    for (const k of ["price_above_ema200", "rsi_above_50", "higher_high", "volume_above_average"]) block = addPresetCondition(block, preset(k));
    assert.deepEqual(
      block?.conditions.map((c) => conditionText(c, META)),
      ["Close > EMA(200)", "RSI(14) > 50", "Higher High", "Volume > Avg volume(20)"],
    );
  });
});

describe("rule types", () => {
  test("STOP / TARGET cards come from the meta, with v1 fallbacks", () => {
    assert.deepEqual(
      ruleTypes(META, "stop").map((t) => t.type),
      ["atr", "percent", "swing"],
    );
    assert.deepEqual(
      ruleTypes(META, "take_profit").map((t) => t.type),
      ["r_multiple", "atr", "percent", "none"],
    );
    assert.deepEqual(
      ruleTypes(META_V1, "stop").map((t) => t.type),
      ["atr", "percent", "swing"],
    );
    assert.equal(ruleTypes(undefined, "take_profit").find((t) => t.type === "r_multiple")?.defaults.value, 2);
  });
});
