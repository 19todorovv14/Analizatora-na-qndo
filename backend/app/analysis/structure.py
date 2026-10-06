"""Market structure: swing points, HH/HL/LH/LL labels and support/resistance levels."""

from __future__ import annotations

from dataclasses import dataclass

from app.market.base import Candle


@dataclass
class Swing:
    index: int
    ts: int
    price: float
    kind: str  # high | low
    label: str | None = None  # HH | LH | HL | LL

    def to_dict(self) -> dict:
        return {"index": self.index, "time": self.ts, "price": self.price, "kind": self.kind, "label": self.label}


def find_swings(candles: list[Candle], left: int = 3, right: int = 3) -> list[Swing]:
    """Confirmed pivot highs/lows (need `right` bars after the pivot → no lookahead in live use)."""
    swings: list[Swing] = []
    n = len(candles)
    for i in range(left, n - right):
        h = candles[i].high
        lo = candles[i].low
        win = candles[i - left : i + right + 1]
        if h == max(c.high for c in win) and all(c.high < h for c in candles[i + 1 : i + right + 1]):
            swings.append(Swing(i, candles[i].ts, h, "high"))
        if lo == min(c.low for c in win) and all(c.low > lo for c in candles[i + 1 : i + right + 1]):
            swings.append(Swing(i, candles[i].ts, lo, "low"))
    swings.sort(key=lambda s: (s.index, 0 if s.kind == "high" else 1))
    last_high = last_low = None
    for s in swings:
        if s.kind == "high":
            if last_high is not None:
                s.label = "HH" if s.price > last_high else "LH"
            last_high = s.price
        else:
            if last_low is not None:
                s.label = "HL" if s.price > last_low else "LL"
            last_low = s.price
    return swings


def structure_trend(swings: list[Swing]) -> dict:
    highs = [s for s in swings if s.kind == "high" and s.label]
    lows = [s for s in swings if s.kind == "low" and s.label]
    last_h = highs[-1].label if highs else None
    last_l = lows[-1].label if lows else None
    if last_h == "HH" and last_l == "HL":
        trend, text = "bullish", "Higher highs и higher lows — бичя структура (uptrend)."
    elif last_h == "LH" and last_l == "LL":
        trend, text = "bearish", "Lower highs и lower lows — меча структура (downtrend)."
    elif last_h is None or last_l is None:
        trend, text = "unknown", "Недостатъчно swing точки за оценка на структурата."
    else:
        trend, text = "mixed", f"Смесена структура ({last_h} + {last_l}) — често range или преход."
    return {"trend": trend, "last_high_label": last_h, "last_low_label": last_l, "text": text}


def levels(candles: list[Candle], swings: list[Swing], atr_value: float | None, lookback: int = 300) -> list[dict]:
    """Cluster swing prices into horizontal support/resistance zones."""
    if not candles:
        return []
    start = max(0, len(candles) - lookback)
    pts = sorted((s for s in swings if s.index >= start), key=lambda s: s.price)
    tol = (atr_value or (candles[-1].close * 0.005)) * 0.6
    clusters: list[list[Swing]] = []
    for s in pts:
        if clusters and abs(s.price - sum(x.price for x in clusters[-1]) / len(clusters[-1])) <= tol:
            clusters[-1].append(s)
        else:
            clusters.append([s])
    out = []
    for cl in clusters:
        price = sum(x.price for x in cl) / len(cl)
        out.append(
            {
                "price": price,
                "touches": len(cl),
                "last_index": max(x.index for x in cl),
                "last_time": max(x.ts for x in cl),
            }
        )
    return out


def nearest_levels(lvls: list[dict], price: float, n: int = 2) -> tuple[list[dict], list[dict]]:
    supports = sorted((lv for lv in lvls if lv["price"] < price), key=lambda lv: price - lv["price"])[:n]
    resistances = sorted((lv for lv in lvls if lv["price"] > price), key=lambda lv: lv["price"] - price)[:n]
    return supports, resistances
