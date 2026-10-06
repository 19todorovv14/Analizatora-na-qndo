"""Market regime classification: TRENDING_UP, TRENDING_DOWN, RANGING, HIGH_VOLATILITY,
LOW_VOLATILITY, UNCLEAR — always with the reasons that led to the label."""

from __future__ import annotations

from dataclasses import dataclass

from app import indicators as ind
from app.market.base import Candle

REGIMES = ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCLEAR"]


@dataclass
class RegimeInputs:
    closes: list[float]
    ema_fast: ind.Series  # EMA 50
    ema_slow: ind.Series  # EMA 200 (or 100 for short histories)
    adx: ind.Series
    atr: ind.Series
    atr_pct: ind.Series

    @classmethod
    def from_candles(cls, candles: list[Candle]) -> RegimeInputs:
        closes = [c.close for c in candles]
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        slow = 200 if len(candles) >= 260 else 100
        atr = ind.atr(highs, lows, closes, 14)
        return cls(
            closes=closes,
            ema_fast=ind.ema(closes, 50),
            ema_slow=ind.ema(closes, slow),
            adx=ind.adx(highs, lows, closes, 14),
            atr=atr,
            atr_pct=[a / c * 100 if a is not None and c else None for a, c in zip(atr, closes, strict=True)],
        )


def classify_at(x: RegimeInputs, i: int, lookback: int = 200) -> dict:
    close = x.closes[i]
    ef, es, adx, atrp = x.ema_fast[i], x.ema_slow[i], x.adx[i], x.atr_pct[i]
    if ef is None or es is None or adx is None or atrp is None or i < 10 or x.ema_fast[i - 10] is None:
        return {"regime": "UNCLEAR", "reasons": ["Недостатъчно история за надеждна класификация."], "metrics": {}}
    window = [v for v in x.atr_pct[max(0, i - lookback) : i + 1] if v is not None]
    rank = sum(1 for v in window if v <= atrp) / len(window) * 100 if window else 50.0
    atr_now = x.atr[i] or 0.0
    slope = (ef - x.ema_fast[i - 10]) / atr_now if atr_now else 0.0  # EMA50 change over 10 bars in ATRs
    metrics = {
        "adx": round(adx, 1),
        "atr_pct": round(atrp, 3),
        "atr_rank": round(rank, 0),
        "ema50_slope_atr": round(slope, 2),
        "close_vs_ema50": "above" if close > ef else "below",
        "ema50_vs_ema_slow": "above" if ef > es else "below",
    }
    reasons: list[str] = []
    if rank >= 90:
        reasons.append(
            f"ATR е в топ {100 - rank:.0f}% от последните {len(window)} свещи — волатилността е много висока."
        )
        direction = "нагоре" if close > ef > es else "надолу" if close < ef < es else "без ясна посока"
        reasons.append(f"Посоката под волатилността е {direction}.")
        return {"regime": "HIGH_VOLATILITY", "reasons": reasons, "metrics": metrics}
    if rank <= 10:
        reasons.append(f"ATR е в най-ниските {rank:.0f}% — пазарът е необичайно тих (често преди силно движение).")
        return {"regime": "LOW_VOLATILITY", "reasons": reasons, "metrics": metrics}
    if adx >= 22 and close > ef > es and slope > 0.3:
        reasons += [
            f"ADX {adx:.0f} ≥ 22 → има тренд.",
            "Цената е над EMA 50, а EMA 50 е над бавната EMA → подредени нагоре.",
            f"EMA 50 расте ({slope:+.1f} ATR за 10 свещи).",
        ]
        return {"regime": "TRENDING_UP", "reasons": reasons, "metrics": metrics}
    if adx >= 22 and close < ef < es and slope < -0.3:
        reasons += [
            f"ADX {adx:.0f} ≥ 22 → има тренд.",
            "Цената е под EMA 50, а EMA 50 е под бавната EMA → подредени надолу.",
            f"EMA 50 пада ({slope:+.1f} ATR за 10 свещи).",
        ]
        return {"regime": "TRENDING_DOWN", "reasons": reasons, "metrics": metrics}
    if adx < 20 and abs(slope) < 0.6:
        reasons += [f"ADX {adx:.0f} < 20 → слаб тренд.", "EMA 50 е почти хоризонтална — цената се движи в диапазон."]
        return {"regime": "RANGING", "reasons": reasons, "metrics": metrics}
    reasons.append(
        f"Сигналите не съвпадат (ADX {adx:.0f}, наклон {slope:+.1f} ATR, цена {'над' if close > ef else 'под'} EMA 50)."
    )
    return {"regime": "UNCLEAR", "reasons": reasons, "metrics": metrics}


def classify(candles: list[Candle]) -> dict:
    x = RegimeInputs.from_candles(candles)
    return classify_at(x, len(candles) - 1)


def regime_series(candles: list[Candle], step: int = 1) -> list[str]:
    x = RegimeInputs.from_candles(candles)
    out: list[str] = []
    last = "UNCLEAR"
    for i in range(len(candles)):
        if i % step == 0:
            last = classify_at(x, i)["regime"]
        out.append(last)
    return out
