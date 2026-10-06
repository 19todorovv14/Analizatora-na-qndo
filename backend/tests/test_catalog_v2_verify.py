"""V2 foundation (F1) — independent verification regressions.

* byte-exact demo series of core instruments (fingerprints captured from the pre-V2 generator, commit f9ebd4d)
* provider credentials never reach logs or error texts
* configuration problems (Twelve Data without a key) are DATA_NOT_AVAILABLE, consistent with availability()
* provider responses that are not JSON become MarketDataError (503), never a 500
* Celery worker processes resolve provider-synced instruments
* an empty provider list never mass-deactivates synced instruments
* read-only market data / disabled live execution, per-user favorites and recently viewed
No network anywhere: HTTP is mocked with httpx.MockTransport.
"""

from __future__ import annotations

import hashlib
import inspect
import logging
import pathlib
import re
import struct

import httpx
import pytest
from sqlalchemy import delete, select

from app.market import catalog, discovery
from app.market.base import DataNotAvailableError, DataSource, MarketDataError, MarketDataProvider, redact_secrets
from app.market.catalog import ASSETS, ASSETS_BY_SYMBOL, get_asset
from app.market.demo import DemoMarketDataProvider
from app.market.http_providers import BinancePublicProvider, TwelveDataProvider
from app.market.providers import CLASS_PROVIDERS, AssetClassProvider, MarketRouter
from app.market.registry import availability, set_provider_override
from app.models import Asset, CatalogSync

NOW = 1_780_000_123
SECRET = "SECRETKEY123"

# sha256(<q5d per candle: ts, open, high, low, close, volume>)[:32] of the PRE-V2 generator (commit f9ebd4d)
# at NOW, limits 1d=400, 1h=300, 1m=300; ticker = (price, change_24h_pct, volume_24h).
PRE_V2_FINGERPRINTS = {
    "BTC/USDT": {
        "1d": "a322ac0d549f353faf45ed0a9566441a",
        "1h": "cb84603539298a553f449a1a4ff76288",
        "1m": "89b9eb8419845ba0e0c0d4b0f6f86c5f",
        "ticker": (74031.36, -4.15, 589498.691),
    },
    "EUR/USD": {
        "1d": "a77574dc90dc800cfa121cda2733ad88",
        "1h": "88251aabdbd3f1e02492303413a454d5",
        "1m": "cc2136f1de2d246fe4bf2e62f7b6e91f",
        "ticker": (1.11089, -0.6, 224509810954.6927),
    },
    "SPX": {
        "1d": "6b9cdd3ce448b06098cb44c995b67a5c",
        "1h": "78f13b6ef532c261f60e530bcd03d26c",
        "1m": "891c0d38b4361715ce9f59dc09e26b73",
        "ticker": (7142.88, 0.644, 3196033.3702),
    },
    "AAPL": {
        "1d": "3c8251d19630c39e839a8f0433418659",
        "1h": "24544d3d9ddc1b7ed17d78f8e6541965",
        "1m": "d9ab14079debd05b9d405de04a093bff",
        "ticker": (230.72, -0.039, 35357641.8115),
    },
    "XAU/USD": {
        "1d": "48e98e3131ec70c6a24c35a66f8e2f53",
        "1h": "9276b459bab00bd04488fac8e27e4f50",
        "1m": "cd782e40444bbd412f77e5607c2f511b",
        "ticker": (2482.62, 0.554, 8415675.6544),
    },
}


def _fingerprint(rows) -> str:
    h = hashlib.sha256()
    for c in rows:
        h.update(struct.pack("<q5d", c.ts, c.open, c.high, c.low, c.close, c.volume))
    return h.hexdigest()[:32]


@pytest.mark.parametrize("symbol", sorted(PRE_V2_FINGERPRINTS))
def test_core_demo_series_are_byte_identical_to_pre_v2(symbol):
    demo = DemoMarketDataProvider()
    a = get_asset(symbol)
    want = PRE_V2_FINGERPRINTS[symbol]
    for tf, limit in (("1d", 400), ("1h", 300), ("1m", 300)):
        assert _fingerprint(demo.get_candles(a, tf, limit=limit, now=NOW)) == want[tf], (symbol, tf)
    t = demo.get_ticker(a, now=NOW)
    assert (t.price, t.change_24h_pct, t.volume_24h) == want["ticker"]  # exact float equality


# ------------------------------------------------------------------ credentials never leak
def _td_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_redact_secrets():
    text = "GET https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=abc123 and https://finnhub.io/x?token=t0k&q=1"
    out = redact_secrets(text)
    assert "abc123" not in out and "t0k" not in out
    assert "apikey=***" in out and "token=***" in out and "symbol=EUR/USD" in out and "q=1" in out
    assert redact_secrets("nothing secret here") == "nothing secret here"


def test_httpx_request_logs_never_contain_api_keys(caplog):
    caplog.set_level(logging.INFO, logger="httpx")

    def handler(request):
        return httpx.Response(200, json={"symbol": "AAPL", "close": "230.5", "percent_change": "0.1", "volume": "5"})

    p = TwelveDataProvider(SECRET, "https://td.test", client=_td_client(handler))
    assert p.get_ticker(get_asset("AAPL"), now=NOW).price == 230.5
    assert "HTTP Request" in caplog.text  # httpx still logs the request …
    assert SECRET not in caplog.text and "apikey=***" in caplog.text  # … without the key


def test_provider_transport_errors_never_echo_the_key():
    def handler(request):
        raise httpx.ConnectError(f"failed for {request.url}", request=request)

    p = TwelveDataProvider(SECRET, "https://td.test", client=_td_client(handler))
    with pytest.raises(MarketDataError) as exc:
        p.get_ticker(get_asset("AAPL"), now=NOW)
    assert SECRET not in str(exc.value)

    def api_error(request):
        return httpx.Response(401, json={"status": "error", "message": f"bad key in {request.url}"})

    p = TwelveDataProvider(SECRET, "https://td.test", client=_td_client(api_error))
    with pytest.raises(MarketDataError) as exc:
        p.get_ticker(get_asset("AAPL"), now=NOW)
    assert SECRET not in str(exc.value)


class _LeakyProvider(MarketDataProvider):
    source = DataSource("twelvedata", "Twelve Data", True, "test", status="delayed")

    def supports(self, asset):
        return True

    def get_candles(self, asset, timeframe, **kw):
        raise MarketDataError(f"Twelve Data request failed: https://td.test/time_series?apikey={SECRET}&x=1")

    def get_ticker(self, asset, *, now=None):
        raise MarketDataError(f"Twelve Data request failed: https://td.test/quote?apikey={SECRET}&x=1")


def test_watchlist_error_rows_never_echo_the_key(guest):
    set_provider_override(_LeakyProvider())
    try:
        r = guest.get("/api/market/watchlist")
    finally:
        set_provider_override(None)
    assert r.status_code == 200 and SECRET not in r.text
    assert all(i["code"] == "MARKET_DATA_ERROR" and "price" not in i for i in r.json()["items"])


# ------------------------------------------------- configuration problems → DATA_NOT_AVAILABLE
def test_twelvedata_without_key_is_data_not_available_everywhere(client):
    keyless = TwelveDataProvider(None, "https://td.invalid")
    with pytest.raises(DataNotAvailableError, match="TWELVEDATA_API_KEY"):
        keyless.get_candles(get_asset("AAPL"), "1h", limit=5, now=NOW)
    set_provider_override(keyless)
    try:
        av = availability(get_asset("AAPL"))
        r = client.get("/api/market/candles", params={"symbol": "AAPL", "timeframe": "1h"})
        t = client.get("/api/market/ticker", params={"symbol": "AAPL"})
    finally:
        set_provider_override(None)
    assert av["available"] is False and "TWELVEDATA_API_KEY" in av["reason"]
    for resp in (r, t):
        assert resp.status_code == 503  # status unchanged; code now matches availability()
        body = resp.json()
        assert body["code"] == "DATA_NOT_AVAILABLE" and "TWELVEDATA_API_KEY" in body["reason"]
        assert isinstance(body["detail"], str)


def test_non_json_provider_responses_are_market_data_errors(client):
    def gateway_page(request):
        return httpx.Response(502, text="<html><body>502 Bad Gateway</body></html>")

    def html_200(request):
        return httpx.Response(200, text="<html>maintenance</html>")

    td = TwelveDataProvider("key", "https://td.test", client=_td_client(gateway_page))
    with pytest.raises(MarketDataError, match="non-JSON"):
        td.get_ticker(get_asset("AAPL"), now=NOW)
    bn = BinancePublicProvider("https://bn.test", client=_td_client(html_200))
    with pytest.raises(MarketDataError, match="non-JSON"):
        bn.get_ticker(get_asset("BTC/USDT"), now=NOW)
    set_provider_override(td)
    try:
        r = client.get("/api/market/ticker", params={"symbol": "AAPL"})
    finally:
        set_provider_override(None)
    assert r.status_code == 503 and r.json()["code"] == "MARKET_DATA_ERROR"  # not a 500


# --------------------------------------------------------- synced instruments in Celery workers
@pytest.fixture
def loader_state():
    s = catalog._SYNCED
    saved = (s.loader, s.version_fn, s.check_every)
    yield
    catalog.set_synced_loader(saved[0], version=saved[1], check_every=saved[2])
    catalog.clear_synced()


def test_worker_processes_install_the_synced_loader(loader_state):
    from app.workers import tasks

    catalog.set_synced_loader(None)
    discovery.ensure_db_loader()
    assert catalog.synced_loader() is discovery.load_synced_specs
    custom = list  # an already installed loader is left alone
    catalog.set_synced_loader(custom)
    discovery.ensure_db_loader()
    assert catalog.synced_loader() is custom
    # the worker module installs it at import (workers never run the FastAPI lifespan)
    assert re.search(r"^discovery\.ensure_db_loader\(\)", inspect.getsource(tasks), re.M)


# --------------------------------------------------------------- discovery: empty provider list
EXCHANGE_INFO = {
    "symbols": [
        {
            "symbol": "QQZUSDT",
            "status": "TRADING",
            "baseAsset": "QQZ",
            "quoteAsset": "USDT",
            "isSpotTradingAllowed": True,
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.0001"},
                {"filterType": "LOT_SIZE", "minQty": "1", "stepSize": "1"},
            ],
        }
    ]
}


@pytest.fixture
def clean_sync(client, db, loader_state):
    def cleanup():
        db.execute(delete(Asset).where(Asset.source != "curated"))
        db.execute(delete(CatalogSync))
        db.commit()

    cleanup()
    discovery.install_db_loader()
    catalog.clear_synced()
    yield db
    cleanup()


def test_empty_provider_list_never_deactivates_synced_instruments(clean_sync):
    db = clean_sync
    payload = {"value": EXCHANGE_INFO}
    http = _td_client(lambda request: httpx.Response(200, json=payload["value"]))
    first = discovery.sync_binance(db, client=http)
    assert first["status"] == "ok" and first["count"] == 1
    payload["value"] = {"symbols": []}  # provider glitch / API change
    second = discovery.sync_binance(db, client=http)
    assert second["status"] == "error" and "no instruments" in second["message"]
    assert db.scalar(select(Asset.active).where(Asset.symbol == "QQZ/USDT")) is True
    assert get_asset("QQZ/USDT").source == "binance"


# ------------------------------------------------------------------- read-only / live disabled
_EXECUTION_WORDS = re.compile(r"order|withdraw|transfer|deposit|trade|buy|sell|position|balance|leverage", re.I)


def test_market_data_classes_have_no_execution_methods():
    from app.exchange.market_data import MarketDataAdapter

    classes = [DemoMarketDataProvider, BinancePublicProvider, TwelveDataProvider, AssetClassProvider, MarketRouter]
    classes += list(CLASS_PROVIDERS.values()) + [MarketDataAdapter]
    for cls in classes:
        public = [n for n in dir(cls) if not n.startswith("_") and callable(getattr(cls, n, None))]
        assert not [n for n in public if _EXECUTION_WORDS.search(n)], cls


def test_future_live_adapter_is_unreachable_from_the_api():
    from app.exchange.base import LiveTradingDisabledError
    from app.exchange.registry import LIVE_TRADING_AVAILABLE, get_adapter

    assert LIVE_TRADING_AVAILABLE is False
    for mode in ("live", "binance", "", "PAPER", "paper "):
        with pytest.raises(LiveTradingDisabledError):
            get_adapter(mode)
    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    modules = [*(app_dir / "api").glob("*.py"), *(app_dir / "services").glob("*.py"), app_dir / "main.py"]
    for path in modules:
        source = path.read_text(encoding="utf-8")
        assert "FutureLiveExecutionAdapter" not in source and "exchange.live" not in source, path


# ------------------------------------------------------------ public catalog / per-user lists
def test_public_catalog_endpoints_need_no_auth_and_blank_symbol_lists_all(client):
    from fastapi.testclient import TestClient

    from app.main import app

    anon = TestClient(app)  # no cookies, no token
    anon_paths = ("/api/market/search?q=gold", "/api/market/catalog?page_size=5", "/api/market/instrument/XAU-USD")
    for path in anon_paths:
        assert anon.get(path).status_code == 200, path
    assert anon.get("/api/market/favorites").status_code == 401
    r = client.get("/api/market/assets", params={"symbol": ""})
    assert r.status_code == 200 and len(r.json()["assets"]) == len(ASSETS)
    one = client.get("/api/market/assets", params={"symbol": "SPY"}).json()["assets"]
    assert [a["symbol"] for a in one] == ["SPY"]


def test_favorites_and_recent_are_per_user(client):
    from fastapi.testclient import TestClient

    from app.main import app

    headers = {"x-ta-client": "web"}

    def guest():
        c = TestClient(app)
        assert c.post("/api/auth/guest", headers=headers).status_code == 200
        c.headers.update(headers)
        return c

    a, b = guest(), guest()
    a.post("/api/market/favorites", json={"symbol": "BTC/USDT"})
    a.post("/api/market/recent", json={"symbol": "AAPL"})
    assert b.get("/api/market/favorites").json() == {"items": []}
    assert b.get("/api/market/recent").json() == {"items": []}
    assert b.delete("/api/market/favorites/BTC/USDT").json() == {"ok": True}  # only B's own rows
    assert [i["symbol"] for i in a.get("/api/market/favorites").json()["items"]] == ["BTC/USDT"]
    assert [i["symbol"] for i in a.get("/api/market/recent").json()["items"]] == ["AAPL"]


def test_core_instruments_keep_their_symbols_and_order():
    assert [a.symbol for a in ASSETS[:15]] == list(catalog.CORE_SYMBOLS)
    assert ASSETS_BY_SYMBOL["GER40"].provider_symbols == {"twelvedata": "GDAXI"}
    assert ASSETS_BY_SYMBOL["SPX"].provider_symbols == {} and ASSETS_BY_SYMBOL["NDX"].provider_symbols == {}
