"""News / events (optional, READ-ONLY). Uses the Finnhub REST API when FINNHUB_API_KEY is set.

News is shown as CONTEXT only — the platform never turns a headline into a trade signal.
Without a key the endpoints say so instead of inventing headlines or calendar events.

Security: the API key is sent in the ``X-Finnhub-Token`` header (never in the URL) and every provider error
text is scrubbed of query strings and configured secrets before it reaches a response.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, datetime, timedelta

import httpx

from app.config import get_settings
from app.market.base import MarketDataError
from app.market.http_providers import RateLimiter, _TTLCache
from app.market.overview import scrub_secrets

log = logging.getLogger(__name__)

_limiter = RateLimiter(rate_per_sec=0.5, burst=3)
_cache = _TTLCache(256)

CATEGORIES = ("general", "forex", "crypto", "merger")
NEWS_TTL = 300  # seconds
CALENDAR_TTL = 1800
MAX_ITEMS = 30

DISCLAIMER = (
    "Новините са контекст, не trading сигнал. Пазарната реакция на новина е непредвидима — "
    "AI анализът може да отбележи 'News risk' и да препоръча NO TRADE."
)
NOT_CONFIGURED_MESSAGE = (
    "Няма конфигуриран news provider. Добави FINNHUB_API_KEY в backend/.env, за да виждаш реални новини."
)
NOT_CONFIGURED_REASON = (
    "Configure FINNHUB_API_KEY in backend/.env to enable news and the events calendar (Finnhub). "
    "Без news provider платформата не показва (и не измисля) новини."
)
HOW_TO_ENABLE = (
    "1) Създай безплатен ключ на finnhub.io. 2) Добави FINNHUB_API_KEY=<ключ> в backend/.env. "
    "3) Рестартирай backend-а. Ключът остава само на сървъра."
)
CALENDAR_DISCLAIMER = (
    "Календарът показва планирани събития. Около тях volatility и spread-ът често се увеличават — "
    "събитието само по себе си не определя посоката на цената."
)


class NewsProviderError(RuntimeError):
    """The news provider failed. The message is safe to show (no URLs with keys, no secrets)."""

    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


def clear_cache() -> None:
    """Forget cached news / calendar responses (tests)."""
    with _cache.lock:
        _cache.data.clear()


def _safe_url(value) -> str | None:
    url = str(value or "").strip()
    return url if url.startswith(("https://", "http://")) else None


def _int(value) -> int | None:
    try:
        return int(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def _float(value) -> float | None:
    try:
        return float(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def _text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


class FinnhubClient:
    """Minimal read-only Finnhub REST client (news, company news, economic & earnings calendars)."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://finnhub.io/api/v1",
        *,
        timeout: float = 10.0,
        client: httpx.Client | None = None,
        limiter: RateLimiter | None = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=timeout)
        self.limiter = limiter or _limiter

    def _get(self, path: str, params: dict):
        try:
            self.limiter.acquire(timeout=5.0)
        except MarketDataError as exc:
            raise NewsProviderError("News provider rate limit — опитай отново след малко.") from exc
        try:
            resp = self.client.get(f"{self.base_url}{path}", params=params, headers={"X-Finnhub-Token": self.api_key})
        except httpx.HTTPError as exc:
            # httpx error texts can contain the full request URL → only the error type is reported
            raise NewsProviderError(
                f"Finnhub request failed ({type(exc).__name__}: {scrub_secrets(exc, limit=120)})"
            ) from exc
        if resp.status_code >= 400:
            detail = ""
            try:
                body = resp.json()
                if isinstance(body, dict) and body.get("error"):
                    detail = f": {scrub_secrets(body['error'], limit=200)}"
            except ValueError:
                pass
            raise NewsProviderError(f"Finnhub HTTP {resp.status_code}{detail}", status=resp.status_code)
        try:
            return resp.json()
        except ValueError as exc:
            raise NewsProviderError("Finnhub returned invalid JSON") from exc

    # ------------------------------------------------------------ endpoints
    @staticmethod
    def _items(raw) -> list[dict]:
        if not isinstance(raw, list):
            raise NewsProviderError("Unexpected Finnhub news response")
        items = []
        for n in raw:
            if not isinstance(n, dict) or not n.get("headline"):
                continue
            items.append(
                {
                    "id": _int(n.get("id")),
                    "headline": _text(n.get("headline"), 300),
                    "summary": _text(n.get("summary"), 400),
                    "source": _text(n.get("source"), 80) or None,
                    "url": _safe_url(n.get("url")),
                    "ts": _int(n.get("datetime")),
                    "category": _text(n.get("category"), 40) or None,
                    "related": _text(n.get("related"), 80) or None,
                }
            )
        items.sort(key=lambda x: x["ts"] or 0, reverse=True)
        return items[:MAX_ITEMS]

    def news(self, category: str) -> list[dict]:
        return self._items(self._get("/news", {"category": category}))

    def company_news(self, symbol: str, start: str, end: str) -> list[dict]:
        return self._items(self._get("/company-news", {"symbol": symbol, "from": start, "to": end}))

    def economic_calendar(self, start: str, end: str) -> list[dict]:
        raw = self._get("/calendar/economic", {"from": start, "to": end})
        rows = raw.get("economicCalendar") if isinstance(raw, dict) else None
        if not isinstance(rows, list):
            raise NewsProviderError("Unexpected Finnhub economic calendar response")
        items = []
        for e in rows:
            if not isinstance(e, dict) or not e.get("event"):
                continue
            items.append(
                {
                    "time": _text(e.get("time"), 32) or None,
                    "ts": _parse_time(e.get("time")),
                    "country": _text(e.get("country"), 8) or None,
                    "event": _text(e.get("event"), 200),
                    "impact": _text(e.get("impact"), 16) or None,
                    "actual": _float(e.get("actual")),
                    "estimate": _float(e.get("estimate")),
                    "prev": _float(e.get("prev")),
                    "unit": _text(e.get("unit"), 16) or None,
                }
            )
        items.sort(key=lambda x: x["ts"] or 0)
        return items

    def earnings_calendar(self, start: str, end: str) -> list[dict]:
        raw = self._get("/calendar/earnings", {"from": start, "to": end})
        rows = raw.get("earningsCalendar") if isinstance(raw, dict) else None
        if not isinstance(rows, list):
            raise NewsProviderError("Unexpected Finnhub earnings calendar response")
        items = []
        for e in rows:
            if not isinstance(e, dict) or not e.get("symbol"):
                continue
            items.append(
                {
                    "date": _text(e.get("date"), 10) or None,
                    "symbol": _text(e.get("symbol"), 20),
                    "hour": _text(e.get("hour"), 8) or None,  # bmo | amc | dmh | ""
                    "eps_estimate": _float(e.get("epsEstimate")),
                    "eps_actual": _float(e.get("epsActual")),
                    "revenue_estimate": _float(e.get("revenueEstimate")),
                    "revenue_actual": _float(e.get("revenueActual")),
                    "quarter": _int(e.get("quarter")),
                    "year": _int(e.get("year")),
                }
            )
        items.sort(key=lambda x: (x["date"] or "", x["symbol"]))
        return items


def _parse_time(value) -> int | None:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return int(datetime.strptime(text, fmt).replace(tzinfo=UTC).timestamp())
        except ValueError:
            continue
    return None


_client: FinnhubClient | None = None
_client_key: tuple | None = None
_client_lock = threading.Lock()


def finnhub_client() -> FinnhubClient | None:
    """The shared Finnhub client, or None when FINNHUB_API_KEY is not set."""
    global _client, _client_key
    s = get_settings()
    if not s.finnhub_api_key:
        return None
    key = (s.finnhub_api_key, s.finnhub_base_url, s.market_http_timeout)
    with _client_lock:
        if _client is None or _client_key != key:
            _client = FinnhubClient(s.finnhub_api_key, s.finnhub_base_url, timeout=s.market_http_timeout)
            _client_key = key
        return _client


def is_configured() -> bool:
    return bool(get_settings().finnhub_api_key)


# ------------------------------------------------------------------ /api/news (legacy shape, kept)
def get_news(category: str = "general", *, client: FinnhubClient | None = None) -> dict:
    """{configured, items, message?, fetched_ts?, disclaimer} — the shape of GET /api/news (unchanged)."""
    client = client or finnhub_client()
    if client is None:
        return {"configured": False, "items": [], "message": NOT_CONFIGURED_MESSAGE, "disclaimer": DISCLAIMER}
    key = ("news", category)
    cached = _cache.get(key)
    if cached is not None:
        return cached
    try:
        items = client.news(category)
    except NewsProviderError as exc:
        return {
            "configured": True,
            "items": [],
            "message": f"News provider error: {scrub_secrets(exc)}",
            "disclaimer": DISCLAIMER,
        }
    out = {
        "configured": True,
        "items": [{k: n[k] for k in ("headline", "summary", "source", "url", "ts", "category")} for n in items],
        "fetched_ts": int(time.time()),
        "disclaimer": DISCLAIMER,
    }
    _cache.set(key, out, ttl=NEWS_TTL)
    return out


# ------------------------------------------------------------------ /api/markets/news
def _not_configured(**extra) -> dict:
    return {
        "available": False,
        "provider": None,
        "code": "NEWS_NOT_CONFIGURED",
        "reason": NOT_CONFIGURED_REASON,
        "how_to_enable": HOW_TO_ENABLE,
        "items": [],
        "disclaimer": DISCLAIMER,
        **extra,
    }


def news_feed(
    *,
    symbol: str | None = None,
    asset_class: str | None = None,
    category: str | None = None,
    now: int | None = None,
    client: FinnhubClient | None = None,
) -> dict:
    """Company news for stocks/ETFs (last 7 days) or a Finnhub category feed (general|forex|crypto|merger).

    → {available, provider, scope: company|category, symbol, category, items, fetched_ts, disclaimer}
      or {available: false, code, reason, how_to_enable?, items: [], …}
    """
    now = int(now if now is not None else time.time())
    company = bool(symbol) and asset_class in ("stock", "etf")
    if company:
        scope, cat = "company", None
    else:
        scope = "category"
        cat = category or {"crypto": "crypto", "forex": "forex"}.get(asset_class or "", "general")
    meta = {"scope": scope, "symbol": symbol, "category": cat}
    client = client or finnhub_client()
    if client is None:
        return _not_configured(**meta)
    key = ("feed", scope, symbol if company else cat)
    cached = _cache.get(key)
    if cached is not None:
        return cached
    try:
        if company:
            end = datetime.fromtimestamp(now, UTC).date()
            items = client.company_news(str(symbol), (end - timedelta(days=7)).isoformat(), end.isoformat())
        else:
            items = client.news(cat or "general")
    except NewsProviderError as exc:
        return {
            "available": False,
            "provider": "finnhub",
            "code": "NEWS_PROVIDER_ERROR",
            "reason": f"News provider error: {scrub_secrets(exc)}",
            "items": [],
            "disclaimer": DISCLAIMER,
            **meta,
        }
    out = {
        "available": True,
        "provider": "finnhub",
        **meta,
        "items": items,
        "fetched_ts": now,
        "disclaimer": DISCLAIMER,
    }
    _cache.set(key, out, ttl=NEWS_TTL)
    return out


# ------------------------------------------------------------------ /api/markets/calendar
def calendar(
    *,
    start: str,
    end: str,
    now: int | None = None,
    client: FinnhubClient | None = None,
    catalog_lookup=None,
) -> dict:
    """Economic calendar when the Finnhub plan allows it (401/403 → falls back to the earnings calendar).

    `catalog_lookup(symbol)` → (slug, name) | None marks earnings of instruments that exist in the catalog.
    Events are never fabricated: both calendars failing → available false with the (scrubbed) provider message.
    """
    now = int(now if now is not None else time.time())
    meta = {"from": start, "to": end}
    client = client or finnhub_client()
    if client is None:
        return _not_configured(kind=None, note=None, **meta)
    key = ("calendar", start, end)
    cached = _cache.get(key)
    if cached is not None:
        return cached
    note = None
    try:
        items = client.economic_calendar(start, end)
        kind = "economic"
    except NewsProviderError as exc:
        if exc.status not in (401, 403):
            return {
                "available": False,
                "provider": "finnhub",
                "code": "NEWS_PROVIDER_ERROR",
                "kind": None,
                "reason": f"Calendar provider error: {scrub_secrets(exc)}",
                "note": None,
                "items": [],
                "disclaimer": CALENDAR_DISCLAIMER,
                **meta,
            }
        note = (
            f"Economic calendar is not available on the configured Finnhub plan ({scrub_secrets(exc)}). "
            "Показваме earnings calendar вместо него."
        )
        try:
            items = client.earnings_calendar(start, end)
            kind = "earnings"
        except NewsProviderError as exc2:
            return {
                "available": False,
                "provider": "finnhub",
                "code": "NEWS_PROVIDER_ERROR",
                "kind": None,
                "reason": f"{note} Earnings calendar error: {scrub_secrets(exc2)}",
                "note": note,
                "items": [],
                "disclaimer": CALENDAR_DISCLAIMER,
                **meta,
            }
        if catalog_lookup is not None:
            for item in items:
                hit = catalog_lookup(item["symbol"])
                item["in_catalog"] = hit is not None
                item["slug"], item["name"] = hit if hit is not None else (None, None)
            items.sort(key=lambda x: (not x.get("in_catalog"), x["date"] or "", x["symbol"]))
    items = items[:300]
    out = {
        "available": True,
        "provider": "finnhub",
        "kind": kind,
        "note": note,
        "items": items,
        "fetched_ts": now,
        "disclaimer": CALENDAR_DISCLAIMER,
        **meta,
    }
    _cache.set(key, out, ttl=CALENDAR_TTL)
    return out
