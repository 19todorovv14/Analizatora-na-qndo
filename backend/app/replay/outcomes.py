"""Resolution of replay decisions on the candles revealed AFTER the decision bar.

LONG / SHORT predictions
  * entry = close of the decision bar (the last price the user saw), risk = |entry − stop| (1R).
  * Each later candle is checked for the stop and the target. When both are inside the same candle the
    policy is WORST CASE: the stop counts first (we cannot know the path inside the candle).
  * A candle that opens beyond the stop (gap) exits at its open (the loss can be worse than −1R); a candle that
    opens beyond the target exits at its open (a resting limit order fills at the better price).
  * No hit after PREDICTION_HORIZON candles → "expired" at that candle's close (mark-to-market R).
  * Fewer candles revealed than the horizon and no hit → "open" with the live (unrealised) R.

WAIT decisions
  right_to_wait is True when, within the next WAIT_HORIZON candles, price did NOT make a clean move of
  ≥ WAIT_MOVE_ATR × ATR in one direction without first moving ≥ WAIT_AGAINST_ATR × ATR against that direction.
  A candle that reaches both thresholds of one direction is ambiguous and never counts as a clean move.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.market.base import Candle

PREDICTION_HORIZON = 50
WAIT_HORIZON = 10
WAIT_MOVE_ATR = 1.5
WAIT_AGAINST_ATR = 1.0

RESOLVED_PREDICTION = ("target", "stop", "expired")


def _fmt(v: float | None, precision: int) -> str:
    return "—" if v is None else f"{v:,.{precision}f}"


def _r(v: float | None, nd: int = 3) -> float | None:
    return None if v is None else round(v, nd)


def resolve_prediction(
    action: str,
    entry: float,
    stop: float,
    target: float | None,
    bars_after: Sequence[Candle],
    *,
    horizon: int = PREDICTION_HORIZON,
) -> dict:
    """Outcome of a LONG/SHORT prediction. `bars_after` = candles strictly after the decision bar, oldest first."""
    if action not in ("long", "short"):
        raise ValueError("resolve_prediction is only for long/short decisions")
    sign = 1 if action == "long" else -1
    risk = abs(entry - stop)
    if risk <= 0:
        raise ValueError("stop must differ from the entry")
    mfe_r = 0.0
    mae_r = 0.0
    bars = list(bars_after[:horizon])
    for k, c in enumerate(bars, start=1):
        if action == "long":
            stop_hit = c.low <= stop
            target_hit = target is not None and c.high >= target
            fav = (c.high - entry) / risk
            adv = (c.low - entry) / risk
        else:
            stop_hit = c.high >= stop
            target_hit = target is not None and c.low <= target
            fav = (entry - c.low) / risk
            adv = (entry - c.high) / risk
        if stop_hit:
            exit_price = min(c.open, stop) if action == "long" else max(c.open, stop)
            r = sign * (exit_price - entry) / risk
            mae_r = min(mae_r, r)
            return {
                "status": "stop",
                "bars_held": k,
                "r_result": _r(r),
                "mfe_r": _r(mfe_r),
                "mae_r": _r(mae_r),
                "exit_price": exit_price,
                "exit_ts": c.ts,
                "last_ts": c.ts,
                "same_bar_stop_and_target": bool(target_hit),
                "gap": (c.open < stop) if action == "long" else (c.open > stop),
                "horizon": horizon,
            }
        if target_hit:
            exit_price = max(c.open, target) if action == "long" else min(c.open, target)
            r = sign * (exit_price - entry) / risk
            mfe_r = max(mfe_r, r)
            mae_r = min(mae_r, adv)
            return {
                "status": "target",
                "bars_held": k,
                "r_result": _r(r),
                "mfe_r": _r(mfe_r),
                "mae_r": _r(mae_r),
                "exit_price": exit_price,
                "exit_ts": c.ts,
                "last_ts": c.ts,
                "same_bar_stop_and_target": False,
                "gap": (c.open > target) if action == "long" else (c.open < target),
                "horizon": horizon,
            }
        mfe_r = max(mfe_r, fav)
        mae_r = min(mae_r, adv)
    n = len(bars)
    last = bars[-1] if bars else None
    live_r = sign * (last.close - entry) / risk if last else 0.0
    status = "expired" if n >= horizon else "open"
    return {
        "status": status,
        "bars_held": n,
        "r_result": _r(live_r),
        "mfe_r": _r(mfe_r),
        "mae_r": _r(mae_r),
        "exit_price": last.close if (status == "expired" and last) else None,
        "exit_ts": last.ts if (status == "expired" and last) else None,
        "last_ts": last.ts if last else None,
        "same_bar_stop_and_target": False,
        "gap": False,
        "horizon": horizon,
    }


def resolve_wait(
    reference: float,
    atr: float | None,
    bars_after: Sequence[Candle],
    *,
    precision: int = 2,
    horizon: int = WAIT_HORIZON,
) -> dict:
    """Was WAIT right? `reference` = close of the decision bar, `atr` = ATR(14) at that bar."""
    bars = list(bars_after[:horizon])
    if not atr or atr <= 0:
        return {
            "status": "resolved" if len(bars) >= horizon else "open",
            "right_to_wait": True if len(bars) >= horizon else None,
            "bars_observed": len(bars),
            "clean_move": None,
            "bars_to_move": None,
            "max_up_atr": None,
            "max_down_atr": None,
            "atr": atr,
            "horizon": horizon,
            "explanation": "Няма ATR за този момент — изчакването не може да се оцени количествено.",
        }
    up_target = reference + WAIT_MOVE_ATR * atr
    down_target = reference - WAIT_MOVE_ATR * atr
    up_against = reference - WAIT_AGAINST_ATR * atr
    down_against = reference + WAIT_AGAINST_ATR * atr
    up_alive = down_alive = True
    max_up = max_down = 0.0
    clean: str | None = None
    at: int | None = None
    for k, c in enumerate(bars, start=1):
        max_up = max(max_up, (c.high - reference) / atr)
        max_down = max(max_down, (reference - c.low) / atr)
        if up_alive:
            if c.low <= up_against:  # moved ≥ 1 ATR against first (or in the same candle → ambiguous)
                up_alive = False
            elif c.high >= up_target:
                clean, at = "up", k
                break
        if down_alive:
            if c.high >= down_against:
                down_alive = False
            elif c.low <= down_target:
                clean, at = "down", k
                break
        if not up_alive and not down_alive:
            break  # choppy both ways — no clean move is possible any more
    p = precision
    out = {
        "bars_observed": len(bars) if clean is None else at,
        "clean_move": clean,
        "bars_to_move": at,
        "max_up_atr": round(max_up, 2),
        "max_down_atr": round(max_down, 2),
        "atr": atr,
        "horizon": horizon,
    }
    if clean is not None:
        side = "LONG" if clean == "up" else "SHORT"
        level = up_target if clean == "up" else down_target
        direction = "нагоре" if clean == "up" else "надолу"
        return {
            **out,
            "status": "resolved",
            "right_to_wait": False,
            "explanation": (
                f"Цената направи чисто движение {direction} ≥ {WAIT_MOVE_ATR:g} ATR (до {_fmt(level, p)}) за {at} "
                f"свещи, без първо да тръгне {WAIT_AGAINST_ATR:g} ATR срещу посоката — имаше ясна {side} възможност."
            ),
        }
    if not up_alive and not down_alive:
        return {
            **out,
            "status": "resolved",
            "right_to_wait": True,
            "explanation": (
                f"Цената се люшкаше в двете посоки (≥ {WAIT_AGAINST_ATR:g} ATR нагоре и надолу) без чисто движение — "
                "изчакването беше разумно."
            ),
        }
    if len(bars) >= horizon:
        return {
            **out,
            "status": "resolved",
            "right_to_wait": True,
            "explanation": (
                f"В следващите {horizon} свещи нямаше чисто движение ≥ {WAIT_MOVE_ATR:g} ATR в една посока "
                f"(макс. +{max_up:.1f} / −{max_down:.1f} ATR) — изчакването беше разумно."
            ),
        }
    return {
        **out,
        "status": "open",
        "right_to_wait": None,
        "explanation": f"Оценява се: {len(bars)} от {horizon} свещи след решението са разкрити.",
    }


def prediction_correct(outcome: dict) -> bool | None:
    """True/False for a resolved LONG/SHORT outcome (expired counts by the sign of its R), None while open."""
    status = outcome.get("status")
    if status == "target":
        return True
    if status == "stop":
        return False
    if status == "expired":
        return (outcome.get("r_result") or 0.0) > 0
    return None
