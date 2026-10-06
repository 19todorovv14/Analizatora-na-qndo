"""V2 foundation (F1b): instrument search, catalog/instrument endpoints, DATA_NOT_AVAILABLE error body,
favorites / recently viewed / unlimited watchlist, discovery sync (mapping + DB + registry), CLI and
Celery wiring. No network anywhere: HTTP is mocked with httpx.MockTransport."""

from __future__ import annotations

import json
import statistics
import time

import httpx
import pytest
from sqlalchemy import delete, func, select

from app.config import Settings, get_settings
from app.market import catalog, discovery
from app.market import search as catalog_search
from app.market.base import AssetSpec, Candle, DataSource, MarketDataError, MarketDataProvider, Ticker
from app.market.catalog import ASSETS, ASSETS_BY_SYMBOL, UnknownAssetError, get_asset, resolve_asset
from app.market.registry import set_provider_override
from app.market.search import (
    SCORE_ALIAS_CONTAINS,
    SCORE_ALIAS_PREFIX,
    SCORE_EXACT_ALIAS,
    SCORE_EXACT_SYMBOL,
    SCORE_NAME_CONTAINS,
    SCORE_NAME_PREFIX,
    SCORE_NAME_WORD_PREFIX,
    SCORE_SYMBOL_PREFIX,
    SYNCED_PENALTY,
)
from app.models import Asset, CatalogSync, FavoriteAsset, RecentAsset

NOW = 1_780_000_123

SUMMARY_KEYS = {
    "symbol",
    "slug",
    "name",
    "asset_class",
    "category",
    "sector",
    "exchange",
    "country",
    "currency",
    "base",
    "popularity",
    "curated",
    "available",
    "unavailable_reason",
    "source",
    "price_precision",
    "max_leverage",
}
INSTRUMENT_KEYS = SUMMARY_KEYS | {
    "qty_step",
    "min_qty",
    "spread_bps",
    "maker_fee",
    "taker_fee",
    "description",
    "aliases",
    "provider_symbols",
    "session",
    "market_status",
}

# section 6 expectations: query → (expected first symbol | None, symbols that must be in the top results)
EXPECTATIONS = {
    "btc": ("BTC/USDT", {"BTC/USD"}),
    "bitcoin": ("BTC/USDT", set()),
    "tesla": ("TSLA", set()),
    "gold": ("XAU/USD", set()),
    "злато": ("XAU/USD", set()),
    "apple": ("AAPL", set()),
    "nvidia": ("NVDA", set()),
    "eurusd": ("EUR/USD", set()),
    "eur/usd": ("EUR/USD", set()),
    "nasdaq": ("NDX", {"QQQ"}),
    "spx": ("SPX", set()),
    "oil": (None, set()),  # WTI/USD in the top 3 (checked separately)
    "eth": ("ETH/USDT", set()),
    "sol": ("SOL/USDT", set()),
    "dax": ("GER40", set()),
}


def _spec(symbol: str, asset_class: str = "crypto", *, source: str = "binance", **kw) -> AssetSpec:
    """A synced (non-curated, non-demo) instrument."""
    provider = "binance" if source == "binance" else "twelvedata"
    item = {
        "symbol": symbol,
        "name": kw.pop("name", symbol),
        "asset_class": asset_class,
        "price_precision": 4,
        "qty_step": 0.01,
        "min_qty": 0.01,
        "max_leverage": 2,
        "spread_bps": 5,
        "providers": {provider: symbol.replace("/", "") if provider == "binance" else symbol},
        "popularity": kw.pop("popularity", 6000),
        **kw,
    }
    return catalog.spec_from_item(item, curated=False, source=source)


# Real provider tickers that collide with aliases of popular curated instruments
COLLIDING = [
    _spec("BTC", "etf", source="twelvedata", name="Grayscale Bitcoin Mini Trust ETF", exchange="NYSE ARCA"),
    _spec("ETH", "etf", source="twelvedata", name="Grayscale Ethereum Mini Trust ETF"),
    _spec("SOL", "stock", source="twelvedata", name="Emeren Group Ltd"),
    _spec("DAX", "etf", source="twelvedata", name="Global X DAX Germany ETF"),
    _spec("GOLD", "stock", source="twelvedata", name="Gold Resource Corp"),
    _spec("OIL", "etf", source="twelvedata", name="iPath Pure Beta Crude Oil ETN"),
    _spec("NDAQ", "stock", source="twelvedata", name="Nasdaq Inc"),
    _spec("APLE", "stock", source="twelvedata", name="Apple Hospitality REIT Inc"),
    _spec("BTC/FDUSD", name="Bitcoin", popularity=5200),
    _spec("ETH/FDUSD", name="Ethereum", popularity=5200),
    _spec("SOL/FDUSD", name="Solana", popularity=5200),
    _spec("EUR/USDC", name="EUR", popularity=5100),
    _spec("PEPE/EUR", name="Pepe", popularity=5500),
]


@pytest.fixture
def no_synced():
    catalog.set_synced_assets([])
    yield
    catalog.clear_synced()


@pytest.fixture
def colliding():
    specs = catalog.set_synced_assets(COLLIDING)
    yield {s.symbol: s for s in specs}
    catalog.clear_synced()


def _top(q: str, limit: int = 10, **kw) -> list[str]:
    return [s.symbol for s in catalog_search.search(q, limit, **kw)]


# ------------------------------------------------------------------- search core
@pytest.mark.parametrize("q", sorted(EXPECTATIONS))
def test_search_expectations_curated(no_synced, q):
    first, also = EXPECTATIONS[q]
    top = _top(q)
    if first:
        assert top[0] == first, top
    assert also <= set(top[:5]), top
    if q == "oil":
        assert "WTI/USD" in top[:3], top
    if q == "btc":
        assert top[:2] == ["BTC/USDT", "BTC/USD"]


@pytest.mark.parametrize("q", sorted(EXPECTATIONS))
def test_search_expectations_hold_with_colliding_synced_tickers(colliding, q):
    """Synced exact-ticker hits (the 'BTC' ETF, the 'SOL' stock …) never push the curated instrument down."""
    first, also = EXPECTATIONS[q]
    top = _top(q)
    if first:
        assert top[0] == first, top
    assert also <= set(top[:5]), top
    if q == "oil":
        assert "WTI/USD" in top[:3], top


def test_synced_exact_symbol_still_ranks_above_curated_prefix_matches(colliding):
    top = _top("btc", 10)
    # all curated exact-alias hits first, then the synced exact ticker, then prefix matches
    assert top[:3] == ["BTC/USDT", "BTC/USD", "BTC/EUR"]
    assert top[3] == "BTC"
    assert top.index("BTC") < top.index("BTC/FDUSD")
    assert _top("pepe/eur")[0] == "PEPE/EUR"
    assert _top("PEPEEUR")[0] == "PEPE/EUR"
    assert _top("ndaq")[0] == "NDAQ"


def test_query_normalisation(no_synced):
    for q in ("EUR/USD", "eur-usd", " EUR_USD ", "eur usd", "EURUSD", "Eur/Usd"):
        assert _top(q)[0] == "EUR/USD", q
    assert _top("ЗЛАТО")[0] == "XAU/USD"
    assert _top("  Bitcoin  ")[0] == "BTC/USDT"
    assert _top("x" * 500) == []  # long input is truncated, no error
    assert catalog_search.normalize_query("  Crude   OIL ") == "crude oil"
    assert catalog_search.ticker_key("BTC / usdt") == "btcusdt"


def _entry_score(spec: AssetSpec, q: str) -> int:
    e = catalog_search._Entry(spec)
    qn = catalog_search.normalize_query(q)
    return e.score(qn, catalog_search.ticker_key(q), catalog_search._spaced_words(qn))


def test_scoring_rules_exact_values():
    curated = AssetSpec(
        "ABC/USD",
        "Alpha Beta Coin",
        "crypto",
        2,
        1.0,
        1.0,
        1.0,
        0.0,
        0.0,
        1.0,
        anchor_price=1.0,
        daily_vol=0.01,
        daily_volume_usd=1.0,
        aliases=("abcusd", "zeta token"),
    )
    cases = {
        "abc/usd": SCORE_EXACT_SYMBOL,
        "ABC-USD": SCORE_EXACT_SYMBOL,
        "zeta token": SCORE_EXACT_ALIAS,
        "abcu": SCORE_SYMBOL_PREFIX,
        "zeta": SCORE_ALIAS_PREFIX,
        "alpha": SCORE_NAME_PREFIX,
        "beta": SCORE_NAME_WORD_PREFIX,
        "beta c": SCORE_NAME_WORD_PREFIX,
        "ta tok": SCORE_ALIAS_CONTAINS,
        "ha be": SCORE_NAME_CONTAINS,
        "xyz": 0,
    }
    for q, expected in cases.items():
        assert _entry_score(curated, q) == expected, q
    assert (100, 95, 80, 70, 65, 55, 40, 35) == (
        SCORE_EXACT_SYMBOL,
        SCORE_EXACT_ALIAS,
        SCORE_SYMBOL_PREFIX,
        SCORE_ALIAS_PREFIX,
        SCORE_NAME_PREFIX,
        SCORE_NAME_WORD_PREFIX,
        SCORE_ALIAS_CONTAINS,
        SCORE_NAME_CONTAINS,
    )
    import dataclasses

    synced = dataclasses.replace(curated, curated=False, source="binance")
    assert _entry_score(synced, "abc/usd") == SCORE_EXACT_SYMBOL - SYNCED_PENALTY
    assert _entry_score(synced, "alpha") == SCORE_NAME_PREFIX - SYNCED_PENALTY


def test_tie_break_curated_then_popularity_then_shorter_symbol(no_synced):
    a = _spec("QQAA/USDT", name="Quux", popularity=10)
    b = _spec("QQAB/USDT", name="Quux", popularity=5)
    c = _spec("QQA/USDT", name="Quux", popularity=10)
    catalog.set_synced_assets([a, b, c])
    assert _top("quux") == ["QQAB/USDT", "QQA/USDT", "QQAA/USDT"]  # popularity, then shorter symbol
    # same score: curated first — "bitcoin" exact alias on 3 curated pairs beats nothing else
    assert _top("bitcoin")[:3] == ["BTC/USDT", "BTC/USD", "BTC/EUR"]  # popularity 1 < 44 < 60


def test_empty_query_returns_popular_one_per_class(no_synced):
    total, matches = catalog_search.search_with_total("", 6)
    assert total == len(ASSETS)
    classes = [m.spec.asset_class for m in matches]
    assert len(set(classes)) == 6  # one per asset class in turn
    assert matches[0].symbol == "BTC/USDT"
    # with a class filter: plain popularity order
    stocks = catalog_search.search("", 5, asset_class="stock")
    pops = [s.popularity for s in stocks]
    assert pops == sorted(pops) and all(s.asset_class == "stock" for s in stocks)


def test_search_filters(no_synced):
    assert all(s.asset_class == "etf" for s in catalog_search.search("gold", 10, asset_class="etf"))
    assert _top("gold", asset_class="etf")[0] == "GLD"
    metals = catalog_search.search("", 50, asset_class="commodity", category="metal")
    assert metals and all(s.category == "metal" for s in metals)
    assert _top("btc", asset_class="forex") == []
    assert _top("nope-nothing-here") == []


def test_search_latency_with_20k_synced_instruments():
    """~20k synced instruments: warm-index queries stay well below 30 ms (generous CI margin: 80 ms)."""
    words = ["alpha", "nova", "terra", "quant", "delta", "orbit", "pixel", "zen", "lumen", "vector"]
    specs = []
    for i in range(20_000):
        if i % 3 == 0:
            symbol, cls, src = f"S{i:05d}", "stock", "twelvedata"
            name = f"{words[i % 10].title()} {words[(i // 10) % 10].title()} Holdings {i}"
        elif i % 3 == 1:
            symbol, cls, src = f"C{i:05d}/USDT", "crypto", "binance"
            name = f"{words[(i // 7) % 10].title()}coin {i}"
        else:
            symbol, cls, src = f"F{i:05d}", "etf", "twelvedata"
            name = f"{words[(i // 3) % 10].title()} Index Fund {i}"
        specs.append(_spec(symbol, cls, source=src, name=name, popularity=6000 + i % 97))
    catalog.set_synced_assets(specs)
    try:
        assert catalog_search.warm() == len(ASSETS) + 20_000
        queries = ["btc", "apple", "eur/usd", "a", "s1", "nova", "terra holdings", "zz", "nasdaq", "c00043/usdt"]
        for q in queries:  # warm-up pass (first call of each branch)
            catalog_search.search_with_total(q, 12)
        timings = {}
        for q in queries:
            runs = []
            for _ in range(5):
                t0 = time.perf_counter()
                total, res = catalog_search.search_with_total(q, 12)
                runs.append((time.perf_counter() - t0) * 1000)
            timings[q] = statistics.median(runs)
        print("search latency over 20k synced instruments (median ms):", {k: round(v, 2) for k, v in timings.items()})
        assert max(timings.values()) < 80, timings
        assert statistics.median(timings.values()) < 30, timings
        assert _top("btc")[0] == "BTC/USDT"
        assert _top("C00043/USDT")[0] == "C00043/USDT"
        page = catalog_search.browse(q="nova", page=2, page_size=50)
        assert page["total"] > 100 and len(page["items"]) == 50
    finally:
        catalog.clear_synced()


# ----------------------------------------------------------------- search & catalog API
def test_search_endpoint_shape(client, no_synced):
    r = client.get("/api/market/search", params={"q": "btc", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "btc" and body["total"] >= 3
    first = body["results"][0]
    assert SUMMARY_KEYS <= set(first)
    assert first["symbol"] == "BTC/USDT" and first["slug"] == "BTC-USDT" and first["curated"] is True
    assert first["available"] is True and first["source"]["status"] == "demo"
    assert len(body["results"]) <= 5
    empty = client.get("/api/market/search", params={"q": ""}).json()
    assert len(empty["results"]) == 12 and empty["total"] == len(ASSETS)  # default limit 12
    blank_filters = client.get("/api/market/search", params={"q": "gold", "asset_class": "", "category": ""})
    assert blank_filters.json()["results"][0]["symbol"] == "XAU/USD"
    etf_gold = client.get("/api/market/search", params={"q": "gold", "asset_class": "etf"}).json()["results"]
    assert etf_gold[0]["symbol"] == "GLD" and all(r["asset_class"] == "etf" for r in etf_gold)
    assert client.get("/api/market/search", params={"q": "x", "limit": 51}).status_code == 422


def test_search_endpoint_marks_synced_instruments_unavailable_in_demo(client, colliding):
    res = client.get("/api/market/search", params={"q": "pepe/eur"}).json()["results"]
    pepe = res[0]
    assert pepe["symbol"] == "PEPE/EUR" and pepe["curated"] is False and pepe["catalog_source"] == "binance"
    assert pepe["available"] is False and pepe["source"] is None
    assert "No configured provider for crypto supports PEPE/EUR" in pepe["unavailable_reason"]


def test_catalog_pagination_sort_and_facets(client, no_synced):
    p1 = client.get("/api/market/catalog", params={"page_size": 50}).json()
    assert {"items", "page", "page_size", "total", "pages", "facets"} <= set(p1)
    assert p1["total"] == len(ASSETS) and p1["page"] == 1 and p1["pages"] == (len(ASSETS) + 49) // 50
    assert len(p1["items"]) == 50 and SUMMARY_KEYS <= set(p1["items"][0])
    assert p1["items"][0]["symbol"] == "BTC/USDT"  # popularity sort by default
    pops = [i["popularity"] for i in p1["items"]]
    assert pops == sorted(pops)
    p2 = client.get("/api/market/catalog", params={"page_size": 50, "page": 2}).json()
    assert not {i["symbol"] for i in p1["items"]} & {i["symbol"] for i in p2["items"]}
    last = client.get("/api/market/catalog", params={"page_size": 50, "page": p1["pages"]}).json()
    assert len(last["items"]) == len(ASSETS) - 50 * (p1["pages"] - 1)
    beyond = client.get("/api/market/catalog", params={"page_size": 50, "page": p1["pages"] + 1}).json()
    assert beyond["items"] == [] and beyond["total"] == len(ASSETS)
    # facets: counts over everything matching the other filters
    facets = p1["facets"]
    assert sum(facets["asset_class"].values()) == len(ASSETS)
    assert facets["asset_class"]["crypto"] == sum(1 for a in ASSETS if a.asset_class == "crypto")
    assert facets["category"]["metal"] == sum(1 for a in ASSETS if a.category == "metal")
    assert "" not in facets["category"] and "" not in facets["sector"]
    # disjunctive: filtering by class keeps the other classes' counts in the class facet
    crypto = client.get("/api/market/catalog", params={"asset_class": "crypto", "page_size": 200}).json()
    assert crypto["total"] == facets["asset_class"]["crypto"] == len(crypto["items"])
    assert crypto["facets"]["asset_class"] == facets["asset_class"]
    assert set(crypto["facets"]["category"]) == {a.category for a in ASSETS if a.asset_class == "crypto"}
    metals = client.get("/api/market/catalog", params={"asset_class": "commodity", "category": "metal"}).json()
    assert metals["total"] == facets["category"]["metal"]
    assert {i["symbol"] for i in metals["items"]} >= {"XAU/USD", "XAG/USD"}
    # sector filter
    some_sector = next(a.sector for a in ASSETS if a.asset_class == "stock" and a.sector)
    sec = client.get("/api/market/catalog", params={"sector": some_sector, "page_size": 200}).json()
    assert sec["total"] == sum(1 for a in ASSETS if a.sector == some_sector)
    # sorting
    by_symbol = client.get("/api/market/catalog", params={"sort": "symbol", "page_size": 200}).json()["items"]
    syms = [i["symbol"].upper() for i in by_symbol]
    assert syms == sorted(syms)
    by_name = client.get("/api/market/catalog", params={"sort": "name", "page_size": 200}).json()["items"]
    names = [i["name"].lower() for i in by_name]
    assert names == sorted(names)
    # q: relevance order by default, popularity on request
    gold = client.get("/api/market/catalog", params={"q": "gold"}).json()
    assert gold["items"][0]["symbol"] == "XAU/USD" and gold["sort"] == "relevance"
    assert gold["total"] == catalog_search.search_with_total("gold", 1)[0]
    # limits
    assert client.get("/api/market/catalog", params={"page_size": 200}).status_code == 200
    assert client.get("/api/market/catalog", params={"page_size": 201}).status_code == 422
    assert client.get("/api/market/catalog", params={"sort": "price"}).status_code == 422
    assert client.get("/api/market/catalog", params={"page": 0}).status_code == 422


def test_catalog_source_filter_and_synced_items(client, colliding):
    synced = client.get("/api/market/catalog", params={"source": "twelvedata", "page_size": 200}).json()
    assert synced["total"] == sum(1 for s in COLLIDING if s.source == "twelvedata")
    assert all(i["curated"] is False and i["available"] is False for i in synced["items"])
    p1 = client.get("/api/market/catalog", params={"page_size": 200}).json()
    p2 = client.get("/api/market/catalog", params={"page_size": 200, "page": 2}).json()
    assert p1["total"] == len(ASSETS) + len(COLLIDING) and p1["pages"] == 2
    flags = [i["curated"] for i in p1["items"] + p2["items"]]
    # curated instruments first (popularity order); synced ones (popularity ≥ 5000) after them
    assert flags == [True] * len(ASSETS) + [False] * len(COLLIDING)


def test_instrument_endpoint(client, no_synced):
    r = client.get("/api/market/instrument/BTC-USDT")
    assert r.status_code == 200
    body = r.json()
    assert INSTRUMENT_KEYS <= set(body)
    assert body["symbol"] == "BTC/USDT" and body["slug"] == "BTC-USDT"
    assert body["provider_symbols"] == {"binance": "BTCUSDT", "twelvedata": "BTC/USD"}
    assert "bitcoin" in body["aliases"] and body["session"] == "24x7"
    assert (body["qty_step"], body["min_qty"], body["maker_fee"], body["taker_fee"]) == (0.0001, 0.0001, 0.0002, 0.0006)
    ms = body["market_status"]
    assert ms["status"] == "open" and "Демо данните се генерират 24/7" in ms["note"]
    for variant in ("btc-usdt", "BTC/USDT", "btcusdt"):
        assert client.get(f"/api/market/instrument/{variant}").json()["symbol"] == "BTC/USDT", variant
    aapl = client.get("/api/market/instrument/AAPL").json()
    assert aapl["session"] == "us_equity" and aapl["market_status"]["status"] in ("open", "closed")
    r404 = client.get("/api/market/instrument/NOPE-NOPE")
    assert r404.status_code == 404 and "NOPE-NOPE" in r404.json()["detail"]


def test_instrument_endpoint_for_synced_instrument(client, colliding):
    slug = colliding["PEPE/EUR"].slug
    body = client.get(f"/api/market/instrument/{slug}").json()
    assert body["symbol"] == "PEPE/EUR" and body["curated"] is False and body["demo_capable"] is False
    assert body["available"] is False and body["code"] == "DATA_NOT_AVAILABLE" and body["source"] is None
    assert body["market_status"]["status"] == "open" and "Демо" not in body["market_status"]["note"]


def test_assets_endpoint_symbol_filter(client, colliding):
    one = client.get("/api/market/assets", params={"symbol": "SPY"}).json()
    assert [a["symbol"] for a in one["assets"]] == ["SPY"] and "timeframes" in one and "indicators" in one
    pepe = client.get("/api/market/assets", params={"symbol": "PEPE/EUR"}).json()["assets"]
    assert pepe[0]["symbol"] == "PEPE/EUR" and pepe[0]["available"] is False and pepe[0]["source"] is None
    assert client.get("/api/market/assets", params={"symbol": "NOPE/X"}).status_code == 404
    assert len(client.get("/api/market/assets").json()["assets"]) == len(ASSETS)  # synced not listed by default


# ------------------------------------------------------------ DATA_NOT_AVAILABLE error body
def test_data_not_available_error_body(client, colliding):
    for path, params in (
        ("/api/market/candles", {"symbol": "PEPE/EUR", "timeframe": "1h"}),
        ("/api/market/ticker", {"symbol": "PEPE/EUR"}),
    ):
        r = client.get(path, params=params)
        assert r.status_code == 503  # unchanged status
        body = r.json()
        assert isinstance(body["detail"], str) and body["detail"].startswith("Market data unavailable: ")
        assert body["code"] == "DATA_NOT_AVAILABLE"
        assert body["reason"] == "No configured provider for crypto supports PEPE/EUR (configured: demo)"
        assert body["symbol"] == "PEPE/EUR"
    assert client.get("/api/market/candles", params={"symbol": "NOPE/X", "timeframe": "1h"}).status_code == 404


class _Exploding(MarketDataProvider):
    source = DataSource("twelvedata", "Twelve Data", True, "test", status="delayed")

    def supports(self, asset):
        return True

    def get_candles(self, asset, timeframe, **kw) -> list[Candle]:
        raise MarketDataError("Twelve Data request failed: GET https://td.test/quote?symbol=EUR/USD&apikey=SECRET123")

    def get_ticker(self, asset, *, now=None) -> Ticker:
        raise MarketDataError("Twelve Data request failed: GET https://td.test/quote?symbol=EUR/USD&apikey=SECRET123")


def test_provider_errors_get_a_code_and_never_echo_query_strings(client):
    set_provider_override(_Exploding())
    try:
        r = client.get("/api/market/ticker", params={"symbol": "EUR/USD"})
    finally:
        set_provider_override(None)
    assert r.status_code == 503
    body = r.json()
    assert body["code"] == "MARKET_DATA_ERROR" and "SECRET123" not in r.text
    assert body["detail"].startswith("Market data unavailable: Twelve Data request failed")


# ------------------------------------------------------------ favorites / recent / watchlist
def test_favorites_flow(guest, client, db):
    assert guest.get("/api/market/favorites").json() == {"items": []}
    assert guest.post("/api/market/favorites", json={"symbol": "BTC/USDT"}).json() == {"ok": True, "symbol": "BTC/USDT"}
    assert guest.post("/api/market/favorites", json={"symbol": "BTC/USDT"}).status_code == 200  # idempotent
    assert guest.post("/api/market/favorites", json={"symbol": "eth-usdt"}).json()["symbol"] == "ETH/USDT"
    assert guest.post("/api/market/favorites", json={"symbol": "NOPE/NOPE"}).status_code == 404
    items = guest.get("/api/market/favorites").json()["items"]
    assert [i["symbol"] for i in items] == ["ETH/USDT", "BTC/USDT"]  # newest first
    assert len(items) == 2 and SUMMARY_KEYS <= set(items[0]) and "favorited_ts" in items[0]
    # a symbol that left the catalog stays listed (and removable) instead of breaking the list
    uid = guest.get("/api/auth/me").json()["id"]
    db.add(FavoriteAsset(user_id=uid, symbol="GONE/USDT", created_ts=1))
    db.commit()
    items = guest.get("/api/market/favorites").json()["items"]
    gone = next(i for i in items if i["symbol"] == "GONE/USDT")
    assert gone["available"] is False and gone["code"] == "UNKNOWN_INSTRUMENT" and gone["slug"] == "GONE-USDT"
    assert items[-1]["symbol"] == "GONE/USDT"  # newest first
    assert guest.delete("/api/market/favorites/GONE/USDT").json() == {"ok": True}
    assert guest.delete("/api/market/favorites/BTC-USDT").json() == {"ok": True}  # slug variant
    assert [i["symbol"] for i in guest.get("/api/market/favorites").json()["items"]] == ["ETH/USDT"]
    # favorites are per user and need auth
    other = client.get("/api/market/favorites")
    assert other.status_code == 401


def test_recent_flow_and_pruning(guest, db):
    assert guest.get("/api/market/recent").json() == {"items": []}
    r1 = guest.post("/api/market/recent", json={"symbol": "SPY"}).json()
    assert r1["ok"] and r1["views"] == 1 and r1["symbol"] == "SPY"
    assert guest.post("/api/market/recent", json={"symbol": "spy"}).json()["views"] == 2
    assert guest.post("/api/market/recent", json={"symbol": "NOPE/X"}).status_code == 404
    uid = guest.get("/api/auth/me").json()["id"]
    db.add(RecentAsset(user_id=uid, symbol="AAPL", viewed_ts=1, views=3))
    db.commit()
    items = guest.get("/api/market/recent").json()["items"]
    assert [i["symbol"] for i in items] == ["SPY", "AAPL"]
    assert items[0]["views"] == 2 and items[0]["viewed_ts"] >= items[1]["viewed_ts"] and SUMMARY_KEYS <= set(items[0])
    assert len(guest.get("/api/market/recent", params={"limit": 1}).json()["items"]) == 1
    assert guest.get("/api/market/recent", params={"limit": 101}).status_code == 422
    # keep only the newest 100 per user
    db.add_all(RecentAsset(user_id=uid, symbol=f"OLD{i}", viewed_ts=100 + i, views=1) for i in range(120))
    db.commit()
    guest.post("/api/market/recent", json={"symbol": "TSLA"})
    rows = db.scalars(select(RecentAsset.symbol).where(RecentAsset.user_id == uid)).all()
    assert len(rows) == 100 and "TSLA" in rows and "SPY" in rows and "AAPL" not in rows and "OLD0" not in rows
    newest = guest.get("/api/market/recent", params={"limit": 100}).json()["items"]
    assert newest[0]["symbol"] == "TSLA" and len(newest) == 100
    assert next(i for i in newest if i["symbol"] == "OLD119")["code"] == "UNKNOWN_INSTRUMENT"


def test_watchlist_is_unlimited_and_tolerates_stale_symbols(guest, db):
    before = guest.get("/api/market/watchlist").json()["items"]
    extra = [a.symbol for a in ASSETS if a.symbol not in {i["symbol"] for i in before}][:40]
    for sym in extra:
        assert guest.post("/api/market/watchlist", json={"symbol": sym}).status_code == 200
    assert guest.post("/api/market/watchlist", json={"symbol": "NOPE/X"}).status_code == 404
    uid = guest.get("/api/auth/me").json()["id"]
    from app.models import WatchlistItem

    db.add(WatchlistItem(user_id=uid, symbol="GONE/USDT", position=999))
    db.commit()
    r = guest.get("/api/market/watchlist")
    assert r.status_code == 200  # one stale symbol must not 404 the whole list
    items = r.json()["items"]
    assert len(items) == len(before) + len(extra) + 1
    assert [i["symbol"] for i in items[len(before) : len(before) + len(extra)]] == extra  # order kept
    stale = items[-1]
    assert stale["symbol"] == "GONE/USDT" and stale["code"] == "UNKNOWN_INSTRUMENT" and "error" in stale
    ok = items[0]
    assert {"price", "change_24h_pct", "trend", "regime", "source", "precision"} <= set(ok)


def test_watchlist_row_for_unavailable_synced_instrument(guest, colliding):
    assert guest.post("/api/market/watchlist", json={"symbol": "PEPE/EUR"}).status_code == 200
    row = next(i for i in guest.get("/api/market/watchlist").json()["items"] if i["symbol"] == "PEPE/EUR")
    assert row["code"] == "DATA_NOT_AVAILABLE" and "price" not in row


# ------------------------------------------------------------------ discovery mapping
EXCHANGE_INFO = {
    "timezone": "UTC",
    "symbols": [
        {  # curated → skipped
            "symbol": "BTCUSDT",
            "status": "TRADING",
            "baseAsset": "BTC",
            "quoteAsset": "USDT",
            "isSpotTradingAllowed": True,
            "filters": [],
        },
        {
            "symbol": "ZZZUSDT",
            "status": "TRADING",
            "baseAsset": "ZZZ",
            "quoteAsset": "USDT",
            "quotePrecision": 8,
            "isSpotTradingAllowed": True,
            "permissions": [],
            "permissionSets": [["SPOT", "MARGIN"]],
            "filters": [
                {"filterType": "PRICE_FILTER", "minPrice": "0.00010000", "tickSize": "0.00010000"},
                {"filterType": "LOT_SIZE", "minQty": "0.10000000", "stepSize": "0.10000000"},
            ],
        },
        {  # known coin, other quote: name from the curated catalog, popularity by quote rank
            "symbol": "SOLFDUSD",
            "status": "TRADING",
            "baseAsset": "SOL",
            "quoteAsset": "FDUSD",
            "permissions": ["SPOT"],
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.01000000"},
                {"filterType": "LOT_SIZE", "minQty": "0.00100000", "stepSize": "0.00100000"},
            ],
        },
        {  # not trading
            "symbol": "OLDUSDT",
            "status": "BREAK",
            "baseAsset": "OLD",
            "quoteAsset": "USDT",
            "isSpotTradingAllowed": True,
            "filters": [{"filterType": "LOT_SIZE", "minQty": "1", "stepSize": "1"}],
        },
        {  # quote not configured
            "symbol": "ZZZTRY",
            "status": "TRADING",
            "baseAsset": "ZZZ",
            "quoteAsset": "TRY",
            "isSpotTradingAllowed": True,
            "filters": [{"filterType": "LOT_SIZE", "minQty": "1", "stepSize": "1"}],
        },
        {  # margin only
            "symbol": "MRGUSDT",
            "status": "TRADING",
            "baseAsset": "MRG",
            "quoteAsset": "USDT",
            "isSpotTradingAllowed": False,
            "permissionSets": [["MARGIN"]],
            "filters": [{"filterType": "LOT_SIZE", "minQty": "1", "stepSize": "1"}],
        },
        {  # no lot information → cannot size orders
            "symbol": "NOLOTUSDT",
            "status": "TRADING",
            "baseAsset": "NOLOT",
            "quoteAsset": "USDT",
            "isSpotTradingAllowed": True,
            "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.01"}],
        },
        {  # minQty smaller than step → raised to one step
            "symbol": "YYYBTC",
            "status": "TRADING",
            "baseAsset": "YYY",
            "quoteAsset": "BTC",
            "isSpotTradingAllowed": True,
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.00000001"},
                {"filterType": "LOT_SIZE", "minQty": "0.5", "stepSize": "1.00000000"},
            ],
        },
    ],
}


def test_binance_mapping():
    quotes = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "EUR"]
    items = {i["symbol"]: i for i in discovery.binance_items(EXCHANGE_INFO, quotes=quotes)}
    assert set(items) == {"ZZZ/USDT", "SOL/FDUSD", "YYY/BTC"}
    zzz = items["ZZZ/USDT"]
    assert zzz["providers"] == {"binance": "ZZZUSDT"}
    assert (zzz["price_precision"], zzz["qty_step"], zzz["min_qty"]) == (4, 0.1, 0.1)
    assert (zzz["asset_class"], zzz["category"], zzz["session"], zzz["max_leverage"], zzz["spread_bps"]) == (
        "crypto",
        "other",
        "24x7",
        2.0,
        5.0,
    )
    assert (zzz["name"], zzz["base"], zzz["currency"], zzz["exchange"]) == ("ZZZ", "ZZZ", "USDT", "Binance")
    sol = items["SOL/FDUSD"]
    assert sol["name"] == "Solana" and sol["price_precision"] == 2 and sol["qty_step"] == 0.001
    assert zzz["popularity"] == 5050 and sol["popularity"] == 5200  # quote rank; unknown base +50
    yyy = items["YYY/BTC"]
    assert (yyy["price_precision"], yyy["qty_step"], yyy["min_qty"]) == (8, 1.0, 1.0)
    spec = catalog.spec_from_item(zzz, curated=False, source="binance")
    assert (spec.maker_fee, spec.taker_fee) == (0.0002, 0.0006) and not spec.demo_capable and spec.slug == "ZZZ-USDT"
    # quotes setting is honoured
    assert {i["symbol"] for i in discovery.binance_items(EXCHANGE_INFO, quotes=["BTC"])} == {"YYY/BTC"}
    assert discovery.tick_decimals("0.01000000") == 2 and discovery.tick_decimals("1.00") == 0
    assert discovery.tick_decimals("garbage", default=7) == 7 and discovery.tick_decimals("0") == 8


TD_STOCKS = {
    "data": [
        {"symbol": "AAPL", "name": "Apple Inc", "currency": "USD", "exchange": "NASDAQ", "country": "United States", "type": "Common Stock"},
        {"symbol": "ZZZQ", "name": "Zed Quantum Inc", "currency": "USD", "exchange": "NASDAQ", "country": "United States", "type": "Common Stock"},
        {"symbol": "ZZZQ", "name": "Zed Quantum Inc", "currency": "USD", "exchange": "BATS", "country": "United States", "type": "Common Stock"},
        {"symbol": "ZZZW", "name": "Zed Warrants", "currency": "USD", "exchange": "NASDAQ", "country": "United States", "type": "Warrant"},
        {"symbol": "ZPINK", "name": "Pink Sheet Co", "currency": "USD", "exchange": "OTC", "country": "United States", "type": "Common Stock"},
        {"symbol": "ZADR", "name": "Zed ADR", "currency": "USD", "exchange": "NYSE", "country": "United States", "type": "American Depositary Receipt"},
        {"symbol": "ZGER", "name": "Zed Germany AG", "currency": "EUR", "exchange": "XETR", "country": "Germany", "type": "Common Stock"},
        {"symbol": "BTC-USDT", "name": "Slug Clash Corp", "currency": "USD", "exchange": "NYSE", "country": "United States", "type": "Common Stock"},
    ],
    "status": "ok",
}  # fmt: skip
TD_ETF = {
    "data": [
        {"symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "currency": "USD", "exchange": "NYSE", "country": "United States"},
        {"symbol": "ZETF", "name": "Zed Momentum ETF", "currency": "USD", "exchange": "NYSE ARCA", "country": "United States"},
        {"symbol": "ZCBOE", "name": "Zed Cboe ETF", "currency": "USD", "exchange": "CBOE", "country": "United States"},
        {"symbol": "ZBATS", "name": "Zed Bats ETF", "currency": "USD", "exchange": "BATS", "country": "United States"},
        {"symbol": "DAX", "name": "Global X DAX Germany ETF", "currency": "USD", "exchange": "NASDAQ", "country": "United States"},
        {"symbol": "EXS1", "name": "iShares Core DAX", "currency": "EUR", "exchange": "XETR", "country": "Germany"},
    ]
}  # fmt: skip
TD_FOREX = {
    "data": [
        {"symbol": "EUR/USD", "currency_group": "Major", "currency_base": "Euro", "currency_quote": "US Dollar"},
        {"symbol": "CAD/CHF", "currency_group": "Minor", "currency_base": "Canadian Dollar", "currency_quote": "Swiss Franc"},
        {"symbol": "USD/HUF", "currency_group": "Exotic", "currency_base": "US Dollar", "currency_quote": "Hungarian Forint"},
        {"symbol": "TRY/JPY", "currency_group": "Exotic-Cross", "currency_base": "Turkish Lira", "currency_quote": "Japanese Yen"},
        {"symbol": "BROKEN", "currency_group": "Major"},
    ]
}  # fmt: skip
TD_INDICES = [
    {"symbol": "SPX", "name": "S&P 500", "country": "United States", "currency": "USD", "exchange": "INDEX"},
    {"symbol": "MDAXI", "name": "MDAX Performance Index", "country": "Germany", "currency": "EUR", "exchange": "XETR"},
    {"symbol": "NSEI", "name": "Nifty 50", "country": "India", "currency": "INR", "exchange": "NSE"},
    {"symbol": "BVSP", "name": "Bovespa", "country": "Brazil", "currency": "BRL", "exchange": "BVMF"},
    {"symbol": "FTSE", "name": "FTSE 100", "country": "United Kingdom", "currency": "GBP", "exchange": "LSE"},
    {"symbol": "GDAXI", "name": "DAX PERFORMANCE-INDEX", "country": "Germany", "currency": "EUR", "exchange": "XETR"},
]  # fmt: skip
TD_COMMODITIES = [
    {"symbol": "XAU/USD", "name": "Gold Spot", "category": "Precious Metal"},
    {"symbol": "XAU/EUR", "name": "Gold Spot Euro", "category": "Precious Metal"},
    {"symbol": "XBR/USD", "name": "Brent Crude Oil", "category": "Energy"},
    {"symbol": "HO/USD", "name": "Heating Oil", "category": "Energy"},
    {"symbol": "ZW1", "name": "Wheat Futures", "category": "Agricultural Product"},
    {"symbol": "LUMBER", "name": "Lumber", "category": "Industrial"},
]  # fmt: skip
TD_CRYPTO = [
    {"symbol": "BTC/EUR", "currency_base": "Bitcoin", "currency_quote": "Euro"},
    {"symbol": "DOT/USD", "currency_base": "Dotcoin", "currency_quote": "US Dollar"},  # reused ticker → skipped
    {"symbol": "ZZC/USD", "currency_base": "Zed Coin", "currency_quote": "US Dollar"},
    {"symbol": "ZZC/BTC", "currency_base": "Zed Coin", "currency_quote": "Bitcoin"},
]  # fmt: skip


def test_twelvedata_equity_mapping():
    stocks = {i["symbol"]: i for i in discovery.twelvedata_items("stocks", TD_STOCKS)}
    # curated, warrant, OTC and non-configured-country rows are skipped; duplicates collapse
    assert set(stocks) == {"ZZZQ", "ZADR", "BTC-USDT"}
    z = stocks["ZZZQ"]
    assert z["exchange"] == "NASDAQ"  # main exchange preferred over the BATS duplicate
    assert (z["asset_class"], z["max_leverage"], z["qty_step"], z["min_qty"], z["session"]) == (
        "stock",
        5.0,
        0.01,
        0.01,
        "us_equity",
    )
    assert z["providers"] == {"twelvedata": "ZZZQ"} and z["country"] == "United States" and z["currency"] == "USD"
    both = discovery.twelvedata_items("stocks", TD_STOCKS, countries=["Germany", "United States"])
    assert both[0]["symbol"] == "ZGER" and both[0]["session"] == "eu_xetra"  # first configured country first
    etfs = {i["symbol"]: i for i in discovery.twelvedata_items("etf", TD_ETF["data"])}
    assert set(etfs) == {"ZETF", "ZCBOE", "DAX"}  # US ETFs only on NASDAQ / NYSE / NYSE ARCA / CBOE
    assert etfs["DAX"]["asset_class"] == "etf"  # the "DAX" ETF ticker is not the DAX index (GER40 maps GDAXI)
    assert {i["symbol"] for i in discovery.twelvedata_items("etf", TD_ETF, countries=["Germany"])} == {"EXS1"}
    with pytest.raises(ValueError):
        discovery.twelvedata_items("bonds", [])


def test_twelvedata_forex_index_commodity_crypto_mapping():
    fx = {i["symbol"]: i for i in discovery.twelvedata_items("forex_pairs", TD_FOREX)}
    assert set(fx) == {"CAD/CHF", "USD/HUF", "TRY/JPY"}  # curated EUR/USD skipped, malformed row skipped
    assert (fx["CAD/CHF"]["max_leverage"], fx["CAD/CHF"]["category"], fx["CAD/CHF"]["price_precision"]) == (
        30.0,
        "cross",
        5,
    )
    assert (fx["USD/HUF"]["max_leverage"], fx["USD/HUF"]["category"]) == (20.0, "exotic")
    assert (fx["TRY/JPY"]["price_precision"], fx["TRY/JPY"]["category"]) == (3, "exotic")
    assert (fx["CAD/CHF"]["qty_step"], fx["CAD/CHF"]["min_qty"], fx["CAD/CHF"]["session"]) == (100.0, 1000.0, "fx")
    assert fx["CAD/CHF"]["name"] == "Canadian Dollar / Swiss Franc" and fx["CAD/CHF"]["base"] == "CAD"
    assert fx["CAD/CHF"]["currency"] == "CHF"

    idx = {i["symbol"]: i for i in discovery.twelvedata_items("indices", TD_INDICES)}
    # curated symbol / symbols mapped by curated UK100 and GER40
    assert "SPX" not in idx and "FTSE" not in idx and "GDAXI" not in idx
    assert (idx["MDAXI"]["category"], idx["MDAXI"]["session"], idx["MDAXI"]["max_leverage"]) == (
        "europe",
        "eu_xetra",
        10.0,
    )
    assert (idx["NSEI"]["category"], idx["NSEI"]["session"]) == ("asia", "unknown")
    assert idx["BVSP"]["category"] == "other"

    com = {i["symbol"]: i for i in discovery.twelvedata_items("commodities", TD_COMMODITIES)}
    assert set(com) == {"XAU/EUR", "HO/USD", "ZW1", "LUMBER"}  # XAU/USD curated, XBR/USD mapped by BRENT/USD
    assert (com["XAU/EUR"]["max_leverage"], com["XAU/EUR"]["category"], com["XAU/EUR"]["currency"]) == (
        20.0,
        "metal",
        "EUR",
    )
    assert (com["HO/USD"]["max_leverage"], com["HO/USD"]["category"]) == (10.0, "energy")
    assert com["ZW1"]["category"] == "agriculture" and com["LUMBER"]["category"] == "other"
    assert com["XAU/EUR"]["name"] == "Gold Spot Euro (EUR)" and com["HO/USD"]["name"] == "Heating Oil"

    cry = {i["symbol"]: i for i in discovery.twelvedata_items("cryptocurrencies", TD_CRYPTO)}
    assert set(cry) == {"ZZC/USD", "ZZC/BTC"}  # curated bases (BTC, DOT) are never added again
    assert cry["ZZC/USD"]["name"] == "Zed Coin" and cry["ZZC/BTC"]["price_precision"] == 8
    assert cry["ZZC/USD"]["max_leverage"] == 2.0 and cry["ZZC/USD"]["session"] == "24x7"


# ------------------------------------------------------------- discovery sync (mocked HTTP + DB)
def _mock_client(routes: dict, calls: list) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        key = request.url.path
        if key not in routes:
            return httpx.Response(404, json={"status": "error", "message": "not found"})
        status, payload = routes[key]
        return httpx.Response(status, json=payload)

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def sync_env(client, db):
    """Clean synced rows before/after; the DB loader feeds the registry; settings restored by monkeypatch."""

    def cleanup():
        db.execute(delete(Asset).where(Asset.source != "curated"))
        db.execute(delete(CatalogSync))
        db.commit()

    cleanup()
    discovery.install_db_loader(check_every=300)
    catalog.clear_synced()
    yield db
    cleanup()
    discovery.install_db_loader()
    catalog.clear_synced()


def test_sync_end_to_end_with_mocked_http(sync_env, monkeypatch):
    db = sync_env
    settings = get_settings()
    monkeypatch.setattr(settings, "catalog_twelvedata_countries", "United States")
    calls: list = []
    routes = {
        "/api/v3/exchangeInfo": (200, EXCHANGE_INFO),
        "/stocks": (200, TD_STOCKS),
        "/etf": (200, TD_ETF),
        "/forex_pairs": (200, TD_FOREX),
        "/indices": (200, {"data": TD_INDICES, "status": "ok"}),
        "/commodities": (200, {"data": TD_COMMODITIES}),
        "/cryptocurrencies": (500, {"status": "error", "message": "boom"}),
    }
    http = _mock_client(routes, calls)
    assert get_asset("BTC/USDT")  # registry loads (empty) before the sync
    results = discovery.run_sync(db, "all", client=http, pause=0)
    by_kind = {r["kind"]: r for r in results}
    assert [r["provider"] for r in results] == ["binance"] + ["twelvedata"] * 6
    assert by_kind["spot"]["status"] == "ok" and by_kind["spot"]["count"] == 3
    assert by_kind["stocks"]["count"] == 3 and by_kind["etf"]["count"] == 3
    assert by_kind["forex_pairs"]["count"] == 3 and by_kind["commodities"]["count"] == 4
    assert by_kind["cryptocurrencies"]["status"] == "error" and "boom" in by_kind["cryptocurrencies"]["message"]
    # requests: permissions=SPOT for Binance, country filter for equities, never an API key
    binance_req = next(c for c in calls if c.url.path == "/api/v3/exchangeInfo")
    assert binance_req.url.params["permissions"] == "SPOT"
    assert next(c for c in calls if c.url.path == "/stocks").url.params["country"] == "United States"
    assert all("apikey" not in c.url.params for c in calls)
    # catalog_syncs rows
    runs = db.scalars(select(CatalogSync).order_by(CatalogSync.id)).all()
    assert [(r.provider, r.kind, r.status) for r in runs][0] == ("binance", "spot", "ok")
    assert len(runs) == 7 and all(r.finished_ts and r.finished_ts >= r.started_ts for r in runs)
    assert sum(r.status == "error" for r in runs) == 1
    # assets rows
    rows = {a.symbol: a for a in db.scalars(select(Asset).where(Asset.source != "curated"))}
    assert rows["ZZZ/USDT"].source == "binance" and rows["ZZZ/USDT"].active and rows["ZZZ/USDT"].demo is None
    assert rows["ZZZ/USDT"].provider_symbols == {"binance": "ZZZUSDT"} and rows["ZZZ/USDT"].slug == "ZZZ-USDT"
    assert rows["ZZZQ"].source == "twelvedata" and rows["ZZZQ"].asset_class == "stock"
    clash = rows["BTC-USDT"]
    assert clash.slug.startswith("BTC-USDT-") and clash.slug != "BTC-USDT"  # curated slug never taken
    slugs = [s for s in db.scalars(select(Asset.slug)) if s]
    assert len(slugs) == len(set(slugs))
    # in-memory registry reloads lazily and serves the new instruments
    zzz = get_asset("ZZZ/USDT")
    assert not zzz.curated and zzz.source == "binance" and zzz.price_precision == 4 and not zzz.demo_capable
    assert resolve_asset("zzz-usdt").symbol == "ZZZ/USDT"
    assert resolve_asset(clash.slug).symbol == "BTC-USDT"
    assert get_asset("BTC-USDT").slug == clash.slug  # DB slug == registry slug
    assert resolve_asset("btc-usdt").symbol == "BTC/USDT"
    assert catalog_search.search("zed quantum", 3)[0].symbol == "ZZZQ"
    assert catalog_search.search("btc", 3)[0].symbol == "BTC/USDT"
    # second run: an instrument disappeared → deactivated and gone from the registry
    routes["/api/v3/exchangeInfo"] = (
        200,
        {"symbols": [s for s in EXCHANGE_INFO["symbols"] if s["symbol"] != "YYYBTC"]},
    )
    again = discovery.sync_binance(db, client=http)
    assert again["status"] == "ok" and again["count"] == 2 and "1 deactivated" in again["message"]
    assert db.scalar(select(Asset.active).where(Asset.symbol == "YYY/BTC")) is False
    with pytest.raises(UnknownAssetError):
        get_asset("YYY/BTC")
    assert get_asset("ZZZ/USDT")
    # idempotent: nothing changes on a third identical run
    third = discovery.sync_binance(db, client=http)
    assert "0 new, 0 updated, 0 deactivated" in third["message"]


def test_sync_never_takes_over_other_rows(sync_env):
    db = sync_env
    calls: list = []
    crypto = {"/cryptocurrencies": (200, {"data": [{"symbol": "ZZZ/USDT", "currency_base": "Other Zed"}]})}
    http = _mock_client({"/api/v3/exchangeInfo": (200, EXCHANGE_INFO), **crypto}, calls)
    discovery.sync_binance(db, client=http)
    res = discovery.sync_twelvedata(db, ("cryptocurrencies",), client=http, pause=0)
    assert res[0]["status"] == "ok" and res[0]["count"] == 0 and "1 skipped" in res[0]["message"]
    row = db.scalar(select(Asset).where(Asset.symbol == "ZZZ/USDT"))
    assert row.source == "binance" and row.name == "ZZZ"
    assert db.scalar(select(func.count()).select_from(Asset).where(Asset.source == "curated")) >= len(ASSETS)
    with pytest.raises(ValueError):
        discovery.sync_twelvedata(db, ("bonds",), client=http)


def test_sync_records_network_errors(sync_env):
    db = sync_env

    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    res = discovery.sync_binance(db, client=http)
    assert res["status"] == "error" and "ConnectError" in res["message"] and res["count"] == 0
    row = db.scalar(select(CatalogSync).where(CatalogSync.id == res["id"]))
    assert row.status == "error" and row.finished_ts is not None


def test_registry_notices_syncs_from_other_processes(sync_env):
    db = sync_env
    discovery.install_db_loader(check_every=0)  # probe the version on every lookup (test only)
    catalog.clear_synced()
    with pytest.raises(UnknownAssetError):
        get_asset("ZZZ/USDT")
    # another process (Celery worker / CLI) syncs: rows + a successful catalog_syncs row
    from app.seed import asset_row_values

    spec = catalog.spec_from_item(
        discovery.binance_items(EXCHANGE_INFO, quotes=["USDT"])[0], curated=False, source="binance"
    )
    db.add(Asset(symbol=spec.symbol, active=True, **asset_row_values(spec)))
    db.add(CatalogSync(provider="binance", kind="spot", started_ts=1, finished_ts=2, status="ok", count=1, message=""))
    db.commit()
    assert get_asset("ZZZ/USDT").source == "binance"


def test_loader_is_lazy_after_startup(client):
    discovery.install_db_loader()
    assert catalog._SYNCED.loaded is False  # nothing is read from the DB until the first lookup/search
    assert get_asset("BTC/USDT") is ASSETS_BY_SYMBOL["BTC/USDT"]
    assert catalog._SYNCED.loaded is False  # curated lookups never load the synced registry
    catalog.clear_synced()


# ------------------------------------------------------------------- CLI, Celery, settings
def test_cli_parses_arguments_and_runs(monkeypatch, capsys, client):
    seen = {}

    def fake_run_sync(db, provider, kinds, *, pause):
        seen.update(provider=provider, kinds=kinds, pause=pause)
        return [{"provider": provider, "kind": "forex_pairs", "status": "ok", "count": 1, "message": "1 instruments"}]

    monkeypatch.setattr(discovery, "run_sync", fake_run_sync)
    assert discovery.main(["--provider", "twelvedata", "--kinds", "forex_pairs,commodities", "--pause", "0"]) == 0
    assert seen == {"provider": "twelvedata", "kinds": ("forex_pairs", "commodities"), "pause": 0.0}
    assert json.loads(capsys.readouterr().out)[0]["status"] == "ok"
    assert discovery.main(["--provider", "twelvedata", "--kinds", "stocks", "etf"]) == 0
    assert seen["kinds"] == ("stocks", "etf")
    for bad in (
        ["--provider", "kraken"],
        ["--provider", "twelvedata", "--kinds", "bonds"],
        ["--provider", "binance", "--kinds", "stocks"],
    ):
        with pytest.raises(SystemExit):
            discovery.main(bad)


def test_celery_task_and_beat_flag(monkeypatch):
    from app.workers import tasks
    from app.workers.celery_app import build_beat_schedule, celery_app

    assert "app.workers.tasks.sync_catalog" in celery_app.tasks
    off = build_beat_schedule(Settings(catalog_auto_sync=False))
    assert "sync-catalog" not in off and {"sync-paper-accounts", "run-bots"} <= set(off)
    on = build_beat_schedule(Settings(catalog_auto_sync=True))
    assert on["sync-catalog"]["task"] == "app.workers.tasks.sync_catalog"
    monkeypatch.setattr(
        discovery,
        "run_sync",
        lambda db, provider, kinds: [
            {"provider": provider, "kind": "spot", "status": "ok", "message": "x", "kinds": kinds}
        ],
    )
    out = tasks.sync_catalog.run("binance")
    assert out[0]["provider"] == "binance" and out[0]["kinds"] is None


def test_catalog_settings(monkeypatch):
    s = Settings()
    assert s.catalog_auto_sync is False
    assert s.catalog_quotes == ["USDT", "USDC", "FDUSD", "BTC", "ETH", "EUR"]
    assert s.catalog_countries == ["United States"]
    monkeypatch.setenv("CATALOG_BINANCE_QUOTES", "")  # docker-compose passes unset variables as ""
    monkeypatch.setenv("CATALOG_TWELVEDATA_COUNTRIES", " Germany, United States ,Germany")
    monkeypatch.setenv("CATALOG_AUTO_SYNC", "true")
    s = Settings()
    assert s.catalog_quotes == ["USDT", "USDC", "FDUSD", "BTC", "ETH", "EUR"]
    assert s.catalog_countries == ["Germany", "United States"] and s.catalog_auto_sync is True
    monkeypatch.setenv("CATALOG_BINANCE_QUOTES", "usdt, eur")
    assert Settings().catalog_quotes == ["USDT", "EUR"]


# ------------------------------------------------------------------ demo horizon (late addition)
def test_demo_horizon_fails_with_market_data_error():
    from app.market.demo import HORIZON_END, DemoMarketDataProvider

    demo = DemoMarketDataProvider()
    late = HORIZON_END + 30 * 86400
    last_hour = HORIZON_END - 3600
    for sym in ("BTC/USDT", "SPY"):
        a = get_asset(sym)
        for tf in ("1m", "1h", "1d", "1w"):
            with pytest.raises(MarketDataError, match="2029-12-31"):
                demo.get_candles(a, tf, limit=5, now=late)
        with pytest.raises(MarketDataError):
            demo.get_ticker(a, now=late)
        # the final (partial) week and the last hour of the horizon still work — no IndexError
        assert len(demo.get_candles(a, "1w", limit=3, now=last_hour)) == 3
        assert demo.get_ticker(a, now=last_hour).price > 0
