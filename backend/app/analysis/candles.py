"""Candlestick anatomy and classic single/two-candle patterns."""

from __future__ import annotations

from dataclasses import dataclass

from app.market.base import Candle


def anatomy(c: Candle) -> dict:
    rng = c.high - c.low
    body = abs(c.close - c.open)
    upper = c.high - max(c.open, c.close)
    lower = min(c.open, c.close) - c.low
    direction = "bullish" if c.close > c.open else "bearish" if c.close < c.open else "neutral"
    return {
        "direction": direction,
        "range": rng,
        "body": body,
        "upper_wick": upper,
        "lower_wick": lower,
        "body_pct": body / rng * 100 if rng else 0.0,
        "upper_wick_pct": upper / rng * 100 if rng else 0.0,
        "lower_wick_pct": lower / rng * 100 if rng else 0.0,
    }


def patterns(c: Candle, prev: Candle | None = None, atr: float | None = None) -> list[str]:
    a = anatomy(c)
    out: list[str] = []
    if a["range"] == 0:
        return ["doji"]
    if a["body_pct"] <= 10:
        out.append("doji")
    if a["lower_wick"] >= 2 * a["body"] and a["upper_wick_pct"] <= 15 and a["body_pct"] > 5:
        out.append("hammer")
    if a["upper_wick"] >= 2 * a["body"] and a["lower_wick_pct"] <= 15 and a["body_pct"] > 5:
        out.append("shooting_star")
    if a["body_pct"] >= 90:
        out.append("marubozu")
    if prev is not None:
        pa = anatomy(prev)
        if (
            a["direction"] == "bullish"
            and pa["direction"] == "bearish"
            and c.close >= prev.open
            and c.open <= prev.close
            and a["body"] > pa["body"]
        ):
            out.append("bullish_engulfing")
        if (
            a["direction"] == "bearish"
            and pa["direction"] == "bullish"
            and c.close <= prev.open
            and c.open >= prev.close
            and a["body"] > pa["body"]
        ):
            out.append("bearish_engulfing")
    if atr and a["range"] > 2.5 * atr:
        out.append("wide_range")
    return out


PATTERN_TEXT = {
    "doji": "Doji — тялото е почти нула: купувачи и продавачи са в баланс; нерешителност, не сигнал сам по себе си.",
    "hammer": "Hammer — дълъг долен wick: продавачите бутнаха цената надолу, но купувачите я върнаха. "
    "Има значение най-вече при support и след спад.",
    "shooting_star": "Shooting star — дълъг горен wick: купувачите опитаха нагоре, но бяха отхвърлени. "
    "По-значим при resistance след покачване.",
    "marubozu": "Marubozu — почти без wicks: едната страна контролира целия период.",
    "bullish_engulfing": "Bullish engulfing — бичето тяло 'поглъща' предишното мечо тяло.",
    "bearish_engulfing": "Bearish engulfing — мечото тяло 'поглъща' предишното биче тяло.",
    "wide_range": "Необичайно голяма свещ (> 2.5 ATR) — висока волатилност, често след новини.",
}


def explain_candle(c: Candle, prev: Candle | None = None, atr: float | None = None, precision: int = 2) -> str:
    a = anatomy(c)
    fmt = f"{{:,.{precision}f}}"
    lines = [
        f"Open {fmt.format(c.open)}, High {fmt.format(c.high)}, Low {fmt.format(c.low)}, Close {fmt.format(c.close)}.",
    ]
    if a["direction"] == "bearish":
        lines.append("Свещта е BEARISH, защото Close е ПОД Open — през периода цената е паднала.")
    elif a["direction"] == "bullish":
        lines.append("Свещта е BULLISH, защото Close е НАД Open — през периода цената се е покачила.")
    else:
        lines.append("Open и Close са равни — неутрална свещ.")
    lines.append(
        f"Тялото е {a['body_pct']:.0f}% от целия диапазон; горен wick {a['upper_wick_pct']:.0f}%, "
        f"долен wick {a['lower_wick_pct']:.0f}%."
    )
    for p in patterns(c, prev, atr):
        lines.append(PATTERN_TEXT[p])
    lines.append("Една свещ сама по себе си не предсказва следващата — гледай контекста (тренд, нива, обем).")
    return "\n".join(lines)


# ================================================================================================ S3b
# Rule-based candlestick pattern DETECTION (Candlestick Lab "find it on a real chart"; usable as strategy
# operands). Additive: `patterns()` above keeps its original behaviour for existing callers.
#
# Notation per candle: R = high − low (range), B = |close − open| (body), U = upper wick, L = lower wick.
# Every rule is numeric and uses ONLY the pattern's own candles plus the bars BEFORE it (no lookahead): the hit is
# reported on the pattern's LAST candle (`index`), so `detect_patterns(candles[: i + 1])` already knows every hit
# that completes at bar i.
#
# Prior trend (the "context" of reversal patterns) = slope of an EMA of the closes of the TREND_LOOKBACK bars
# before the pattern's FIRST candle: the EMA is seeded with the first close of that window (alpha =
# 2 / (TREND_EMA_PERIOD + 1)); slope = (EMA_last − first close) / average range of the window.
#   up    if slope ≥ +TREND_MIN_SLOPE        down if slope ≤ −TREND_MIN_SLOPE        flat otherwise
#   unknown when fewer than TREND_MIN_BARS bars precede the pattern (→ trend-dependent patterns are not reported).
# A detected pattern is a DESCRIPTION of past candles — not a signal on its own.

TREND_LOOKBACK = 6
TREND_MIN_BARS = 3
TREND_EMA_PERIOD = 4
TREND_MIN_SLOPE = 0.5
AVG_BODY_BARS = 10  # "long body" is judged against the average body of up to this many previous bars
DOJI_BODY = 0.10  # B ≤ 10% of R
LONG_WICK_SHARE = 0.55  # hammer-family: the long wick is ≥ 55% of R …
WICK_BODY_MULT = 2.0  # … and ≥ 2 × B
SHORT_WICK_SHARE = 0.15  # … and the opposite wick ≤ 15% of R
MARUBOZU_BODY = 0.90  # B ≥ 90% of R
MARUBOZU_VS_AVG = 1.3  # and B ≥ 1.3 × the average body of the previous bars (when ≥ 3 are known)
TWEEZER_TOL = 0.10  # equal highs/lows: difference ≤ 10% of the larger range

PATTERN_DEFS: dict[str, dict] = {
    # key: bars in the pattern, bias, prior trend required (None = any), numeric rule (shown in the lab)
    "doji": {
        "bars": 1,
        "bias": "neutral",
        "trend": None,
        "rule": "B ≤ 10% от R (и не е dragonfly/gravestone).",
    },
    "dragonfly_doji": {
        "bars": 1,
        "bias": "context-dependent",
        "trend": None,
        "rule": "B ≤ 10% от R, горен wick ≤ 10% от R, долен wick ≥ 60% от R.",
    },
    "gravestone_doji": {
        "bars": 1,
        "bias": "context-dependent",
        "trend": None,
        "rule": "B ≤ 10% от R, долен wick ≤ 10% от R, горен wick ≥ 60% от R.",
    },
    "spinning_top": {
        "bars": 1,
        "bias": "neutral",
        "trend": None,
        "rule": "10% < B ≤ 35% от R и двата wick-а ≥ 25% от R.",
    },
    "hammer": {
        "bars": 1,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад (EMA наклон ≤ −0.5 среден диапазон): B > 10% от R, долен wick ≥ 2×B и ≥ 55% от R, "
        "горен wick ≤ 15% от R.",
    },
    "hanging_man": {
        "bars": 1,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: същата форма като hammer (долен wick ≥ 2×B и ≥ 55% от R, горен ≤ 15% от R).",
    },
    "inverted_hammer": {
        "bars": 1,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад: B > 10% от R, горен wick ≥ 2×B и ≥ 55% от R, долен wick ≤ 15% от R.",
    },
    "shooting_star": {
        "bars": 1,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: същата форма като inverted hammer (горен wick ≥ 2×B и ≥ 55% от R, долен ≤ 15%).",
    },
    "bullish_marubozu": {
        "bars": 1,
        "bias": "bullish",
        "trend": None,
        "rule": "Close > Open, B ≥ 90% от R и B ≥ 1.3 × средното тяло на предходните свещи.",
    },
    "bearish_marubozu": {
        "bars": 1,
        "bias": "bearish",
        "trend": None,
        "rule": "Close < Open, B ≥ 90% от R и B ≥ 1.3 × средното тяло на предходните свещи.",
    },
    "bullish_engulfing": {
        "bars": 2,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад: мечя свещ, после бича, чието тяло покрива изцяло предишното тяло (Open₂ ≤ Close₁, "
        "Close₂ ≥ Open₁, B₂ > B₁).",
    },
    "bearish_engulfing": {
        "bars": 2,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: бича свещ, после мечя, чието тяло покрива изцяло предишното (Open₂ ≥ Close₁, "
        "Close₂ ≤ Open₁, B₂ > B₁).",
    },
    "bullish_harami": {
        "bars": 2,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад: дълга мечя свещ (B₁ ≥ 50% от R₁), после свещ с тяло вътре в тялото ѝ и B₂ ≤ 50% от B₁.",
    },
    "bearish_harami": {
        "bars": 2,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: дълга бича свещ (B₁ ≥ 50% от R₁), после свещ с тяло вътре в тялото ѝ и "
        "B₂ ≤ 50% от B₁.",
    },
    "piercing_line": {
        "bars": 2,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад: дълга мечя свещ (B₁ ≥ 50% от R₁), после бича, която отваря на или под Close₁ и затваря "
        "над средата на тялото ѝ, но под Open₁ (класически с gap надолу; на пазари 24/7 Open₂ = Close₁).",
    },
    "dark_cloud_cover": {
        "bars": 2,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: дълга бича свещ (B₁ ≥ 50% от R₁), после мечя, която отваря на или над Close₁ и "
        "затваря под средата на тялото ѝ, но над Open₁ (класически с gap нагоре; на пазари 24/7 Open₂ = Close₁).",
    },
    "tweezer_bottom": {
        "bars": 2,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад: мечя, после бича свещ с почти равни Low (разлика ≤ 10% от по-големия диапазон).",
    },
    "tweezer_top": {
        "bars": 2,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: бича, после мечя свещ с почти равни High (разлика ≤ 10% от по-големия диапазон).",
    },
    "inside_bar": {
        "bars": 2,
        "bias": "context-dependent",
        "trend": None,
        "rule": "High₂ ≤ High₁, Low₂ ≥ Low₁ и R₂ < R₁ — цялата свещ е в диапазона на предходната.",
    },
    "outside_bar": {
        "bars": 2,
        "bias": "context-dependent",
        "trend": None,
        "rule": "High₂ > High₁ и Low₂ < Low₁ — свещта покрива целия диапазон на предходната.",
    },
    "morning_star": {
        "bars": 3,
        "bias": "bullish",
        "trend": "down",
        "rule": "След спад: дълга мечя свещ (B₁ ≥ 50% от R₁), малко тяло в долния ѝ край (B₂ ≤ 35% от B₁), "
        "после бича свещ, затваряща над средата на първото тяло.",
    },
    "evening_star": {
        "bars": 3,
        "bias": "bearish",
        "trend": "up",
        "rule": "След покачване: дълга бича свещ, малко тяло в горния ѝ край (B₂ ≤ 35% от B₁), после мечя свещ, "
        "затваряща под средата на първото тяло.",
    },
    "three_white_soldiers": {
        "bars": 3,
        "bias": "bullish",
        "trend": "not_up",
        "rule": "След спад или странично движение: три бичи свещи с B ≥ 50% от R и горен wick ≤ 30% от R; всяка "
        "отваря в тялото на предходната и затваря по-високо.",
    },
    "three_black_crows": {
        "bars": 3,
        "bias": "bearish",
        "trend": "not_down",
        "rule": "След покачване или странично движение: три мечи свещи с B ≥ 50% от R и долен wick ≤ 30% от R; "
        "всяка отваря в тялото на предходната и затваря по-ниско.",
    },
}
DETECTABLE_PATTERNS: tuple[str, ...] = tuple(PATTERN_DEFS)


@dataclass(frozen=True, slots=True)
class PatternHit:
    key: str
    index: int  # last candle of the pattern (the bar on which it becomes known)
    start: int  # first candle of the pattern
    time: int  # open time of the last candle
    bias: str
    prior_trend: str  # up | down | flat | unknown

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "index": self.index,
            "start_index": self.start,
            "time": self.time,
            "bars": self.index - self.start + 1,
            "bias": self.bias,
            "prior_trend": self.prior_trend,
        }


@dataclass(frozen=True, slots=True)
class _Shape:
    o: float
    h: float
    low: float
    c: float
    rng: float
    body: float
    upper: float
    lower: float

    @property
    def bull(self) -> bool:
        return self.c > self.o

    @property
    def bear(self) -> bool:
        return self.c < self.o

    @property
    def top(self) -> float:
        return max(self.o, self.c)

    @property
    def bottom(self) -> float:
        return min(self.o, self.c)

    @property
    def mid(self) -> float:
        return (self.o + self.c) / 2


def _shape(c: Candle) -> _Shape:
    return _Shape(
        c.open,
        c.high,
        c.low,
        c.close,
        c.high - c.low,
        abs(c.close - c.open),
        c.high - max(c.open, c.close),
        min(c.open, c.close) - c.low,
    )


def prior_trend(candles: list[Candle], end: int, lookback: int = TREND_LOOKBACK) -> str:
    """Trend of the bars BEFORE index `end` (exclusive): 'up' | 'down' | 'flat' | 'unknown' (see the rule above)."""
    ctx = candles[max(0, end - lookback) : max(0, end)]
    if len(ctx) < TREND_MIN_BARS:
        return "unknown"
    alpha = 2 / (TREND_EMA_PERIOD + 1)
    ema_v = ctx[0].close
    for c in ctx[1:]:
        ema_v = alpha * c.close + (1 - alpha) * ema_v
    avg_range = sum(c.high - c.low for c in ctx) / len(ctx)
    if avg_range <= 0:
        return "flat"
    slope = (ema_v - ctx[0].close) / avg_range
    if slope >= TREND_MIN_SLOPE:
        return "up"
    if slope <= -TREND_MIN_SLOPE:
        return "down"
    return "flat"


def _avg_body(candles: list[Candle], end: int) -> float | None:
    ctx = candles[max(0, end - AVG_BODY_BARS) : max(0, end)]
    if len(ctx) < TREND_MIN_BARS:
        return None
    return sum(abs(c.close - c.open) for c in ctx) / len(ctx)


def _trend_ok(required: str | None, trend: str) -> bool:
    if required is None:
        return True
    if required == "not_up":
        return trend in ("down", "flat")
    if required == "not_down":
        return trend in ("up", "flat")
    return trend == required


def _single(s: _Shape, avg_body: float | None) -> set[str]:
    """Shape-only single-candle keys (hammer-family returned as 'hammer_shape' / 'inverted_shape')."""
    out: set[str] = set()
    if s.rng <= 0:
        return {"doji"}
    if s.body <= DOJI_BODY * s.rng:
        if s.upper <= 0.10 * s.rng and s.lower >= 0.60 * s.rng:
            out.add("dragonfly_doji")
        elif s.lower <= 0.10 * s.rng and s.upper >= 0.60 * s.rng:
            out.add("gravestone_doji")
        else:
            out.add("doji")
        return out
    if s.body <= 0.35 * s.rng and s.upper >= 0.25 * s.rng and s.lower >= 0.25 * s.rng:
        out.add("spinning_top")
    if (
        s.lower >= WICK_BODY_MULT * s.body
        and s.lower >= LONG_WICK_SHARE * s.rng
        and s.upper <= SHORT_WICK_SHARE * s.rng
    ):
        out.add("hammer_shape")
    if (
        s.upper >= WICK_BODY_MULT * s.body
        and s.upper >= LONG_WICK_SHARE * s.rng
        and s.lower <= SHORT_WICK_SHARE * s.rng
    ):
        out.add("inverted_shape")
    if s.body >= MARUBOZU_BODY * s.rng and (avg_body is None or s.body >= MARUBOZU_VS_AVG * avg_body):
        out.add("bullish_marubozu" if s.bull else "bearish_marubozu")
    return out


def _double(a: _Shape, b: _Shape) -> set[str]:
    out: set[str] = set()
    if a.bear and b.bull and b.o <= a.c and b.c >= a.o and b.body > a.body:
        out.add("bullish_engulfing")
    if a.bull and b.bear and b.o >= a.c and b.c <= a.o and b.body > a.body:
        out.add("bearish_engulfing")
    if a.bear and a.body >= 0.5 * a.rng and b.top <= a.o and b.bottom >= a.c and b.body <= 0.5 * a.body:
        out.add("bullish_harami")
    if a.bull and a.body >= 0.5 * a.rng and b.top <= a.c and b.bottom >= a.o and b.body <= 0.5 * a.body:
        out.add("bearish_harami")
    if a.bear and a.body >= 0.5 * a.rng and b.bull and b.o <= a.c and a.mid < b.c < a.o:
        out.add("piercing_line")
    if a.bull and a.body >= 0.5 * a.rng and b.bear and b.o >= a.c and a.o < b.c < a.mid:
        out.add("dark_cloud_cover")
    tol = TWEEZER_TOL * max(a.rng, b.rng)
    if a.bear and b.bull and tol > 0 and abs(a.low - b.low) <= tol:
        out.add("tweezer_bottom")
    if a.bull and b.bear and tol > 0 and abs(a.h - b.h) <= tol:
        out.add("tweezer_top")
    if b.h <= a.h and b.low >= a.low and b.rng < a.rng:
        out.add("inside_bar")
    if b.h > a.h and b.low < a.low:
        out.add("outside_bar")
    return out


def _triple(a: _Shape, b: _Shape, c: _Shape) -> set[str]:
    out: set[str] = set()
    if (
        a.bear
        and a.body >= 0.5 * a.rng
        and b.body <= 0.35 * a.body
        and b.top <= a.c + 0.25 * a.body
        and c.bull
        and c.c >= a.mid
    ):
        out.add("morning_star")
    if (
        a.bull
        and a.body >= 0.5 * a.rng
        and b.body <= 0.35 * a.body
        and b.bottom >= a.c - 0.25 * a.body
        and c.bear
        and c.c <= a.mid
    ):
        out.add("evening_star")
    trio = (a, b, c)
    if (
        all(x.bull and x.rng > 0 and x.body >= 0.5 * x.rng and x.upper <= 0.3 * x.rng for x in trio)
        and a.o <= b.o <= a.c
        and b.o <= c.o <= b.c
        and a.c < b.c < c.c
    ):
        out.add("three_white_soldiers")
    if (
        all(x.bear and x.rng > 0 and x.body >= 0.5 * x.rng and x.lower <= 0.3 * x.rng for x in trio)
        and a.c <= b.o <= a.o
        and b.c <= c.o <= b.o
        and a.c > b.c > c.c
    ):
        out.add("three_black_crows")
    return out


def patterns_at(candles: list[Candle], i: int, keys: set[str] | None = None) -> list[PatternHit]:
    """Patterns that COMPLETE at bar i (uses candles[: i + 1] only)."""
    if not 0 <= i < len(candles):
        return []
    hits: list[PatternHit] = []
    trend_cache: dict[int, str] = {}

    def trend(start: int) -> str:
        if start not in trend_cache:
            trend_cache[start] = prior_trend(candles, start)
        return trend_cache[start]

    def add(found: set[str], start: int) -> None:
        for key in sorted(found):
            d = PATTERN_DEFS[key]
            if keys is not None and key not in keys:
                continue
            t = trend(start)
            if d["trend"] is not None and not _trend_ok(d["trend"], t):
                continue
            hits.append(PatternHit(key, i, start, candles[i].ts, d["bias"], t))

    s = _shape(candles[i])
    single = _single(s, _avg_body(candles, i))
    if "hammer_shape" in single:
        single |= {"hammer", "hanging_man"}
    if "inverted_shape" in single:
        single |= {"inverted_hammer", "shooting_star"}
    add(single - {"hammer_shape", "inverted_shape"}, i)
    if i >= 1:
        add(_double(_shape(candles[i - 1]), s), i - 1)
    if i >= 2:
        add(_triple(_shape(candles[i - 2]), _shape(candles[i - 1]), s), i - 2)
    return hits


def detect_patterns(
    candles: list[Candle], keys: list[str] | tuple[str, ...] | set[str] | None = None
) -> list[PatternHit]:
    """Every rule-based pattern in `candles` (PATTERN_DEFS keys; optionally only `keys`), in bar order.

    Unknown keys raise KeyError. Each hit is reported on the pattern's last candle; no lookahead."""
    wanted = None
    if keys is not None:
        wanted = set(keys)
        unknown = wanted - set(PATTERN_DEFS)
        if unknown:
            raise KeyError(f"Unknown candle pattern(s): {', '.join(sorted(unknown))}")
    out: list[PatternHit] = []
    for i in range(len(candles)):
        out.extend(patterns_at(candles, i, wanted))
    return out


def pattern_flags(
    candles: list[Candle], keys: list[str] | tuple[str, ...] | None = None
) -> dict[str, list[float | None]]:
    """Per-bar 1.0 / 0.0 flags for each pattern key (None while the pattern cannot complete yet: i < bars − 1).
    Same values as detect_patterns, in the strategy-operand series format (no lookahead)."""
    names = tuple(keys) if keys is not None else DETECTABLE_PATTERNS
    n = len(candles)
    out: dict[str, list[float | None]] = {}
    for k in names:
        bars = PATTERN_DEFS[k]["bars"]
        out[k] = [None if i < bars - 1 else 0.0 for i in range(n)]
    for hit in detect_patterns(candles, names):
        out[hit.key][hit.index] = 1.0
    return out
