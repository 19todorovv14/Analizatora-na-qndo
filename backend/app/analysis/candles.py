"""Candlestick anatomy and classic single/two-candle patterns."""

from __future__ import annotations

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
