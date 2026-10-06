"""S1 news & events (app.news.providers): Finnhub client mocked with httpx.MockTransport (NO network).
The API key never leaves the server: it is sent in a header and scrubbed from every provider error text."""

from __future__ import annotations

import httpx
import pytest

from app.config import get_settings
from app.market.http_providers import RateLimiter
from app.news import providers as news
from app.news.providers import FinnhubClient
from app.services import markets_service

NOW = 1_780_000_123  # 2026-05-28
SECRET = "SECRETKEY123"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    news.clear_cache()
    yield
    news.clear_cache()


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "finnhub_api_key", SECRET)
    yield s


def _client(handler, seen: list | None = None) -> FinnhubClient:
    def wrapped(request: httpx.Request) -> httpx.Response:
        assert SECRET not in str(request.url)  # never in the URL
        assert request.headers.get("X-Finnhub-Token") == SECRET
        if seen is not None:
            seen.append(request)
        return handler(request)

    return FinnhubClient(
        SECRET,
        "https://finnhub.test/api/v1",
        client=httpx.Client(transport=httpx.MockTransport(wrapped)),
        limiter=RateLimiter(rate_per_sec=1000, burst=1000),
    )


NEWS_ROWS = [
    {
        "id": 1,
        "headline": "Old headline",
        "summary": "s" * 1000,
        "source": "Reuters",
        "url": "https://example.com/a",
        "datetime": 1_779_990_000,
        "category": "company",
        "related": "AAPL",
    },
    {
        "id": 2,
        "headline": "New headline",
        "summary": "short",
        "source": "CNBC",
        "url": "javascript:alert(1)",
        "datetime": 1_779_999_000,
        "category": "company",
        "related": "AAPL",
    },
    {"id": 3, "headline": "", "datetime": 1},
]


def test_get_news_never_leaks_the_key_from_exception_texts(settings, monkeypatch):
    """F1 integration request: f"News provider error: {exc}" used to include the URL with token=<key>."""

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(
            f"connection failed for https://finnhub.io/api/v1/news?category=general&token={SECRET}"
        )

    client = _client(boom)
    monkeypatch.setattr(news, "finnhub_client", lambda: client)
    out = news.get_news("general")
    assert set(out) == {"configured", "items", "message", "disclaimer"}  # /api/news shape kept
    assert out["configured"] is True and out["items"] == []
    assert SECRET not in out["message"] and "token=" not in out["message"]
    assert out["message"].startswith("News provider error: Finnhub request failed (ConnectError")


def test_http_errors_from_the_provider_are_scrubbed(settings):
    client = _client(lambda r: httpx.Response(401, json={"error": f"Invalid API key {SECRET} (?token={SECRET})"}))
    feed = news.news_feed(symbol="AAPL", asset_class="stock", now=NOW, client=client)
    assert feed["available"] is False and feed["code"] == "NEWS_PROVIDER_ERROR"
    assert SECRET not in feed["reason"] and "HTTP 401" in feed["reason"]


def test_get_news_legacy_shape_with_key(settings):
    client = _client(lambda r: httpx.Response(200, json=NEWS_ROWS))
    out = news.get_news("general", client=client)
    assert out["configured"] is True and len(out["items"]) == 2
    assert set(out["items"][0]) == {"headline", "summary", "source", "url", "ts", "category"}
    assert out["items"][0]["headline"] == "New headline"  # newest first
    assert out["items"][0]["url"] is None  # non-http URLs are dropped
    assert len(out["items"][1]["summary"]) == 400


def test_company_news_for_stocks_and_category_feed_otherwise(settings):
    seen: list[httpx.Request] = []
    client = _client(lambda r: httpx.Response(200, json=NEWS_ROWS), seen)
    feed = news.news_feed(symbol="AAPL", asset_class="stock", now=NOW, client=client)
    assert feed["available"] is True and feed["scope"] == "company" and feed["provider"] == "finnhub"
    assert seen[-1].url.path.endswith("/company-news")
    assert dict(seen[-1].url.params) == {"symbol": "AAPL", "from": "2026-05-21", "to": "2026-05-28"}
    assert [i["id"] for i in feed["items"]] == [2, 1]
    assert set(feed["items"][0]) == {"id", "headline", "summary", "source", "url", "ts", "category", "related"}
    assert news.news_feed(symbol="AAPL", asset_class="stock", now=NOW, client=client) is feed  # cached 5 min
    assert len(seen) == 1

    crypto = news.news_feed(symbol="BTC/USDT", asset_class="crypto", now=NOW, client=client)
    assert crypto["scope"] == "category" and crypto["category"] == "crypto"
    assert seen[-1].url.path.endswith("/news") and seen[-1].url.params["category"] == "crypto"
    fx = news.news_feed(symbol="EUR/USD", asset_class="forex", now=NOW, client=client)
    assert fx["category"] == "forex"
    general = news.news_feed(category="merger", now=NOW, client=client)
    assert general["category"] == "merger" and general["scope"] == "category"


ECON = {
    "economicCalendar": [
        {
            "time": "2026-05-29 12:30:00",
            "country": "US",
            "event": "CPI MoM",
            "impact": "high",
            "actual": None,
            "estimate": 0.3,
            "prev": 0.2,
            "unit": "%",
        },
        {"time": "2026-05-28 08:00:00", "country": "DE", "event": "Ifo", "impact": "medium"},
    ]
}
EARNINGS = {
    "earningsCalendar": [
        {"date": "2026-05-30", "symbol": "ZZZQ", "hour": "bmo", "epsEstimate": 1.0, "quarter": 2, "year": 2026},
        {"date": "2026-05-29", "symbol": "AAPL", "hour": "amc", "epsEstimate": 1.5, "revenueEstimate": 9.1e10},
    ]
}


def test_economic_calendar_when_the_plan_allows_it(settings):
    client = _client(lambda r: httpx.Response(200, json=ECON))
    cal = news.calendar(start="2026-05-28", end="2026-06-04", now=NOW, client=client)
    assert cal["available"] is True and cal["kind"] == "economic" and cal["note"] is None
    assert [e["event"] for e in cal["items"]] == ["Ifo", "CPI MoM"]  # chronological
    assert cal["items"][1]["estimate"] == 0.3 and cal["items"][1]["actual"] is None and cal["items"][1]["ts"]


def test_calendar_falls_back_to_earnings_on_403(settings):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/calendar/economic"):
            return httpx.Response(403, json={"error": "You don't have access to this resource."})
        return httpx.Response(200, json=EARNINGS)

    client = _client(handler)
    cal = news.calendar(
        start="2026-05-28", end="2026-06-04", now=NOW, client=client, catalog_lookup=markets_service._catalog_lookup
    )
    assert cal["available"] is True and cal["kind"] == "earnings"
    assert "not available on the configured Finnhub plan" in cal["note"] and "HTTP 403" in cal["note"]
    first = cal["items"][0]
    assert (
        first["symbol"] == "AAPL"
        and first["in_catalog"] is True
        and first["slug"] == "AAPL"
        and first["name"] == "Apple"
    )
    assert cal["items"][1]["in_catalog"] is False and cal["items"][1]["slug"] is None


def test_calendar_errors_never_fabricate_events(settings):
    client = _client(lambda r: httpx.Response(403, json={"error": f"no access {SECRET}"}))
    cal = news.calendar(start="2026-05-28", end="2026-06-04", now=NOW, client=client)
    assert cal["available"] is False and cal["items"] == [] and SECRET not in cal["reason"]
    other = _client(lambda r: httpx.Response(500, text="oops"))
    cal2 = news.calendar(start="2026-05-01", end="2026-05-02", now=NOW, client=other)
    assert cal2["available"] is False and cal2["kind"] is None and "HTTP 500" in cal2["reason"]


def test_markets_news_endpoint_with_a_configured_key(client, settings, monkeypatch):
    from app.api import markets as markets_api

    monkeypatch.setattr(markets_api, "now_ts", lambda: NOW)
    fc = _client(lambda r: httpx.Response(200, json=NEWS_ROWS))
    monkeypatch.setattr(news, "finnhub_client", lambda: fc)
    r = client.get("/api/markets/news", params={"symbol": "aapl"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True and body["symbol"] == "AAPL" and body["scope"] == "company"
    assert SECRET not in r.text
