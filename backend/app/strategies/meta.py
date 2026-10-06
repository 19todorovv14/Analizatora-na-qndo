"""Builder metadata for GET /strategies/meta — everything the Strategy Builder UI needs to stay data-driven."""

from __future__ import annotations

from app import indicators as ind
from app.analysis.regime import REGIMES
from app.strategies import structure_ops
from app.strategies.rules import BOOL_OPS, OPS, PRICE_FIELDS
from app.strategies.templates import PRESETS, TEMPLATES

DSL_VERSION = 2
SETUP_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement."

OPERAND_KINDS = [
    {"kind": "indicator", "label": "Indicator", "description": "Технически индикатор (EMA, RSI, ATR, …)."},
    {"kind": "price", "label": "Price", "description": "Поле на свещта: open / high / low / close / volume."},
    {"kind": "value", "label": "Value", "description": "Фиксирано число (праг)."},
    {
        "kind": "structure",
        "label": "Structure",
        "group": "structure",
        "description": "Пазарна структура от потвърдени swing точки (1 = да, 0 = не), без lookahead.",
    },
    {
        "kind": "structure",
        "label": "Candle pattern",
        "group": "candle_pattern",
        "description": "Свещна формация на текущата свещ (1 = да, 0 = не).",
    },
]

OPERATOR_INFO = [
    {"op": "<", "label": "<", "text": "е под", "needs_right": True},
    {"op": ">", "label": ">", "text": "е над", "needs_right": True},
    {"op": "<=", "label": "≤", "text": "е под или равно на", "needs_right": True},
    {"op": ">=", "label": "≥", "text": "е над или равно на", "needs_right": True},
    {"op": "crosses_above", "label": "crosses above", "text": "пресича нагоре", "needs_right": True},
    {"op": "crosses_below", "label": "crosses below", "text": "пресича надолу", "needs_right": True},
    {"op": "is_true", "label": "is true", "text": "е вярно (стойност > 0)", "needs_right": False},
    {"op": "is_false", "label": "is false", "text": "НЕ е вярно (стойност ≤ 0)", "needs_right": False},
]
assert [o["op"] for o in OPERATOR_INFO] == list(OPS) and all(
    not o["needs_right"] for o in OPERATOR_INFO if o["op"] in BOOL_OPS
)

LOGIC = [
    {"value": "all", "label": "AND", "text": "всички условия"},
    {"value": "any", "label": "OR", "text": "поне едно условие"},
]

BLOCKS = [
    {"key": "entry_long", "label": "LONG entry", "then": "Potential LONG Setup"},
    {"key": "entry_short", "label": "SHORT entry", "then": "Potential SHORT Setup"},
    {"key": "exit_long", "label": "Exit LONG", "then": "Close LONG"},
    {"key": "exit_short", "label": "Exit SHORT", "then": "Close SHORT"},
]

STOP_TYPES = [
    {"type": "atr", "label": "ATR × n", "defaults": {"value": 2, "atr_period": 14}},
    {"type": "percent", "label": "% от цената", "defaults": {"value": 1}},
    {
        "type": "swing",
        "label": "Зад swing low / high",
        "defaults": {"value": 1, "lookback": 10},
        "note": "value е буфер в единици от 0.1% от цената; lookback = брой свещи.",
    },
]

TAKE_PROFIT_TYPES = [
    {"type": "r_multiple", "label": "n R (Risk × n)", "defaults": {"value": 2}},
    {"type": "atr", "label": "ATR × n", "defaults": {"value": 3}},
    {"type": "percent", "label": "% от цената", "defaults": {"value": 2}},
    {"type": "none", "label": "Без фиксирана цел", "defaults": {"value": 2}},
]


def builder_meta() -> dict:
    return {
        # v1 keys (unchanged shapes)
        "indicators": ind.INDICATOR_CATALOG,
        "operators": OPS,
        "price_fields": PRICE_FIELDS,
        "templates": [
            {
                "key": t["key"],
                "name": t["name"],
                "description": t["description"],
                "timeframe": t["timeframe"],
                "tags": t.get("tags", []),
            }
            for t in TEMPLATES
        ],
        # v2
        "dsl_version": DSL_VERSION,
        "operand_kinds": OPERAND_KINDS,
        "operator_info": OPERATOR_INFO,
        "structures": structure_ops.catalog(),
        "structure_params": {
            "defaults": {"left": structure_ops.DEFAULT_LEFT, "right": structure_ops.DEFAULT_RIGHT},
            "min": structure_ops.SWING_PARAM_RANGE[0],
            "max": structure_ops.SWING_PARAM_RANGE[1],
            "note": "Swing точка се потвърждава след `right` свещи — затова структурата закъснява, но е без lookahead.",
        },
        "presets": PRESETS,
        "logic": LOGIC,
        "blocks": BLOCKS,
        "stop_types": STOP_TYPES,
        "take_profit_types": TAKE_PROFIT_TYPES,
        "regimes": REGIMES,
        "disclaimer": SETUP_DISCLAIMER,
    }
