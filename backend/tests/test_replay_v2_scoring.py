"""S5 — replay decision validation and explainable scoring on crafted candles."""

from __future__ import annotations

import random

import pytest

from app.academy.content import LESSONS_BY_SLUG
from app.market.base import Candle
from app.replay import scoring

H = 3600


def series(closes: list[float], rng_frac: float = 0.004, seed: int = 1) -> list[Candle]:
    r = random.Random(seed)
    out: list[Candle] = []
    prev = closes[0]
    for i, c in enumerate(closes):
        o = prev
        span = c * rng_frac * (0.6 + 0.8 * r.random())
        out.append(Candle(1_000_000 + i * H, o, max(o, c) + span / 2, min(o, c) - span / 2, c, 100.0))
        prev = c
    return out


def downtrend() -> list[Candle]:
    r = random.Random(7)
    closes = [100.0]
    for _ in range(299):
        closes.append(closes[-1] * (1 - 0.002 + 0.004 * (r.random() - 0.5)))
    return series(closes)


def chase_series() -> list[Candle]:
    cs = series([100 + 0.2 * i for i in range(80)], 0.01)
    last = cs[-1]
    cs.append(Candle(last.ts + H, last.close, last.close + 5.2, last.close - 0.1, last.close + 5, 100))
    return cs


def zigzag_down() -> list[Candle]:
    pts: list[float] = []
    level = 120.0
    for _ in range(12):
        pts += [level - j * 1.2 for j in range(6)]  # down leg
        pts += [level - 6 + j * 1.0 for j in range(4)]  # smaller up leg → lower highs and lower lows
        level -= 2.0
    return series(pts)


def range_under_resistance() -> list[Candle]:
    pts: list[float] = []
    for _ in range(8):
        pts += [100 + j * 1.25 for j in range(9)] + [110 - j * 1.25 for j in range(1, 8)]
    pts += [100 + j * 1.25 for j in range(8)] + [109.6]
    return series(pts)


def keys(a: dict) -> set[str]:
    return {f["key"] for f in a["flags"]}


# ------------------------------------------------------------------------------------------------ validation
def test_validate_levels_sides_and_required_stop():
    scoring.validate_levels("wait", 100, None, None)
    scoring.validate_levels("long", 100, 98, 104)
    scoring.validate_levels("long", 100, 98, None)  # target is recommended, not required
    scoring.validate_levels("short", 100, 102, 96)
    for action, stop, target in (
        ("long", None, 104),  # stop required
        ("long", 101, 104),  # stop above entry
        ("long", 100, 104),  # stop at entry
        ("long", 98, 99),  # target below entry
        ("short", 98, 96),  # stop below entry
        ("short", 102, 101 + 3),  # target above entry
        ("short", None, 96),
    ):
        with pytest.raises(scoring.DecisionError):
            scoring.validate_levels(action, 100, stop, target)
    with pytest.raises(scoring.DecisionError):
        scoring.validate_levels("hold", 100, 98, 104)


def test_planned_rr():
    assert scoring.planned_rr(100, 98, 104) == pytest.approx(2.0)
    assert scoring.planned_rr(100, 102, 97) == pytest.approx(1.5)
    assert scoring.planned_rr(100, 98, None) is None
    assert scoring.planned_rr(100, None, 104) is None


# ------------------------------------------------------------------------------------------------ context: no lookahead
def test_decision_context_uses_only_candles_up_to_the_decision_bar():
    cs = zigzag_down()
    ctx = scoring.decision_context(cs[:60])
    later = scoring.decision_context(cs[:60] + [Candle(cs[59].ts + H, 1, 500, 0.5, 400, 1)])
    assert ctx["time"] == cs[59].ts and ctx["close"] == cs[59].close
    assert later["time"] != ctx["time"]
    assert scoring.decision_context(cs[:60]) == ctx  # deterministic
    assert scoring.decision_context([]) == {"available": False}


# ------------------------------------------------------------------------------------------------ flags
def test_chased_after_large_candle_far_from_ema20():
    cs = chase_series()
    ctx = scoring.decision_context(cs)
    assert ctx["large_candle"]["direction"] == "bullish"
    assert ctx["ema20_distance_atr"] > scoring.CHASE_EMA_ATR
    entry = cs[-1].close
    a = scoring.assess_entry("long", entry, entry - 3, entry + 6, ctx)
    assert "chased" in keys(a)
    chased = next(f for f in a["flags"] if f["key"] == "chased")
    assert chased["label"] == "Chasing?" and chased["lesson"] == "fomo"
    assert a["components"]["entry"]["score"] <= 60
    # the same candle for a SHORT is not chasing (it is against the move)
    assert "chased" not in keys(scoring.assess_entry("short", entry, entry + 3, entry - 6, ctx))


def test_entered_too_early_long_in_lh_ll_structure():
    cs = zigzag_down()
    ctx = scoring.decision_context(cs)
    assert ctx["structure"] == "bearish"
    entry = ctx["close"]
    assert entry < ctx["last_swing_high"]["price"]  # no close above the last Lower High → no confirmation
    a = scoring.assess_entry("long", entry, entry - 2, entry + 4, ctx)
    assert "entered_too_early" in keys(a)
    early = next(f for f in a["flags"] if f["key"] == "entered_too_early")
    assert "LH/LL" in early["text"] and early["lesson"] == "market-structure"
    # a SHORT in a bearish structure is not "too early"
    assert "entered_too_early" not in keys(scoring.assess_entry("short", entry, entry + 2, entry - 4, ctx))


def test_ignored_structure_long_right_under_resistance_and_bad_rr_and_noise_stop():
    cs = range_under_resistance()
    ctx = scoring.decision_context(cs)
    entry = ctx["close"]
    assert ctx["resistance"] is not None and 0 <= ctx["resistance"] - entry <= scoring.STRUCTURE_ATR * ctx["atr"]
    a = scoring.assess_entry("long", entry, entry - 0.3, entry + 0.2, ctx)
    assert {"ignored_structure", "poor_rr", "stop_in_noise"} <= keys(a)
    ign = next(f for f in a["flags"] if f["key"] == "ignored_structure")
    assert ign["label"] == "Against structure" and ign["level"] == ctx["resistance"]
    assert a["components"]["rr"]["score"] == 15 and a["components"]["stop"]["score"] == 15
    # a wide, structural stop with a 2R target → no stop/R:R flags
    good = scoring.assess_entry("long", entry, entry - 3 * ctx["atr"], entry + 6 * ctx["atr"], ctx)
    assert not keys(good) & {"poor_rr", "stop_in_noise", "low_rr", "no_target"}


def test_counter_trend_against_regime():
    cs = downtrend()
    ctx = scoring.decision_context(cs)
    assert ctx["regime"] == "TRENDING_DOWN"
    entry = ctx["close"]
    atr = ctx["atr"]
    long = scoring.assess_entry("long", entry, entry - 2 * atr, entry + 4 * atr, ctx)
    short = scoring.assess_entry("short", entry, entry + 2 * atr, entry - 4 * atr, ctx)
    assert "counter_trend" in keys(long) and long["components"]["regime"]["score"] == 20
    assert "counter_trend" not in keys(short) and short["components"]["regime"]["score"] == 100


def test_rr_bands_and_no_target():
    ctx = scoring.decision_context(downtrend())
    e, a = ctx["close"], ctx["atr"]
    assert scoring.assess_entry("short", e, e + a, e - 2.5 * a, ctx)["components"]["rr"]["score"] == 100
    assert scoring.assess_entry("short", e, e + a, e - 1.6 * a, ctx)["components"]["rr"]["score"] == 85
    low = scoring.assess_entry("short", e, e + a, e - 1.2 * a, ctx)
    assert low["components"]["rr"]["score"] == 55 and "low_rr" in keys(low)
    nt = scoring.assess_entry("short", e, e + a, None, ctx)
    assert nt["planned_rr"] is None and "no_target" in keys(nt)


def test_every_flag_maps_to_an_existing_lesson():
    for key, info in scoring.FLAGS.items():
        assert info["lesson"] in LESSONS_BY_SLUG, key
    assert scoring.FLAGS["chased"]["label"] == "Chasing?"
    assert scoring.FLAGS["ignored_structure"]["label"] == "Against structure"


# ------------------------------------------------------------------------------------------------ scores
def test_score_prediction_direction_and_partial():
    ctx = scoring.decision_context(downtrend())
    e, a = ctx["close"], ctx["atr"]
    assessment = scoring.assess_entry("short", e, e + 2 * a, e - 4 * a, ctx)
    pending = scoring.score_prediction(assessment, {"status": "open"})
    assert pending["final"] is False and "direction" not in pending["components"]
    win = scoring.score_prediction(assessment, {"status": "target", "r_result": 2.0})
    loss = scoring.score_prediction(assessment, {"status": "stop", "r_result": -1.0})
    assert win["final"] and loss["final"]
    assert win["score"] > pending["score"] > loss["score"]
    assert 0 <= loss["score"] <= win["score"] <= 100
    exp = scoring.score_prediction(assessment, {"status": "expired", "r_result": 0.5, "bars_held": 50})
    assert exp["components"]["direction"]["score"] == 65
    final_open = scoring.score_prediction(assessment, {"status": "open", "r_result": 1.2}, final=True)
    assert final_open["final"] and final_open["components"]["direction"]["score"] == 85


def test_wait_scores_and_flags():
    assert scoring.score_wait({"right_to_wait": True})["score"] == 100
    missed = {"right_to_wait": False, "clean_move": "up"}
    assert scoring.score_wait(missed)["score"] == 30
    assert scoring.wait_flags(missed)[0]["key"] == "missed_move"
    assert scoring.score_wait({"right_to_wait": None}) == {"score": None, "components": {}, "final": False}
    assert scoring.wait_flags({"right_to_wait": True}) == []


def test_session_score_outcome_weighting():
    items = [
        {"action": "long", "outcome": {"status": "target"}, "score": 90, "final": True},
        {"action": "short", "outcome": {"status": "stop"}, "score": 30, "final": True},
        {"action": "wait", "outcome": {"right_to_wait": True}, "score": 100, "final": True},
        {"action": "long", "outcome": {"status": "open"}, "score": 70, "final": False},  # not known yet
    ]
    # (1·90 + 1·30 + 0.5·100) / 2.5 = 68
    assert scoring.session_score(items) == pytest.approx(68.0)
    items.append({"action": "short", "outcome": {"status": "expired"}, "score": 50, "final": True})
    assert scoring.session_score(items) == pytest.approx((90 + 30 + 50 + 0.75 * 50) / 3.25, abs=0.05)
    assert scoring.session_score([]) is None
    assert (
        scoring.grade(90) == "A" and scoring.grade(72) == "B" and scoring.grade(60) == "C" and scoring.grade(10) == "D"
    )
    assert scoring.grade(None) is None


def test_is_correct():
    assert scoring.is_correct("long", {"status": "target"}) is True
    assert scoring.is_correct("short", {"status": "stop"}) is False
    assert scoring.is_correct("long", {"status": "open"}) is None
    assert scoring.is_correct("wait", {"right_to_wait": True}) is True
    assert scoring.is_correct("wait", {"right_to_wait": False}) is False
