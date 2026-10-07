"""Indicators for the replay chart, computed WITHOUT lookahead.

The series are computed on closed candles that end at the cursor (with extra warm-up history before the visible
window) and only the values of the visible candles are returned — appending future candles can never change them.
Spec format and response keys match GET /api/market/candles ('ema:20,rsi:14,bb' → ema_20, rsi_14, bb).
"""

from __future__ import annotations

from collections.abc import Sequence

from app import indicators as ind
from app.market.base import Candle

MAX_INDICATORS = 12
WARMUP_BARS = 250


class IndicatorSpecError(ValueError):
    pass


def parse(spec: str | None) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    if not spec:
        return out
    for part in spec.split(","):
        bits = [b for b in part.strip().split(":") if b]
        if not bits:
            continue
        name = bits[0].lower()
        if name not in ind.INDICATOR_CATALOG:
            raise IndicatorSpecError(f"Unknown indicator '{name}'")
        keys = list(ind.INDICATOR_CATALOG[name]["params"].keys())
        params: dict[str, float] = {}
        for k, v in zip(keys, bits[1:], strict=False):
            try:
                params[k] = float(v)
            except ValueError as exc:
                raise IndicatorSpecError(f"Bad indicator parameter '{v}'") from exc
            if not (0 < params[k] <= 500):
                raise IndicatorSpecError(f"Indicator parameter out of range: '{v}'")
        out.append((name, params))
        if len(out) > MAX_INDICATORS:
            raise IndicatorSpecError("Too many indicators")
    return out


def compute(parsed: list[tuple[str, dict]], candles: Sequence[Candle], visible_from: int) -> dict:
    """`candles` end at the cursor; only points with time ≥ `visible_from` are returned."""
    rows = list(candles)
    times = [c.ts for c in rows]
    out: dict = {}
    for name, params in parsed:
        series = ind.compute(name, rows, params)
        key = name + "_" + "_".join(f"{v:g}" for v in params.values()) if params else name
        out[key] = {
            "name": name,
            "params": params,
            "pane": ind.INDICATOR_CATALOG[name]["pane"],
            "series": {
                o: [{"time": t, "value": v} for t, v in zip(times, vals, strict=True) if v is not None and t >= visible_from]
                for o, vals in series.items()
            },
        }
    return out
