"""Market capitalisation for the crypto heatmap — ONLY from a real, read-only provider (never estimated).

Setting ``MARKET_CAP_PROVIDER``:
    none       (default) no market caps → the heatmap sizes tiles by 24h volume and says
               "Market cap: DATA NOT AVAILABLE".
    coingecko  CoinGecko public API, one request
               ``GET {COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1``
               cached 15 minutes. Coins are mapped by their (upper-case) ticker symbol; when several coins share
               a ticker the one with the highest market cap wins. An optional demo key (COINGECKO_API_KEY) is sent
               as the ``x-cg-demo-api-key`` header, never in the URL.

Stocks and ETFs: none of the configured providers supplies market capitalisation, so it is always None.
"""

from __future__ import annotations

import threading
import time

import httpx

from app.config import get_settings
from app.market.base import DataSource
from app.market.overview import scrub_secrets

CACHE_TTL = 900.0  # 15 minutes
FAILURE_TTL = 120.0  # do not hammer the provider after an error

COINGECKO_SOURCE = DataSource(
    id="coingecko",
    name="CoinGecko (market cap)",
    is_live=True,
    disclaimer="Пазарна капитализация от CoinGecko (read-only, обновява се на 15 минути).",
    status="live",
)


class MarketCapError(RuntimeError):
    """The market-cap provider failed (message is safe to show: no secrets)."""


class CoinGeckoMarketCaps:
    """{TICKER: {market_cap, id, name, rank}} from ONE CoinGecko /coins/markets request (cached 15 min)."""

    def __init__(
        self,
        base_url: str = "https://api.coingecko.com/api/v3",
        api_key: str | None = None,
        *,
        timeout: float = 10.0,
        client: httpx.Client | None = None,
        clock=time.monotonic,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=timeout)
        self._clock = clock
        self._lock = threading.Lock()
        self._data: dict[str, dict] | None = None
        self._expires = 0.0
        self._error: str | None = None
        self.fetched_ts: int | None = None

    def _fetch(self) -> dict[str, dict]:
        headers = {"accept": "application/json"}
        if self.api_key:
            headers["x-cg-demo-api-key"] = self.api_key
        params = {"vs_currency": "usd", "order": "market_cap_desc", "per_page": 250, "page": 1}
        try:
            resp = self.client.get(f"{self.base_url}/coins/markets", params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise MarketCapError(f"CoinGecko request failed ({type(exc).__name__})") from exc
        if resp.status_code == 429:
            raise MarketCapError("CoinGecko rate limit reached (HTTP 429)")
        if resp.status_code >= 400:
            raise MarketCapError(f"CoinGecko HTTP {resp.status_code}")
        try:
            rows = resp.json()
        except ValueError as exc:
            raise MarketCapError("CoinGecko returned invalid JSON") from exc
        if not isinstance(rows, list):
            raise MarketCapError("Unexpected CoinGecko response")
        out: dict[str, dict] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = str(row.get("symbol") or "").strip().upper()
            cap = row.get("market_cap")
            try:
                cap = float(cap) if cap is not None else None
            except (TypeError, ValueError):
                cap = None
            if not sym or cap is None or cap <= 0:
                continue  # missing caps stay missing (never estimated)
            prev = out.get(sym)
            if prev is None or cap > prev["market_cap"]:
                out[sym] = {
                    "market_cap": cap,
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "rank": row.get("market_cap_rank"),
                }
        return out

    def caps(self, *, refresh: bool = False) -> dict[str, dict]:
        """Cached market caps; raises MarketCapError when the provider fails and nothing is cached."""
        now = self._clock()
        if not refresh and now < self._expires:
            if self._data is not None:
                return self._data
            raise MarketCapError(self._error or "Market cap provider unavailable")
        with self._lock:
            now = self._clock()
            if not refresh and now < self._expires:
                if self._data is not None:
                    return self._data
                raise MarketCapError(self._error or "Market cap provider unavailable")
            try:
                data = self._fetch()
            except MarketCapError as exc:
                self._error = scrub_secrets(exc)
                self._expires = now + FAILURE_TTL
                self._data = None
                raise MarketCapError(self._error) from exc
            self._data = data
            self._error = None
            self._expires = now + CACHE_TTL
            self.fetched_ts = int(time.time())
            return data

    def is_stale(self) -> bool:
        return self._clock() >= self._expires


_provider: CoinGeckoMarketCaps | None = None
_provider_key: tuple | None = None
_provider_lock = threading.Lock()


def provider_name() -> str:
    return (get_settings().market_cap_provider or "none").strip().lower()


def get_provider() -> CoinGeckoMarketCaps | None:
    """The configured market-cap provider (None for MARKET_CAP_PROVIDER=none or unknown values)."""
    global _provider, _provider_key
    s = get_settings()
    if provider_name() != "coingecko":
        return None
    key = (s.coingecko_base_url, s.coingecko_api_key, s.market_http_timeout)
    with _provider_lock:
        if _provider is None or _provider_key != key:
            _provider = CoinGeckoMarketCaps(s.coingecko_base_url, s.coingecko_api_key, timeout=s.market_http_timeout)
            _provider_key = key
        return _provider


def set_provider(provider: CoinGeckoMarketCaps | None) -> None:
    """Install a provider instance (tests: one with an httpx.MockTransport). It is used while the setting is coingecko."""
    global _provider, _provider_key
    s = get_settings()
    with _provider_lock:
        _provider = provider
        _provider_key = (s.coingecko_base_url, s.coingecko_api_key, s.market_http_timeout) if provider else None


def refresh_if_stale() -> bool:
    """Called by the warm-up thread so heatmap requests find warm market caps. True when a fetch succeeded."""
    p = get_provider()
    if p is None or not p.is_stale():
        return False
    try:
        p.caps()
    except MarketCapError:
        return False
    return True


def crypto_market_caps(bases: list[str]) -> dict:
    """Market caps for crypto base tickers.

    → {available, provider, caps: {BASE: float|None}, source: DataSource dict|None, reason: str|None, fetched_ts}
    """
    p = get_provider()
    if p is None:
        name = provider_name()
        reason = (
            "MARKET_CAP_PROVIDER=none"
            if name == "none"
            else f"Unknown MARKET_CAP_PROVIDER '{name}' (supported: none, coingecko)"
        )
        return {"available": False, "provider": "none", "caps": {}, "source": None, "reason": reason, "fetched_ts": None}
    try:
        data = p.caps()
    except MarketCapError as exc:
        return {
            "available": False,
            "provider": "coingecko",
            "caps": {},
            "source": COINGECKO_SOURCE.to_dict(),
            "reason": f"CoinGecko: {exc}",
            "fetched_ts": None,
        }
    caps = {b.upper(): (data.get(b.upper()) or {}).get("market_cap") for b in bases}
    return {
        "available": True,
        "provider": "coingecko",
        "caps": caps,
        "source": COINGECKO_SOURCE.to_dict(),
        "reason": None,
        "fetched_ts": p.fetched_ts,
    }
