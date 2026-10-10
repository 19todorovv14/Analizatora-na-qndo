"""Technical indicators.

All functions take plain lists and return lists of the same length; values that are
not yet defined (warm-up period) are `None`. Indicators describe the past — none of
them is a buy/sell signal on its own.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, datetime

from app.market.base import Candle

Series = list[float | None]


def sma(values: Sequence[float], period: int) -> Series:
    out: Series = [None] * len(values)
    if period <= 0:
        return out
    acc = 0.0
    for i, v in enumerate(values):
        acc += v
        if i >= period:
            acc -= values[i - period]
        if i >= period - 1:
            out[i] = acc / period
    return out


def ema(values: Sequence[float], period: int) -> Series:
    """Exponential moving average, seeded with the SMA of the first `period` values."""
    out: Series = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    k = 2 / (period + 1)
    prev = sum(values[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def _ema_optional(values: Series, period: int) -> Series:
    """EMA over a series that starts with None values."""
    first = next((i for i, v in enumerate(values) if v is not None), None)
    out: Series = [None] * len(values)
    if first is None:
        return out
    tail = ema([v for v in values[first:]], period)  # type: ignore[misc]
    out[first:] = tail
    return out


def rsi(closes: Sequence[float], period: int = 14) -> Series:
    """Wilder's RSI (0-100)."""
    out: Series = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        ch = closes[i] - closes[i - 1]
        gains += max(ch, 0.0)
        losses += max(-ch, 0.0)
    avg_g, avg_l = gains / period, losses / period

    def _val(g: float, l: float) -> float:  # noqa: E741
        if l == 0:
            return 100.0 if g > 0 else 50.0
        return 100 - 100 / (1 + g / l)

    out[period] = _val(avg_g, avg_l)
    for i in range(period + 1, len(closes)):
        ch = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + max(ch, 0.0)) / period
        avg_l = (avg_l * (period - 1) + max(-ch, 0.0)) / period
        out[i] = _val(avg_g, avg_l)
    return out


def macd(closes: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[Series, Series, Series]:
    ef, es = ema(closes, fast), ema(closes, slow)
    line: Series = [a - b if a is not None and b is not None else None for a, b in zip(ef, es, strict=True)]
    sig = _ema_optional(line, signal)
    hist: Series = [a - b if a is not None and b is not None else None for a, b in zip(line, sig, strict=True)]
    return line, sig, hist


def stdev(values: Sequence[float], period: int) -> Series:
    out: Series = [None] * len(values)
    for i in range(period - 1, len(values)):
        window = values[i - period + 1 : i + 1]
        m = sum(window) / period
        out[i] = math.sqrt(sum((x - m) ** 2 for x in window) / period)
    return out


def bollinger(closes: Sequence[float], period: int = 20, mult: float = 2.0) -> tuple[Series, Series, Series]:
    mid = sma(closes, period)
    sd = stdev(closes, period)
    upper: Series = [m + mult * s if m is not None and s is not None else None for m, s in zip(mid, sd, strict=True)]
    lower: Series = [m - mult * s if m is not None and s is not None else None for m, s in zip(mid, sd, strict=True)]
    return upper, mid, lower


def true_range(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float]) -> list[float]:
    tr = []
    for i in range(len(closes)):
        if i == 0:
            tr.append(highs[0] - lows[0])
        else:
            pc = closes[i - 1]
            tr.append(max(highs[i] - lows[i], abs(highs[i] - pc), abs(lows[i] - pc)))
    return tr


def atr(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], period: int = 14) -> Series:
    """Wilder's Average True Range."""
    tr = true_range(highs, lows, closes)
    out: Series = [None] * len(tr)
    if len(tr) < period:
        return out
    prev = sum(tr[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(tr)):
        prev = (prev * (period - 1) + tr[i]) / period
        out[i] = prev
    return out


def adx(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], period: int = 14) -> Series:
    """Average Directional Index — trend *strength* (not direction)."""
    n = len(closes)
    out: Series = [None] * n
    if n < period * 2 + 1:
        return out
    tr = true_range(highs, lows, closes)
    pdm = [0.0] * n
    mdm = [0.0] * n
    for i in range(1, n):
        up, down = highs[i] - highs[i - 1], lows[i - 1] - lows[i]
        pdm[i] = up if up > down and up > 0 else 0.0
        mdm[i] = down if down > up and down > 0 else 0.0
    atr_s = sum(tr[1 : period + 1])
    p_s = sum(pdm[1 : period + 1])
    m_s = sum(mdm[1 : period + 1])
    dxs: list[float] = []
    for i in range(period + 1, n):
        atr_s = atr_s - atr_s / period + tr[i]
        p_s = p_s - p_s / period + pdm[i]
        m_s = m_s - m_s / period + mdm[i]
        pdi = 100 * p_s / atr_s if atr_s else 0.0
        mdi = 100 * m_s / atr_s if atr_s else 0.0
        dx = 100 * abs(pdi - mdi) / (pdi + mdi) if (pdi + mdi) else 0.0
        dxs.append(dx)
        if len(dxs) == period:
            out[i] = sum(dxs) / period
        elif len(dxs) > period:
            out[i] = (out[i - 1] * (period - 1) + dx) / period  # type: ignore[operator]
    return out


def vwap(candles: Sequence[Candle], anchor: str = "auto") -> Series:
    """Volume-weighted average price, reset every UTC day (or week for >=1d data).

    anchor "auto" (default) picks "week" when the bars are a day or longer apart — before W4a the daily reset was
    always used, so on 1d charts every bar was its own session and "VWAP" was just the bar's typical price."""
    if anchor == "auto":
        anchor = "week" if len(candles) >= 2 and candles[1].ts - candles[0].ts >= 86_400 else "day"
    out: Series = []
    pv = vol = 0.0
    current = None
    for c in candles:
        dt = datetime.fromtimestamp(c.ts, UTC)
        key = dt.date() if anchor == "day" else dt.isocalendar()[:2]
        if key != current:
            current, pv, vol = key, 0.0, 0.0
        typical = (c.high + c.low + c.close) / 3
        pv += typical * c.volume
        vol += c.volume
        out.append(pv / vol if vol else typical)
    return out


def highest(values: Sequence[float], period: int) -> Series:
    """Highest value of the PREVIOUS `period` bars (excludes the current bar → no lookahead)."""
    out: Series = [None] * len(values)
    for i in range(period, len(values)):
        out[i] = max(values[i - period : i])
    return out


def lowest(values: Sequence[float], period: int) -> Series:
    """Lowest value of the PREVIOUS `period` bars."""
    out: Series = [None] * len(values)
    for i in range(period, len(values)):
        out[i] = min(values[i - period : i])
    return out


def last(series: Series) -> float | None:
    for v in reversed(series):
        if v is not None:
            return v
    return None


def percentile_rank(series: Series, value: float, lookback: int = 200) -> float | None:
    window = [v for v in series[-lookback:] if v is not None]
    if not window:
        return None
    return sum(1 for v in window if v <= value) / len(window) * 100


# ---------------------------------------------------------------------- dispatch
INDICATOR_CATALOG = {
    "sma": {"params": {"period": 20}, "pane": "price", "outputs": ["value"]},
    "ema": {"params": {"period": 20}, "pane": "price", "outputs": ["value"]},
    "bb": {"params": {"period": 20, "mult": 2.0}, "pane": "price", "outputs": ["upper", "middle", "lower"]},
    "vwap": {"params": {}, "pane": "price", "outputs": ["value"]},
    "rsi": {"params": {"period": 14}, "pane": "separate", "outputs": ["value"]},
    "macd": {
        "params": {"fast": 12, "slow": 26, "signal": 9},
        "pane": "separate",
        "outputs": ["macd", "signal", "hist"],
    },
    "atr": {"params": {"period": 14}, "pane": "separate", "outputs": ["value"]},
    "volume_sma": {"params": {"period": 20}, "pane": "volume", "outputs": ["value"]},
    "adx": {"params": {"period": 14}, "pane": "separate", "outputs": ["value"]},
    "highest": {"params": {"period": 20}, "pane": "price", "outputs": ["value"]},
    "lowest": {"params": {"period": 20}, "pane": "price", "outputs": ["value"]},
}


def compute(name: str, candles: Sequence[Candle], params: dict | None = None) -> dict[str, Series]:
    """Compute an indicator by name. Returns {output_name: series}."""
    if name not in INDICATOR_CATALOG:
        raise ValueError(f"Unknown indicator '{name}'")
    p = {**INDICATOR_CATALOG[name]["params"], **(params or {})}
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    if name == "sma":
        return {"value": sma(closes, int(p["period"]))}
    if name == "ema":
        return {"value": ema(closes, int(p["period"]))}
    if name == "bb":
        u, m, lo = bollinger(closes, int(p["period"]), float(p["mult"]))
        return {"upper": u, "middle": m, "lower": lo}
    if name == "vwap":
        return {"value": vwap(candles)}
    if name == "rsi":
        return {"value": rsi(closes, int(p["period"]))}
    if name == "macd":
        line, sig, hist = macd(closes, int(p["fast"]), int(p["slow"]), int(p["signal"]))
        return {"macd": line, "signal": sig, "hist": hist}
    if name == "atr":
        return {"value": atr(highs, lows, closes, int(p["period"]))}
    if name == "volume_sma":
        return {"value": sma([c.volume for c in candles], int(p["period"]))}
    if name == "highest":
        return {"value": highest(highs, int(p["period"]))}
    if name == "lowest":
        return {"value": lowest(lows, int(p["period"]))}
    return {"value": adx(highs, lows, closes, int(p["period"]))}
