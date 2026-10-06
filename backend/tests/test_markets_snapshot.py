"""S1 quote snapshot engine (app.market.overview): math on demo data at a fixed clock, caching, DATA_NOT_AVAILABLE,
error scrubbing, warm-up thread and router lifespan. No network anywhere in this file."""

from __future__ import annotations

import asyncio
import threading

import pytest

from app import indicators as ind
from app.analysis.regime import classify
from app.config import get_settings
from app.market import catalog, overview
from app.market.base import AssetSpec, Candle, DataSource, MarketDataError, MarketDataProvider, Ticker
from app.market.catalog import ASSETS, get_asset
from app.market.overview import ENGINE, QuoteEngine
from app.market.registry import demo_provider, set_provider_override
from app.services import market_service

NOW = 1_780_000_123  # same fixed clock as the other market tests
DAY = 86400


@pytest.fixture(autouse=True)
def _fresh_engine():
    ENGINE.reset()
    yield
    ENGINE.background.drain()
    ENGINE.reset()


@pytest.fixture
def settings(monkeypatch):
    yield get_settings()


def _c(ts: int, close: float, spread: float = 1.0) -> Candle:
    return Candle(ts, close, close + spread, close - spread, close, 10.0)


# ------------------------------------------------------------------ pure helpers
def test_downsample_keeps_first_and_last_and_caps_points():
    values = list(range(48))
    out = overview.downsample(values, 32)
    assert len(out) == 32 and out[0] == 0 and out[-1] == 47
    assert out == sorted(out)
    assert overview.downsample([1, 2, 3], 32) == [1, 2, 3]


def test_change_7d_uses_the_close_at_least_seven_days_old():
    day0 = (NOW // DAY) * DAY
    daily = [_c(day0 - k * DAY, 100.0 + k) for k in range(20, 0, -1)]  # closed days, newest = yesterday
    # last candle that closed at or before now - 7d: open = day0 - 8d (close 108)
    assert overview.change_7d_pct(daily, 120.0, NOW) == pytest.approx((120 / 108 - 1) * 100)
    assert overview.change_7d_pct(daily[-3:], 120.0, NOW) is None  # not enough history → None, never guessed
    assert overview.change_7d_pct(daily, None, NOW) is None


def test_daily_trend_up_down_sideways_and_insufficient():
    up = [100 * 1.01**i for i in range(80)]
    down = [100 * 0.99**i for i in range(80)]
    flat = [100.0 + (0.01 if i % 2 else -0.01) for i in range(80)]
    assert overview.daily_trend(up, 1.0) == "up"
    assert overview.daily_trend(down, 1.0) == "down"
    assert overview.daily_trend(flat, 1.0) == "sideways"
    assert overview.daily_trend(up[:30], 1.0) is None


def test_atr_pct_matches_indicator():
    day0 = (NOW // DAY) * DAY
    daily = [_c(day0 - k * DAY, 100.0, spread=2.0) for k in range(30, 0, -1)]
    atr = ind.atr([c.high for c in daily], [c.low for c in daily], [c.close for c in daily], 14)[-1]
    assert overview.atr_pct(daily, 100.0) == pytest.approx(atr)  # price 100 → ATR % == ATR
    assert overview.atr_pct(daily[:5], 100.0) is None


def test_scrub_secrets_removes_query_strings_and_configured_keys(settings, monkeypatch):
    monkeypatch.setattr(settings, "twelvedata_api_key", "TDSECRET123")
    text = overview.scrub_secrets("GET https://api.test/x?symbol=AAPL&apikey=abc failed (key TDSECRET123) token=zzz")
    assert "abc" not in text and "TDSECRET123" not in text and "zzz" not in text
    assert "?…" in text


# ------------------------------------------------------------------ demo snapshot math
def test_demo_snapshot_math_at_fixed_now():
    spec = get_asset("BTC/USDT")
    p = demo_provider()
    q = ENGINE.quote(spec, now=NOW)
    assert q["status"] == "ok" and q["available"] is True and q["partial"] is False
    assert q["symbol"] == "BTC/USDT" and q["as_of"] == NOW and q["currency"] == "USDT" and q["precision"] == 2
    assert q["source"]["id"] == "demo" and q["source"]["status"] == "demo"

    ticker = p.get_ticker(spec, now=NOW)
    hourly = p.get_candles(spec, "1h", limit=49, now=NOW)
    daily = [c for c in p.get_candles(spec, "1d", limit=301, now=NOW) if c.ts + DAY <= NOW][-300:]
    window = hourly[-24:]
    high, low = max(c.high for c in window), min(c.low for c in window)

    assert q["price"] == ticker.price  # identical to /api/market/ticker
    assert q["change_24h_pct"] == ticker.change_24h_pct and q["change_basis"] == "rolling_24h"
    assert q["high_24h"] == max(high, ticker.price) and q["low_24h"] == min(low, ticker.price)
    assert q["low_24h"] <= q["price"] <= q["high_24h"]
    assert q["volume_24h"] == pytest.approx(ticker.volume_24h)
    assert q["volume_24h_usd"] == pytest.approx(ticker.volume_24h * ticker.price, rel=1e-9)
    assert q["range_24h_pct"] == pytest.approx((q["high_24h"] - q["low_24h"]) / q["low_24h"] * 100, abs=1e-3)
    ref = [c for c in daily if c.ts + DAY <= NOW - 7 * DAY][-1]
    assert q["change_7d_pct"] == pytest.approx((ticker.price / ref.close - 1) * 100, abs=1e-3)
    assert q["atr_pct_1d"] == pytest.approx(overview.atr_pct(daily, ticker.price), abs=1e-3)
    assert q["regime"] == classify(daily)["regime"]
    assert q["trend"] in ("up", "down", "sideways")
    assert q["trend"] == overview.daily_trend(
        [c.close for c in daily] + [ticker.price], overview.atr_pct(daily, ticker.price)
    )
    # sparkline: ≤ 32 points from the last 48 hourly closes, newest = current price
    assert q["sparkline_tf"] == "1h" and len(q["sparkline"]) == 32
    assert q["sparkline"][0] == hourly[-48].close and q["sparkline"][-1] == ticker.price


def test_regime_1d_matches_market_service_regime_snapshot():
    spec = get_asset("EUR/USD")
    e = ENGINE.entry(spec, now=NOW)
    snap = market_service.regime_snapshot("EUR/USD", "1d", NOW)
    assert e.extra["regime_1d"] == snap
    assert e.quote["regime"] == snap["regime"]


def test_demo_volume_in_usd_has_no_fx_conversion():
    """The demo generator builds volume so that volume × price ≈ daily_volume_usd for every quote currency
    (regression: ETH/BTC must not be multiplied by the BTC price)."""
    for symbol in ("ETH/BTC", "USD/JPY", "EUR/GBP"):
        try:
            spec = get_asset(symbol)
        except catalog.UnknownAssetError:
            continue
        q = ENGINE.quote(spec, now=NOW)
        assert q["volume_24h_usd"] == pytest.approx(q["volume_24h"] * q["price"], rel=1e-6)
        assert q["volume_24h_usd"] < spec.daily_volume_usd * 10  # same order of magnitude as the generator input


# ------------------------------------------------------------------ caching
def test_cache_ttl_follows_the_clock_passed_in():
    spec = get_asset("ETH/USDT")
    a = ENGINE.quote(spec, now=NOW)
    assert ENGINE.quote(spec, now=NOW + 30) is a  # demo TTL 60 s
    b = ENGINE.quote(spec, now=NOW + 61)
    assert b is not a and b["as_of"] == NOW + 61
    c = ENGINE.quote(spec, now=NOW)  # clock went backwards → recomputed, never a future snapshot
    assert c["as_of"] == NOW
    assert ENGINE.cached(spec, now=NOW + 200) is c  # lists may use snapshots up to 10 minutes old
    assert ENGINE.cached(spec, now=NOW + 601) is None


def test_cache_is_per_provider():
    spec = get_asset("SOL/USDT")
    q_demo = ENGINE.quote(spec, now=NOW)
    fake = _FakeProvider("fake")
    set_provider_override(fake)
    try:
        q_fake = ENGINE.quote(spec, now=NOW)
    finally:
        set_provider_override(None)
    assert q_demo["source"]["id"] == "demo" and q_fake["source"]["id"] == "fake"
    assert ENGINE.quote(spec, now=NOW)["source"]["id"] == "demo"


# ------------------------------------------------------------------ availability / errors
def test_data_not_available_when_routing_excludes_the_instrument(settings, monkeypatch):
    monkeypatch.setattr(settings, "market_data_stocks", "binance")  # AAPL has no Binance symbol
    q = ENGINE.quote(get_asset("AAPL"), now=NOW)
    assert q["available"] is False and q["status"] == "unavailable" and q["code"] == "DATA_NOT_AVAILABLE"
    assert "No configured provider for stock supports AAPL" in q["reason"]
    assert all(q[f] is None for f in overview.QUOTE_FIELDS) and q["sparkline"] == []
    assert q["source"]["status"] == "unavailable"


def test_synced_instrument_without_demo_parameters_is_not_available():
    specs = catalog.set_synced_assets(
        [
            catalog.spec_from_item(
                {
                    "symbol": "ZZZ/USDT",
                    "name": "ZZZ",
                    "asset_class": "crypto",
                    "price_precision": 4,
                    "qty_step": 1,
                    "min_qty": 1,
                    "max_leverage": 2,
                    "spread_bps": 5,
                    "providers": {"binance": "ZZZUSDT"},
                },
                curated=False,
                source="binance",
            )
        ]
    )
    try:
        q = overview.get_quote("ZZZ/USDT", now=NOW)
        assert q["status"] == "unavailable" and q["code"] == "DATA_NOT_AVAILABLE" and q["price"] is None
        assert specs[0].symbol == "ZZZ/USDT"
    finally:
        catalog.clear_synced()
    assert overview.get_quote("NOPE/NOPE", now=NOW)["status"] == "unknown"


class _FakeProvider(MarketDataProvider):
    """Demo-backed provider with another id (or failing with a secret in the message)."""

    def __init__(self, pid: str, fail: bool = False):
        self.source = DataSource(id=pid, name=pid, is_live=True, disclaimer="test", status="live")
        self.fail = fail
        self.calls = 0

    def supports(self, asset: AssetSpec) -> bool:
        return asset.demo_capable

    def get_candles(self, asset, timeframe, **kw):
        self.calls += 1
        if self.fail:
            raise MarketDataError("provider down: GET https://x.test/q?apikey=SECRET123")
        return demo_provider().get_candles(asset, timeframe, **kw)

    def get_ticker(self, asset, *, now=None) -> Ticker:
        self.calls += 1
        if self.fail:
            raise MarketDataError("provider down: GET https://x.test/q?apikey=SECRET123")
        return demo_provider().get_ticker(asset, now=now)


def test_provider_errors_become_error_quotes_without_secrets():
    fake = _FakeProvider("flaky", fail=True)
    set_provider_override(fake)
    try:
        q = ENGINE.quote(get_asset("BTC/USDT"), now=NOW)
        assert q["status"] == "error" and q["code"] == "MARKET_DATA_ERROR" and q["available"] is False
        assert "SECRET123" not in q["reason"] and "provider down" in q["reason"]
        calls = fake.calls
        ENGINE.quote(get_asset("BTC/USDT"), now=NOW + 10)  # errors are cached briefly (20 s)…
        assert fake.calls == calls
        ENGINE.quote(get_asset("BTC/USDT"), now=NOW + 25)  # …then retried
        assert fake.calls > calls
    finally:
        set_provider_override(None)


# ------------------------------------------------------------------ collect / warm-up
def test_collect_excludes_unavailable_and_respects_the_time_budget(settings, monkeypatch):
    monkeypatch.setattr(settings, "market_data_fx", "binance")  # forex → DATA_NOT_AVAILABLE
    specs = [a for a in ASSETS if a.asset_class in ("forex", "index")]
    col = ENGINE.collect(specs, now=NOW, seconds=30)
    n_fx = sum(1 for a in specs if a.asset_class == "forex")
    assert col.eligible == len(specs) and col.unavailable == n_fx and col.missing == 0
    assert {s.asset_class for s, _ in col.items} == {"index"}
    ENGINE.reset()
    cold = ENGINE.collect(specs, now=NOW, seconds=0)  # no time budget → nothing computed inside the request
    assert cold.items == [] and cold.missing == len(specs) - n_fx


def test_warm_computes_curated_snapshots():
    specs = [a for a in ASSETS if a.asset_class == "index"]
    counts = ENGINE.warm(NOW, specs=specs)
    assert counts == {"ok": len(specs)}
    assert all(ENGINE.cached(s, now=NOW) is not None for s in specs)
    state = ENGINE.warmup_status()
    assert state["passes"] == 1 and state["last_pass_ts"] == NOW and state["enabled"] is False  # APP_ENV=test


def test_warmup_thread_is_disabled_in_tests_and_starts_when_enabled(settings, monkeypatch):
    assert overview.start_warmup() is False  # APP_ENV=test
    engine = QuoteEngine()
    passes = threading.Event()

    def fake_warm(now=None, **kw):
        passes.set()
        return {}

    monkeypatch.setattr(engine, "warm", fake_warm)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "market_warmup", False)
    assert engine.start_warmup() is False
    monkeypatch.setattr(settings, "market_warmup", True)
    assert engine.start_warmup() is True
    assert passes.wait(5)
    assert engine.warmup_status()["running"] is True
    engine.stop_warmup()
    assert engine.warmup_status()["running"] is False


def test_router_lifespan_starts_and_stops_the_warmup(monkeypatch):
    from app.api import markets as markets_api

    calls: list[str] = []
    monkeypatch.setattr(overview, "start_warmup", lambda: calls.append("start") or True)
    monkeypatch.setattr(overview, "stop_warmup", lambda: calls.append("stop"))

    async def run():
        async with markets_api.router.lifespan_context(None):
            calls.append("inside")

    asyncio.run(run())
    assert calls == ["start", "inside", "stop"]


def test_background_worker_deduplicates_jobs():
    bg = overview.Background(workers=1, max_pending=2)
    gate = threading.Event()
    f1 = bg.submit("a", lambda: gate.wait(5) and 1)
    assert bg.submit("a", lambda: 2) is f1
    f2 = bg.submit("b", lambda: 3)
    assert bg.submit("c", lambda: 4) is None  # queue full
    gate.set()
    assert f1.result(5) == 1 and f2.result(5) == 3
    assert bg.drain(5)
