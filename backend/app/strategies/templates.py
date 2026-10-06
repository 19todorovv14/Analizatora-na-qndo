"""Educational strategy templates. None of them is presented as profitable — they are
starting points to learn how rules, stops, targets and validation interact."""

from __future__ import annotations


def _ind(name: str, output: str = "value", scale: float = 1.0, shift: int = 0, **params) -> dict:
    """`scale` multiplies the operand (e.g. 1.5 × average volume); `params` go to the indicator."""
    return {"kind": "indicator", "name": name, "params": params, "output": output, "mult": scale, "shift": shift}


def _price(field: str) -> dict:
    return {"kind": "price", "field": field}


def _val(v: float) -> dict:
    return {"kind": "value", "value": v}


def _struct(name: str, **params) -> dict:
    """DSL v2 structure / candle-pattern operand (1/0 per bar, no lookahead)."""
    return {"kind": "structure", "name": name, "params": params}


def _is(name: str, *, true: bool = True, **params) -> dict:
    """Condition "<structure> is true/false" (no right operand needed)."""
    return {"left": _struct(name, **params), "op": "is_true" if true else "is_false"}


TEMPLATES: list[dict] = [
    {
        "key": "rsi_ema200_volume",
        "name": "RSI < 30 + EMA 200 + Volume (пример от спецификацията)",
        "description": "Търси силно 'преразпродаден' момент (RSI < 30) САМО когато дългосрочният тренд е нагоре "
        "(цена > EMA 200) и обемът е над средния. Сигналите са редки — чудесен пример защо "
        "sample size е важен.",
        "timeframe": "1h",
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {"left": _ind("rsi", period=14), "op": "<", "right": _val(30)},
                    {"left": _price("close"), "op": ">", "right": _ind("ema", period=200)},
                    {"left": _price("volume"), "op": ">", "right": _ind("volume_sma", period=20)},
                ],
            },
            "stop": {"type": "atr", "value": 2, "atr_period": 14},
            "take_profit": {"type": "r_multiple", "value": 2},
            "risk_per_trade_pct": 1,
        },
    },
    {
        "key": "ema_cross_trend",
        "name": "EMA 20/50 crossover с филтър EMA 200",
        "description": "Trend-following: LONG при пресичане на EMA 20 над EMA 50, само над EMA 200; SHORT обратно. "
        "Губи в range пазари (whipsaw) — виж разбивката по market regime в backtest-а.",
        "timeframe": "4h",
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {"left": _ind("ema", period=20), "op": "crosses_above", "right": _ind("ema", period=50)},
                    {"left": _price("close"), "op": ">", "right": _ind("ema", period=200)},
                ],
            },
            "entry_short": {
                "logic": "all",
                "conditions": [
                    {"left": _ind("ema", period=20), "op": "crosses_below", "right": _ind("ema", period=50)},
                    {"left": _price("close"), "op": "<", "right": _ind("ema", period=200)},
                ],
            },
            "stop": {"type": "atr", "value": 2, "atr_period": 14},
            "take_profit": {"type": "r_multiple", "value": 2.5},
            "risk_per_trade_pct": 1,
        },
    },
    {
        "key": "bb_mean_reversion",
        "name": "Bollinger mean reversion (само в range)",
        "description": "Купува връщане над долната лента и продава връщане под горната, когато ADX показва слаб тренд. "
        "Работи в range и страда в силен тренд.",
        "timeframe": "1h",
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {"left": _price("close"), "op": "crosses_above", "right": _ind("bb", "lower", period=20, mult=2)},
                    {"left": _ind("adx", period=14), "op": "<", "right": _val(20)},
                ],
            },
            "entry_short": {
                "logic": "all",
                "conditions": [
                    {"left": _price("close"), "op": "crosses_below", "right": _ind("bb", "upper", period=20, mult=2)},
                    {"left": _ind("adx", period=14), "op": "<", "right": _val(20)},
                ],
            },
            "exit_long": {
                "logic": "any",
                "conditions": [
                    {"left": _price("close"), "op": ">", "right": _ind("bb", "middle", period=20, mult=2)},
                ],
            },
            "exit_short": {
                "logic": "any",
                "conditions": [
                    {"left": _price("close"), "op": "<", "right": _ind("bb", "middle", period=20, mult=2)},
                ],
            },
            "stop": {"type": "atr", "value": 1.5, "atr_period": 14},
            "take_profit": {"type": "r_multiple", "value": 1.5},
            "risk_per_trade_pct": 0.5,
        },
    },
    {
        "key": "breakout_volume",
        "name": "Breakout на 20-свещен максимум с обем",
        "description": "LONG когато close пробие най-високата цена от последните 20 свещи при обем ≥ 1.5× среден. "
        "Показва проблема с fakeouts — много малки загуби, редки големи печалби.",
        "timeframe": "1h",
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {"left": _price("close"), "op": ">", "right": _ind("highest", period=20)},
                    {"left": _price("volume"), "op": ">", "right": _ind("volume_sma", scale=1.5, period=20)},
                ],
            },
            "entry_short": {
                "logic": "all",
                "conditions": [
                    {"left": _price("close"), "op": "<", "right": _ind("lowest", period=20)},
                    {"left": _price("volume"), "op": ">", "right": _ind("volume_sma", scale=1.5, period=20)},
                ],
            },
            "stop": {"type": "atr", "value": 1.5, "atr_period": 14},
            "take_profit": {"type": "r_multiple", "value": 3},
            "risk_per_trade_pct": 1,
        },
    },
    {
        "key": "macd_momentum",
        "name": "MACD momentum над EMA 50",
        "description": "LONG при пресичане на MACD над signal линията, докато цената е над EMA 50. "
        "Пример за закъсняващ (lagging) индикатор.",
        "timeframe": "1h",
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {
                        "left": _ind("macd", "macd", fast=12, slow=26, signal=9),
                        "op": "crosses_above",
                        "right": _ind("macd", "signal", fast=12, slow=26, signal=9),
                    },
                    {"left": _price("close"), "op": ">", "right": _ind("ema", period=50)},
                ],
            },
            "exit_long": {
                "logic": "any",
                "conditions": [
                    {
                        "left": _ind("macd", "macd", fast=12, slow=26, signal=9),
                        "op": "crosses_below",
                        "right": _ind("macd", "signal", fast=12, slow=26, signal=9),
                    },
                ],
            },
            "stop": {"type": "atr", "value": 2, "atr_period": 14},
            "take_profit": {"type": "r_multiple", "value": 2},
            "risk_per_trade_pct": 1,
        },
    },
]

# Appended (never inserted): code and tests refer to the first templates by position.
TEMPLATES.append(
    {
        "key": "trend_momentum_structure",
        "name": "Trend + momentum + structure (EMA200, RSI>50, Higher High, Volume>Avg, ATR×2 stop, 2R target)",
        "description": "АКО Price > EMA 200 И RSI > 50 И Higher High И Volume > Average, ТОГАВА Potential LONG Setup; "
        "STOP ATR × 2; TARGET 2R. Комбинира тренд (EMA 200), momentum (RSI), пазарна структура (потвърден "
        "Higher High) и участие (обем над средния). Пример как всяко добавено условие намалява броя сигнали — "
        "провери sample size и overfitting риска в backtest-а.",
        "timeframe": "1h",
        "tags": ["trend", "momentum", "structure", "volume", "v2"],
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {"left": _price("close"), "op": ">", "right": _ind("ema", period=200)},
                    {"left": _ind("rsi", period=14), "op": ">", "right": _val(50)},
                    _is("higher_high"),
                    {"left": _price("volume"), "op": ">", "right": _ind("volume_sma", period=20)},
                ],
            },
            "stop": {"type": "atr", "value": 2, "atr_period": 14},
            "take_profit": {"type": "r_multiple", "value": 2},
            "risk_per_trade_pct": 1,
        },
    }
)

TEMPLATES_BY_KEY = {t["key"]: t for t in TEMPLATES}


def _preset(key: str, label: str, group: str, side: str, condition: dict) -> dict:
    return {"key": key, "label": label, "group": group, "side": side, "condition": condition}


# Ready-made conditions for the builder's presets row (each `condition` is a valid DSL condition).
PRESETS: list[dict] = [
    _preset(
        "price_above_ema200",
        "Price > EMA 200",
        "trend",
        "long",
        {"left": _price("close"), "op": ">", "right": _ind("ema", period=200)},
    ),
    _preset(
        "price_below_ema200",
        "Price < EMA 200",
        "trend",
        "short",
        {"left": _price("close"), "op": "<", "right": _ind("ema", period=200)},
    ),
    _preset(
        "ema20_cross_up_ema50",
        "EMA 20 crosses above EMA 50",
        "trend",
        "long",
        {"left": _ind("ema", period=20), "op": "crosses_above", "right": _ind("ema", period=50)},
    ),
    _preset(
        "ema20_cross_down_ema50",
        "EMA 20 crosses below EMA 50",
        "trend",
        "short",
        {"left": _ind("ema", period=20), "op": "crosses_below", "right": _ind("ema", period=50)},
    ),
    _preset(
        "adx_above_25",
        "ADX > 25 (има тренд)",
        "trend",
        "both",
        {"left": _ind("adx", period=14), "op": ">", "right": _val(25)},
    ),
    _preset(
        "rsi_above_50", "RSI > 50", "momentum", "long", {"left": _ind("rsi", period=14), "op": ">", "right": _val(50)}
    ),
    _preset(
        "rsi_below_50", "RSI < 50", "momentum", "short", {"left": _ind("rsi", period=14), "op": "<", "right": _val(50)}
    ),
    _preset(
        "rsi_below_30",
        "RSI < 30 (oversold)",
        "momentum",
        "long",
        {"left": _ind("rsi", period=14), "op": "<", "right": _val(30)},
    ),
    _preset(
        "rsi_above_70",
        "RSI > 70 (overbought)",
        "momentum",
        "short",
        {"left": _ind("rsi", period=14), "op": ">", "right": _val(70)},
    ),
    _preset(
        "macd_cross_up",
        "MACD crosses above signal",
        "momentum",
        "long",
        {
            "left": _ind("macd", "macd", fast=12, slow=26, signal=9),
            "op": "crosses_above",
            "right": _ind("macd", "signal", fast=12, slow=26, signal=9),
        },
    ),
    _preset(
        "macd_cross_down",
        "MACD crosses below signal",
        "momentum",
        "short",
        {
            "left": _ind("macd", "macd", fast=12, slow=26, signal=9),
            "op": "crosses_below",
            "right": _ind("macd", "signal", fast=12, slow=26, signal=9),
        },
    ),
    _preset("higher_high", "Higher High", "structure", "long", _is("higher_high")),
    _preset("higher_low", "Higher Low", "structure", "long", _is("higher_low")),
    _preset("lower_high", "Lower High", "structure", "short", _is("lower_high")),
    _preset("lower_low", "Lower Low", "structure", "short", _is("lower_low")),
    _preset("uptrend_structure", "Uptrend (HH + HL)", "structure", "long", _is("uptrend")),
    _preset("downtrend_structure", "Downtrend (LH + LL)", "structure", "short", _is("downtrend")),
    _preset("break_above_swing_high", "Break above swing high", "structure", "long", _is("break_above_swing_high")),
    _preset("break_below_swing_low", "Break below swing low", "structure", "short", _is("break_below_swing_low")),
    _preset(
        "volume_above_average",
        "Volume > Average",
        "volume",
        "both",
        {"left": _price("volume"), "op": ">", "right": _ind("volume_sma", period=20)},
    ),
    _preset(
        "volume_spike",
        "Volume > 1.5× Average",
        "volume",
        "both",
        {"left": _price("volume"), "op": ">", "right": _ind("volume_sma", scale=1.5, period=20)},
    ),
    _preset("bullish_engulfing", "Bullish engulfing", "candle_pattern", "long", _is("bullish_engulfing")),
    _preset("bearish_engulfing", "Bearish engulfing", "candle_pattern", "short", _is("bearish_engulfing")),
    _preset("hammer", "Hammer", "candle_pattern", "long", _is("hammer")),
    _preset("shooting_star", "Shooting star", "candle_pattern", "short", _is("shooting_star")),
    _preset("inside_bar", "Inside bar", "candle_pattern", "both", _is("inside_bar")),
]
PRESETS_BY_KEY = {p["key"]: p for p in PRESETS}
