"""News / events (optional). Uses the Finnhub REST API when FINNHUB_API_KEY is set.

News is shown as CONTEXT only — the platform never turns a headline into a trade signal.
Without a key the endpoint says so instead of inventing headlines.
"""

from __future__ import annotations

import time

import httpx

from app.config import get_settings
from app.market.http_providers import RateLimiter, _TTLCache

_limiter = RateLimiter(rate_per_sec=0.5, burst=3)
_cache = _TTLCache(32)

DISCLAIMER = (
    "Новините са контекст, не trading сигнал. Пазарната реакция на новина е непредвидима — "
    "AI анализът може да отбележи 'News risk' и да препоръча NO TRADE."
)


def get_news(category: str = "general") -> dict:
    s = get_settings()
    if not s.finnhub_api_key:
        return {
            "configured": False,
            "items": [],
            "message": "Няма конфигуриран news provider. Добави FINNHUB_API_KEY в backend/.env, за да виждаш реални новини.",
            "disclaimer": DISCLAIMER,
        }
    cached = _cache.get(category)
    if cached is not None:
        return cached
    _limiter.acquire()
    try:
        resp = httpx.get(
            "https://finnhub.io/api/v1/news",
            params={"category": category, "token": s.finnhub_api_key},
            timeout=s.market_http_timeout,
        )
        resp.raise_for_status()
        raw = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        return {"configured": True, "items": [], "message": f"News provider error: {exc}", "disclaimer": DISCLAIMER}
    items = [
        {
            "headline": n.get("headline"),
            "summary": (n.get("summary") or "")[:400],
            "source": n.get("source"),
            "url": n.get("url"),
            "ts": n.get("datetime"),
            "category": n.get("category"),
        }
        for n in raw[:30]
        if n.get("headline")
    ]
    out = {"configured": True, "items": items, "fetched_ts": int(time.time()), "disclaimer": DISCLAIMER}
    _cache.set(category, out, ttl=300)
    return out
