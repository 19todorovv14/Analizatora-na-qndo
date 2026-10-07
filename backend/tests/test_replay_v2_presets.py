"""S5 — period presets: deterministic past windows matching a regime, never the last bars, no future leakage."""

from __future__ import annotations

import json
import random
import time

import pytest

from app.market.base import Candle
from app.market.timeframes import tf_seconds
from app.replay import presets
from app.services import market_service

H = 3600


def synthetic(n: int = 2400, seed: int = 3) -> list[Candle]:
    """Random walk with one long, clean uptrend in the middle."""
    r = random.Random(seed)
    closes = [100.0]
    for i in range(1, n):
        drift = 0.004 if 1200 <= i < 1450 else 0.0
        closes.append(closes[-1] * (1 + drift + 0.006 * (r.random() - 0.5)))
    out = []
    prev = closes[0]
    for i, c in enumerate(closes):
        span = c * 0.004 * (0.6 + 0.8 * r.random())
        out.append(Candle(1_000_000 + i * H, prev, max(prev, c) + span / 2, min(prev, c) - span / 2, c, 10.0))
        prev = c
    return out


@pytest.mark.parametrize("preset", presets.PRESET_KEYS)
def test_window_never_uses_the_last_bars(preset):
    cs = synthetic()
    w = presets.choose_window(cs, preset, 200, seed_key="u1")
    n = len(cs)
    assert w["index"] + w["bars"] == w["end_index"]
    assert n - 1 - w["end_index"] >= presets.FUTURE_GAP_BARS  # ≥ 60 hidden future candles after the window
    assert w["index"] >= presets.HISTORY_BARS  # context before the start exists
    assert w["start_ts"] == cs[w["index"]].ts
    assert w["candidates"] >= 1


def test_deterministic_for_the_same_seed_and_varies_with_the_seed():
    cs = synthetic()
    a = presets.choose_window(cs, "random", 200, seed_key="u1:BTC:1h:0")
    b = presets.choose_window(cs, "random", 200, seed_key="u1:BTC:1h:0")
    assert a == b
    starts = {presets.choose_window(cs, "random", 200, seed_key=f"u1:BTC:1h:{k}")["start_ts"] for k in range(8)}
    assert len(starts) > 1


def test_trend_preset_finds_the_trend():
    cs = synthetic()
    w = presets.choose_window(cs, "trend", 200, seed_key="x")
    assert w["matched"] is True
    assert w["info"]["direction"] == "up"
    assert 1100 <= w["index"] <= 1450  # inside / at the start of the embedded uptrend
    assert w["regime_mix"].get("TRENDING_UP", 0) > 0


def test_errors():
    with pytest.raises(presets.PresetError):
        presets.choose_window(synthetic(), "moon", 200, seed_key="x")
    with pytest.raises(presets.PresetError):
        presets.choose_window(synthetic(400), "trend", 200, seed_key="x")  # not enough history
    assert presets.fetch_span(200) > 200 + presets.FUTURE_GAP_BARS + presets.REGIME_WARMUP_BARS


def test_min_window_bars():
    w = presets.choose_window(synthetic(), "range", 20, seed_key="x")
    assert w["bars"] == presets.MIN_WINDOW_BARS


# ------------------------------------------------------------------------------------------------ API
@pytest.mark.parametrize("preset", ["trend", "breakout", "random"])
def test_preset_session_reveals_nothing_after_the_cursor(guest, preset):
    r = guest.post(
        "/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "preset": preset, "mode": "predict", "seed": 4}
    )
    assert r.status_code == 200, r.text
    s = r.json()
    sess = s["session"]
    assert sess["mode"] == "predict" and sess["preset"]["key"] == preset
    assert max(c["time"] for c in s["candles"]) == sess["cursor_ts"] == sess["start_ts"]
    assert sess["bars"] == 200 and sess["revealed"] == 0
    # the active session never hints at the future: no direction / regime of the picked window
    dumped = json.dumps(sess["preset"])
    assert "direction" not in dumped and "TRENDING" not in dumped
    assert "review" not in s and "setup" not in json.dumps(s["session"])
    # at least 60 closed candles exist after the window end — it is never "the last bars"
    sec = tf_seconds("1h")
    after = market_service.candles(
        "BTC/USDT", "1h", start=sess["end_ts"] + sec, end=int(time.time()), limit=2000, include_partial=False
    )
    assert len(after) >= presets.FUTURE_GAP_BARS
    st = guest.post(f"/api/replay/{sess['id']}/step", json={"n": 7}).json()
    assert max(c["time"] for c in st["candles"]) == st["session"]["cursor_ts"] == sess["start_ts"] + 7 * sec


def test_preset_seed_is_deterministic_via_api(guest):
    body = {"symbol": "ETH/USDT", "timeframe": "4h", "preset": "range", "seed": 11}
    a = guest.post("/api/replay", json=body).json()["session"]
    b = guest.post("/api/replay", json=body).json()["session"]
    assert (a["start_ts"], a["end_ts"]) == (b["start_ts"], b["end_ts"])


def test_preset_errors_via_api(guest):
    r = guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "preset": "moon"})
    assert r.status_code == 422
    r = guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h"})
    assert r.status_code == 400 and "preset" in r.json()["detail"]
    r = guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1w", "preset": "trend"})
    assert r.status_code == 400
    r = guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "preset": "trend", "mode": "live"})
    assert r.status_code == 422
