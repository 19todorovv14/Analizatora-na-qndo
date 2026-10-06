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

TEMPLATES_BY_KEY = {t["key"]: t for t in TEMPLATES}
