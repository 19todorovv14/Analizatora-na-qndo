"""HISTORICAL EXAMPLES — "what happened after similar conditions in the past?"

Scans the last ~1000 CLOSED bars for bars where
* the selected strategy's entry block passed (its regime filter applied), or
* without a strategy: the market was in the same regime as now and RSI(14) was in the same 10-point band,
and summarises the forward `horizon`-bar outcome distribution honestly: count, median / quartile move in ATR,
and the share of examples that reached +1R before −1R (R = the strategy's stop distance, or 1 ATR without a
strategy). Examples never overlap (after a match the next `horizon` bars are skipped) and when +1R and −1R are
both touched inside the same bar the order is unknown, so it is counted as −1R first (worst case).

These are PAST EXAMPLES, NOT A FORECAST — the wording of every result says so.
"""

from __future__ import annotations

from statistics import median

from app import indicators as ind
from app.analysis.regime import regime_series
from app.market.base import AssetSpec, Candle
from app.strategies.rules import IndicatorCache, StrategyDefinition, evaluate_block, stop_distance

NOT_A_FORECAST = (
    "Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия "
    "в историята, не какво ще се случи сега."
)
HORIZON = 10
MAX_BARS = 1000
MIN_RELIABLE = 10
WARMUP = 50


def _quantile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    pos = (len(sorted_vals) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _first_hit(candles: list[Candle], i: int, direction: int, r_unit: float, horizon: int) -> str:
    """'plus' if +1R (in `direction`) was reached before −1R within `horizon` bars, 'minus' if −1R first,
    'neither' otherwise. Same-bar double touch → 'minus' (worst case, order inside the bar is unknown)."""
    entry = candles[i].close
    up = entry + r_unit
    down = entry - r_unit
    for c in candles[i + 1 : i + 1 + horizon]:
        hit_up, hit_down = c.high >= up, c.low <= down
        if direction > 0:
            if hit_down:
                return "minus"
            if hit_up:
                return "plus"
        else:
            if hit_up:
                return "minus"
            if hit_down:
                return "plus"
    return "neither"


def _rsi_band(value: float) -> tuple[float, float]:
    lo = max(0.0, min(90.0, (value // 10) * 10))
    return lo, lo + 10


def historical_examples(
    candles: list[Candle],
    spec: AssetSpec,
    *,
    strategy: StrategyDefinition | None = None,
    strategy_name: str | None = None,
    horizon: int = HORIZON,
    max_bars: int = MAX_BARS,
) -> dict:
    """Outcome distribution of past bars that matched the current conditions (CLOSED candles only)."""
    rows = candles[-max_bars:]
    n = len(rows)
    out: dict = {
        "available": False,
        "basis": "strategy" if strategy is not None else "analog",
        "horizon": horizon,
        "bars_scanned": 0,
        "count": 0,
        "note": NOT_A_FORECAST,
    }
    if n < WARMUP + horizon + 20:
        out["reason"] = f"Недостатъчно история ({n} свещи) за търсене на исторически примери."
        return out

    closes = [c.close for c in rows]
    atr = ind.atr([c.high for c in rows], [c.low for c in rows], closes, 14)
    regimes = regime_series(rows)
    rsi = ind.rsi(closes, 14)
    last_scan = n - 1 - horizon  # forward window must be complete
    matches: list[tuple[int, int]] = []  # (bar index, direction +1 long / -1 short)

    if strategy is not None:
        cache = IndicatorCache(rows)
        allowed = set(strategy.regime_filter)
        r_units: dict[int, float] = {}
        i = WARMUP
        while i <= last_scan:
            if allowed and regimes[i] not in allowed:
                i += 1
                continue
            lp = evaluate_block(strategy.entry_long, cache, i)["passed"] if strategy.entry_long else False
            sp = evaluate_block(strategy.entry_short, cache, i)["passed"] if strategy.entry_short else False
            if lp != sp:  # exactly one side (both = conflicting → the strategy view says NO SETUP too)
                direction = 1 if lp else -1
                d = stop_distance(strategy, cache, i, "buy" if lp else "sell")
                if d and d > 0 and atr[i]:
                    matches.append((i, direction))
                    r_units[i] = d
                    i += horizon  # no overlapping examples
                    continue
            i += 1
        label = strategy_name or "стратегията"
        criteria = f"бари, на които entry правилата на '{label}' са изпълнени" + (
            f" (regime filter: {', '.join(sorted(allowed))})" if allowed else ""
        )
        r_unit_text = "stop разстоянието по правилото на стратегията"
    else:
        regime_now = regimes[-1]
        rsi_now = rsi[-1]
        if rsi_now is None:
            out["reason"] = "RSI още не е изчислен (warm-up)."
            return out
        lo, hi = _rsi_band(rsi_now)
        r_units = {}
        i = WARMUP
        while i <= last_scan:
            v = rsi[i]
            if regimes[i] == regime_now and v is not None and lo <= v < hi and atr[i]:
                matches.append((i, 1))
                r_units[i] = atr[i]
                i += horizon
                continue
            i += 1
        criteria = f"бари в режим {regime_now} с RSI(14) между {lo:.0f} и {hi:.0f} (като сега)"
        r_unit_text = "1 ATR(14)"
        out["regime"] = regime_now
        out["rsi_band"] = [lo, hi]

    moves: list[float] = []
    plus = minus = neither = longs = shorts = 0
    for i, direction in matches:
        a = atr[i]
        move = (rows[i + horizon].close - rows[i].close) / a * direction
        moves.append(move)
        hit = _first_hit(rows, i, direction, r_units[i], horizon)
        plus += hit == "plus"
        minus += hit == "minus"
        neither += hit == "neither"
        longs += direction > 0
        shorts += direction < 0

    k = len(matches)
    out.update(
        {
            "available": True,
            "criteria": criteria,
            "r_unit": r_unit_text,
            "direction": "trade" if strategy is not None else "price",
            "bars_scanned": max(0, last_scan - WARMUP + 1),
            "count": k,
        }
    )
    if strategy is not None:
        out["long"], out["short"] = longs, shorts
    if k == 0:
        out["summary"] = f"Няма подобни случаи в последните {n} затворени свещи. {NOT_A_FORECAST}"
        return out
    ms = sorted(moves)
    out.update(
        {
            "median_move_atr": round(median(ms), 2),
            "p25_move_atr": round(_quantile(ms, 0.25), 2),
            "p75_move_atr": round(_quantile(ms, 0.75), 2),
            "plus_first_pct": round(plus / k * 100),
            "minus_first_pct": round(minus / k * 100),
            "neither_pct": round(neither / k * 100),
            "reliable": k >= MIN_RELIABLE,
        }
    )
    sign_word = "в посоката на сделката" if strategy is not None else "(+ = нагоре)"
    summary = (
        f"{k} исторически примера ({criteria}). След {horizon} свещи медианното движение е "
        f"{out['median_move_atr']:+.2f} ATR {sign_word} (среден 50%: {out['p25_move_atr']:+.2f} … "
        f"{out['p75_move_atr']:+.2f} ATR); +1R преди −1R: {out['plus_first_pct']}%, −1R първо: "
        f"{out['minus_first_pct']}%, нито едно: {out['neither_pct']}% (1R = {r_unit_text})."
    )
    if k < MIN_RELIABLE:
        summary += f" Само {k} случая — твърде малка извадка за изводи."
    out["summary"] = f"{summary} {NOT_A_FORECAST}"
    return out
