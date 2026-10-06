"""S1 Markets explorer endpoints on DEMO data at a fixed clock: overview, lists (ordering, pagination, filters),
quotes, heatmap, asset page (optional auth), watchlist rows with AI status, membership, news without a key and the
"what does this event mean?" explainer (safety). No network anywhere in this file."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.ai.providers import LLMError
from app.ai.safety import find_violations
from app.analysis.signal import analyze
from app.api import markets as markets_api
from app.config import get_settings
from app.database import SessionLocal
from app.main import app
from app.market import overview
from app.market.catalog import ASSETS, get_asset
from app.market.overview import ENGINE
from app.models import WatchlistItem
from app.news import explain as news_explain
from app.news import providers as news_providers
from app.services import market_service, markets_service

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
    "catalog_source",
    "available",
    "unavailable_reason",
    "source",
    "price_precision",
    "max_leverage",
}
QUOTE_KEYS = {
    "symbol",
    "available",
    "status",
    "code",
    "reason",
    "partial",
    *overview.QUOTE_FIELDS,
    "sparkline",
    "sparkline_tf",
    "precision",
    "currency",
    "source",
    "as_of",
}
AI_STATUSES = {"LONG SETUP", "SHORT SETUP", "NO TRADE", "WAIT"}


@pytest.fixture(scope="module")
def warmed():
    """All curated demo snapshots at NOW (what the warm-up thread does in production)."""
    ENGINE.reset()
    counts = ENGINE.warm(NOW)
    assert counts.get("ok") == len(ASSETS)
    yield
    ENGINE.reset()


@pytest.fixture(autouse=True)
def _fixed_clock(monkeypatch):
    monkeypatch.setattr(markets_api, "now_ts", lambda: NOW)
    markets_service.reset_caches()
    news_providers.clear_cache()
    yield
    ENGINE.background.drain()


@pytest.fixture
def settings(monkeypatch):
    yield get_settings()


@pytest.fixture
def anon():
    return TestClient(app)  # no cookie at all


def _check_item(item: dict) -> None:
    assert SUMMARY_KEYS <= set(item)
    assert set(item["quote"]) == QUOTE_KEYS
    assert item["quote"]["symbol"] == item["symbol"]


# ------------------------------------------------------------------ overview
def test_overview_payload(client, warmed):
    r = client.get("/api/markets/overview")
    assert r.status_code == 200
    o = r.json()
    assert o["as_of"] == NOW
    keys = [c["key"] for c in o["categories"]]
    assert keys == ["crypto", "stock", "etf", "forex", "index", "commodity", "metal", "energy", "agriculture"]
    by_key = {c["key"]: c for c in o["categories"]}
    assert by_key["metal"]["filter"] == {"asset_class": "commodity", "category": "metal"}
    assert by_key["crypto"]["count"] == sum(1 for a in ASSETS if a.asset_class == "crypto")
    for cat in o["categories"]:
        assert 0 < len(cat["items"]) <= 8 and cat["label"] and cat["label_bg"]
        pops = [i["popularity"] for i in cat["items"]]
        assert pops == sorted(pops)
        for item in cat["items"]:
            _check_item(item)
    assert set(o["lists"]) == {
        "gainers",
        "losers",
        "most_volume",
        "high_volatility",
        "low_volatility",
        "trending",
        "popular",
    }
    for kind, lst in o["lists"].items():
        assert lst["kind"] == kind and lst["available"] is True and lst["status"] == "ok"
        assert 0 < len(lst["items"]) <= 10
        for item in lst["items"]:
            _check_item(item)
    assert o["lists"]["popular"]["items"][0]["symbol"] == "BTC/USDT"
    assert set(o["sources"]) == {"crypto", "stock", "etf", "forex", "index", "commodity"}
    assert all(s["status"] == "demo" for s in o["sources"].values())
    assert o["coverage"]["ranked"] == len(ASSETS) and o["coverage"]["missing"] == 0
    assert set(o["provider_chains"]) == {"crypto", "stock", "etf", "forex", "index", "commodity"}
    assert o["warmup"]["enabled"] is False


# ------------------------------------------------------------------ lists
def _metric(items, field):
    return [i["quote"][field] for i in items]


def test_list_ordering(client, warmed):
    def get(kind, **params):
        r = client.get("/api/markets/list", params={"kind": kind, "page_size": 100, **params})
        assert r.status_code == 200, r.text
        return r.json()

    g = get("gainers")["items"]
    assert g and _metric(g, "change_24h_pct") == sorted(_metric(g, "change_24h_pct"), reverse=True)
    assert all(v > 0 for v in _metric(g, "change_24h_pct"))
    lo = get("losers")["items"]
    assert lo and _metric(lo, "change_24h_pct") == sorted(_metric(lo, "change_24h_pct"))
    assert all(v < 0 for v in _metric(lo, "change_24h_pct"))
    mv = get("most_volume")["items"]
    assert _metric(mv, "volume_24h_usd") == sorted(_metric(mv, "volume_24h_usd"), reverse=True)
    hv = get("high_volatility")["items"]
    assert _metric(hv, "range_24h_pct") == sorted(_metric(hv, "range_24h_pct"), reverse=True)
    lv = get("low_volatility")["items"]
    assert _metric(lv, "range_24h_pct") == sorted(_metric(lv, "range_24h_pct"))
    tr = get("trending")["items"]
    assert [abs(v) for v in _metric(tr, "change_7d_pct")] == sorted(
        (abs(v) for v in _metric(tr, "change_7d_pct")), reverse=True
    )
    assert all(i["quote"]["trend"] in ("up", "down") for i in tr)
    pop = get("popular")["items"]
    assert [i["popularity"] for i in pop] == sorted(i["popularity"] for i in pop)


def test_list_pagination_and_filters(client, warmed):
    p1 = client.get("/api/markets/list", params={"kind": "high_volatility", "page": 1, "page_size": 7}).json()
    p2 = client.get("/api/markets/list", params={"kind": "high_volatility", "page": 2, "page_size": 7}).json()
    assert p1["total"] == p2["total"] == len(ASSETS) and p1["pages"] == (len(ASSETS) + 6) // 7
    assert len(p1["items"]) == len(p2["items"]) == 7
    assert not {i["symbol"] for i in p1["items"]} & {i["symbol"] for i in p2["items"]}
    assert p1["items"][-1]["quote"]["range_24h_pct"] >= p2["items"][0]["quote"]["range_24h_pct"]
    beyond = client.get("/api/markets/list", params={"kind": "high_volatility", "page": 999}).json()
    assert beyond["items"] == [] and beyond["available"] is True

    fx = client.get("/api/markets/list", params={"kind": "low_volatility", "asset_class": "forex"}).json()
    assert fx["asset_class"] == "forex" and fx["items"] and all(i["asset_class"] == "forex" for i in fx["items"])
    metals = client.get("/api/markets/list", params={"kind": "popular", "asset_class": "metal"}).json()
    assert metals["asset_class"] == "commodity" and metals["category"] == "metal"
    assert {i["category"] for i in metals["items"]} == {"metal"} and metals["total"] == 5
    energy = client.get(
        "/api/markets/list", params={"kind": "gainers", "asset_class": "commodity", "category": "energy"}
    )
    assert all(i["category"] == "energy" for i in energy.json()["items"])
    empty = client.get("/api/markets/list", params={"kind": "gainers", "category": "no-such-category"}).json()
    assert empty["available"] is True and empty["items"] == [] and empty["total"] == 0
    assert client.get("/api/markets/list", params={"kind": "gainers", "asset_class": "bonds"}).status_code == 400
    assert client.get("/api/markets/list", params={"kind": "nope"}).status_code == 422
    assert client.get("/api/markets/list", params={"kind": "gainers", "page_size": 101}).status_code == 422


def test_list_reports_data_not_available_for_a_class_without_provider(client, settings, monkeypatch, warmed):
    monkeypatch.setattr(settings, "market_data_stocks", "binance")
    monkeypatch.setattr(settings, "market_data_etf", "binance")
    r = client.get("/api/markets/list", params={"kind": "gainers", "asset_class": "stock"}).json()
    assert r["available"] is False and r["code"] == "DATA_NOT_AVAILABLE" and r["items"] == []
    assert r["reason"].startswith("DATA NOT AVAILABLE")
    allc = client.get("/api/markets/list", params={"kind": "most_volume", "page_size": 100}).json()
    # index and commodity chains fall back to the stocks chain → only crypto and forex stay available
    assert allc["available"] is True and {i["asset_class"] for i in allc["items"]} <= {"crypto", "forex"}
    assert allc["coverage"]["unavailable"] == sum(1 for a in ASSETS if a.asset_class not in ("crypto", "forex"))


def test_list_while_cold_does_not_compute_the_universe(client, monkeypatch):
    ENGINE.reset()
    monkeypatch.setattr(overview, "LIST_SYNC_SECONDS", 0.0)  # no time to compute anything inside the request
    r = client.get("/api/markets/list", params={"kind": "gainers"}).json()
    assert r["available"] is False and r["status"] == "warming" and r["code"] == "WARMING"
    assert r["coverage"]["missing"] == len(ASSETS)


# ------------------------------------------------------------------ quotes
def test_quotes_endpoint(client, warmed):
    r = client.get("/api/markets/quotes", params={"symbols": "BTC/USDT, eth-usdt,NOPE,BTC/USDT"})
    assert r.status_code == 200
    q = r.json()["quotes"]
    assert list(q) == ["BTC/USDT", "eth-usdt", "NOPE"]
    assert q["BTC/USDT"]["status"] == "ok" and q["BTC/USDT"]["as_of"] == NOW
    assert q["eth-usdt"]["symbol"] == "ETH/USDT" and q["eth-usdt"]["available"] is True
    assert q["NOPE"]["status"] == "unknown" and q["NOPE"]["code"] == "UNKNOWN_INSTRUMENT" and q["NOPE"]["price"] is None
    assert set(q["NOPE"]) == QUOTE_KEYS
    assert client.get("/api/markets/quotes").json() == {"quotes": {}, "as_of": NOW}
    many = ",".join(a.symbol for a in ASSETS[:101])
    assert client.get("/api/markets/quotes", params={"symbols": many}).status_code == 400


# ------------------------------------------------------------------ heatmap
def test_heatmap_stocks_size_by_volume_without_market_cap(client, warmed):
    h = client.get("/api/markets/heatmap", params={"asset_class": "stock"}).json()
    assert h["available"] is True and h["size_basis"] == "volume"
    assert "Market cap: DATA NOT AVAILABLE (provider does not supply it)" in h["note"] and "DEMO" in h["note"]
    assert h["tiles"] and all(t["market_cap"] is None for t in h["tiles"])
    assert all(t["size"] == t["volume_24h_usd"] and t["size"] > 0 for t in h["tiles"])
    sizes = [t["size"] for t in h["tiles"]]
    assert sizes == sorted(sizes, reverse=True)
    tile = h["tiles"][0]
    assert {
        "symbol",
        "slug",
        "name",
        "sector",
        "group",
        "change_24h_pct",
        "volume_24h_usd",
        "market_cap",
        "size",
    } <= set(tile)
    assert h["source"]["status"] == "demo" and h["market_cap_source"] is None


def test_heatmap_crypto_dedupes_by_base_and_never_invents_market_cap(client, settings, monkeypatch, warmed):
    monkeypatch.setattr(settings, "market_cap_provider", "none")
    h = client.get("/api/markets/heatmap").json()
    assert h["asset_class"] == "crypto" and h["size_basis"] == "volume" and h["deduplicated_by_base"] is True
    symbols = [t["symbol"] for t in h["tiles"]]
    assert "BTC/USDT" in symbols and "BTC/USD" not in symbols and "BTC/EUR" not in symbols
    assert all(t["market_cap"] is None for t in h["tiles"])
    assert "Market cap: DATA NOT AVAILABLE (MARKET_CAP_PROVIDER=none)" in h["note"]
    assert client.get("/api/markets/heatmap", params={"asset_class": "forex"}).status_code == 422


# ------------------------------------------------------------------ asset page
ASSET_KEYS = {
    "symbol",
    "slug",
    "available",
    "code",
    "reason",
    "instrument",
    "quote",
    "market_status",
    "regime",
    "volatility",
    "related",
    "lessons",
    "news",
    "is_favorite",
    "in_watchlist",
    "authenticated",
    "as_of",
}


def test_asset_page_payload_for_anonymous_visitor(anon, warmed):
    from app.academy.content import LESSONS_BY_SLUG

    r = anon.get("/api/markets/asset/BTC-USDT")
    assert r.status_code == 200, r.text
    a = r.json()
    assert set(a) == ASSET_KEYS
    assert a["symbol"] == "BTC/USDT" and a["available"] is True and a["code"] is None
    assert a["is_favorite"] is None and a["in_watchlist"] is None and a["authenticated"] is False
    assert a["instrument"]["slug"] == "BTC-USDT" and a["instrument"]["qty_step"] == get_asset("BTC/USDT").qty_step
    assert a["market_status"] == a["instrument"]["market_status"] and a["market_status"]["status"] == "open"
    assert a["quote"]["status"] == "ok" and a["quote"]["as_of"] == NOW
    assert set(a["regime"]) == {"1h", "1d"}
    assert (
        a["regime"]["1h"]["available"]
        and a["regime"]["1h"]["regime"] == market_service.regime_snapshot("BTC/USDT", "1h", NOW)["regime"]
    )
    assert a["regime"]["1d"]["regime"] == market_service.regime_snapshot("BTC/USDT", "1d", NOW)["regime"]
    assert a["volatility"]["atr_pct_1d"] == a["quote"]["atr_pct_1d"]
    assert a["volatility"]["range_24h_pct"] == a["quote"]["range_24h_pct"]
    assert len(a["related"]) == 6
    assert all(x["asset_class"] == "crypto" and x["base"] != "BTC" for x in a["related"])
    for x in a["related"]:
        _check_item(x)
    assert 1 <= len(a["lessons"]) <= 5
    assert all(
        lesson["slug"] in LESSONS_BY_SLUG and lesson["href"] == f"/learn/{lesson['slug']}" for lesson in a["lessons"]
    )
    assert a["news"]["available"] is False and a["news"]["reason"].startswith("Configure FINNHUB_API_KEY")
    # symbol variants resolve to the same instrument; unknown → 404
    for variant in ("BTC/USDT", "btcusdt", "btc-usdt"):
        assert anon.get(f"/api/markets/asset/{variant}").json()["symbol"] == "BTC/USDT"
    assert anon.get("/api/markets/asset/NOPE-NOPE").status_code == 404


def test_asset_page_flags_for_logged_in_user(guest, warmed):
    a = guest.get("/api/markets/asset/AAPL").json()
    assert a["authenticated"] is True and a["is_favorite"] is False and a["in_watchlist"] is False
    assert guest.post("/api/market/favorites", json={"symbol": "AAPL"}).status_code == 200
    assert guest.post("/api/market/watchlist", json={"symbol": "AAPL"}).status_code == 200
    a = guest.get("/api/markets/asset/AAPL").json()
    assert a["is_favorite"] is True and a["in_watchlist"] is True
    assert all(x["asset_class"] == "stock" for x in a["related"])
    assert a["news"]["scope"] == "company" and a["news"]["symbol"] == "AAPL"
    m = guest.get("/api/markets/membership").json()
    assert "AAPL" in m["watchlist"] and m["favorites"] == ["AAPL"]


def test_asset_page_when_data_is_not_available(anon, settings, monkeypatch):
    monkeypatch.setattr(settings, "market_data_stocks", "binance")
    r = anon.get("/api/markets/asset/TSLA")
    assert r.status_code == 200  # never 503 on the asset page
    a = r.json()
    assert a["available"] is False and a["code"] == "DATA_NOT_AVAILABLE" and "TSLA" in a["reason"]
    assert a["quote"]["status"] == "unavailable" and a["quote"]["price"] is None
    assert a["regime"]["1h"]["available"] is False and a["regime"]["1h"]["code"] == "DATA_NOT_AVAILABLE"
    assert a["regime"]["1d"]["available"] is False
    assert a["volatility"] == {"atr_pct_1d": None, "range_24h_pct": None, "atr_pct_1h": None}
    assert all(x["quote"]["status"] == "unavailable" for x in a["related"])
    assert a["lessons"]


# ------------------------------------------------------------------ watchlist
def test_watchlist_requires_auth(anon):
    assert anon.get("/api/markets/watchlist").status_code == 401
    assert anon.get("/api/markets/membership").status_code == 401


def test_watchlist_rows_with_ai_status(guest, warmed):
    r = guest.get("/api/markets/watchlist")
    assert r.status_code == 200
    w = r.json()
    old = guest.get("/api/market/watchlist").json()["items"]  # the F1 endpoint keeps working
    assert [row["symbol"] for row in w["items"]] == [row["symbol"] for row in old]
    assert w["total"] == len(old) == 7 and w["page"] == 1 and w["pages"] == 1 and w["as_of"] == NOW
    positions = [row["position"] for row in w["items"]]
    assert positions == sorted(positions)
    for row in w["items"]:
        _check_item(row)
        assert row["ai_status"] in AI_STATUSES and row["ai_reason"] and row["ai_pending"] is False
    # identical to the deterministic engine on closed 1h candles (as /api/ai/analyze computes it)
    spec = get_asset("ETH/USDT")
    rows = market_service.candles("ETH/USDT", "1h", limit=400, now=NOW, include_partial=False)
    price = next(row["quote"]["price"] for row in w["items"] if row["symbol"] == "ETH/USDT")
    expected = analyze(rows, spec=spec, timeframe="1h", price=price, source="demo")["signal"]
    assert next(row["ai_status"] for row in w["items"] if row["symbol"] == "ETH/USDT") == expected

    page = guest.get("/api/markets/watchlist", params={"page": 2, "page_size": 3}).json()
    assert page["total"] == 7 and page["pages"] == 3 and len(page["items"]) == 3
    assert [row["symbol"] for row in page["items"]] == [row["symbol"] for row in w["items"][3:6]]


def test_watchlist_ai_status_is_cached_and_stale_symbols_do_not_break(guest, monkeypatch, warmed):
    calls: list[str] = []
    real = markets_service.compute_ai_status

    def counting(spec, **kw):
        calls.append(spec.symbol)
        return real(spec, **kw)

    monkeypatch.setattr(markets_service, "compute_ai_status", counting)
    guest.get("/api/markets/watchlist")
    first = len(calls)
    assert first == 7
    guest.get("/api/markets/watchlist")
    assert len(calls) == first  # cached for 5 minutes

    user_id = guest.get("/api/auth/me").json()["id"]
    with SessionLocal() as db:
        db.add(WatchlistItem(user_id=user_id, symbol="GONE/USDT", position=999))
        db.commit()
    rows = guest.get("/api/markets/watchlist").json()["items"]
    stale = rows[-1]
    assert stale["symbol"] == "GONE/USDT" and stale["code"] == "UNKNOWN_INSTRUMENT"
    assert stale["quote"]["status"] == "unknown" and stale["ai_status"] is None


# ------------------------------------------------------------------ news / calendar / explain
def test_news_and_calendar_without_key(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "finnhub_api_key", None)
    n = client.get("/api/markets/news", params={"symbol": "AAPL"}).json()
    assert n["available"] is False and n["items"] == [] and n["code"] == "NEWS_NOT_CONFIGURED"
    assert n["reason"].startswith("Configure FINNHUB_API_KEY") and n["how_to_enable"]
    assert n["scope"] == "company" and n["symbol"] == "AAPL"
    g = client.get("/api/markets/news", params={"category": "crypto"}).json()
    assert g["available"] is False and g["scope"] == "category" and g["category"] == "crypto"
    assert client.get("/api/markets/news", params={"symbol": "NOPE"}).status_code == 404
    assert client.get("/api/markets/news", params={"category": "sports"}).status_code == 422
    cal = client.get("/api/markets/calendar").json()
    assert (
        cal["available"] is False and cal["items"] == [] and cal["from"] == "2026-05-28" and cal["to"] == "2026-06-04"
    )
    assert client.get("/api/markets/calendar", params={"from": "2026-06-10", "to": "2026-06-01"}).status_code == 400
    assert client.get("/api/markets/calendar", params={"from": "2026-01-01", "to": "2026-03-01"}).status_code == 400
    legacy = client.get("/api/news").json()  # /api/news keeps its shape
    assert legacy["configured"] is False and legacy["items"] == []


HEADLINES = [
    ("Fed raises interest rates by 25bp, Powell signals more hikes", "EUR/USD", "monetary_policy"),
    ("US CPI inflation comes in hotter than expected", "XAU/USD", "inflation"),
    ("Apple beats quarterly earnings estimates, raises guidance", "AAPL", "earnings"),
    ("Bitcoin exchange hit by hack, withdrawals paused", "BTC/USDT", "crypto_event"),
    ("OPEC+ agrees to cut oil supply", "WTI/USD", "commodity_supply"),
    ("Company X agrees merger with Company Y", None, "mna"),
    ("Something happened somewhere", None, "general"),
]


def test_explain_event_requires_auth(anon):
    assert anon.post("/api/markets/news/explain", json={"headline": "x"}).status_code == 401


@pytest.mark.parametrize(("headline", "symbol", "kind"), HEADLINES)
def test_explain_event_offline_is_safe_and_structured(guest, headline, symbol, kind):
    r = guest.post("/api/markets/news/explain", json={"headline": headline, "symbol": symbol})
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["provider"] == "offline" and e["event_type"] == kind and e["symbol"] == symbol
    assert [s["key"] for s in e["sections"]] == [
        "event_type",
        "who_reacts",
        "volatility",
        "beginner_dont",
        "no_direction",
    ]
    text = "\n".join(f"{s['title']}\n{s['body']}" for s in e["sections"]) + e["disclaimer"]
    assert find_violations(text) == []
    assert "не гарантира никаква посока на цената" in e["sections"][-1]["body"]
    assert "does not guarantee any price direction" in e["sections"][-1]["body"]
    assert e["safety_removed"] == []
    if symbol:
        assert symbol in e["sections"][1]["body"]


def test_explain_event_validation(guest):
    assert guest.post("/api/markets/news/explain", json={"headline": ""}).status_code == 422
    assert guest.post("/api/markets/news/explain", json={"headline": "x" * 501}).status_code == 422
    unknown = guest.post("/api/markets/news/explain", json={"headline": "Fed holds rates", "symbol": "NOPE"}).json()
    assert unknown["symbol"] is None  # unknown instruments are simply ignored


class _FakeLLM:
    name = "fake-llm"

    def __init__(self, reply: str | Exception):
        self.reply = reply
        self.prompts: list[str] = []

    def complete(self, system, messages, max_tokens=None):
        self.prompts.append(messages[0]["content"])
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def test_explain_event_llm_output_goes_through_the_safety_filter():
    reply = (
        '{"event_type": "Решение за лихвите.", '
        '"who_reacts": ["USD двойки", "Злато"], '
        '"volatility": "Spread-ът се разширява. BUY NOW — guaranteed profit!", '
        '"beginner_dont": "- Не гони цената.", '
        '"no_direction": "Посоката е несигурна."}'
    )
    llm = _FakeLLM(reply)
    e = news_explain.explain_event("Fed hikes rates", None, get_asset("EUR/USD"), llm=llm)
    assert e["provider"] == "fake-llm"
    text = "\n".join(s["body"] for s in e["sections"])
    notice = "⚠️ Safety filter:"  # app.ai.safety's standard notice about the removed sentence
    assert notice in text and "guaranteed profit" not in text.lower() and "buy now" not in text.lower()
    assert find_violations("\n".join(line for line in text.splitlines() if notice not in line)) == []
    assert e["safety_removed"]
    assert news_explain.NO_DIRECTION in e["sections"][-1]["body"]  # enforced even when the LLM omits it
    assert "<event>" in llm.prompts[0] and "EUR/USD" in llm.prompts[0]


@pytest.mark.parametrize("reply", ["not json at all", '{"event_type": "only one key"}', LLMError("down")])
def test_explain_event_falls_back_to_offline(reply):
    e = news_explain.explain_event("ECB cuts rates", "summary", None, llm=_FakeLLM(reply))
    assert e["provider"] == "offline" and e["event_type"] == "monetary_policy"
    assert len(e["sections"]) == 5
