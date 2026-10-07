"""S5 — resolution of replay predictions (LONG/SHORT) and WAIT decisions on revealed candles."""

from __future__ import annotations

import pytest

from app.market.base import Candle
from app.replay import outcomes

H = 3600


def C(i: int, o: float, h: float, low: float, c: float) -> Candle:
    return Candle(1_000_000 + i * H, o, h, low, c, 1.0)


# ------------------------------------------------------------------------------------------------ LONG / SHORT
def test_long_hits_target():
    bars = [C(1, 100, 101, 99.5, 100.5), C(2, 100.5, 104.2, 100.2, 104)]
    o = outcomes.resolve_prediction("long", 100, 98, 104, bars)
    assert o["status"] == "target" and o["bars_held"] == 2
    assert o["r_result"] == pytest.approx(2.0)
    assert o["exit_price"] == 104 and o["exit_ts"] == bars[1].ts
    assert o["mfe_r"] == pytest.approx(2.0)
    assert o["mae_r"] == pytest.approx(-0.25)
    assert outcomes.prediction_correct(o) is True


def test_long_hits_stop():
    bars = [C(1, 100, 100.5, 99, 99.2), C(2, 99.2, 99.4, 97.5, 98)]
    o = outcomes.resolve_prediction("long", 100, 98, 104, bars)
    assert o["status"] == "stop" and o["bars_held"] == 2
    assert o["r_result"] == pytest.approx(-1.0)
    assert outcomes.prediction_correct(o) is False


def test_same_candle_stop_and_target_counts_stop_first():
    bars = [C(1, 100, 105, 97, 103)]  # both 98 and 104 inside one candle
    o = outcomes.resolve_prediction("long", 100, 98, 104, bars)
    assert o["status"] == "stop"
    assert o["same_bar_stop_and_target"] is True
    assert o["r_result"] == pytest.approx(-1.0)
    s = outcomes.resolve_prediction("short", 100, 102, 96, [C(1, 100, 103, 95, 97)])
    assert s["status"] == "stop" and s["same_bar_stop_and_target"] is True and s["r_result"] == pytest.approx(-1.0)


def test_gap_through_stop_exits_at_open_worse_than_minus_one_r():
    bars = [C(1, 96, 97, 95, 96.5)]  # opens below the stop
    o = outcomes.resolve_prediction("long", 100, 98, 104, bars)
    assert o["status"] == "stop" and o["gap"] is True
    assert o["exit_price"] == 96 and o["r_result"] == pytest.approx(-2.0)


def test_gap_through_target_exits_at_better_open():
    o = outcomes.resolve_prediction("long", 100, 98, 104, [C(1, 105, 106, 104.5, 105.5)])
    assert o["status"] == "target" and o["gap"] is True and o["r_result"] == pytest.approx(2.5)


def test_short_mirror():
    bars = [C(1, 100, 100.4, 99, 99.5), C(2, 99.5, 99.6, 95.8, 96)]
    o = outcomes.resolve_prediction("short", 100, 102, 96, bars)
    assert o["status"] == "target" and o["r_result"] == pytest.approx(2.0)
    assert o["mae_r"] == pytest.approx(-0.2)


def test_open_and_expired():
    calm = [C(i, 100, 100.6, 99.6, 100.3) for i in range(1, 11)]
    o = outcomes.resolve_prediction("long", 100, 98, 104, calm)
    assert o["status"] == "open" and o["bars_held"] == 10 and o["exit_price"] is None
    assert o["r_result"] == pytest.approx(0.15)
    assert outcomes.prediction_correct(o) is None
    many = [C(i, 100, 100.6, 99.6, 101) for i in range(1, 70)]
    e = outcomes.resolve_prediction("long", 100, 98, 104, many)
    assert e["status"] == "expired" and e["bars_held"] == outcomes.PREDICTION_HORIZON == 50
    assert e["exit_ts"] == many[49].ts and e["r_result"] == pytest.approx(0.5)
    assert outcomes.prediction_correct(e) is True
    neg = outcomes.resolve_prediction("long", 100, 98, 104, [C(i, 100, 100.2, 99, 99.5) for i in range(1, 60)])
    assert neg["status"] == "expired" and outcomes.prediction_correct(neg) is False


def test_no_target_is_resolved_only_by_stop_or_horizon():
    bars = [C(i, 100, 110, 99, 109) for i in range(1, 5)]
    o = outcomes.resolve_prediction("long", 100, 98, None, bars)
    assert o["status"] == "open" and o["mfe_r"] == pytest.approx(5.0)


def test_rejects_wait_and_zero_risk():
    with pytest.raises(ValueError):
        outcomes.resolve_prediction("wait", 100, 98, 104, [])
    with pytest.raises(ValueError):
        outcomes.resolve_prediction("long", 100, 100, 104, [])


# ------------------------------------------------------------------------------------------------ WAIT
def test_wait_wrong_when_clean_move_up():
    # ATR 1: price climbs to +1.5 ATR without dipping −1 ATR first
    bars = [C(1, 100, 100.6, 99.5, 100.4), C(2, 100.4, 101.0, 100.1, 100.9), C(3, 100.9, 101.7, 100.7, 101.6)]
    o = outcomes.resolve_wait(100, 1.0, bars)
    assert o["right_to_wait"] is False and o["status"] == "resolved"
    assert o["clean_move"] == "up" and o["bars_to_move"] == 3
    assert "LONG" in o["explanation"]


def test_wait_right_when_move_first_goes_against():
    bars = [
        C(1, 100, 100.2, 98.9, 99.2),  # −1.1 ATR first → the up move is no longer "clean"
        C(2, 99.2, 101.2, 99.1, 101.1),
        C(3, 101.1, 101.8, 100.9, 101.6),  # +1.8 ATR afterwards
    ] + [C(i, 101, 101.3, 100.6, 101) for i in range(4, 11)]
    o = outcomes.resolve_wait(100, 1.0, bars)
    assert o["clean_move"] is None
    assert o["right_to_wait"] is True


def test_wait_clean_move_down():
    bars = [C(1, 100, 100.5, 99.3, 99.4), C(2, 99.4, 99.6, 98.3, 98.4)]
    o = outcomes.resolve_wait(100, 1.0, bars)
    assert o["right_to_wait"] is False and o["clean_move"] == "down" and "SHORT" in o["explanation"]


def test_wait_same_candle_both_thresholds_is_not_clean():
    bars = [C(1, 100, 101.6, 98.9, 100)] + [C(i, 100, 100.3, 99.7, 100) for i in range(2, 11)]
    o = outcomes.resolve_wait(100, 1.0, bars)
    assert o["clean_move"] is None and o["right_to_wait"] is True


def test_wait_quiet_market_and_open_state():
    quiet = [C(i, 100, 100.4, 99.6, 100.1) for i in range(1, 11)]
    o = outcomes.resolve_wait(100, 1.0, quiet)
    assert o["right_to_wait"] is True and o["status"] == "resolved" and o["bars_observed"] == 10
    partial = outcomes.resolve_wait(100, 1.0, quiet[:4])
    assert partial["status"] == "open" and partial["right_to_wait"] is None
    assert "4 от 10" in partial["explanation"]


def test_wait_only_uses_horizon_bars():
    quiet = [C(i, 100, 100.4, 99.6, 100.1) for i in range(1, 11)]
    late = [C(11, 100, 104, 99.9, 103.9)]  # the 11th candle is outside the 10-bar window
    assert outcomes.resolve_wait(100, 1.0, quiet + late)["right_to_wait"] is True
