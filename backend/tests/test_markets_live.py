"""S1 snapshot strategies for live providers, all mocked with httpx.MockTransport (NO network):
Binance (one bulk 24h ticker call + per-symbol daily klines with a per-request budget), Twelve Data (on demand only,
never in lists), CoinGecko market caps for the heatmap."""

from __future__ import annotations

import time
from datetime import UTC, datetime

import httpx
import pytest

from app.config import get_settings
from app.database import SessionLocal
from app.market import marketcap, overview
from app.market.catalog import ASSETS, get_asset
from app.market.http_providers import BinancePublicProvider, RateLimiter, TwelveDataProvider
from app.market.marketcap import CoinGeckoMarketCaps, MarketCapError
from app.market.overview import ENGINE
from app.market.registry import set_provider_override
from app.services import market_service, markets_service

NOW = 1_780_000_123
DAY = 86400
DAY0 = (NOW // DAY) * DAY


@pytest.fixture(autouse=True)
def _clean():
    ENGINE.reset()
    markets_service.reset_caches()
    market_service._regime_cache.clear()  # keyed by (symbol, timeframe) only — other tests used the demo provider
    yield
    set_provider_override(None)
    marketcap.set_provider(None)
    ENGINE.background.drain()
    ENGINE.reset()
    market_service._regime_cache.clear()


@pytest.fixture
def settings(monkeypatch):
    yield get_settings()


def _close(i: int, base: float) -> float:
    return round(base * 1.002 ** (i - DAY0 // DAY), 6)  # steady uptrend


# ------------------------------------------------------------------ Binance mock
BINANCE_CRYPTO = [a for a in ASSETS if a.asset_class == "crypto" and "binance" in a.provider_symbols]


def _ticker_rows() -> list[dict]:
    rows = []
    for n, a in enumerate(BINANCE_CRYPTO):
        last = 100.0 + n
        rows.append(
            {
                "symbol": a.provider_symbols["binance"],
                "lastPrice": str(last),
                "priceChangePercent": str(round((n % 7) - 3 + 0.5, 2)),
                "highPrice": str(last * 1.02),
                "lowPrice": str(last * 0.97),
                "volume": str(1000 + n),
                "quoteVolume": str((1000 + n) * last),
            }
        )
    btc = next(r for r in rows if r["symbol"] == "BTCUSDT")
    btc.update(lastPrice="100000.0", priceChangePercent="2.5", highPrice="101000", lowPrice="97000", volume="1000")
    btc["quoteVolume"] = "99000000"
    ethbtc = next(r for r in rows if r["symbol"] == "ETHBTC")
    ethbtc.update(lastPrice="0.04", volume="500", quoteVolume="20")
    return rows


class BinanceMock:
    def __init__(self):
        self.calls: dict[str, int] = {"tickers": 0, "klines": 0}
        self.tickers = _ticker_rows()

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v3/ticker/24hr":
            assert "symbol" not in request.url.params  # ONE bulk call, never per symbol
            self.calls["tickers"] += 1
            return httpx.Response(200, json=self.tickers)
        if request.url.path == "/api/v3/klines":
            self.calls["klines"] += 1
            assert request.url.params["interval"] == "1d"
            start = int(request.url.params["startTime"]) // 1000
            end = int(request.url.params["endTime"]) // 1000
            t = (start // DAY) * DAY + (DAY if start % DAY else 0)
            out = []
            while t <= end:
                c = _close(t // DAY, 100.0)
                out.append(
                    [t * 1000, str(c * 0.995), str(c * 1.01), str(c * 0.985), str(c), "10", t * 1000 + DAY * 1000 - 1]
                )
                t += DAY
            return httpx.Response(200, json=out)
        return httpx.Response(404, json={"msg": "not mocked"})

    def provider(self) -> BinancePublicProvider:
        p = BinancePublicProvider(
            "https://binance.test", client=httpx.Client(transport=httpx.MockTransport(self.handler))
        )
        p.limiter = RateLimiter(rate_per_sec=1000, burst=1000)
        return p


def test_binance_snapshot_from_bulk_ticker_and_daily_klines():
    mock = BinanceMock()
    set_provider_override(mock.provider())
    q = ENGINE.quote(get_asset("BTC/USDT"), now=NOW)
    assert q["status"] == "ok" and q["partial"] is False
    assert q["source"]["id"] == "binance" and q["source"]["status"] == "live"
    assert (q["price"], q["change_24h_pct"], q["high_24h"], q["low_24h"]) == (100000.0, 2.5, 101000.0, 97000.0)
    assert q["volume_24h"] == 1000.0 and q["volume_24h_usd"] == 99000000.0  # exact quoteVolume (USDT)
    assert q["range_24h_pct"] == pytest.approx((101000 - 97000) / 97000 * 100, abs=1e-3)
    ref = _close((DAY0 - 8 * DAY) // DAY, 100.0)  # daily close at least 7 days old
    assert q["change_7d_pct"] == pytest.approx((100000 / ref - 1) * 100, abs=1e-3)
    assert q["sparkline_tf"] == "1d" and len(q["sparkline"]) == 32 and q["sparkline"][-1] == 100000.0
    assert q["trend"] == "up" and q["regime"] is not None and q["atr_pct_1d"] is not None
    assert mock.calls == {"tickers": 1, "klines": 1}
    ENGINE.quote(get_asset("ETH/USDT"), now=NOW)
    assert mock.calls == {"tickers": 1, "klines": 2}  # bulk ticker shared (cached 30 s by the provider)
    ENGINE.quote(get_asset("BTC/USDT"), now=NOW + 10)
    assert mock.calls == {"tickers": 1, "klines": 2}  # snapshot cached (live TTL 30 s)


def test_binance_request_budget_defers_daily_klines_to_the_background():
    mock = BinanceMock()
    set_provider_override(mock.provider())
    specs = BINANCE_CRYPTO[:12]
    quotes = ENGINE.quotes(specs, now=NOW)
    partial = [q for q in quotes.values() if q["partial"]]
    assert len(partial) == len(specs) - overview.REQUEST_LIVE_FETCHES
    for q in partial:  # 24h fields are there, daily-derived fields are not (never guessed)
        assert q["status"] == "ok" and q["available"] is True and q["price"] is not None
        assert q["change_24h_pct"] is not None and q["volume_24h_usd"] is not None
        assert q["change_7d_pct"] is None and q["trend"] is None and q["regime"] is None and q["sparkline"] == []
        assert q["reason"] == overview.REASON_DAILY_PENDING
    assert mock.calls["tickers"] == 1
    assert ENGINE.background.drain(10)
    assert mock.calls["klines"] == len(specs)
    later = ENGINE.quotes(specs, now=NOW + 21)  # partial snapshots expire after 20 s; daily candles are cached
    assert all(not q["partial"] and q["change_7d_pct"] is not None for q in later.values())
    assert mock.calls["klines"] == len(specs)


def test_binance_volume_in_usd_uses_a_live_rate_only():
    mock = BinanceMock()
    set_provider_override(mock.provider())
    first = ENGINE.quote(get_asset("ETH/BTC"), now=NOW)
    assert first["volume_24h_usd"] is None  # BTC/USD rate not known yet → unknown, not invented
    ENGINE.quote(get_asset("BTC/USDT"), now=NOW)
    later = ENGINE.quote(get_asset("ETH/BTC"), now=NOW + 31)
    assert later["volume_24h_usd"] == pytest.approx(20 * 100000.0)  # quoteVolume (BTC) × BTC price


def test_binance_lists_and_unsupported_classes():
    mock = BinanceMock()
    set_provider_override(mock.provider())
    g = markets_service.list_payload("gainers", asset_class="crypto", page_size=100, now=NOW)
    assert g["available"] is True and g["items"]
    changes = [i["quote"]["change_24h_pct"] for i in g["items"]]
    assert changes == sorted(changes, reverse=True) and all(c > 0 for c in changes)
    assert all(i["quote"]["source"]["id"] == "binance" for i in g["items"])
    stocks = markets_service.list_payload("gainers", asset_class="stock", now=NOW)
    assert stocks["available"] is False and stocks["code"] == "DATA_NOT_AVAILABLE"
    assert mock.calls["tickers"] == 1


def test_binance_missing_symbol_in_bulk_ticker_is_an_error_not_a_number():
    mock = BinanceMock()
    mock.tickers = [r for r in mock.tickers if r["symbol"] != "SOLUSDT"]
    set_provider_override(mock.provider())
    q = ENGINE.quote(get_asset("SOL/USDT"), now=NOW)
    assert q["status"] == "error" and q["price"] is None and "SOL/USDT" in q["reason"]


# ------------------------------------------------------------------ Twelve Data mock (rate-limited → on demand)
class TwelveDataMock:
    def __init__(self, fail: bool = False):
        self.calls: list[str] = []
        self.fail = fail

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/time_series"
        interval = request.url.params["interval"]
        self.calls.append(interval)
        if self.fail:
            return httpx.Response(400, json={"status": "error", "message": "Invalid key TDKEY for ?apikey=TDKEY"})
        end = int(
            datetime.strptime(request.url.params["end_date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC).timestamp()
        )
        size = int(request.url.params["outputsize"])
        step = DAY if interval == "1day" else 3600
        last = (end // step) * step
        values = []
        for k in range(size - 1, -1, -1):
            t = last - k * step
            c = _close(t // DAY, 200.0) * (1 if step == DAY else 1 + 0.0005 * ((t // 3600) % 5))
            dt = datetime.fromtimestamp(t, UTC)
            values.append(
                {
                    "datetime": dt.strftime("%Y-%m-%d") if step == DAY else dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "open": str(c * 0.999),
                    "high": str(c * 1.01),
                    "low": str(c * 0.99),
                    "close": str(c),
                    "volume": "12345",
                }
            )
        return httpx.Response(200, json={"values": values, "status": "ok"})

    def provider(self) -> TwelveDataProvider:
        p = TwelveDataProvider(
            "TDKEY", "https://td.test", client=httpx.Client(transport=httpx.MockTransport(self.handler))
        )
        p.limiter = RateLimiter(rate_per_sec=1000, burst=1000)
        return p


def test_twelvedata_is_never_fanned_out_over_lists():
    mock = TwelveDataMock()
    set_provider_override(mock.provider())
    q = ENGINE.quote(get_asset("AAPL"), now=NOW)  # cheap: no request for a rate-limited provider
    assert q["status"] == "on_demand" and q["code"] == "ON_DEMAND_ONLY" and q["available"] is False
    lst = markets_service.list_payload("gainers", asset_class="stock", now=NOW)
    assert lst["available"] is False and lst["reason"] == "The configured provider plan cannot compute this list"
    assert lst["code"] == "PLAN_LIMIT" and lst["coverage"]["rate_limited"] > 0
    pop = markets_service.list_payload("popular", asset_class="stock", page_size=10, now=NOW)
    assert pop["available"] is True and all(i["quote"]["status"] == "on_demand" for i in pop["items"])
    quotes = markets_service.quotes_payload(["AAPL", "TSLA"], now=NOW)["quotes"]
    assert {q["status"] for q in quotes.values()} == {"on_demand"}
    heat = markets_service.heatmap_payload("stock", now=NOW)
    assert heat["available"] is False and heat["code"] == "PLAN_LIMIT"
    ENGINE.background.drain()
    assert mock.calls == []


def test_twelvedata_on_demand_snapshot_cache_and_stale_while_revalidate():
    mock = TwelveDataMock()
    set_provider_override(mock.provider())
    spec = get_asset("AAPL")
    q = ENGINE.quote(spec, now=NOW, fetch="on_demand", wait=10)
    assert q["status"] == "ok" and q["source"]["id"] == "twelvedata" and q["source"]["status"] == "delayed"
    assert q["change_basis"] == "session" and q["sparkline_tf"] == "1d" and len(q["sparkline"]) == 32
    last, prev = _close(DAY0 // DAY, 200.0), _close(DAY0 // DAY - 1, 200.0)
    assert q["price"] == pytest.approx(last, rel=1e-9)
    assert q["change_24h_pct"] == pytest.approx((last / prev - 1) * 100, abs=1e-3)  # vs the previous session close
    assert q["volume_24h"] == 12345.0 and q["trend"] == "up"
    assert mock.calls == ["1day"]  # ONE request per instrument
    assert ENGINE.quote(spec, now=NOW + 200, fetch="on_demand") is q  # Twelve Data TTL 300 s
    stale = ENGINE.quote(spec, now=NOW + 400, fetch="on_demand")
    assert stale is q  # served immediately while the background refresh runs
    assert ENGINE.background.drain(10)
    assert mock.calls == ["1day", "1day"]
    assert ENGINE.quote(spec, now=NOW + 401, fetch="on_demand")["as_of"] == NOW + 400


def test_twelvedata_errors_are_scrubbed(settings, monkeypatch):
    monkeypatch.setattr(settings, "twelvedata_api_key", "TDKEY")
    set_provider_override(TwelveDataMock(fail=True).provider())
    q = ENGINE.quote(get_asset("TSLA"), now=NOW, fetch="on_demand", wait=10)
    assert q["status"] == "error" and q["code"] == "MARKET_DATA_ERROR"
    assert "TDKEY" not in q["reason"] and "Twelve Data error" in q["reason"]


def test_twelvedata_asset_page_and_watchlist_on_demand(guest):
    mock = TwelveDataMock()
    set_provider_override(mock.provider())
    with SessionLocal() as db:
        a = markets_service.asset_payload(get_asset("AAPL"), user=None, db=db, now=NOW)
    assert a["quote"]["status"] == "ok" and a["regime"]["1d"]["available"] is True
    assert a["regime"]["1h"]["available"] is True and a["regime"]["1h"]["timeframe"] == "1h"
    assert all(x["quote"]["status"] in ("on_demand", "ok") for x in a["related"])  # related quotes never fan out
    assert sorted(mock.calls) == ["1day", "1h"]

    user_id = guest.get("/api/auth/me").json()["id"]
    with SessionLocal() as db:
        from app.models import User

        user = db.get(User, user_id)
        w = markets_service.watchlist_payload(user, db, now=NOW)
    rows = {r["symbol"]: r for r in w["items"]}
    for sym in ("BTC/USDT", "ETH/USDT", "EUR/USD", "XAU/USD"):  # have a Twelve Data symbol
        assert rows[sym]["quote"]["status"] == "ok", rows[sym]["quote"]
        assert rows[sym]["ai_status"] in {"LONG SETUP", "SHORT SETUP", "NO TRADE", "WAIT"}
    for sym in ("SPX", "NDX"):  # no Twelve Data symbol → DATA NOT AVAILABLE (never invented)
        assert rows[sym]["quote"]["status"] == "unavailable" and rows[sym]["ai_status"] is None
        assert rows[sym]["ai_reason"].startswith("DATA NOT AVAILABLE")


# ------------------------------------------------------------------ CoinGecko market caps
def _cg_provider(rows, status: int = 200, seen: list | None = None) -> CoinGeckoMarketCaps:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/coins/markets"
        assert request.url.params["vs_currency"] == "usd" and request.url.params["per_page"] == "250"
        assert "DEMOKEY" not in str(request.url)  # the key travels in a header only
        if seen is not None:
            seen.append(request.headers.get("x-cg-demo-api-key"))
        return httpx.Response(status, json=rows)

    return CoinGeckoMarketCaps(
        "https://cg.test", "DEMOKEY", client=httpx.Client(transport=httpx.MockTransport(handler))
    )


CG_ROWS = [
    {"id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "market_cap": 2.0e12, "market_cap_rank": 1},
    {"id": "fake-bitcoin", "symbol": "btc", "name": "Fake", "market_cap": 1.0e6, "market_cap_rank": 9000},
    {"id": "ethereum", "symbol": "eth", "name": "Ethereum", "market_cap": 4.0e11, "market_cap_rank": 2},
    {"id": "solana", "symbol": "sol", "name": "Solana", "market_cap": None},
]


def test_coingecko_maps_by_symbol_preferring_the_highest_cap_and_caches():
    seen: list = []
    p = _cg_provider(CG_ROWS, seen=seen)
    caps = p.caps()
    assert caps["BTC"] == {"market_cap": 2.0e12, "id": "bitcoin", "name": "Bitcoin", "rank": 1}
    assert caps["ETH"]["market_cap"] == 4.0e11 and "SOL" not in caps  # missing caps stay missing
    assert p.caps() is caps and seen == ["DEMOKEY"]  # cached 15 minutes, one request


def test_coingecko_failure_is_reported_and_not_retried_immediately():
    seen: list = []
    p = _cg_provider({"error": "boom"}, status=500, seen=seen)
    with pytest.raises(MarketCapError, match="CoinGecko HTTP 500"):
        p.caps()
    with pytest.raises(MarketCapError):
        p.caps()
    assert len(seen) == 1


def test_heatmap_uses_coingecko_market_caps_when_configured(settings, monkeypatch):
    monkeypatch.setattr(settings, "market_cap_provider", "coingecko")
    marketcap.set_provider(_cg_provider(CG_ROWS))
    h = markets_service.heatmap_payload("crypto", now=NOW)
    assert h["available"] is True and h["size_basis"] == "market_cap"
    tiles = {t["symbol"]: t for t in h["tiles"]}
    assert tiles["BTC/USDT"]["market_cap"] == 2.0e12 and tiles["BTC/USDT"]["size"] == 2.0e12
    assert tiles["ETH/USDT"]["market_cap"] == 4.0e11
    excluded = {e["symbol"]: e["reason"] for e in h["excluded"]}
    assert excluded["SOL/USDT"] == "Market cap: DATA NOT AVAILABLE"  # never estimated from volume
    assert h["market_cap_source"]["id"] == "coingecko" and "CoinGecko" in h["note"]


def test_heatmap_falls_back_to_volume_when_coingecko_fails(settings, monkeypatch):
    monkeypatch.setattr(settings, "market_cap_provider", "coingecko")
    marketcap.set_provider(_cg_provider({"error": "x"}, status=503))
    h = markets_service.heatmap_payload("crypto", now=NOW)
    assert h["size_basis"] == "volume" and all(t["market_cap"] is None for t in h["tiles"])
    assert "Market cap: DATA NOT AVAILABLE (CoinGecko: CoinGecko HTTP 503)" in h["note"]
    monkeypatch.setattr(settings, "market_cap_provider", "something")
    h2 = markets_service.heatmap_payload("crypto", now=NOW)
    assert "Unknown MARKET_CAP_PROVIDER 'something'" in h2["note"]


def test_provider_outage_does_not_multiply_timeouts(monkeypatch):
    """A failing bulk ticker trips a short circuit breaker: one request, not one timeout per instrument."""
    calls = {"n": 0}

    def down(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.ConnectError("connection refused")

    p = BinancePublicProvider("https://binance.test", client=httpx.Client(transport=httpx.MockTransport(down)))
    set_provider_override(p)
    col = ENGINE.collect(BINANCE_CRYPTO, now=NOW, seconds=30)
    assert calls["n"] == 1
    assert col.items and all(q["status"] == "error" and "Binance request failed" in q["reason"] for _, q in col.items)
    monkeypatch.setattr(overview, "CIRCUIT_SECONDS", 0.05)
    ENGINE.reset()
    ENGINE.quote(get_asset("BTC/USDT"), now=NOW)
    time.sleep(0.1)  # circuit closes again → the provider is retried
    ENGINE.quote(get_asset("ETH/USDT"), now=NOW)
    assert calls["n"] == 3
