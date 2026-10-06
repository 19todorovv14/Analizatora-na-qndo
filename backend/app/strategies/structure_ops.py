"""Strategy DSL v2 — "structure" operands: market structure (confirmed swings) and candle patterns.

Every series is 1.0 / 0.0 per bar (None while it cannot be known yet) and is computed WITHOUT lookahead:
the value at bar i depends only on bars 0..i (swing pivots count only once they are confirmed, i.e. `right`
bars after the pivot). Use them with the operators `is_true` / `is_false`, or compare them with numbers.
"""

from __future__ import annotations

from app.analysis.candles import patterns
from app.analysis.structure import SWING_STATE_KEYS, swing_state_series
from app.market.base import Candle

Series = list[float | None]

DEFAULT_LEFT = 3
DEFAULT_RIGHT = 3
SWING_PARAM_RANGE = (1, 20)

PATTERN_KEYS = ("inside_bar", "bullish_engulfing", "bearish_engulfing", "hammer", "shooting_star")

# name → metadata exposed through /strategies/meta (the UI is built from it)
STRUCTURE_OPERANDS: dict[str, dict] = {
    "higher_high": {
        "label": "Higher High",
        "group": "structure",
        "bias": "long",
        "description": "Последният потвърден swing high е по-висок от предходния (HH).",
        "lesson": "higher-high",
    },
    "higher_low": {
        "label": "Higher Low",
        "group": "structure",
        "bias": "long",
        "description": "Последният потвърден swing low е по-висок от предходния (HL).",
        "lesson": "higher-low",
    },
    "lower_high": {
        "label": "Lower High",
        "group": "structure",
        "bias": "short",
        "description": "Последният потвърден swing high не е над предходния (LH).",
        "lesson": "lower-high",
    },
    "lower_low": {
        "label": "Lower Low",
        "group": "structure",
        "bias": "short",
        "description": "Последният потвърден swing low не е над предходния (LL).",
        "lesson": "lower-low",
    },
    "uptrend": {
        "label": "Uptrend (HH + HL)",
        "group": "structure",
        "bias": "long",
        "description": "Последните swing точки са Higher High и Higher Low — бича структура.",
        "lesson": "trend",
    },
    "downtrend": {
        "label": "Downtrend (LH + LL)",
        "group": "structure",
        "bias": "short",
        "description": "Последните swing точки са Lower High и Lower Low — меча структура.",
        "lesson": "trend",
    },
    "break_above_swing_high": {
        "label": "Break above swing high",
        "group": "structure",
        "bias": "long",
        "description": "Close пробива над последния потвърден swing high на тази свещ (свещта на пробива).",
        "lesson": "breakout",
    },
    "break_below_swing_low": {
        "label": "Break below swing low",
        "group": "structure",
        "bias": "short",
        "description": "Close пробива под последния потвърден swing low на тази свещ (свещта на пробива).",
        "lesson": "breakout",
    },
    "inside_bar": {
        "label": "Inside bar",
        "group": "candle_pattern",
        "bias": "neutral",
        "description": "Цялата свещ (high и low) е в диапазона на предходната — пауза / компресия.",
        "lesson": "consolidation",
    },
    "bullish_engulfing": {
        "label": "Bullish engulfing",
        "group": "candle_pattern",
        "bias": "long",
        "description": "Бичето тяло 'поглъща' тялото на предходната мечя свещ.",
        "lesson": "engulfing",
    },
    "bearish_engulfing": {
        "label": "Bearish engulfing",
        "group": "candle_pattern",
        "bias": "short",
        "description": "Мечото тяло 'поглъща' тялото на предходната бича свещ.",
        "lesson": "engulfing",
    },
    "hammer": {
        "label": "Hammer",
        "group": "candle_pattern",
        "bias": "long",
        "description": "Дълъг долен wick (≥ 2× тялото) и малък горен — купувачите върнаха цената нагоре.",
        "lesson": "hammer",
    },
    "shooting_star": {
        "label": "Shooting star",
        "group": "candle_pattern",
        "bias": "short",
        "description": "Дълъг горен wick (≥ 2× тялото) и малък долен — купувачите бяха отхвърлени.",
        "lesson": "shooting-star",
    },
}
STRUCTURE_NAMES = tuple(STRUCTURE_OPERANDS)
assert set(STRUCTURE_NAMES) == set(SWING_STATE_KEYS) | set(PATTERN_KEYS)


def uses_swings(name: str) -> bool:
    return name in SWING_STATE_KEYS


def default_params(name: str) -> dict[str, int]:
    return {"left": DEFAULT_LEFT, "right": DEFAULT_RIGHT} if uses_swings(name) else {}


def validate_params(name: str, params: dict[str, float]) -> None:
    """Raises ValueError for an unknown structure name or invalid params."""
    if name not in STRUCTURE_OPERANDS:
        raise ValueError(f"Unknown structure operand '{name}'. Allowed: {', '.join(STRUCTURE_NAMES)}")
    allowed = set(default_params(name))
    extra = set(params) - allowed
    if extra:
        if not allowed:
            raise ValueError(f"Candle pattern '{name}' takes no parameters")
        raise ValueError(f"Structure operand '{name}' accepts only the params left/right")
    lo, hi = SWING_PARAM_RANGE
    for k, v in params.items():
        if v != int(v) or not lo <= v <= hi:
            raise ValueError(f"{k} must be a whole number between {lo} and {hi}")


def swing_params(params: dict[str, float]) -> tuple[int, int]:
    return int(params.get("left", DEFAULT_LEFT)), int(params.get("right", DEFAULT_RIGHT))


def label(name: str, params: dict[str, float]) -> str:
    base = STRUCTURE_OPERANDS[name]["label"]
    if uses_swings(name):
        left, right = swing_params(params)
        if (left, right) != (DEFAULT_LEFT, DEFAULT_RIGHT):
            base += f" ({left}/{right})"
    return base


def pattern_series(candles: list[Candle]) -> dict[str, Series]:
    """Candle-pattern flags per bar (the two-candle patterns need the previous bar → None at bar 0)."""
    n = len(candles)
    out: dict[str, Series] = {k: [None] * n for k in PATTERN_KEYS}
    for i, c in enumerate(candles):
        prev = candles[i - 1] if i > 0 else None
        found = set(patterns(c, prev))
        out["hammer"][i] = 1.0 if "hammer" in found else 0.0
        out["shooting_star"][i] = 1.0 if "shooting_star" in found else 0.0
        if prev is not None:
            out["bullish_engulfing"][i] = 1.0 if "bullish_engulfing" in found else 0.0
            out["bearish_engulfing"][i] = 1.0 if "bearish_engulfing" in found else 0.0
            inside = c.high <= prev.high and c.low >= prev.low and (c.high - c.low) < (prev.high - prev.low)
            out["inside_bar"][i] = 1.0 if inside else 0.0
    return out


def compute(candles: list[Candle], name: str, params: dict[str, float] | None = None) -> dict[str, Series]:
    """All flags of the family `name` belongs to: swing flags for (left, right), or all candle patterns."""
    if uses_swings(name):
        left, right = swing_params(params or {})
        return swing_state_series(candles, left, right)
    return pattern_series(candles)


def catalog() -> list[dict]:
    return [
        {
            "name": name,
            "label": meta["label"],
            "group": meta["group"],
            "bias": meta["bias"],
            "description": meta["description"],
            "lesson": meta["lesson"],
            "params": default_params(name),
        }
        for name, meta in STRUCTURE_OPERANDS.items()
    ]
