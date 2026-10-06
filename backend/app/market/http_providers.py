"""Real (read-only) market-data providers.

* BinancePublicProvider — Binance public market-data REST endpoints. No API key and no
  account access are involved; only klines and 24h tickers are requested.
* TwelveDataProvider — Twelve Data REST API for forex / stocks / indices / commodities.
  Requires TWELVEDATA_API_KEY (set it in `.env`, never in code or in the database).

Both providers respect rate limits (token bucket) and cache responses. On failure they
raise MarketDataError — the platform never silently replaces real data with demo data.
"""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime

import httpx

from app.market.base import AssetSpec, Candle, DataSource, MarketDataError, MarketDataProvider, Ticker
from app.market.timeframes import align, tf_seconds


class RateLimiter:
    """Simple thread-safe token bucket."""

    def __init__(self, rate_per_sec: float, burst: int):
        self.rate = rate_per_sec
        self.capacity = burst
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self, timeout: float = 15.0) -> None:
        deadline = time.monotonic() + timeout
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate
            if time.monotonic() + wait > deadline:
                raise MarketDataError("Rate limit: too many market-data requests, try again shortly.")
            time.sleep(wait)


class _TTLCache:
    def __init__(self, maxsize: int = 512):
        self.data: dict = {}
        self.maxsize = maxsize
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            item = self.data.get(key)
            if item and item[0] > time.monotonic():
                return item[1]
            return None

    def set(self, key, value, ttl: float) -> None:
        with self.lock:
            if len(self.data) >= self.maxsize:
                self.data.pop(next(iter(self.data)))
            self.data[key] = (time.monotonic() + ttl, value)


class BinancePublicProvider(MarketDataProvider):
    source = DataSource(
        id="binance",
        name="Binance public market data",
        is_live=True,
        disclaimer="Реални публични пазарни данни (read-only). Изпълнението на сделки остава PAPER (виртуално).",
    )
    _INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w"}

    def __init__(self, base_url: str, timeout: float = 10.0, client: httpx.Client | None = None):
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=timeout)
        self.limiter = RateLimiter(rate_per_sec=8, burst=16)  # far below Binance's published weight limits
        self.cache = _TTLCache()

    def supports(self, asset: AssetSpec) -> bool:
        return "binance" in asset.provider_symbols

    def _get(self, path: str, params: dict):
        self.limiter.acquire()
        try:
            resp = self.client.get(f"{self.base_url}{path}", params=params)
        except httpx.HTTPError as exc:
            raise MarketDataError(f"Binance request failed: {exc}") from exc
        if resp.status_code == 429 or resp.status_code == 418:
            raise MarketDataError("Binance rate limit reached — slowing down.")
        if resp.status_code >= 400:
            raise MarketDataError(f"Binance error {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    def get_candles(self, asset, timeframe, *, start=None, end=None, limit=500, now=None, include_partial=True):
        if not self.supports(asset):
            raise MarketDataError(f"{asset.symbol} is not available from Binance")
        now = int(now or time.time())
        sec = tf_seconds(timeframe)
        end = min(end or now, now)
        if start is None:
            start = align(end, timeframe) - (limit - 1) * sec
        key = (asset.symbol, timeframe, start, align(end, timeframe))
        cached = self.cache.get(key)
        if cached is None:
            rows: list[Candle] = []
            cursor = start
            while cursor <= end:
                data = self._get(
                    "/api/v3/klines",
                    {
                        "symbol": asset.provider_symbols["binance"],
                        "interval": self._INTERVALS[timeframe],
                        "startTime": cursor * 1000,
                        "endTime": end * 1000,
                        "limit": 1000,
                    },
                )
                if not data:
                    break
                for k in data:
                    rows.append(
                        Candle(int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]))
                    )
                cursor = rows[-1].ts + sec
                if len(data) < 1000:
                    break
            cached = rows
            # closed history can be cached longer than the forming candle
            self.cache.set(key, cached, ttl=5 if align(end, timeframe) >= align(now, timeframe) else 300)
        rows = [c for c in cached if c.ts <= end]
        if not include_partial:
            rows = [c for c in rows if c.ts + sec <= now]
        return rows[-limit:] if limit else rows

    def get_ticker(self, asset, *, now=None):
        key = ("ticker", asset.symbol)
        cached = self.cache.get(key)
        if cached:
            return cached
        data = self._get("/api/v3/ticker/24hr", {"symbol": asset.provider_symbols["binance"]})
        t = Ticker(
            symbol=asset.symbol,
            price=float(data["lastPrice"]),
            ts=int(now or time.time()),
            change_24h_pct=float(data.get("priceChangePercent", 0.0)),
            volume_24h=float(data.get("volume", 0.0)),
            source=self.source.id,
        )
        self.cache.set(key, t, ttl=2)
        return t


def _parse_dt(value: str) -> int:
    value = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return int(datetime.strptime(value, fmt).replace(tzinfo=UTC).timestamp())
        except ValueError:
            continue
    raise MarketDataError(f"Unexpected datetime from Twelve Data: {value!r}")


class TwelveDataProvider(MarketDataProvider):
    source = DataSource(
        id="twelvedata",
        name="Twelve Data",
        is_live=True,
        disclaimer="Реални пазарни данни от Twelve Data (read-only, може да има закъснение според плана). "
        "Изпълнението остава PAPER.",
    )
    _INTERVALS = {
        "1m": "1min",
        "5m": "5min",
        "15m": "15min",
        "30m": "30min",
        "1h": "1h",
        "4h": "4h",
        "1d": "1day",
        "1w": "1week",
    }

    def __init__(self, api_key: str | None, base_url: str, timeout: float = 10.0, client: httpx.Client | None = None):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=timeout)
        self.limiter = RateLimiter(rate_per_sec=8 / 60, burst=4)  # free plan: 8 requests / minute
        self.cache = _TTLCache()

    def supports(self, asset: AssetSpec) -> bool:
        return "twelvedata" in asset.provider_symbols

    def _get(self, path: str, params: dict):
        if not self.api_key:
            raise MarketDataError("TWELVEDATA_API_KEY is not set. Add it to backend .env to use Twelve Data.")
        self.limiter.acquire(timeout=30)
        try:
            resp = self.client.get(f"{self.base_url}{path}", params={**params, "apikey": self.api_key})
        except httpx.HTTPError as exc:
            raise MarketDataError(f"Twelve Data request failed: {exc}") from exc
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400 or (isinstance(data, dict) and data.get("status") == "error"):
            raise MarketDataError(f"Twelve Data error: {data.get('message', resp.status_code)}")
        return data

    def get_candles(self, asset, timeframe, *, start=None, end=None, limit=500, now=None, include_partial=True):
        if not self.supports(asset):
            raise MarketDataError(f"{asset.symbol} is not available from Twelve Data")
        now = int(now or time.time())
        sec = tf_seconds(timeframe)
        end = min(end or now, now)
        fmt = "%Y-%m-%d %H:%M:%S"
        params = {
            "symbol": asset.provider_symbols["twelvedata"],
            "interval": self._INTERVALS[timeframe],
            "timezone": "UTC",
            "order": "ASC",
            "outputsize": min(max(limit, 1), 5000),
            "end_date": datetime.fromtimestamp(end, UTC).strftime(fmt),
        }
        if start is not None:
            params["start_date"] = datetime.fromtimestamp(start, UTC).strftime(fmt)
        key = tuple(sorted(params.items()))
        rows = self.cache.get(key)
        if rows is None:
            data = self._get("/time_series", params)
            rows = []
            for v in data.get("values", []):
                ts = _parse_dt(v["datetime"])
                rows.append(
                    Candle(
                        ts,
                        float(v["open"]),
                        float(v["high"]),
                        float(v["low"]),
                        float(v["close"]),
                        float(v.get("volume") or 0.0),
                    )
                )
            self.cache.set(key, rows, ttl=30)
        if not include_partial:
            rows = [c for c in rows if c.ts + sec <= now]
        return rows[-limit:] if limit else rows

    def get_ticker(self, asset, *, now=None):
        key = ("ticker", asset.symbol)
        cached = self.cache.get(key)
        if cached:
            return cached
        data = self._get("/quote", {"symbol": asset.provider_symbols["twelvedata"]})
        t = Ticker(
            symbol=asset.symbol,
            price=float(data["close"]),
            ts=int(now or time.time()),
            change_24h_pct=float(data.get("percent_change") or 0.0),
            volume_24h=float(data.get("volume") or 0.0),
            source=self.source.id,
        )
        self.cache.set(key, t, ttl=15)
        return t
