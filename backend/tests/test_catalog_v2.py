"""V2 foundation: instrument catalog, demo provider, provider routing, market sessions, schema,
execution-adapter safety and router layout. No network access anywhere in this file."""

from __future__ import annotations

import dataclasses
import re
from datetime import UTC, datetime

import httpx
import pytest

from app.config import get_settings
from app.database import Base
from app.exchange.base import ExchangeAdapter, LiveTradingDisabledError
from app.exchange.live import FutureLiveExecutionAdapter
from app.exchange.market_data import MarketDataAdapter
from app.exchange.paper import PaperExchangeAdapter, PaperExecutionAdapter
from app.exchange.registry import LIVE_TRADING_AVAILABLE, get_adapter
from app.market import catalog
from app.market.base import AssetSpec, DataNotAvailableError, MarketDataError, MarketDataProvider, slug_for
from app.market.catalog import (
    ASSETS,
    ASSETS_BY_SYMBOL,
    CORE_SYMBOLS,
    DEFAULT_WATCHLIST,
    SPECS,
    UnknownAssetError,
    get_asset,
    resolve_asset,
)
from app.market.demo import _PROFILES, DEMO_SOURCE, DemoMarketDataProvider
from app.market.http_providers import BinancePublicProvider, TwelveDataProvider
from app.market.providers import (
    CLASS_PROVIDERS,
    AssetClassProvider,
    CommodityProvider,
    CryptoProvider,
    ETFProvider,
    ForexProvider,
    IndexProvider,
    MarketRouter,
    StockProvider,
    parse_chain,
)
from app.market.registry import availability, provider_for, set_provider_override
from app.market.sessions import CALENDARS, NOTE_DEMO, market_status
from app.market.universe import ALL_ITEMS

NOW = 1_780_000_123  # same fixed clock as test_market_and_analysis

# Captured from the committed (pre-V2) generator at NOW:
# (1d first close, 1d last close, sum of 60 1d closes, sum of 48 1h closes, last 1m close, ticker volume_24h)
GOLDEN = {
    "BTC/USDT": (102747.46, 74031.36, 5079620.89, 3641043.04, 74031.36, 589498.691),
    "ETH/USDT": (1317.21, 1306.67, 74588.01, 63147.85, 1306.67, 3373086.1789),
    "SOL/USDT": (157.069, 333.634, 14150.072, 15799.534, 333.634, 8510684.9457),
    "XRP/USDT": (2.391, 3.7577, 231.1783, 178.4916, 3.7577, 821582769.9117),
    "EUR/USD": (1.09351, 1.11089, 66.46351, 53.56545, 1.11089, 224509810954.6927),
    "GBP/USD": (1.32023, 1.31256, 78.87319, 62.8698, 1.31256, 57759329866.929),
    "AUD/USD": (0.64158, 0.71247, 41.72877, 34.1306, 0.71247, 33382234219.1249),
    "XAU/USD": (2460.5, 2482.62, 148196.97, 118679.53, 2482.62, 8415675.6544),
    "WTI/USD": (64.79, 68.7, 4140.67, 3337.69, 68.7, 166200020.5542),
    "SPX": (7042.81, 7142.88, 409015.66, 342797.1, 7142.88, 3196033.3702),
    "NDX": (19252.51, 19955.28, 1200724.41, 963372.32, 19955.28, 543031.585),
    "GER40": (20860.2, 20448.9, 1258928.4, 1002522.6, 20448.9, 670752.0203),
    "AAPL": (223.56, 230.72, 13599.63, 11043.61, 230.72, 35357641.8115),
    "TSLA": (352.78, 246.72, 15408.75, 11630.5, 246.72, 93152788.9339),
    "NVDA": (128.29, 82.24, 6419.26, 3961.47, 82.24, 332999243.9732),
}


def _ts(iso: str) -> int:
    return int(datetime.fromisoformat(iso).replace(tzinfo=UTC).timestamp())


def _synced_spec(symbol: str, asset_class: str = "crypto", providers: dict | None = None, **kw) -> AssetSpec:
    item = {
        "symbol": symbol,
        "name": kw.pop("name", symbol),
        "asset_class": asset_class,
        "price_precision": 4,
        "qty_step": 0.01,
        "min_qty": 0.01,
        "max_leverage": 2,
        "spread_bps": 5,
        "providers": providers if providers is not None else {"binance": symbol.replace("/", "")},
        **kw,
    }
    return catalog.spec_from_item(item, curated=False, source="binance")


@pytest.fixture
def synced():
    """Install a couple of synced (non-curated, non-demo) instruments for one test."""
    specs = catalog.set_synced_assets(
        [
            _synced_spec("PEPE/EUR"),
            _synced_spec("BTC-USDT"),  # slug collides with curated BTC/USDT → suffixed
            _synced_spec("BTC/USDT"),  # curated symbol → ignored
            _synced_spec("ACME", "stock", {"twelvedata": "ACME"}),
        ]
    )
    yield {s.symbol: s for s in specs}
    catalog.clear_synced()


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    yield s  # monkeypatch.setattr(s, ...) in tests restores automatically


# ------------------------------------------------------------------- catalog
def test_universe_loads_and_catalog_order():
    assert len(ALL_ITEMS) == 282
    assert len(ASSETS) == 15 + 282
    assert tuple(a.symbol for a in ASSETS[:15]) == CORE_SYMBOLS
    assert len(CORE_SYMBOLS) == 15 and "BTC/USDT" in CORE_SYMBOLS and "NVDA" in CORE_SYMBOLS
    assert DEFAULT_WATCHLIST == ["BTC/USDT", "ETH/USDT", "SOL/USDT", "EUR/USD", "XAU/USD", "SPX", "NDX"]
    assert {a.asset_class for a in ASSETS} == {"crypto", "stock", "etf", "forex", "index", "commodity"}
    assert set(ASSETS_BY_SYMBOL) == {a.symbol for a in ASSETS}
    assert all(a.curated and a.source == "curated" for a in ASSETS)


def test_symbols_and_slugs_unique_and_url_safe():
    symbols = [a.symbol for a in ASSETS]
    slugs = [a.slug for a in ASSETS]
    assert len(set(symbols)) == len(symbols)
    assert len(set(slugs)) == len(slugs)
    for a in ASSETS:
        assert a.slug == slug_for(a.symbol)
        assert re.fullmatch(r"[A-Z0-9._-]+", a.slug), a.slug
        assert len(a.symbol) <= 32 and len(a.slug) <= 48
    assert slug_for("BTC/USDT") == "BTC-USDT"
    assert slug_for("s&p 500") == "S_P_500"
    assert slug_for("eur/usd") == "EUR-USD"


def test_core_specs_unchanged():
    btc = ASSETS_BY_SYMBOL["BTC/USDT"]
    assert (btc.name, btc.asset_class, btc.price_precision, btc.qty_step, btc.min_qty, btc.spread_bps) == (
        "Bitcoin",
        "crypto",
        2,
        0.0001,
        0.0001,
        1.0,
    )
    assert (btc.maker_fee, btc.taker_fee, btc.max_leverage) == (0.0002, 0.0006, 2)
    assert (btc.anchor_price, btc.daily_vol, btc.daily_volume_usd, btc.drift) == (95_000, 0.030, 2.0e10, 0.0006)
    assert btc.provider_symbols == {"binance": "BTCUSDT", "twelvedata": "BTC/USD"}
    eur = ASSETS_BY_SYMBOL["EUR/USD"]
    assert (eur.qty_step, eur.min_qty, eur.spread_bps, eur.maker_fee, eur.max_leverage) == (
        100.0,
        1000.0,
        0.8,
        3e-05,
        30,
    )
    assert eur.provider_symbols == {"twelvedata": "EUR/USD"}
    ger = ASSETS_BY_SYMBOL["GER40"]
    # provider_symbols were corrected against Twelve Data's /indices list (they never affect demo data)
    assert (ger.price_precision, ger.anchor_price, ger.provider_symbols) == (1, 20_000, {"twelvedata": "GDAXI"})
    assert ASSETS_BY_SYMBOL["SPX"].provider_symbols == ASSETS_BY_SYMBOL["NDX"].provider_symbols == {}
    nvda = ASSETS_BY_SYMBOL["NVDA"]
    assert (nvda.maker_fee, nvda.max_leverage, nvda.anchor_price, nvda.daily_vol) == (0.0005, 5, 140, 0.030)
    # metadata was added (metadata fields only)
    assert "bitcoin" in btc.aliases and btc.popularity == 1 and btc.category == "layer1"
    assert ASSETS_BY_SYMBOL["XAU/USD"].session == "cme" and "злато" in ASSETS_BY_SYMBOL["XAU/USD"].aliases
    assert ASSETS_BY_SYMBOL["AAPL"].session == "us_equity"


@pytest.mark.parametrize("symbol", sorted(GOLDEN))
def test_core_demo_candles_unchanged(symbol):
    demo = DemoMarketDataProvider()
    a = get_asset(symbol)
    d1 = demo.get_candles(a, "1d", limit=60, now=NOW)
    h1 = demo.get_candles(a, "1h", limit=48, now=NOW)
    m1 = demo.get_candles(a, "1m", limit=30, now=NOW)
    t = demo.get_ticker(a, now=NOW)
    first, last, sum_d, sum_h, last_m, vol24 = GOLDEN[symbol]
    approx = lambda v: pytest.approx(v, rel=1e-9)  # noqa: E731
    assert (len(d1), len(h1), len(m1)) == (60, 48, 30)
    assert d1[0].close == approx(first) and d1[-1].close == approx(last)
    assert sum(c.close for c in d1) == approx(sum_d)
    assert sum(c.close for c in h1) == approx(sum_h)
    assert m1[-1].close == approx(last_m)
    assert t.volume_24h == approx(vol24)


def test_every_curated_instrument_is_demo_capable_with_class_fees():
    demo = DemoMarketDataProvider()
    for a in ASSETS:
        assert a.demo_capable and a.daily_vol > 0 and a.daily_volume_usd > 0, a.symbol
        assert demo.supports(a)
        if a.symbol not in CORE_SYMBOLS:
            fees = catalog.CLASS_FEES[a.asset_class]
            assert (a.maker_fee, a.taker_fee) == (fees["maker_fee"], fees["taker_fee"]), a.symbol
    assert catalog.CLASS_FEES["crypto"] == {"maker_fee": 0.0002, "taker_fee": 0.0006}
    assert catalog.CLASS_FEES["forex"] == {"maker_fee": 0.00003, "taker_fee": 0.00003}
    assert catalog.CLASS_FEES["index"] == catalog.CLASS_FEES["commodity"] == {"maker_fee": 0.0, "taker_fee": 0.0}
    assert catalog.CLASS_FEES["stock"] == catalog.CLASS_FEES["etf"] == {"maker_fee": 0.0005, "taker_fee": 0.0005}


def test_new_instruments_generate_demo_data():
    demo = DemoMarketDataProvider()
    for symbol in ("SPY", "BNB/USDT", "USD/JPY", "XAG/USD", "DJI", "MSFT"):
        a = get_asset(symbol)
        rows = demo.get_candles(a, "1h", limit=24, now=NOW)
        assert len(rows) == 24 and all(r.low <= min(r.open, r.close) <= max(r.open, r.close) <= r.high for r in rows)
        assert demo.get_ticker(a, now=NOW).price == pytest.approx(rows[-1].close)
    assert _PROFILES["etf"] == _PROFILES["stock"]


def test_resolve_asset_variants():
    for text in ("BTC/USDT", "btc/usdt", "btc-usdt", "BTC-USDT", "BTCUSDT", " btcusdt "):
        assert resolve_asset(text).symbol == "BTC/USDT", text
    assert resolve_asset("eur-usd").symbol == "EUR/USD"
    assert resolve_asset("ger40").symbol == "GER40"
    for bad in ("", "NOPE/NOPE", "   "):
        with pytest.raises(UnknownAssetError):
            resolve_asset(bad)
    with pytest.raises(UnknownAssetError):
        get_asset("btc/usdt")  # get_asset stays exact


def test_synced_registry_specs_and_slugs(synced):
    assert set(synced) == {"PEPE/EUR", "BTC-USDT", "ACME"}  # curated BTC/USDT was not overridden
    assert get_asset("BTC/USDT") is ASSETS_BY_SYMBOL["BTC/USDT"]
    clash = synced["BTC-USDT"]
    assert clash.slug != "BTC-USDT" and clash.slug.startswith("BTC-USDT-") and not clash.curated
    assert resolve_asset("btc-usdt").symbol == "BTC/USDT"  # curated wins the slug
    assert resolve_asset(clash.slug).symbol == "BTC-USDT"
    assert resolve_asset(clash.slug.lower()).symbol == "BTC-USDT"  # suffix survives slug normalisation
    assert resolve_asset("pepe-eur").symbol == "PEPE/EUR"
    pepe = get_asset("PEPE/EUR")
    assert not pepe.curated and not pepe.demo_capable and pepe.source == "binance"
    # SPECS resolves curated + synced (what PaperBroker receives)
    assert SPECS["PEPE/EUR"] is pepe and SPECS["BTC/USDT"] is ASSETS_BY_SYMBOL["BTC/USDT"]
    assert "PEPE/EUR" in SPECS and "NOPE" not in SPECS and len(SPECS) == len(ASSETS) + 3
    with pytest.raises(KeyError):
        SPECS["NOPE"]
    assert "ACME" in set(SPECS)


def test_synced_loader_is_lazy_and_failure_tolerant():
    calls = []

    def loader():
        calls.append(1)
        return [_synced_spec("LAZY/USDT")]

    try:
        catalog.set_synced_loader(loader)
        assert calls == []
        assert get_asset("BTC/USDT")  # curated lookups never touch the loader
        assert calls == []
        assert get_asset("LAZY/USDT").symbol == "LAZY/USDT"
        get_asset("LAZY/USDT")
        assert calls == [1]
        assert catalog.reload_synced() == 1 and calls == [1, 1]

        def broken():
            raise RuntimeError("no such table: assets")

        catalog.set_synced_loader(broken)
        with pytest.raises(UnknownAssetError):
            get_asset("LAZY/USDT")
        assert get_asset("ETH/USDT").symbol == "ETH/USDT"
    finally:
        catalog.set_synced_loader(None)
        catalog.clear_synced()


# ----------------------------------------------------------------- providers
def test_demo_chain_makes_everything_curated_available():
    for symbol in ("BTC/USDT", "SPY", "EUR/USD", "DJI", "CORN"):
        av = availability(get_asset(symbol))
        assert av["available"] is True and av["provider_id"] == "demo" and av["reason"] is None
        assert av["source"]["id"] == "demo" and av["source"]["status"] == "demo"
    assert DEMO_SOURCE.to_dict()["status"] == "demo"


def test_synced_instrument_is_data_not_available_in_demo_mode(synced):
    pepe = get_asset("PEPE/EUR")
    with pytest.raises(DataNotAvailableError) as exc:
        provider_for(pepe)
    assert exc.value.code == "DATA_NOT_AVAILABLE"
    assert "No configured provider for crypto supports PEPE/EUR (configured: demo)" in exc.value.reason
    assert isinstance(exc.value, MarketDataError)  # → same HTTP status as before (503)
    av = availability(pepe)
    assert av == {
        "available": False,
        "provider_id": None,
        "reason": "No configured provider for crypto supports PEPE/EUR (configured: demo)",
        "source": None,
    }
    with pytest.raises(DataNotAvailableError):
        DemoMarketDataProvider().get_candles(pepe, "1h", limit=5, now=NOW)  # never invents a series


def test_binance_only_chain_without_binance_symbol_is_not_available(settings, monkeypatch):
    monkeypatch.setattr(settings, "market_data_stocks", "binance")
    aapl = get_asset("AAPL")
    with pytest.raises(
        DataNotAvailableError, match=r"No configured provider for stock supports AAPL \(configured: binance\)"
    ):
        provider_for(aapl)
    assert availability(aapl)["available"] is False and availability(aapl)["provider_id"] is None
    # ETF / index / commodity chains fall back to the stocks chain when unset (or blank)
    monkeypatch.setattr(settings, "market_data_indices", "")
    assert availability(get_asset("SPY"))["available"] is False
    assert availability(get_asset("SPX"))["available"] is False
    # crypto stays on its own chain
    assert provider_for(get_asset("BTC/USDT")).source.id == "demo"


def test_override_must_support_the_asset():
    binance = BinancePublicProvider("https://binance.invalid")  # no request is made
    set_provider_override(binance)
    try:
        assert provider_for(get_asset("BTC/USDT")) is binance
        with pytest.raises(DataNotAvailableError):
            provider_for(get_asset("EUR/USD"))
        assert availability(get_asset("EUR/USD"))["available"] is False
        av = availability(get_asset("ETH/USDT"))
        assert av["available"] and av["provider_id"] == "binance" and av["source"]["status"] == "live"
    finally:
        set_provider_override(None)
    assert provider_for(get_asset("EUR/USD")).source.id == "demo"


def test_chain_support_order(settings, monkeypatch):
    monkeypatch.setattr(settings, "market_data_crypto", "twelvedata,binance")
    assert provider_for(get_asset("BTC/USDT")).source.id == "twelvedata"  # both support → first wins
    assert provider_for(get_asset("DOT/USDT")).source.id == "binance"  # no twelvedata symbol
    monkeypatch.setattr(settings, "market_data_crypto", "binance, TwelveData")
    assert provider_for(get_asset("BTC/USDT")).source.id == "binance"
    assert provider_for(get_asset("BTC/USD")).source.id == "twelvedata"
    monkeypatch.setattr(settings, "market_data_crypto", "binance,demo")
    assert provider_for(get_asset("BTC/USD")).source.id == "demo"
    # explicit ETF chain overrides the stocks chain
    monkeypatch.setattr(settings, "market_data_etf", "twelvedata")
    assert provider_for(get_asset("SPY")).source.id == "twelvedata"
    assert provider_for(get_asset("AAPL")).source.id == "demo"
    # twelvedata without a key: routed, but reported as not available (no network involved)
    monkeypatch.setattr(settings, "twelvedata_api_key", None)
    av = availability(get_asset("SPY"))
    assert av["available"] is False and av["provider_id"] == "twelvedata" and "TWELVEDATA_API_KEY" in av["reason"]
    # unknown provider names are configuration errors
    monkeypatch.setattr(settings, "market_data_fx", "nope")
    with pytest.raises(MarketDataError, match="Unknown market data provider 'nope'"):
        provider_for(get_asset("EUR/USD"))
    assert availability(get_asset("EUR/USD"))["available"] is False


class _Fake(MarketDataProvider):
    def __init__(self, pid: str, supported: set[str], fail: bool = False):
        self.source = dataclasses.replace(DEMO_SOURCE, id=pid)
        self.supported, self.fail, self.calls = supported, fail, 0

    def supports(self, asset):
        return asset.symbol in self.supported

    def get_candles(self, asset, timeframe, **kw):
        self.calls += 1
        if self.fail:
            raise MarketDataError(f"{self.source.id} is down")
        return []

    def get_ticker(self, asset, *, now=None):
        return self.get_candles(asset, "1m")


def test_router_never_falls_back_on_errors():
    primary = _Fake("primary", {"BTC/USDT"}, fail=True)
    backup = _Fake("backup", {"BTC/USDT", "ETH/USDT"})
    factories = {"primary": lambda: primary, "backup": lambda: backup}

    class S:
        market_data_crypto = "primary,backup"
        market_data_stocks = "backup"
        market_data_etf = None

    router = MarketRouter(lambda: S, factories)
    btc, eth = get_asset("BTC/USDT"), get_asset("ETH/USDT")
    assert router.provider_for(btc) is primary and router.provider_for(eth) is backup
    crypto = router.for_class("crypto")
    assert isinstance(crypto, CryptoProvider) and crypto.chain == ("primary", "backup")
    with pytest.raises(MarketDataError, match="primary is down"):
        crypto.get_candles(btc, "1h")
    assert backup.calls == 0  # an outage never switches providers
    assert crypto.get_candles(eth, "1h") == [] and backup.calls == 1
    assert isinstance(router.for_class("etf"), ETFProvider) and router.for_class("etf").chain == ("backup",)
    assert isinstance(router.for_class("something-new"), StockProvider)
    assert router.chains()["crypto"] == ["primary", "backup"]
    with pytest.raises(DataNotAvailableError):
        router.for_class("crypto").resolve(get_asset("SOL/USDT"))
    assert not crypto.supports(get_asset("SOL/USDT"))


def test_class_provider_registry_and_parse_chain():
    assert CLASS_PROVIDERS == {
        "crypto": CryptoProvider,
        "stock": StockProvider,
        "etf": ETFProvider,
        "forex": ForexProvider,
        "index": IndexProvider,
        "commodity": CommodityProvider,
    }
    assert all(issubclass(c, AssetClassProvider) for c in CLASS_PROVIDERS.values())
    assert parse_chain(" Binance, twelvedata,,binance ") == ("binance", "twelvedata")
    assert parse_chain(None) == () and parse_chain("") == ()


def test_providers_are_read_only():
    forbidden = ("create_order", "place_order", "cancel_order", "withdraw", "transfer")
    for cls in (BinancePublicProvider, TwelveDataProvider, DemoMarketDataProvider, AssetClassProvider, MarketRouter):
        assert not any(hasattr(cls, m) for m in forbidden), cls


def test_source_status_labels():
    assert BinancePublicProvider.source.to_dict()["status"] == "live"
    assert TwelveDataProvider.source.to_dict()["status"] == "delayed"
    rt = TwelveDataProvider("k", "https://twelvedata.invalid", realtime=True)
    assert rt.source.to_dict()["status"] == "live" and TwelveDataProvider.source.status == "delayed"


def test_binance_tickers_24h_single_cached_call():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path == "/api/v3/ticker/24hr" and "symbol" not in request.url.params
        return httpx.Response(
            200,
            json=[
                {
                    "symbol": "BTCUSDT",
                    "lastPrice": "100.5",
                    "priceChangePercent": "-1.25",
                    "highPrice": "110",
                    "lowPrice": "90",
                    "volume": "12.5",
                    "quoteVolume": "1250.0",
                },
                {"symbol": "ETHBTC", "lastPrice": "0.05"},  # missing fields → None, never invented
            ],
        )

    p = BinancePublicProvider("https://binance.test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    data = p.tickers_24h()
    assert data["BTCUSDT"] == {
        "last": 100.5,
        "change_pct": -1.25,
        "high": 110.0,
        "low": 90.0,
        "base_volume": 12.5,
        "quote_volume": 1250.0,
    }
    assert (
        data["ETHBTC"]["last"] == 0.05
        and data["ETHBTC"]["change_pct"] is None
        and data["ETHBTC"]["quote_volume"] is None
    )
    assert p.tickers_24h() is data and len(requests) == 1  # cached (30 s)


# ------------------------------------------------------------------ sessions
def test_market_status_known_timestamps():
    sat = _ts("2026-10-03T12:00:00")  # Saturday
    fx = market_status(get_asset("EUR/USD"), sat)
    assert fx["status"] == "closed" and fx["session"] == "fx"
    assert fx["next_change_ts"] == _ts("2026-10-04T22:00:00")  # Sunday 22:00 UTC
    assert market_status(get_asset("EUR/USD"), _ts("2026-10-04T22:00:00"))["status"] == "open"
    assert market_status(get_asset("EUR/USD"), _ts("2026-10-09T22:00:00"))["status"] == "closed"  # Fri 22:00

    mon = _ts("2026-10-05T15:00:00")  # Monday 15:00 UTC = 11:00 New York
    us = market_status(get_asset("AAPL"), mon)
    assert us["status"] == "open" and us["label"] == "Отворен" and us["session"] == "us_equity"
    assert us["next_change_ts"] == _ts("2026-10-05T20:00:00")  # 16:00 EDT
    assert market_status(get_asset("SPY"), _ts("2026-10-05T13:00:00"))["status"] == "closed"  # 09:00 NY
    assert market_status(get_asset("AAPL"), _ts("2026-01-12T14:45:00"))["status"] == "open"  # EST: 09:45 NY

    for ts in (sat, mon, _ts("2026-12-25T03:00:00")):
        c = market_status(get_asset("BTC/USDT"), ts)
        assert c["status"] == "open" and c["next_change_ts"] is None

    gold = market_status(get_asset("XAU/USD"), _ts("2026-10-05T21:30:00"))  # 17:30 New York
    assert gold["status"] == "break" and gold["next_change_ts"] == _ts("2026-10-05T22:00:00")
    assert market_status(get_asset("JPN225"), _ts("2026-10-05T03:00:00"))["status"] == "break"  # Tokyo lunch
    assert market_status(get_asset("UK100"), _ts("2026-03-30T07:30:00"))["status"] == "open"  # BST 08:30
    assert market_status(get_asset("UK100"), _ts("2026-03-27T07:30:00"))["status"] == "closed"  # GMT 07:30


def test_market_status_notes():
    demo_note = market_status(get_asset("AAPL"), NOW)["note"]
    assert NOTE_DEMO == "Демо данните се генерират 24/7." and NOTE_DEMO in demo_note
    assert "Празниците" in demo_note
    live = market_status(get_asset("AAPL"), NOW, demo=False)
    assert NOTE_DEMO not in live["note"]
    assert {a.session for a in ASSETS} <= set(CALENDARS)
    odd = dataclasses.replace(get_asset("AAPL"), session="mars_exchange")
    assert market_status(odd, NOW)["session"] == "us_equity"


# ------------------------------------------------------------ exchange layer
def test_future_live_adapter_is_unusable():
    assert issubclass(LiveTradingDisabledError, NotImplementedError)
    assert issubclass(LiveTradingDisabledError, RuntimeError)
    assert issubclass(FutureLiveExecutionAdapter, ExchangeAdapter)
    assert FutureLiveExecutionAdapter.is_live is True and FutureLiveExecutionAdapter.enabled is False
    with pytest.raises(LiveTradingDisabledError):
        FutureLiveExecutionAdapter()
    with pytest.raises(NotImplementedError):
        FutureLiveExecutionAdapter(api_key="x", secret="y")
    inst = object.__new__(FutureLiveExecutionAdapter)  # bypass __init__: every method still refuses
    calls = {
        "get_balance": (),
        "get_positions": (),
        "get_ticker": ("BTC/USDT",),
        "get_ohlcv": ("BTC/USDT", "1h"),
        "cancel_order": ("x",),
    }
    for name, args in calls.items():
        with pytest.raises(LiveTradingDisabledError):
            getattr(inst, name)(*args)
    with pytest.raises(LiveTradingDisabledError):
        inst.create_order(symbol="BTC/USDT", side="buy", qty=1)
    assert LIVE_TRADING_AVAILABLE is False
    for mode in ("live", "future_live", "FutureLiveExecutionAdapter", "PAPER"):
        with pytest.raises(LiveTradingDisabledError):
            get_adapter(mode)


def test_paper_execution_adapter_alias():
    assert issubclass(PaperExecutionAdapter, PaperExchangeAdapter)
    assert PaperExecutionAdapter.is_live is False and PaperExecutionAdapter.name == "paper"


def test_market_data_adapter_is_read_only():
    forbidden = ("create_order", "place_order", "cancel_order", "withdraw", "transfer", "get_balance", "get_positions")
    assert not any(hasattr(MarketDataAdapter, m) for m in forbidden)
    assert not issubclass(MarketDataAdapter, ExchangeAdapter)
    md = MarketDataAdapter()
    assert md.supports("BTC/USDT") and md.availability("BTC/USDT")["provider_id"] == "demo"
    t = md.get_ticker("BTC/USDT", now=NOW)
    assert t["source"] == "demo" and t["price"] == pytest.approx(GOLDEN["BTC/USDT"][4])
    rows = md.get_ohlcv("BTC/USDT", "1d", limit=60, now=NOW)
    assert len(rows) == 60 and rows[-1]["close"] == pytest.approx(GOLDEN["BTC/USDT"][1])
    assert md.source("EUR/USD")["status"] == "demo"
    with pytest.raises(UnknownAssetError):
        md.get_ticker("NOPE")


# ------------------------------------------------------------ schema & seed
def test_v2_schema_is_created_by_init_db(client, db):
    from sqlalchemy import inspect

    insp = inspect(db.get_bind())
    tables = set(insp.get_table_names())
    assert {"favorite_assets", "recent_assets", "catalog_syncs", "replay_decisions", "structure_attempts"} <= tables
    cols = lambda t: {c["name"] for c in insp.get_columns(t)}  # noqa: E731
    assert {
        "category",
        "sector",
        "aliases",
        "popularity",
        "session",
        "provider_symbols",
        "source",
        "slug",
        "demo",
    } <= cols("assets")
    assert {"mode", "score", "review", "strategy_id"} <= cols("replay_sessions")
    assert {"exit_price", "strategy", "risk_amount", "notes", "ai_review"} <= cols("journal_entries")
    assert "mode" in cols("ai_sessions")
    assert set(Base.metadata.tables) <= tables


def test_seed_upserts_curated_catalog(client, db):
    from sqlalchemy import func, select

    from app.models import Asset
    from app.seed import seed_assets

    rows = {a.symbol: a for a in db.scalars(select(Asset).where(Asset.source == "curated"))}
    assert len(rows) >= len(ASSETS)
    btc = rows["BTC/USDT"]
    assert btc.slug == "BTC-USDT" and btc.category == "layer1" and "bitcoin" in btc.aliases
    assert btc.provider_symbols == {"binance": "BTCUSDT", "twelvedata": "BTC/USD"}
    assert btc.demo["anchor_price"] == 95_000 and btc.min_qty == 0.0001
    assert seed_assets(db) == 0  # idempotent: nothing changes on a second run
    assert (
        db.scalar(select(func.count()).select_from(Asset).where(Asset.slug.is_(None), Asset.source == "curated")) == 0
    )


# ---------------------------------------------------------------- API layer
def test_router_layout_and_replay_moved(client):
    from app.api import learn, markets, misc, replay, teacher

    for module in (markets, learn, teacher, replay):
        assert module.router is not None and module.__doc__
    replay_paths = {getattr(r, "path", "") for r in replay.router.routes}
    assert {"/replay", "/replay/{sid}", "/replay/{sid}/step", "/replay/{sid}/finish"} <= replay_paths
    assert not any("/replay" in getattr(r, "path", "") for r in misc.router.routes)
    paths = client.get("/openapi.json").json()["paths"]
    for p in ("/api/replay", "/api/replay/{sid}", "/api/replay/{sid}/order", "/api/replay/{sid}/action"):
        assert p in paths


def test_health_and_assets_endpoints(client):
    h = client.get("/api/health").json()
    assert h["market_data"]["etf"] == h["market_data"]["indices"] == h["market_data"]["commodities"] == "demo"
    assert h["live_trading"] is False
    r = client.get("/api/market/assets").json()
    assert len(r["assets"]) == len(ASSETS)
    first = r["assets"][0]
    assert first["symbol"] == "BTC/USDT" and first["source"]["id"] == "demo" and first["available"] is True
    assert {
        "symbol",
        "name",
        "asset_class",
        "price_precision",
        "qty_step",
        "min_qty",
        "spread_bps",
        "maker_fee",
    } <= set(first)


def test_new_instruments_work_through_existing_endpoints(client):
    r = client.get("/api/market/candles", params={"symbol": "SPY", "timeframe": "1h", "limit": 50})
    assert r.status_code == 200 and len(r.json()["candles"]) == 50 and r.json()["source"]["id"] == "demo"
    assert client.get("/api/market/ticker", params={"symbol": "BNB/USDT"}).status_code == 200
    assert client.get("/api/market/candles", params={"symbol": "NOPE/X", "timeframe": "1h"}).status_code == 404


def test_synced_symbol_unavailable_via_api_keeps_status(client, synced):
    r = client.get("/api/market/candles", params={"symbol": "PEPE/EUR", "timeframe": "1h"})
    assert r.status_code == 503  # same status as any other market-data failure; no invented candles
    assert "candles" not in r.json()


def test_paper_order_on_new_curated_instrument(guest):
    # paper_service passes SPECS to PaperBroker, so any catalog instrument can be paper-traded
    r = guest.post("/api/paper/orders", json={"symbol": "SPY", "side": "buy", "type": "market", "qty": 1})
    assert r.status_code == 200, r.text
    acc = guest.get("/api/paper/account").json()
    assert [(p["symbol"], p["qty"]) for p in acc["positions"]] == [("SPY", 1.0)]


def test_live_tickers_never_invent_missing_fields():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/ticker/24hr"):
            return httpx.Response(200, json={"symbol": "BTCUSDT", "lastPrice": "100.0"})
        return httpx.Response(200, json={"symbol": "EUR/USD", "close": "1.1", "percent_change": "0.25"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    t = BinancePublicProvider("https://binance.test", client=client).get_ticker(get_asset("BTC/USDT"), now=NOW)
    assert (t.price, t.change_24h_pct, t.volume_24h, t.source) == (100.0, None, None, "binance")
    td = TwelveDataProvider("key", "https://td.test", client=client).get_ticker(get_asset("EUR/USD"), now=NOW)
    assert (td.price, td.change_24h_pct, td.volume_24h, td.source) == (1.1, 0.25, None, "twelvedata")
