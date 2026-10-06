"""Market data provider abstraction, demo generator, regime and signal engine."""

import random

import pytest

from app.analysis.candles import patterns
from app.analysis.regime import classify
from app.analysis.signal import analyze
from app.analysis.structure import find_swings, structure_trend
from app.market.base import Candle
from app.market.catalog import ASSETS, get_asset
from app.market.demo import DemoMarketDataProvider
from app.market.http_providers import BinancePublicProvider, TwelveDataProvider
from app.market.registry import provider_for
from app.market.timeframes import align, tf_seconds

NOW = 1_780_000_123


@pytest.fixture
def demo():
    return DemoMarketDataProvider(clock=lambda: NOW)


def test_demo_is_deterministic(demo):
    a = demo.get_candles(get_asset("ETH/USDT"), "15m", limit=50, now=NOW)
    b = DemoMarketDataProvider().get_candles(get_asset("ETH/USDT"), "15m", limit=50, now=NOW)
    assert a == b


@pytest.mark.parametrize("child,parent,n", [("1h", "4h", 4), ("5m", "15m", 3), ("1d", "1w", 7), ("1m", "5m", 5)])
def test_timeframes_aggregate_exactly(demo, child, parent, n):
    spec = get_asset("BTC/USDT")
    p = demo.get_candles(spec, parent, limit=3, now=NOW, include_partial=False)[0]
    csec = tf_seconds(child)
    kids = demo.get_candles(spec, child, start=p.ts, end=p.ts + (n - 1) * csec, limit=0, now=NOW, include_partial=False)
    assert len(kids) == n
    assert kids[0].open == pytest.approx(p.open)
    assert kids[-1].close == pytest.approx(p.close)
    assert max(k.high for k in kids) == pytest.approx(p.high)
    assert min(k.low for k in kids) == pytest.approx(p.low)


def test_no_future_candles_and_partial(demo):
    spec = get_asset("BTC/USDT")
    rows = demo.get_candles(spec, "1h", limit=10, now=NOW)
    assert rows[-1].ts == align(NOW, "1h")  # forming candle
    assert all(c.ts <= NOW for c in rows)
    closed = demo.get_candles(spec, "1h", limit=10, now=NOW, include_partial=False)
    assert closed[-1].ts + 3600 <= NOW
    for c in rows:
        assert c.low <= min(c.open, c.close) <= max(c.open, c.close) <= c.high


def test_ticker(demo):
    t = demo.get_ticker(get_asset("EUR/USD"), now=NOW)
    last = demo.get_candles(get_asset("EUR/USD"), "1m", limit=1, now=NOW)[-1]
    assert t.price == pytest.approx(last.close)
    assert t.source == "demo"


def test_registry_defaults_to_demo_and_providers_are_read_only():
    for a in ASSETS:
        assert provider_for(a).source.id == "demo"
    for cls in (BinancePublicProvider, TwelveDataProvider, DemoMarketDataProvider):
        assert not any(hasattr(cls, m) for m in ("create_order", "place_order", "withdraw"))


def test_twelvedata_requires_key():
    from app.market.base import MarketDataError

    p = TwelveDataProvider(None, "https://example.invalid")
    with pytest.raises(MarketDataError, match="TWELVEDATA_API_KEY"):
        p.get_candles(get_asset("EUR/USD"), "1h", limit=5)


def _trend(n=300, drift=0.004, seed=1):
    rng = random.Random(seed)
    out = []
    price = 100.0
    for i in range(n):
        o = price
        price = price * (1 + drift + rng.gauss(0, 0.004))
        rg = price * (0.003 + abs(rng.gauss(0, 0.002)))
        out.append(Candle(i * 3600, o, max(o, price) + rg / 2, min(o, price) - rg / 2, price, 1000))
    return out


def test_regime_trending_up_and_structure():
    data = _trend()
    r = classify(data)
    assert r["regime"] == "TRENDING_UP"
    assert r["reasons"]
    assert classify(_trend(drift=-0.004, seed=2))["regime"] == "TRENDING_DOWN"
    st = structure_trend(find_swings(data))
    assert st["trend"] in ("bullish", "mixed")


def test_candle_patterns():
    assert "doji" in patterns(Candle(0, 100, 105, 95, 100.2, 1))
    assert "hammer" in patterns(Candle(0, 100, 100.6, 94, 100.5, 1))
    assert "shooting_star" in patterns(Candle(0, 100, 106, 98.9, 99.0, 1))
    prev = Candle(0, 104, 104.5, 101, 101.5, 1)
    assert "bullish_engulfing" in patterns(Candle(1, 101, 106.5, 100.5, 106, 1), prev)


def test_signal_engine_outputs(demo):
    spec = get_asset("BTC/USDT")
    rows = demo.get_candles(spec, "1h", limit=400, now=NOW, include_partial=False)
    a = analyze(rows, spec=spec, timeframe="1h")
    assert a["decision"] in ("WAIT", "POSSIBLE LONG", "POSSIBLE SHORT", "NO TRADE")
    assert a["signal"] in ("WAIT", "LONG SETUP", "SHORT SETUP", "NO TRADE")
    assert a["confidence"] in ("LOW", "MEDIUM", "HIGH")
    assert "НЕ" in a["confidence_note"]
    assert a["observation"] and a["analysis"] and a["hypothesis"] and a["teach_me_why"]
    assert [s["stage"] for s in a["pipeline"]] == [
        "Market data",
        "Indicators",
        "Market structure",
        "Strategy rules",
        "Risk engine",
        "Signal",
    ]
    if a["setup"]:
        s = a["setup"]
        if s["side"] == "long":
            assert s["invalidation"] < s["entry"] < s["target"]
        else:
            assert s["invalidation"] > s["entry"] > s["target"]


def test_no_trade_system(demo):
    spec = get_asset("BTC/USDT")
    rows = demo.get_candles(spec, "1h", limit=400, now=NOW, include_partial=False)
    a = analyze(rows, spec=spec, timeframe="1h", news_risk=True)
    assert a["decision"] in ("NO TRADE", "WAIT")
    assert any(r["code"] == "news_risk" for r in a["no_trade_reasons"])
    short = analyze(rows[:30], spec=spec, timeframe="1h")
    assert short["decision"] == "NO TRADE"
    assert short["no_trade_reasons"][0]["code"] == "insufficient_data"
