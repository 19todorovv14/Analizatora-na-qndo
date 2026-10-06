/*
 * Strategy DSL v2 types used by the S6 UI (Strategy Builder, Backtesting, Bot Lab).
 * They are a superset of the v1 shapes in lib/types.ts (structure operands, optional right operand for
 * is_true / is_false), so every v1 definition is also a valid v2 definition.
 */

export type OperandKind = "indicator" | "price" | "value" | "structure";

export type OperandV2 = {
  kind: OperandKind;
  /** indicator name or structure / candle-pattern name */
  name?: string | null;
  params?: Record<string, number>;
  output?: string;
  field?: string | null;
  value?: number | null;
  /** bars back */
  shift?: number;
  mult?: number;
};

export type ConditionV2 = { left: OperandV2; op: string; right?: OperandV2 | null };
export type BlockV2 = { logic: "all" | "any"; conditions: ConditionV2[] };
export type BlockKey = "entry_long" | "entry_short" | "exit_long" | "exit_short";

export type StopRuleV2 = { type: "atr" | "percent" | "swing"; value: number; atr_period?: number; lookback?: number };
export type TakeProfitRuleV2 = { type: "r_multiple" | "atr" | "percent" | "none"; value: number };

export type DefinitionV2 = {
  entry_long: BlockV2 | null;
  entry_short: BlockV2 | null;
  exit_long: BlockV2 | null;
  exit_short: BlockV2 | null;
  stop: StopRuleV2;
  take_profit: TakeProfitRuleV2;
  risk_per_trade_pct: number;
  regime_filter: string[];
};

export type StrategyRow = {
  id: number;
  name: string;
  description: string;
  is_template: boolean;
  symbol: string;
  timeframe: string;
  definition: DefinitionV2;
  summary: string[];
  rules_count: number;
  updated_ts?: number;
  /** v2: which built-in template a template row is (null for user strategies) */
  template_key?: string | null;
};

export type IndicatorMeta = { params: Record<string, number>; pane: string; outputs: string[] };

export type StructureMeta = {
  name: string;
  label: string;
  group: "structure" | "candle_pattern" | string;
  bias: "long" | "short" | "neutral" | string;
  description: string;
  lesson?: string | null;
  params: Record<string, number>;
};

export type PresetMeta = {
  key: string;
  label: string;
  group: "trend" | "momentum" | "structure" | "volume" | "candle_pattern" | string;
  side: "long" | "short" | "both" | string;
  condition: ConditionV2;
};

export type OperatorInfo = { op: string; label: string; text: string; needs_right: boolean };

export type RuleTypeMeta = { type: string; label: string; defaults: Record<string, number>; note?: string };

export type TemplateMeta = { key: string; name: string; description: string; timeframe?: string; tags?: string[] };

export type BuilderMeta = {
  indicators: Record<string, IndicatorMeta>;
  operators: string[];
  price_fields: string[];
  templates: TemplateMeta[];
  // v2 (optional so a v1 backend still renders)
  dsl_version?: number;
  operand_kinds?: { kind: OperandKind; label: string; description: string; group?: string }[];
  operator_info?: OperatorInfo[];
  structures?: StructureMeta[];
  structure_params?: { defaults: { left: number; right: number }; min: number; max: number; note?: string };
  presets?: PresetMeta[];
  logic?: { value: "all" | "any"; label: string; text: string }[];
  blocks?: { key: BlockKey; label: string; then: string }[];
  stop_types?: RuleTypeMeta[];
  take_profit_types?: RuleTypeMeta[];
  regimes?: string[];
  disclaimer?: string;
};

export type ConditionResult = { label: string; left: number | null; right: number | null; passed: boolean };
export type BlockResult = { active: boolean; logic?: "all" | "any"; passed: boolean; conditions: ConditionResult[]; score?: number };

/** /strategies/{id}/signal and POST /strategies/check */
export type SignalResponse = {
  signal: "LONG SETUP" | "SHORT SETUP" | "NO TRADE" | string;
  evaluation: Partial<Record<BlockKey, BlockResult>>;
  time?: number;
  regime?: { regime: string; reasons: string[] } | null;
  regime_filter?: string[];
  regime_allowed?: boolean | null;
  summary?: string[];
  disclaimer?: string;
};

/** POST /strategies/describe (always 200) */
export type DescribeResponse = {
  valid: boolean;
  errors: { loc: string; msg: string }[];
  summary: string[];
  conditions: number;
  parameters: number;
  definition?: DefinitionV2;
};

export const SETUP_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement.";
