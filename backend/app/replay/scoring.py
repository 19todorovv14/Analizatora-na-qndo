"""Replay decision scoring — deterministic, explainable, 0–100 per decision plus flags.

Entry-time checks use ONLY the candles up to and including the decision bar (no lookahead). Direction
correctness comes from the outcome resolved on the candles revealed after it (app.replay.outcomes).

LONG / SHORT score = weighted mean of the components that are known (weights in WEIGHTS):
  direction  target 100 · stop 0 · expired by R (≥1R 85, ≥0.25R 65, >−0.25R 45, else 20) · open → not yet known
  rr         planned R:R ≥ 2 → 100, ≥ 1.5 → 85 (good), ≥ 1 → 55, < 1 → 15 (bad), no target → 40
  stop       < 0.5 ATR from entry → 15 (inside noise) · beyond the last swing low/high → 100 · not beyond it → 60 ·
             no swing known → 80 (≥ 1 ATR) / 60 · wider than 4 ATR → at most 60
  entry      100 − 40 chased − 35 entered too early − 40 ignored structure (floor 0)
  regime     with the trend 100 · counter-trend 20 · range / low vol / unclear 70 · high volatility 55
WAIT score = 100 when waiting was right, 30 when a clean move was missed, unknown while open.

Session score = outcome-weighted mean of the FINAL decision scores (target/stop 1.0, expired 0.75, WAIT 0.5).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from app import indicators as ind
from app.analysis.regime import classify
from app.analysis.structure import find_swings, levels, nearest_levels, structure_trend
from app.market.base import Candle
from app.replay.outcomes import prediction_correct

CHASE_EMA_ATR = 1.5  # entry this far from EMA20 (in ATRs, in the trade direction) …
LARGE_BODY_ATR = 1.0  # … right after a candle whose body is at least this large (in ATRs)
LARGE_CANDLE_LOOKBACK = 3  # the decision bar and the two before it
NOISE_STOP_ATR = 0.5
WIDE_STOP_ATR = 4.0
STRUCTURE_ATR = 0.5  # "right under resistance / right above support"
RR_GREAT = 2.0
RR_GOOD = 1.5
RR_BAD = 1.0
SWING_LEFT = SWING_RIGHT = 3
MIN_REGIME_BARS = 60

WEIGHTS = {"direction": 35, "rr": 20, "stop": 20, "entry": 15, "regime": 10}
OUTCOME_WEIGHTS = {"target": 1.0, "stop": 1.0, "expired": 0.75, "open": 0.5, "wait": 0.5}

FLAGS: dict[str, dict] = {
    "chased": {"label": "Chasing?", "severity": "warning", "lesson": "fomo"},
    "entered_too_early": {"label": "Entered too early", "severity": "warning", "lesson": "market-structure"},
    "ignored_structure": {"label": "Against structure", "severity": "warning", "lesson": "resistance"},
    "counter_trend": {"label": "Counter-trend", "severity": "warning", "lesson": "market-regimes"},
    "poor_rr": {"label": "Poor R:R", "severity": "warning", "lesson": "reward-risk"},
    "low_rr": {"label": "Low R:R", "severity": "info", "lesson": "reward-risk"},
    "no_target": {"label": "No target", "severity": "info", "lesson": "reward-risk"},
    "stop_in_noise": {"label": "Stop in noise", "severity": "warning", "lesson": "stop-loss-placement"},
    "stop_inside_structure": {"label": "Stop inside structure", "severity": "info", "lesson": "stop-loss-placement"},
    "wide_stop": {"label": "Wide stop", "severity": "info", "lesson": "position-sizing"},
    "missed_move": {"label": "Missed move", "severity": "info", "lesson": "trend-continuation"},
}
FLAG_KEYS = tuple(FLAGS)


class DecisionError(ValueError):
    pass


def _fmt(v: float | None, precision: int) -> str:
    return "—" if v is None else f"{v:,.{precision}f}"


def _below(v: float) -> str:
    """2 decimals rounded DOWN, so a value under a threshold is never printed as the threshold (0.497 → 0.49)."""
    return f"{math.floor(round(v * 100, 6)) / 100:.2f}"


def _flag(key: str, text: str, **extra) -> dict:
    info = FLAGS[key]
    return {
        "key": key,
        "label": info["label"],
        "severity": info["severity"],
        "text": text,
        "lesson": info["lesson"],
        **extra,
    }


def _swing(s) -> dict | None:
    return None if s is None else {"price": s.price, "time": s.ts, "label": s.label}


# ------------------------------------------------------------------------------------------------ context
def decision_context(candles: Sequence[Candle]) -> dict:
    """Market facts at the decision bar = candles[-1]. Uses nothing after it."""
    rows = list(candles)
    if not rows:
        return {"available": False}
    c = rows[-1]
    closes = [x.close for x in rows]
    highs = [x.high for x in rows]
    lows = [x.low for x in rows]
    ema20 = ind.ema(closes, 20)[-1] if len(rows) >= 20 else None
    atr = ind.atr(highs, lows, closes, 14)[-1] if len(rows) >= 15 else None
    if not atr or atr <= 0:  # very short history: mean candle range as the volatility unit
        tail = rows[-14:]
        atr = sum(x.high - x.low for x in tail) / len(tail) if tail else None
        atr = atr if atr and atr > 0 else None
    swings = find_swings(rows, SWING_LEFT, SWING_RIGHT)
    st = structure_trend(swings)
    highs_sw = [s for s in swings if s.kind == "high"]
    lows_sw = [s for s in swings if s.kind == "low"]
    last_high = highs_sw[-1] if highs_sw else None
    last_low = lows_sw[-1] if lows_sw else None
    low_below = next((s for s in reversed(lows_sw) if s.price < c.close), None)
    high_above = next((s for s in reversed(highs_sw) if s.price > c.close), None)
    lv = levels(rows, swings, atr)
    supports, resistances = nearest_levels(lv, c.close, n=1)
    regime = classify(rows)["regime"] if len(rows) >= MIN_REGIME_BARS else "UNCLEAR"
    large = None
    if atr:
        for x in rows[-LARGE_CANDLE_LOOKBACK:]:
            body = x.close - x.open
            if abs(body) >= LARGE_BODY_ATR * atr:
                large = {
                    "direction": "bullish" if body > 0 else "bearish",
                    "time": x.ts,
                    "body_atr": round(abs(body) / atr, 2),
                }
    return {
        "available": True,
        "time": c.ts,
        "close": c.close,
        "ema20": ema20,
        "atr": atr,
        "ema20_distance_atr": round((c.close - ema20) / atr, 3) if (ema20 is not None and atr) else None,
        "regime": regime,
        "structure": st["trend"],
        "last_high_label": st["last_high_label"],
        "last_low_label": st["last_low_label"],
        "last_swing_high": _swing(last_high),
        "last_swing_low": _swing(last_low),
        "swing_low_below": _swing(low_below),
        "swing_high_above": _swing(high_above),
        "support": supports[0]["price"] if supports else None,
        "resistance": resistances[0]["price"] if resistances else None,
        "large_candle": large,
        "bars": len(rows),
    }


# ------------------------------------------------------------------------------------------------ validation
def validate_levels(action: str, entry: float, stop: float | None, target: float | None, precision: int = 2) -> None:
    """LONG/SHORT need a stop on the correct side; a target (recommended) must be on the correct side too."""
    if action == "wait":
        return
    p = precision
    if stop is None:
        raise DecisionError(
            f"{action.upper()} изисква STOP (invalidation): къде идеята е грешна. Цена в момента: {_fmt(entry, p)}."
        )
    if action == "long":
        if stop >= entry:
            raise DecisionError(
                f"За LONG stop-ът трябва да е ПОД текущата цена {_fmt(entry, p)} (получен {_fmt(stop, p)})."
            )
        if target is not None and target <= entry:
            raise DecisionError(
                f"За LONG target-ът трябва да е НАД текущата цена {_fmt(entry, p)} (получен {_fmt(target, p)})."
            )
    elif action == "short":
        if stop <= entry:
            raise DecisionError(
                f"За SHORT stop-ът трябва да е НАД текущата цена {_fmt(entry, p)} (получен {_fmt(stop, p)})."
            )
        if target is not None and target >= entry:
            raise DecisionError(
                f"За SHORT target-ът трябва да е ПОД текущата цена {_fmt(entry, p)} (получен {_fmt(target, p)})."
            )
    else:
        raise DecisionError("action трябва да е long, short или wait.")


def planned_rr(entry: float, stop: float | None, target: float | None) -> float | None:
    if stop is None or target is None or entry == stop:
        return None
    return abs(target - entry) / abs(entry - stop)


# ------------------------------------------------------------------------------------------------ entry checks
def assess_entry(
    action: str, entry: float, stop: float | None, target: float | None, ctx: dict, precision: int = 2
) -> dict:
    """Entry-time components (everything except direction) and flags for a LONG/SHORT decision."""
    p = precision
    long = action == "long"
    side = "LONG" if long else "SHORT"
    atr = ctx.get("atr")
    flags: list[dict] = []
    comps: dict[str, dict] = {}

    # --- R:R
    rr = planned_rr(entry, stop, target)
    if rr is None:
        comps["rr"] = {"score": 40, "value": None, "text": "Няма target — планираният R:R е неизвестен."}
        flags.append(_flag("no_target", "Няма target: изходът при успех не е планиран, R:R не може да се оцени."))
    elif rr >= RR_GREAT:
        comps["rr"] = {
            "score": 100,
            "value": round(rr, 2),
            "text": f"Планиран R:R {rr:.2f} — асиметрията е в твоя полза.",
        }
    elif rr >= RR_GOOD:
        comps["rr"] = {"score": 85, "value": round(rr, 2), "text": f"Планиран R:R {rr:.2f} (≥ {RR_GOOD:g}) — добре."}
    elif rr >= RR_BAD:
        comps["rr"] = {
            "score": 55,
            "value": round(rr, 2),
            "text": f"Планиран R:R {rr:.2f} — под {RR_GOOD:g}, нужен е висок win rate.",
        }
        flags.append(
            _flag(
                "low_rr", f"R:R {rr:.2f} е под {RR_GOOD:g}: печалбата при успех е малка спрямо риска.", rr=round(rr, 2)
            )
        )
    else:
        comps["rr"] = {
            "score": 15,
            "value": round(rr, 2),
            "text": f"Планиран R:R {rr:.2f} (< {RR_BAD:g}) — рискуваш повече, отколкото целиш.",
        }
        flags.append(_flag("poor_rr", f"R:R {rr:.2f} < {RR_BAD:g}: рискът е по-голям от целта.", rr=round(rr, 2)))

    # --- stop placement
    dist = abs(entry - stop) if stop is not None else None
    dist_atr = dist / atr if (dist is not None and atr) else None
    swing = ctx.get("swing_low_below") if long else ctx.get("swing_high_above")
    swing_word = "swing low" if long else "swing high"
    if dist_atr is not None and dist_atr < NOISE_STOP_ATR:
        comps["stop"] = {
            "score": 15,
            "distance_atr": round(dist_atr, 2),
            "text": f"Stop на {_below(dist_atr)} ATR — вътре в нормалния шум.",
        }
        flags.append(
            _flag(
                "stop_in_noise",
                f"Stop-ът е само на {_below(dist_atr)} ATR от входа (< {NOISE_STOP_ATR:g} ATR) — обикновеният шум "
                "може да го вземе.",
                distance_atr=round(dist_atr, 2),
            )
        )
    elif swing is not None:
        beyond = stop < swing["price"] if long else stop > swing["price"]
        if beyond:
            comps["stop"] = {
                "score": 100,
                "distance_atr": round(dist_atr, 2) if dist_atr is not None else None,
                "text": f"Stop зад последния {swing_word} {_fmt(swing['price'], p)} — там идеята наистина е грешна.",
            }
        else:
            comps["stop"] = {
                "score": 60,
                "distance_atr": round(dist_atr, 2) if dist_atr is not None else None,
                "text": f"Stop преди последния {swing_word} {_fmt(swing['price'], p)} — вътре в структурата.",
            }
            flags.append(
                _flag(
                    "stop_inside_structure",
                    f"Stop-ът {_fmt(stop, p)} не е зад последния {swing_word} {_fmt(swing['price'], p)}.",
                    level=swing["price"],
                )
            )
    else:
        ok = dist_atr is not None and dist_atr >= 1.0
        comps["stop"] = {
            "score": 80 if ok else 60,
            "distance_atr": round(dist_atr, 2) if dist_atr is not None else None,
            "text": f"Няма потвърден {swing_word} под/над цената — stop-ът се оценява само по разстояние в ATR.",
        }
    if dist_atr is not None and dist_atr > WIDE_STOP_ATR:
        comps["stop"]["score"] = min(comps["stop"]["score"], 60)
        flags.append(
            _flag(
                "wide_stop",
                f"Stop на {dist_atr:.1f} ATR — много широк; позицията трябва да е малка, за да рискуваш същите %.",
                distance_atr=round(dist_atr, 2),
            )
        )

    # --- entry quality: chased / too early / ignored structure
    entry_score = 100
    ema_d = ctx.get("ema20_distance_atr")
    large = ctx.get("large_candle")
    directional = None if ema_d is None else (ema_d if long else -ema_d)
    big_with_trade = large is not None and large["direction"] == ("bullish" if long else "bearish")
    if directional is not None and directional > CHASE_EMA_ATR and big_with_trade:
        entry_score -= 40
        flags.append(
            _flag(
                "chased",
                f"{side} на {directional:.1f} ATR {'над' if long else 'под'} EMA 20 веднага след голяма "
                f"{'бича' if long else 'меча'} свещ ({large['body_atr']:.1f} ATR тяло) — гонене на цената (FOMO).",
                ema20_distance_atr=round(directional, 2),
            )
        )
    structure = ctx.get("structure")
    if long and structure == "bearish":
        lh = ctx.get("last_swing_high")
        if lh is None or entry <= lh["price"]:
            entry_score -= 35
            flags.append(
                _flag(
                    "entered_too_early",
                    "LONG докато структурата е още LH/LL — без потвърждение"
                    + (f" (няма затваряне над последния Lower High {_fmt(lh['price'], p)})." if lh else "."),
                )
            )
    elif not long and structure == "bullish":
        hl = ctx.get("last_swing_low")
        if hl is None or entry >= hl["price"]:
            entry_score -= 35
            flags.append(
                _flag(
                    "entered_too_early",
                    "SHORT докато структурата е още HH/HL — без потвърждение"
                    + (f" (няма затваряне под последния Higher Low {_fmt(hl['price'], p)})." if hl else "."),
                )
            )
    level = ctx.get("resistance") if long else ctx.get("support")
    if level is not None and atr:
        gap = (level - entry) if long else (entry - level)
        if 0 <= gap <= STRUCTURE_ATR * atr:
            entry_score -= 40
            word = "resistance" if long else "support"
            flags.append(
                _flag(
                    "ignored_structure",
                    f"{side} точно {'под' if long else 'над'} {word} {_fmt(level, p)} (на {gap / atr:.2f} ATR) — "
                    f"малко място до нивото, което често спира движението.",
                    level=level,
                    lesson="resistance" if long else "support",
                )
            )
    comps["entry"] = {"score": max(entry_score, 0), "text": "Качество на входа (гонене / ранен вход / структура)."}

    # --- regime alignment
    regime = ctx.get("regime") or "UNCLEAR"
    if (long and regime == "TRENDING_UP") or (not long and regime == "TRENDING_DOWN"):
        comps["regime"] = {"score": 100, "regime": regime, "text": f"{side} в посоката на режима {regime}."}
    elif (long and regime == "TRENDING_DOWN") or (not long and regime == "TRENDING_UP"):
        comps["regime"] = {"score": 20, "regime": regime, "text": f"{side} срещу режима {regime}."}
        flags.append(
            _flag(
                "counter_trend",
                f"{side} при режим {regime} — търговията срещу тренда изисква по-силна причина.",
                regime=regime,
            )
        )
    elif regime == "HIGH_VOLATILITY":
        comps["regime"] = {
            "score": 55,
            "regime": regime,
            "text": "Висока волатилност — stop-ът и размерът са по-трудни.",
        }
    else:
        comps["regime"] = {"score": 70, "regime": regime, "text": f"Режим {regime} — без ясна посока."}

    return {
        "planned_rr": round(rr, 3) if rr is not None else None,
        "risk": round(dist, p + 2) if dist is not None else None,
        "risk_atr": round(dist_atr, 3) if dist_atr is not None else None,
        "components": comps,
        "flags": flags,
    }


# ------------------------------------------------------------------------------------------------ scores
def direction_component(outcome: dict) -> dict | None:
    status = outcome.get("status")
    r = outcome.get("r_result")
    if status == "target":
        return {"score": 100, "text": f"Target беше достигнат ({(r or 0):+.2f}R)."}
    if status == "stop":
        return {"score": 0, "text": f"Stop-ът беше ударен ({(r or 0):+.2f}R) — идеята беше грешна."}
    if status in ("expired", "open_final"):
        r = r or 0.0
        score = 85 if r >= 1 else 65 if r >= 0.25 else 45 if r > -0.25 else 20
        return {"score": score, "text": f"Без stop/target след {outcome.get('bars_held')} свещи: {r:+.2f}R."}
    return None


def score_prediction(assessment: dict, outcome: dict, *, final: bool = False) -> dict:
    """{score, components, final}. `final` = the session is finished (an open outcome is scored by its live R)."""
    comps = {k: dict(v) for k, v in assessment["components"].items()}
    o = outcome
    if final and o.get("status") == "open":
        o = {**o, "status": "open_final"}
    d = direction_component(o)
    if d is not None:
        comps["direction"] = d
    total = sum(WEIGHTS[k] for k in comps)
    score = sum(WEIGHTS[k] * comps[k]["score"] for k in comps) / total if total else None
    return {"score": round(score, 1) if score is not None else None, "components": comps, "final": d is not None}


def score_wait(outcome: dict) -> dict:
    right = outcome.get("right_to_wait")
    if right is None:
        return {"score": None, "components": {}, "final": False}
    comp = (
        {"score": 100, "text": "Изчакването беше правилно — нямаше чисто движение."}
        if right
        else {"score": 30, "text": "Пропусна чисто движение — имаше възможност."}
    )
    return {"score": float(comp["score"]), "components": {"wait": comp}, "final": True}


def wait_flags(outcome: dict) -> list[dict]:
    if outcome.get("right_to_wait") is False:
        move = outcome.get("clean_move")
        side = "LONG" if move == "up" else "SHORT"
        return [
            _flag(
                "missed_move",
                f"Изчакването пропусна чисто движение {'нагоре' if move == 'up' else 'надолу'} ({side} възможност).",
                clean_move=move,
            )
        ]
    return []


def outcome_weight(action: str, outcome: dict, *, final: bool = False) -> float:
    if action == "wait":
        return OUTCOME_WEIGHTS["wait"]
    status = outcome.get("status")
    if status == "open":
        return OUTCOME_WEIGHTS["open"] if final else 0.0
    return OUTCOME_WEIGHTS.get(status, 0.0)


def session_score(items: Sequence[dict], *, final: bool = False) -> float | None:
    """Outcome-weighted mean of the decision scores that are final (`items`: {action, outcome, score, final})."""
    num = den = 0.0
    for d in items:
        if d.get("score") is None or not d.get("final"):
            continue
        w = outcome_weight(d["action"], d.get("outcome") or {}, final=final)
        if w <= 0:
            continue
        num += w * d["score"]
        den += w
    return round(num / den, 1) if den else None


def grade(score: float | None) -> str | None:
    if score is None:
        return None
    return "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"


def is_correct(action: str, outcome: dict) -> bool | None:
    if action == "wait":
        return outcome.get("right_to_wait")
    return prediction_correct(outcome)
