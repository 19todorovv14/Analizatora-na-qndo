"""S5 — replay service details: real-candle anchoring for closed markets, exact window counts, FX-aware risk
sizing, an idempotent finish that cancels pending orders, the options endpoint and the list limit."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.main import app
from app.replay import presets, scoring
from app.services import market_service

H = 3600


def _base(days: int = 30) -> int:
    return (int(time.time()) // H) * H - days * 86400


def _gapped(monkeypatch, *gaps: tuple[int, int]) -> None:
    real = market_service.candles

    def candles(*a, **k):
        return [c for c in real(*a, **k) if not any(lo <= c.ts <= hi for lo, hi in gaps)]

    monkeypatch.setattr(market_service, "candles", candles)


# ------------------------------------------------------------------------------------------------ closed markets
def test_start_and_end_inside_closed_hours_are_anchored_on_real_candles(guest, monkeypatch):
    base = _base()
    _gapped(monkeypatch, (base - 3 * H, base + 2 * H), (base + 37 * H, base + 45 * H))
    r = guest.post(
        "/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": base, "bars": 40, "mode": "predict"}
    )
    assert r.status_code == 200, r.text
    s = r.json()
    sess = s["session"]
    assert sess["start_ts"] == sess["cursor_ts"] == base - 4 * H  # the last real candle before the chosen date
    assert sess["end_ts"] == base + 36 * H  # the last real candle of the window
    assert max(c["time"] for c in s["candles"]) == sess["cursor_ts"]
    # exact candle counts (base+3h … base+36h = 34 candles), not hours
    assert (sess["bars"], sess["revealed"], sess["remaining"]) == (34, 0, 34)
    st = guest.post(f"/api/replay/{sess['id']}/step", json={"n": 1}).json()
    assert st["session"]["cursor_ts"] == base + 3 * H  # the closed hours after the start are skipped
    assert (st["session"]["revealed"], st["session"]["remaining"]) == (1, 33)
    st = guest.post(f"/api/replay/{sess['id']}/step", json={"n": 100}).json()
    assert st["session"]["cursor_ts"] == st["session"]["end_ts"] == base + 36 * H
    assert st["session"]["status"] == "finished"
    assert (st["session"]["revealed"], st["session"]["remaining"]) == (34, 0)
    assert max(c["time"] for c in st["candles"]) == base + 36 * H


def test_window_that_lost_its_last_candles_finishes_on_the_last_real_candle(guest, monkeypatch):
    base = _base()
    r = guest.post(
        "/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": base, "bars": 30, "mode": "predict"}
    )
    sess = r.json()["session"]
    assert sess["end_ts"] == base + 30 * H
    _gapped(monkeypatch, (base + 26 * H, base + 40 * H))  # e.g. a provider that has no candles there any more
    st = guest.post(f"/api/replay/{sess['id']}/step", json={"n": 100}).json()
    assert st["session"]["status"] == "finished"
    assert st["session"]["cursor_ts"] == st["session"]["end_ts"] == base + 25 * H
    assert max(c["time"] for c in st["candles"]) == st["session"]["cursor_ts"]
    assert guest.post(f"/api/replay/{sess['id']}/step", json={"n": 1}).status_code == 400


def test_no_candles_in_the_chosen_period_is_a_clear_error(guest, monkeypatch):
    base = _base()
    _gapped(monkeypatch, (base - 200 * H, base + 100 * H))
    r = guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": base, "bars": 40})
    assert r.status_code == 400 and "свещи" in r.json()["detail"]


def test_preset_sessions_count_candles_exactly(guest):
    s = guest.post(
        "/api/replay", json={"symbol": "ETH/USDT", "timeframe": "1h", "preset": "range", "bars": 80, "seed": 2}
    ).json()["session"]
    assert (s["bars"], s["revealed"], s["remaining"]) == (80, 0, 80)
    st = guest.post(f"/api/replay/{s['id']}/step", json={"n": 5}).json()["session"]
    assert (st["revealed"], st["remaining"]) == (5, 75)


# ------------------------------------------------------------------------------------------------ sizing
def test_risk_sizing_converts_quote_currency_to_the_usd_account():
    """USD/JPY: the stop distance is in JPY, the account in USD — 1% risk must be ~1% of the USD equity."""
    client = TestClient(app)
    assert client.post("/api/auth/guest", headers={"x-ta-client": "web"}).status_code == 200
    client.headers.update({"x-ta-client": "web"})
    r = client.post("/api/replay", json={"symbol": "USD/JPY", "timeframe": "1h", "start_ts": _base(), "bars": 40})
    assert r.status_code == 200, r.text
    s = r.json()
    sid = s["session"]["id"]
    price = s["candles"][-1]["close"]
    stop = round(price * 0.99, 3)
    d = client.post(
        f"/api/replay/{sid}/decision",
        json={"action": "long", "stop": stop, "target": round(price * 1.02, 3), "place_order": True, "risk_pct": 1},
    )
    assert d.status_code == 200, d.text
    qty = d.json()["order"]["qty"]
    risk_usd = qty * (price - stop) / price  # JPY risk converted at 1 / USDJPY
    assert 50 <= risk_usd <= 100.5, (qty, risk_usd)


# ------------------------------------------------------------------------------------------------ finish
def test_finish_cancels_pending_orders_and_is_idempotent(guest):
    s = guest.post(
        "/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": _base(), "bars": 60}
    ).json()
    sid = s["session"]["id"]
    price = s["candles"][-1]["close"]
    o = guest.post(
        f"/api/replay/{sid}/order",
        json={"side": "buy", "type": "limit", "qty": 0.01, "price": round(price * 0.5, 2)},
    ).json()
    assert o["order"]["status"] in ("pending", "open")
    guest.post(f"/api/replay/{sid}/decision", json={"action": "wait"})
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 12}).json()
    assert [x["id"] for x in st["account"]["orders"]] == [o["order"]["id"]]  # far below the market: not filled
    first = guest.post(f"/api/replay/{sid}/finish").json()
    assert first["account"]["orders"] == []  # an entry order can never fill once the period is over
    assert first["session"]["status"] == "finished"
    second = guest.post(f"/api/replay/{sid}/finish").json()
    assert second["history_review"] == first["history_review"]  # the stored review, not a new one
    assert second["session"]["score"] == first["session"]["score"]
    assert second["what_happened_next"] == first["what_happened_next"]
    assert len(first["what_happened_next"]) == 30


def test_finish_after_the_window_ended_by_stepping(guest):
    s = guest.post(
        "/api/replay",
        json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": _base(), "bars": 25, "mode": "predict"},
    ).json()
    sid = s["session"]["id"]
    guest.post(f"/api/replay/{sid}/decision", json={"action": "wait"})
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 100}).json()
    assert st["session"]["status"] == "finished" and st["session"]["has_review"] is False
    fin = guest.post(f"/api/replay/{sid}/finish")
    assert fin.status_code == 200
    f = fin.json()
    assert f["session"]["has_review"] is True and f["history_review"]["predictions"][0]["action"] == "wait"
    assert f["history_review"]["predictions"][0]["score_final"] is True


# ------------------------------------------------------------------------------------------------ options / list
def test_options_are_public_static_metadata():
    r = TestClient(app).get("/api/replay/options")
    assert r.status_code == 200
    o = r.json()
    assert [m["key"] for m in o["modes"]] == ["trade", "predict"]
    assert [p["key"] for p in o["presets"]] == list(presets.PRESET_KEYS)
    assert all(p["label"] and p["label_bg"] and p["description"] for p in o["presets"])
    assert o["actions"] == ["long", "short", "wait"]
    assert o["limits"]["step_max"] == 100 and o["limits"]["bars"] == {"min": 20, "max": 1000}
    assert o["rules"]["prediction_horizon_bars"] == 50 and o["rules"]["wait_horizon_bars"] == 10
    assert o["rules"]["same_candle_policy"] == "stop_first"
    keys = [f["key"] for f in o["flags"]]
    assert keys == list(scoring.FLAG_KEYS)
    chased = next(f for f in o["flags"] if f["key"] == "chased")
    assert chased["label"] == "Chasing?" and chased["href"].startswith("/learn/")
    assert o["strategy_sentence"] == "Here is what a rule-based strategy would have done."
    assert "rule-based hypothetical setup" in o["disclaimer"]


def test_list_limit(guest):
    for _ in range(3):
        guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": _base(), "bars": 20})
    rows = guest.get("/api/replay?limit=2").json()["sessions"]
    assert len(rows) == 2 and rows[0]["id"] > rows[1]["id"]
    assert guest.get("/api/replay?limit=0").status_code == 422
