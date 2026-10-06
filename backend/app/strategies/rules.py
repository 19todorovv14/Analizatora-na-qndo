"""Visual Strategy Builder model + evaluator.

A strategy is pure data (JSON). Example — "RSI < 30 AND Price > EMA 200 AND Volume > average":

    {
      "entry_long": {"logic": "all", "conditions": [
        {"left": {"kind": "indicator", "name": "rsi", "params": {"period": 14}}, "op": "<",
         "right": {"kind": "value", "value": 30}},
        {"left": {"kind": "price", "field": "close"}, "op": ">",
         "right": {"kind": "indicator", "name": "ema", "params": {"period": 200}}},
        {"left": {"kind": "price", "field": "volume"}, "op": ">",
         "right": {"kind": "indicator", "name": "volume_sma", "params": {"period": 20}}}
      ]},
      "stop": {"type": "atr", "value": 2},
      "take_profit": {"type": "r_multiple", "value": 2}
    }

Evaluating a strategy only produces a *setup*; it never places a real order.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app import indicators as ind
from app.market.base import Candle

PRICE_FIELDS = ("open", "high", "low", "close", "volume")
OPS = ("<", ">", "<=", ">=", "crosses_above", "crosses_below")


class Operand(BaseModel):
    kind: Literal["indicator", "price", "value"]
    name: str | None = None  # indicator name
    params: dict[str, float] = Field(default_factory=dict)
    output: str = "value"
    field: str | None = None  # price field
    value: float | None = None
    shift: int = Field(0, ge=0, le=50)  # bars back
    mult: float = Field(1.0, gt=0, le=100)

    @model_validator(mode="after")
    def _check(self):
        if self.kind == "indicator":
            if self.name not in ind.INDICATOR_CATALOG:
                raise ValueError(f"Unknown indicator '{self.name}'")
            outputs = ind.INDICATOR_CATALOG[self.name]["outputs"]
            if self.output not in outputs:
                raise ValueError(f"Indicator '{self.name}' has outputs {outputs}")
            for k, v in self.params.items():
                if k in ("period", "fast", "slow", "signal") and not (1 <= v <= 500):
                    raise ValueError(f"{k} must be between 1 and 500")
        elif self.kind == "price":
            if self.field not in PRICE_FIELDS:
                raise ValueError(f"Price field must be one of {PRICE_FIELDS}")
        elif self.value is None:
            raise ValueError("Value operand needs a number")
        return self

    def label(self) -> str:
        if self.kind == "value":
            return f"{self.value:g}"
        if self.kind == "price":
            base = self.field.capitalize()
        else:
            p = ",".join(f"{v:g}" for v in self.params.values())
            base = f"{self.name.upper()}({p})" if p else self.name.upper()
            if self.output != "value":
                base += f".{self.output}"
        if self.mult != 1:
            base = f"{base}×{self.mult:g}"
        if self.shift:
            base += f"[{self.shift} назад]"
        return base


class Condition(BaseModel):
    left: Operand
    op: Literal["<", ">", "<=", ">=", "crosses_above", "crosses_below"]
    right: Operand

    def label(self) -> str:
        op = {"crosses_above": "пресича нагоре", "crosses_below": "пресича надолу"}.get(self.op, self.op)
        return f"{self.left.label()} {op} {self.right.label()}"


class Block(BaseModel):
    logic: Literal["all", "any"] = "all"
    conditions: list[Condition] = Field(default_factory=list, max_length=12)


class StopRule(BaseModel):
    type: Literal["atr", "percent", "swing"] = "atr"
    value: float = Field(2.0, gt=0, le=50)
    atr_period: int = Field(14, ge=2, le=200)
    lookback: int = Field(10, ge=2, le=200)  # for swing stops


class TakeProfitRule(BaseModel):
    type: Literal["r_multiple", "atr", "percent", "none"] = "r_multiple"
    value: float = Field(2.0, gt=0, le=50)


class StrategyDefinition(BaseModel):
    entry_long: Block | None = None
    entry_short: Block | None = None
    exit_long: Block | None = None
    exit_short: Block | None = None
    stop: StopRule = Field(default_factory=StopRule)
    take_profit: TakeProfitRule = Field(default_factory=TakeProfitRule)
    risk_per_trade_pct: float = Field(1.0, gt=0, le=100)
    regime_filter: list[str] = Field(default_factory=list)  # allowed regimes, empty = any

    @field_validator("entry_long", "entry_short", "exit_long", "exit_short")
    @classmethod
    def _empty_to_none(cls, v):
        if v is not None and not v.conditions:
            return None
        return v

    @model_validator(mode="after")
    def _needs_entry(self):
        if self.entry_long is None and self.entry_short is None:
            raise ValueError("Стратегията трябва да има поне едно правило за влизане (LONG или SHORT).")
        return self

    def blocks(self) -> dict[str, Block | None]:
        return {
            "entry_long": self.entry_long,
            "entry_short": self.entry_short,
            "exit_long": self.exit_long,
            "exit_short": self.exit_short,
        }

    def condition_count(self) -> int:
        return sum(len(b.conditions) for b in self.blocks().values() if b)

    def numeric_parameters(self) -> int:
        n = 2  # stop + target
        for b in self.blocks().values():
            if not b:
                continue
            for c in b.conditions:
                for o in (c.left, c.right):
                    n += len(o.params) + (1 if o.kind == "value" else 0)
        return n


class IndicatorCache:
    """Computes each indicator series once per candle list."""

    def __init__(self, candles: list[Candle]):
        self.candles = candles
        self._cache: dict[tuple, dict[str, ind.Series]] = {}
        self._price = {f: [getattr(c, f) for c in candles] for f in PRICE_FIELDS}

    def series(self, op: Operand) -> ind.Series:
        if op.kind == "price":
            return self._price[op.field]  # type: ignore[index]
        return self.indicator(op.name, op.params, op.output)  # type: ignore[arg-type]

    def indicator(self, name: str, params: dict, output: str = "value") -> ind.Series:
        key = (name, tuple(sorted(params.items())))
        if key not in self._cache:
            self._cache[key] = ind.compute(name, self.candles, params)
        return self._cache[key][output]

    def value(self, op: Operand, i: int) -> float | None:
        j = i - op.shift
        if j < 0:
            return None
        if op.kind == "value":
            return op.value
        v = self.series(op)[j]
        return None if v is None else v * op.mult


def _eval_condition(cond: Condition, cache: IndicatorCache, i: int) -> dict:
    lv, rv = cache.value(cond.left, i), cache.value(cond.right, i)
    ok = False
    if lv is not None and rv is not None:
        if cond.op in ("crosses_above", "crosses_below"):
            lp, rp = cache.value(cond.left, i - 1), cache.value(cond.right, i - 1)
            if lp is not None and rp is not None:
                ok = (lp <= rp and lv > rv) if cond.op == "crosses_above" else (lp >= rp and lv < rv)
        else:
            ok = {"<": lv < rv, ">": lv > rv, "<=": lv <= rv, ">=": lv >= rv}[cond.op]
    return {"label": cond.label(), "left": lv, "right": rv, "passed": ok}


def evaluate_block(block: Block | None, cache: IndicatorCache, i: int) -> dict:
    if block is None:
        return {"active": False, "passed": False, "conditions": [], "score": 0.0}
    results = [_eval_condition(c, cache, i) for c in block.conditions]
    passed_n = sum(r["passed"] for r in results)
    passed = passed_n == len(results) if block.logic == "all" else passed_n > 0
    return {
        "active": True,
        "logic": block.logic,
        "passed": passed and bool(results),
        "conditions": results,
        "score": passed_n / len(results) if results else 0.0,
    }


def evaluate(defn: StrategyDefinition, cache: IndicatorCache, i: int) -> dict:
    return {name: evaluate_block(block, cache, i) for name, block in defn.blocks().items()}


def stop_distance(defn: StrategyDefinition, cache: IndicatorCache, i: int, side: str) -> float | None:
    c = cache.candles[i]
    rule = defn.stop
    if rule.type == "percent":
        return c.close * rule.value / 100
    atr_v = cache.indicator("atr", {"period": rule.atr_period})[i] if rule.type == "atr" else None
    if rule.type == "atr":
        return atr_v * rule.value if atr_v else None
    # swing: beyond the lowest low / highest high of the lookback window, plus a small buffer
    window = cache.candles[max(0, i - rule.lookback + 1) : i + 1]
    buffer = c.close * rule.value / 1000  # value is used as buffer in 0.1% units
    if side == "buy":
        d = c.close - min(x.low for x in window) + buffer
    else:
        d = max(x.high for x in window) - c.close + buffer
    return d if d > 0 else None


def target_distance(defn: StrategyDefinition, cache: IndicatorCache, i: int, stop_dist: float) -> float | None:
    rule = defn.take_profit
    if rule.type == "none":
        return None
    if rule.type == "r_multiple":
        return stop_dist * rule.value
    if rule.type == "percent":
        return cache.candles[i].close * rule.value / 100
    atr_v = cache.indicator("atr", {"period": defn.stop.atr_period})[i]
    return atr_v * rule.value if atr_v else None


def describe(defn: StrategyDefinition) -> list[str]:
    lines = []
    names = {
        "entry_long": "LONG setup",
        "entry_short": "SHORT setup",
        "exit_long": "Изход от LONG",
        "exit_short": "Изход от SHORT",
    }
    for key, block in defn.blocks().items():
        if not block:
            continue
        joiner = " И " if block.logic == "all" else " ИЛИ "
        lines.append(f"{names[key]}: АКО " + joiner.join(c.label() for c in block.conditions))
    stop = defn.stop
    stop_txt = {
        "atr": f"ATR({stop.atr_period}) × {stop.value:g}",
        "percent": f"{stop.value:g}% от цената",
        "swing": f"зад swing low/high от последните {stop.lookback} свещи",
    }[stop.type]
    lines.append(f"STOP: {stop_txt}")
    tp = defn.take_profit
    tp_txt = {
        "r_multiple": f"Risk × {tp.value:g}",
        "atr": f"ATR × {tp.value:g}",
        "percent": f"{tp.value:g}%",
        "none": "без фиксирана цел",
    }[tp.type]
    lines.append(f"TAKE PROFIT: {tp_txt}")
    lines.append(f"Риск на сделка: {defn.risk_per_trade_pct:g}% от сметката")
    return lines
