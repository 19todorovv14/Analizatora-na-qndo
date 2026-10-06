"""S3a — interactive candle drill-down: GET /api/learn/candle-drilldown and the pure explanation."""

from __future__ import annotations

import time

import pytest

from app.market import catalog
from app.market.timeframes import align, tf_seconds
from app.services.learning_service import DRILLDOWN_TIMEFRAME, explain_inside

T = 1_780_000_123  # a fixed past moment inside the demo horizon (2026-05-28)


def _c(t, o, h, low, c):
    return {"time": t, "open": o, "high": h, "low": low, "close": c, "volume": 1.0}


# ------------------------------------------------------------------------------------------- pure
def test_explain_low_first_then_high():
    kids = [_c(0, 100, 101, 95, 96), _c(300, 96, 104, 96, 103), _c(600, 103, 110, 102, 109)]
    parent = _c(0, 100, 110, 95, 109)
    info = explain_inside(parent, kids, "1h", "5m", 2)
    p = info["path"]
    assert p["first_extreme"] == "low" and p["low_index"] == 0 and p["high_index"] == 2
    assert p["low_time"] == 0 and p["high_time"] == 600
    assert p["close_position_pct"] == round((109 - 95) / 15 * 100, 1)
    assert p["largest_move"]["index"] == 1
    text = " ".join(info["explanation"])
    assert "Първо цената пада до Low 95.00" in text and "High 110.00" in text
    assert "близо до High" in text and "bullish" in text
    assert info["summary"].startswith("1H свещта отваря на 100.00")
    assert info["anatomy"]["direction"] == "bullish"


def test_explain_high_first_and_rejection_wicks():
    kids = [_c(0, 100, 112, 99.8, 111), _c(300, 111, 111, 99, 101), _c(600, 101, 102, 100.5, 100.8)]
    parent = _c(0, 100, 112, 99, 100.8)
    info = explain_inside(parent, kids, "1h", "5m", 1)
    assert info["path"]["first_extreme"] == "high"
    text = " ".join(info["explanation"])
    assert "Първо цената достига High 112.0" in text
    assert "Горната сянка" in text and "отхвърлени" in text
    assert "близо до Low" in text


def test_explain_same_sub_candle_and_flat_candle():
    info = explain_inside(_c(0, 100, 105, 95, 101), [_c(0, 100, 105, 95, 101)], "5m", "1m", 2)
    assert info["path"]["first_extreme"] == "same"
    assert "в една и съща 1m свещ" in " ".join(info["explanation"])
    flat = explain_inside(_c(0, 100, 100, 100, 100), [], "1h", "5m", 2)
    assert flat["path"]["first_extreme"] is None and flat["path"]["close_position_pct"] is None
    assert any("не се е движила" in x for x in flat["explanation"])


# ------------------------------------------------------------------------------------------ endpoint
@pytest.mark.parametrize(
    ("tf", "child", "n"),
    [
        ("5m", "1m", 5),
        ("15m", "1m", 15),
        ("30m", "1m", 30),
        ("1h", "5m", 12),
        ("4h", "15m", 16),
        ("1d", "1h", 24),
        ("1w", "1d", 7),
    ],
)
def test_drilldown_children_rebuild_the_parent(client, tf, child, n):
    assert DRILLDOWN_TIMEFRAME[tf] == child
    r = client.get("/api/learn/candle-drilldown", params={"symbol": "BTC/USDT", "timeframe": tf, "time": T})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["available"] is True and d["complete"] is True and d["matches_parent"] is True
    assert d["timeframe"] == tf and d["child_timeframe"] == child and d["expected_candles"] == n
    parent, kids = d["parent"], d["candles"]
    assert parent["time"] == align(T, tf) and len(kids) == n
    assert [k["time"] for k in kids] == [parent["time"] + i * tf_seconds(child) for i in range(n)]
    assert kids[0]["open"] == pytest.approx(parent["open"])
    assert kids[-1]["close"] == pytest.approx(parent["close"])
    assert max(k["high"] for k in kids) == pytest.approx(parent["high"])
    assert min(k["low"] for k in kids) == pytest.approx(parent["low"])
    p = d["path"]
    assert kids[p["high_index"]]["high"] == pytest.approx(parent["high"])
    assert kids[p["low_index"]]["low"] == pytest.approx(parent["low"])
    assert p["first_extreme"] in ("high", "low", "same")
    assert d["explanation"] and d["summary"] and d["disclaimer"]
    assert d["source"]["status"] == "demo" and d["precision"] == 2
    assert set(d["anatomy"]) >= {"direction", "body", "upper_wick", "lower_wick", "body_pct"}


def test_drilldown_aligns_any_time_inside_the_candle(client):
    params = {"symbol": "EUR/USD", "timeframe": "1h"}
    a = client.get("/api/learn/candle-drilldown", params={**params, "time": align(T, "1h")}).json()
    b = client.get("/api/learn/candle-drilldown", params={**params, "time": align(T, "1h") + 3599}).json()
    assert a["parent"] == b["parent"] and a["candles"] == b["candles"] and a["precision"] == 5


def test_drilldown_defaults_to_the_last_closed_candle(client):
    before = int(time.time())
    d = client.get("/api/learn/candle-drilldown", params={"symbol": "BTC/USDT", "timeframe": "1h"}).json()
    after = int(time.time())
    assert d["parent"]["time"] in {align(before, "1h") - 3600, align(after, "1h") - 3600}
    assert d["complete"] is True and len(d["candles"]) == 12


def test_drilldown_of_the_forming_candle_is_marked_incomplete(client):
    d = client.get(
        "/api/learn/candle-drilldown", params={"symbol": "BTC/USDT", "timeframe": "1d", "time": int(time.time())}
    ).json()
    assert d["complete"] is False
    assert any("още не е затворена" in x for x in d["explanation"])
    assert 1 <= len(d["candles"]) <= 24


def test_drilldown_errors(client):
    url = "/api/learn/candle-drilldown"
    r = client.get(url, params={"symbol": "BTC/USDT", "timeframe": "1m"})
    assert r.status_code == 400 and "1m" in r.json()["detail"]
    future = client.get(url, params={"symbol": "BTC/USDT", "timeframe": "1h", "time": int(time.time()) + 7200})
    assert future.status_code == 400
    assert client.get(url, params={"symbol": "NOPE/X", "timeframe": "1h"}).status_code == 404
    assert client.get(url, params={"symbol": "BTC/USDT", "timeframe": "2h"}).status_code == 400
    assert client.get(url, params={"symbol": "BTC/USDT", "timeframe": "1h", "time": -5}).status_code == 422


@pytest.fixture
def synced_without_demo():
    spec = catalog.spec_from_item(
        {
            "symbol": "ZZTEST/EUR",
            "name": "Test coin",
            "asset_class": "crypto",
            "price_precision": 4,
            "qty_step": 1,
            "min_qty": 1,
            "max_leverage": 2,
            "spread_bps": 5,
            "providers": {"binance": "ZZTESTEUR"},
        },
        curated=False,
        source="binance",
    )
    catalog.set_synced_assets([spec])
    yield spec
    catalog.clear_synced()


def test_drilldown_reports_data_not_available(client, synced_without_demo):
    r = client.get(
        "/api/learn/candle-drilldown", params={"symbol": synced_without_demo.symbol, "timeframe": "1h", "time": T}
    )
    assert r.status_code == 503
    body = r.json()
    assert body["code"] == "DATA_NOT_AVAILABLE" and body["symbol"] == synced_without_demo.symbol
