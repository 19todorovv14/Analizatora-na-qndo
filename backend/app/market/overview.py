"""Quote snapshot engine for the Markets explorer (work package S1). READ-ONLY market data.

A *quote snapshot* summarises one instrument: last price, 24h change / high / low / volume, 7d change, ATR %,
daily trend and regime, a small sparkline and the data source (DataSource dict incl. ``status``). Every number
comes from the instrument's configured provider (``app.market.registry.provider_for``); nothing is invented.
When no configured provider can serve an instrument the snapshot says ``available: false`` with the reason
(``code: DATA_NOT_AVAILABLE``).

Provider strategies (chosen from the concrete provider that serves the instrument)
    direct        DEMO (and any provider without a special strategy): ticker + 1h candles (49) + 1d candles (301).
    binance       ONE bulk ``/api/v3/ticker/24hr`` call for every instrument (24h fields, cached 30 s by the
                  provider) + per-symbol 1d klines cached 30 min (7d change, trend, regime, ATR, sparkline).
    rate_limited  Twelve Data (8 requests/min, daily credits): computed ONLY on demand for instruments a user looks
                  at (asset page, watchlist rows) from ONE 1d ``time_series`` request, in a background worker so a
                  request never blocks on the rate limiter. Never fanned out over the universe and excluded from
                  universe-wide lists ("The configured provider plan cannot compute this list").

Caching: per-instrument TTL (demo 60 s, live 30 s, Twelve Data 300 s — its quotes are delayed and the free plan
has 800 credits/day), judged against the epoch ``now`` passed in, so tests with a fixed clock are deterministic.
Lists may use snapshots up to 10 minutes old (every quote carries ``as_of``). A background warm-up thread
(started from the markets router lifespan, setting ``MARKET_WARMUP``) precomputes the curated demo/Binance
snapshots and keeps them fresh (Binance every ~30 s, demo every ~4 min — see WARM_REFRESH_DEMO), so a request never
computes a cold universe. A provider-level failure (network, rate limit, 5xx) opens a 30 s circuit breaker so an
outage costs one timeout, not one per instrument.

Quote statuses: ok | unavailable (DATA_NOT_AVAILABLE) | error (MARKET_DATA_ERROR, provider failure) |
pending (being fetched in the background — poll again) | on_demand (rate-limited provider, only loaded on the
asset page / watchlist) | unknown (UNKNOWN_INSTRUMENT).
"""

from __future__ import annotations

import logging
import math
import queue
import re
import threading
import time
from collections import Counter, OrderedDict
from collections.abc import Callable, Hashable, Iterable
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field

from app import indicators as ind
from app.analysis.regime import classify
from app.config import get_settings
from app.market import registry
from app.market.base import AssetSpec, Candle, DataNotAvailableError, MarketDataError, MarketDataProvider
from app.market.catalog import ASSETS, UnknownAssetError, get_asset
from app.market.http_providers import BinancePublicProvider, TwelveDataProvider
from app.market.providers import UNAVAILABLE_SOURCE

log = logging.getLogger(__name__)

KIND_DIRECT = "direct"
KIND_BINANCE = "binance"
KIND_RATE_LIMITED = "rate_limited"

TTL_DEMO = 60
TTL_LIVE = 30
TTL_RATE_LIMITED = 300
TTL_FAILED = 20  # errors / partial snapshots are retried soon
LIST_MAX_STALE = 600  # lists and heatmaps may use snapshots up to 10 minutes old (as_of is in every quote)
BINANCE_DAILY_TTL = 1800  # per-symbol 1d klines (7d change, trend, regime, sparkline)
DAILY_CLOSED = 300  # closed daily candles used for regime / trend / ATR (same window as /api/market/regime)
HOURLY_LIMIT = 49
SPARK_HOURS = 48
SPARK_POINTS = 32
MAX_ENTRIES = 5000
MAX_DAILY_SERIES = 1500  # Binance per-symbol daily klines kept in memory
CIRCUIT_SECONDS = 30.0  # after a provider-level failure (network, rate limit, 5xx) skip that provider briefly
WARM_INTERVAL = 30.0  # seconds between warm-up passes (each pass refreshes snapshots older than TTL / 2 …)
# … except DEMO snapshots, refreshed every ~4 minutes: every demo tick materialises new intraday sub-candles in the
# demo generator's LRU cache, so ticking ~300 instruments every 30 s would grow memory quickly. Lists accept
# snapshots up to LIST_MAX_STALE; a single instrument (asset page, watchlist) is always recomputed after TTL_DEMO.
WARM_REFRESH_DEMO = 240
REQUEST_LIVE_FETCHES = 8  # synchronous Binance kline fetches allowed per request (the rest go to the background)
LIST_SYNC_SECONDS = 1.5  # time a list request may spend computing missing (cheap) snapshots
DAY = 86400

USD_LIKE = frozenset({"USD", "USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USDP", "PYUSD"})

STATUS_OK = "ok"
STATUS_UNAVAILABLE = "unavailable"
STATUS_ERROR = "error"
STATUS_PENDING = "pending"
STATUS_ON_DEMAND = "on_demand"
STATUS_UNKNOWN = "unknown"

CODE_DNA = DataNotAvailableError.code  # DATA_NOT_AVAILABLE
CODE_ERROR = "MARKET_DATA_ERROR"
CODE_PENDING = "PENDING"
CODE_ON_DEMAND = "ON_DEMAND_ONLY"
CODE_UNKNOWN = "UNKNOWN_INSTRUMENT"

REASON_ON_DEMAND = (
    "Котировката от Twelve Data се зарежда on demand (страницата на актива / watchlist): планът позволява "
    "8 заявки в минута, затова списъците не се изчисляват от него."
)
REASON_PENDING = "Котировката се зарежда от доставчика — опитай отново след няколко секунди."
REASON_BUSY = "Доставчикът на данни е зает (rate limit) — опитай отново след минута."
REASON_DAILY_PENDING = "Дневните свещи (7d промяна, trend, regime) се зареждат."
REASON_UNKNOWN = "Непознат инструмент (не е в каталога)."

QUOTE_FIELDS = (
    "price",
    "change_24h_pct",
    "change_basis",
    "high_24h",
    "low_24h",
    "volume_24h",
    "volume_24h_usd",
    "range_24h_pct",
    "change_7d_pct",
    "atr_pct_1d",
    "trend",
    "regime",
)

# ------------------------------------------------------------------ secrets in error texts
_QUERY_STRING = re.compile(r"\?[^\s'\"]*=[^\s'\"]*")
_PROVIDER_LEVEL = re.compile(r"request failed|rate limit|timed? ?out|error 5\d\d|http 5\d\d", re.IGNORECASE)
_SECRET_PARAM = re.compile(r"(?i)\b(token|apikey|api_key|key|secret|password)=[^\s&'\"]+")


def scrub_secrets(text: object, *, limit: int = 300) -> str:
    """Provider error text that is safe to show: query strings and configured API keys removed."""
    out = _QUERY_STRING.sub("?…", str(text))
    out = _SECRET_PARAM.sub(r"\1=…", out)
    s = get_settings()
    for secret in (s.twelvedata_api_key, s.finnhub_api_key, s.coingecko_api_key, s.anthropic_api_key):
        if secret and len(secret) >= 4:
            out = out.replace(secret, "…")
    return out[:limit]


class CircuitOpenError(MarketDataError):
    """The provider failed moments ago (network / rate limit / 5xx); it is skipped for CIRCUIT_SECONDS."""


# ------------------------------------------------------------------ small numeric helpers
def _r(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, digits)


def downsample(values: list[float], points: int = SPARK_POINTS) -> list[float]:
    """At most `points` values, evenly spaced, always keeping the first and the last one."""
    n = len(values)
    if n <= points:
        return list(values)
    if points <= 1:
        return [values[-1]]
    return [values[round(i * (n - 1) / (points - 1))] for i in range(points)]


def closed_daily(candles: list[Candle], now: int) -> list[Candle]:
    """Daily candles that have closed at `now` (the forming one is dropped)."""
    return [c for c in candles if c.ts + DAY <= now]


def change_7d_pct(daily: list[Candle], price: float | None, now: int) -> float | None:
    """Change vs the close of the last daily candle that closed at least 7 days ago (span 7–8 days)."""
    if price is None:
        return None
    ref = None
    for c in reversed(daily):
        if c.ts + DAY <= now - 7 * DAY:
            ref = c
            break
    if ref is None or not ref.close:
        return None
    return (price / ref.close - 1) * 100


def atr_pct(daily: list[Candle], price: float | None) -> float | None:
    """ATR(14) of closed daily candles as % of the current price."""
    if price is None or not price or len(daily) < 15:
        return None
    series = ind.atr([c.high for c in daily], [c.low for c in daily], [c.close for c in daily], 14)
    last = series[-1] if series else None
    return None if last is None else last / price * 100


def daily_trend(closes: list[float], atr_percent: float | None) -> str | None:
    """'up' | 'down' | 'sideways' from daily closes: EMA20 vs EMA50 and the 5-day slope of EMA20.

    The EMA20/EMA50 spread must exceed a quarter of the daily ATR % (an adaptive dead zone) to count as a trend.
    None when there is not enough history (never guessed).
    """
    if len(closes) < 55:
        return None
    e20 = ind.ema(closes, 20)
    e50 = ind.ema(closes, 50)
    fast, slow, fast_5 = e20[-1], e50[-1], e20[-6]
    if fast is None or slow is None or fast_5 is None or not slow or not fast_5:
        return None
    spread = (fast - slow) / slow * 100
    slope = (fast / fast_5 - 1) * 100
    dead_zone = 0.25 * atr_percent if atr_percent else 0.1
    if spread > dead_zone and slope > 0:
        return "up"
    if spread < -dead_zone and slope < 0:
        return "down"
    return "sideways"


def regime_payload(classified: dict, closes: list[float]) -> dict:
    """Same derivation as market_service.regime_snapshot (shape {regime, trend, volatility_pct, reasons})."""
    reg = classified["regime"]
    trend = {"TRENDING_UP": "Up", "TRENDING_DOWN": "Down", "RANGING": "Sideways"}.get(reg, "Mixed")
    if reg in ("HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCLEAR") and len(closes) > 50:
        trend = "Up" if closes[-1] > closes[-50] else "Down"
    return {
        "regime": reg,
        "trend": trend,
        "volatility_pct": (classified.get("metrics") or {}).get("atr_pct"),
        "reasons": classified.get("reasons", []),
    }


# ------------------------------------------------------------------ routing
@dataclass(frozen=True, slots=True)
class Route:
    """How an instrument's snapshot is computed. kind None → not available (reason/code say why)."""

    kind: str | None
    provider: MarketDataProvider | None = None
    source: dict | None = None
    reason: str | None = None
    code: str | None = None

    @property
    def key(self) -> tuple:
        return (self.kind, id(self.provider) if self.provider is not None else None)

    @property
    def is_demo(self) -> bool:
        return bool(self.source) and self.source.get("status") == "demo"

    @property
    def ttl(self) -> int:
        if self.kind == KIND_RATE_LIMITED:
            return TTL_RATE_LIMITED
        if self.kind == KIND_DIRECT and self.is_demo:
            return TTL_DEMO
        return TTL_LIVE

    @property
    def list_capable(self) -> bool:
        return self.kind in (KIND_DIRECT, KIND_BINANCE)


def route(spec: AssetSpec) -> Route:
    """Cheap (no network): which provider serves `spec` and with which snapshot strategy."""
    try:
        av = registry.availability(spec)
    except Exception as exc:  # noqa: BLE001 - availability must never break a list
        return Route(None, reason=scrub_secrets(exc), code=CODE_DNA)
    if not av.get("available"):
        return Route(None, reason=av.get("reason") or "DATA NOT AVAILABLE", code=CODE_DNA)
    try:
        provider = registry.provider_for(spec)
    except DataNotAvailableError as exc:
        return Route(None, reason=exc.reason, code=CODE_DNA)
    except MarketDataError as exc:
        return Route(None, reason=scrub_secrets(exc), code=CODE_ERROR)
    if isinstance(provider, BinancePublicProvider):
        kind = KIND_BINANCE
    elif isinstance(provider, TwelveDataProvider):
        kind = KIND_RATE_LIMITED
    else:
        kind = KIND_DIRECT
    return Route(kind, provider, provider.source.to_dict())


# ------------------------------------------------------------------ quote dicts
def _quote_dict(
    spec: AssetSpec | None,
    symbol: str,
    *,
    status: str,
    now: int | None,
    source: dict | None,
    code: str | None = None,
    reason: str | None = None,
    partial: bool = False,
    values: dict | None = None,
    sparkline: list[float] | None = None,
    sparkline_tf: str | None = None,
) -> dict:
    out: dict = {
        "symbol": symbol,
        "available": status == STATUS_OK,
        "status": status,
        "code": code,
        "reason": reason,
        "partial": partial,
    }
    vals = values or {}
    for f in QUOTE_FIELDS:
        out[f] = vals.get(f)
    out["sparkline"] = sparkline or []
    out["sparkline_tf"] = sparkline_tf
    out["precision"] = spec.price_precision if spec is not None else None
    out["currency"] = spec.currency if spec is not None else None
    out["source"] = source
    out["as_of"] = now
    return out


def placeholder(
    spec: AssetSpec | None,
    *,
    status: str,
    reason: str | None,
    code: str | None,
    now: int | None,
    symbol: str | None = None,
    source: dict | None = None,
) -> dict:
    """A quote-shaped dict without values (unavailable / error / pending / on_demand / unknown)."""
    if source is None:
        source = UNAVAILABLE_SOURCE.to_dict() if status in (STATUS_UNAVAILABLE, STATUS_UNKNOWN) else None
    return _quote_dict(
        spec,
        symbol or (spec.symbol if spec is not None else ""),
        status=status,
        now=now,
        source=source,
        code=code,
        reason=reason,
    )


def unknown_quote(symbol: str, now: int | None = None) -> dict:
    return placeholder(None, symbol=symbol, status=STATUS_UNKNOWN, reason=REASON_UNKNOWN, code=CODE_UNKNOWN, now=now)


def route_placeholder(spec: AssetSpec, r: Route, now: int) -> dict:
    status = STATUS_ERROR if r.code == CODE_ERROR else STATUS_UNAVAILABLE
    return placeholder(spec, status=status, reason=r.reason, code=r.code or CODE_DNA, now=now)


# ------------------------------------------------------------------ background worker
class Background:
    """Tiny daemon worker pool with per-key de-duplication (on-demand live fetches never block a request)."""

    def __init__(self, workers: int = 2, max_pending: int = 64):
        self.workers = workers
        self.max_pending = max_pending
        self._queue: queue.Queue = queue.Queue()
        self._inflight: dict[Hashable, Future] = {}
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    def submit(self, key: Hashable, fn: Callable[[], object]) -> Future | None:
        """Run fn() in the background (once per key while in flight). None when too many jobs are pending."""
        with self._lock:
            fut = self._inflight.get(key)
            if fut is not None:
                return fut
            if len(self._inflight) >= self.max_pending:
                return None
            fut = Future()
            self._inflight[key] = fut
            self._threads = [t for t in self._threads if t.is_alive()]
            while len(self._threads) < self.workers:
                t = threading.Thread(target=self._run, name=f"markets-bg-{len(self._threads)}", daemon=True)
                t.start()
                self._threads.append(t)
        self._queue.put((key, fn, fut))
        return fut

    def _run(self) -> None:
        while True:
            key, fn, fut = self._queue.get()
            try:
                if fut.set_running_or_notify_cancel():
                    try:
                        fut.set_result(fn())
                    except BaseException as exc:  # noqa: BLE001 - delivered to the waiting caller
                        fut.set_exception(exc)
            finally:
                with self._lock:
                    if self._inflight.get(key) is fut:
                        del self._inflight[key]
                self._queue.task_done()

    def pending(self) -> int:
        with self._lock:
            return len(self._inflight)

    def drain(self, timeout: float = 10.0) -> bool:
        """Wait until no job is in flight (tests). True when drained."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.pending() == 0:
                return True
            time.sleep(0.01)
        return self.pending() == 0


class Budget:
    """Synchronous live fetches (and optionally time) a single request may spend."""

    def __init__(self, fetches: int | None = REQUEST_LIVE_FETCHES, seconds: float | None = None):
        self.fetches = fetches
        self.deadline = time.monotonic() + seconds if seconds is not None else None

    def take(self) -> bool:
        if self.fetches is None:
            return True
        if self.fetches <= 0:
            return False
        self.fetches -= 1
        return True

    def has_time(self) -> bool:
        return self.deadline is None or time.monotonic() < self.deadline


def unlimited() -> Budget:
    return Budget(None)


# ------------------------------------------------------------------ engine
@dataclass(slots=True)
class Entry:
    quote: dict
    as_of: int
    ttl: int
    route_key: tuple
    extra: dict = field(default_factory=dict)


@dataclass(slots=True)
class Collected:
    """Snapshots usable for a universe-wide list (only list-capable providers)."""

    items: list[tuple[AssetSpec, dict]]
    eligible: int
    unavailable: int
    rate_limited: int
    missing: int
    rate_limited_classes: list[str]


class QuoteEngine:
    def __init__(self, clock: Callable[[], float] = time.time, workers: int = 3):
        self.clock = clock
        self._lock = threading.RLock()
        self._entries: dict[str, Entry] = {}
        self._daily: dict[str, tuple[int, tuple, list[Candle]]] = {}
        self._regimes: OrderedDict[tuple, dict] = OrderedDict()
        self._down: dict[tuple, tuple[float, str]] = {}  # circuit breaker: key → (monotonic until, message)
        self.background = Background(workers=workers)
        self._warm_thread: threading.Thread | None = None
        self._warm_stop = threading.Event()
        self.warm_state: dict = self._initial_warm_state()

    @staticmethod
    def _initial_warm_state() -> dict:
        return {
            "running": False,
            "passes": 0,
            "last_pass_ts": None,
            "last_pass_seconds": None,
            "last_counts": {},
            "last_error": None,
        }

    def reset(self) -> None:
        """Forget every cached snapshot (tests, configuration changes)."""
        with self._lock:
            self._entries.clear()
            self._daily.clear()
            self._regimes.clear()
            self._down.clear()
            running = self.warm_state.get("running", False)
            self.warm_state = self._initial_warm_state()
            self.warm_state["running"] = running

    def now(self, now: int | None = None) -> int:
        return int(now if now is not None else self.clock())

    # -------------------------------------------------------------- cache
    def _get(self, symbol: str, rkey: tuple, now: int, max_age: int) -> Entry | None:
        """Cached entry at most `max_age` seconds old (computed for the same provider). Errors, unavailable and
        partial snapshots additionally expire after their own short TTL so they are retried soon."""
        e = self._entries.get(symbol)
        if e is None or e.route_key != rkey:
            return None
        age = now - e.as_of
        complete = e.quote.get("status") == STATUS_OK and not e.quote.get("partial")
        if age < 0 or age >= (max_age if complete else min(max_age, e.ttl)):
            return None
        return e

    def _put(self, symbol: str, entry: Entry) -> None:
        with self._lock:
            self._entries[symbol] = entry
            if len(self._entries) > MAX_ENTRIES:
                oldest = sorted(self._entries.items(), key=lambda kv: kv[1].as_of)[: MAX_ENTRIES // 10]
                for sym, _ in oldest:
                    self._entries.pop(sym, None)

    def cached(self, spec: AssetSpec, now: int | None = None, max_age: int = LIST_MAX_STALE) -> dict | None:
        """The cached quote of `spec` if it is at most `max_age` seconds old (no computation)."""
        r = route(spec)
        e = self._get(spec.symbol, r.key, self.now(now), max_age) if r.kind else None
        return e.quote if e else None

    def stats(self) -> dict:
        with self._lock:
            by_status = Counter(e.quote.get("status") for e in self._entries.values())
        return {
            "entries": len(self._entries),
            "by_status": dict(by_status),
            "background_pending": self.background.pending(),
        }

    # -------------------------------------------------------------- public API
    def quote(
        self,
        spec: AssetSpec,
        *,
        now: int | None = None,
        fetch: str = "cheap",
        wait: float = 0.0,
        budget: Budget | None = None,
        max_age: int | None = None,
    ) -> dict:
        """Quote snapshot of one instrument.

        fetch="cache"      only cached snapshots (≤ 10 min old), else a pending placeholder;
        fetch="cheap"      compute demo/Binance snapshots now; rate-limited providers → cached or on_demand;
        fetch="on_demand"  like cheap, and rate-limited providers are fetched in the background (waits ≤ `wait` s).
        """
        return self.entry(spec, now=now, fetch=fetch, wait=wait, budget=budget, max_age=max_age).quote

    def entry(
        self,
        spec: AssetSpec,
        *,
        now: int | None = None,
        fetch: str = "cheap",
        wait: float = 0.0,
        budget: Budget | None = None,
        max_age: int | None = None,
        r: Route | None = None,
    ) -> Entry:
        now = self.now(now)
        r = r or route(spec)
        if r.kind is None:
            return Entry(route_placeholder(spec, r, now), now, 0, r.key)
        fresh = self._get(spec.symbol, r.key, now, max_age if max_age is not None else r.ttl)
        if fresh is not None:
            return fresh
        if fetch == "cache":
            stale = self._get(spec.symbol, r.key, now, LIST_MAX_STALE)
            if stale is not None:
                return stale
            return Entry(self._pending(spec, r, now), now, 0, r.key)
        if r.kind == KIND_RATE_LIMITED:
            return self._rate_limited(spec, r, now, fetch=fetch, wait=wait)
        return self._compute(spec, r, now, budget)

    def quotes(
        self,
        specs: Iterable[AssetSpec],
        *,
        now: int | None = None,
        fetch: str = "cheap",
        wait_total: float = 0.0,
        max_age: int | None = None,
    ) -> dict[str, dict]:
        """Quotes of several instruments; rate-limited ones (fetch="on_demand") are fetched in parallel in the
        background and awaited together for at most `wait_total` seconds. `max_age` (e.g. LIST_MAX_STALE for list
        rows) lets cached snapshots older than the TTL be reused instead of recomputed."""
        now = self.now(now)
        budget = Budget()
        out: dict[str, dict] = {}
        waiting: dict[str, tuple[AssetSpec, Route, Future]] = {}
        for spec in specs:
            r = route(spec)
            if r.kind == KIND_RATE_LIMITED and fetch == "on_demand":
                fresh = self._get(spec.symbol, r.key, now, r.ttl)
                if fresh is not None:
                    out[spec.symbol] = fresh.quote
                    continue
                fut = self._submit_rate_limited(spec, r, now)
                stale = self._get(spec.symbol, r.key, now, 10**9)
                if stale is not None:
                    out[spec.symbol] = stale.quote  # stale-while-revalidate
                elif fut is None:
                    out[spec.symbol] = placeholder(
                        spec, status=STATUS_PENDING, reason=REASON_BUSY, code=CODE_PENDING, now=now, source=r.source
                    )
                else:
                    waiting[spec.symbol] = (spec, r, fut)
                continue
            out[spec.symbol] = self.entry(spec, now=now, fetch=fetch, budget=budget, max_age=max_age, r=r).quote
        deadline = time.monotonic() + max(0.0, wait_total)
        for symbol, (spec, r, fut) in waiting.items():
            out[symbol] = self._await(spec, r, fut, now, max(0.0, deadline - time.monotonic())).quote
        return out

    def collect(self, specs: Iterable[AssetSpec], *, now: int | None = None, seconds: float | None = None) -> Collected:
        """Snapshots for a universe-wide list. Uses cached snapshots (≤ 10 min); missing demo/Binance ones are
        computed only within a small time budget (LIST_SYNC_SECONDS; the warm-up thread fills the rest).
        Rate-limited and unavailable instruments are excluded."""
        now = self.now(now)
        budget = Budget(REQUEST_LIVE_FETCHES, LIST_SYNC_SECONDS if seconds is None else seconds)
        items: list[tuple[AssetSpec, dict]] = []
        eligible = unavailable = rate_limited = missing = 0
        rl_classes: list[str] = []
        for spec in specs:
            eligible += 1
            r = route(spec)
            if r.kind is None:
                unavailable += 1
                continue
            if not r.list_capable:
                rate_limited += 1
                if spec.asset_class not in rl_classes:
                    rl_classes.append(spec.asset_class)
                continue
            e = self._get(spec.symbol, r.key, now, LIST_MAX_STALE)
            if e is None:
                if not budget.has_time():
                    missing += 1
                    continue
                e = self._compute(spec, r, now, budget)
            items.append((spec, e.quote))
        return Collected(items, eligible, unavailable, rate_limited, missing, rl_classes)

    def call_with_deadline(self, key: Hashable, fn: Callable[[], object], wait: float) -> tuple[bool, object]:
        """Run fn() in the background worker and wait at most `wait` seconds: (done, result).

        Exceptions raised by fn propagate. (False, None) when it is still running (or the queue is full)."""
        fut = self.background.submit(key, fn)
        if fut is None:
            return False, None
        try:
            return True, fut.result(timeout=max(0.0, wait))
        except FutureTimeout:
            return False, None

    # -------------------------------------------------------------- rate-limited (Twelve Data) path
    def _pending(self, spec: AssetSpec, r: Route, now: int) -> dict:
        if r.kind == KIND_RATE_LIMITED:
            return placeholder(
                spec, status=STATUS_ON_DEMAND, reason=REASON_ON_DEMAND, code=CODE_ON_DEMAND, now=now, source=r.source
            )
        return placeholder(
            spec, status=STATUS_PENDING, reason=REASON_PENDING, code=CODE_PENDING, now=now, source=r.source
        )

    def _submit_rate_limited(self, spec: AssetSpec, r: Route, now: int) -> Future | None:
        return self.background.submit(("quote", spec.symbol, r.key), lambda: self._compute(spec, r, now, None))

    def _await(self, spec: AssetSpec, r: Route, fut: Future, now: int, wait: float) -> Entry:
        try:
            return fut.result(timeout=wait)
        except FutureTimeout:
            return Entry(
                placeholder(
                    spec, status=STATUS_PENDING, reason=REASON_PENDING, code=CODE_PENDING, now=now, source=r.source
                ),
                now,
                0,
                r.key,
            )
        except Exception as exc:  # noqa: BLE001 - _compute already turns provider errors into entries
            return Entry(
                placeholder(spec, status=STATUS_ERROR, reason=scrub_secrets(exc), code=CODE_ERROR, now=now),
                now,
                0,
                r.key,
            )

    def _rate_limited(self, spec: AssetSpec, r: Route, now: int, *, fetch: str, wait: float) -> Entry:
        stale = self._get(spec.symbol, r.key, now, 10**9)
        if fetch != "on_demand":
            if stale is not None and now - stale.as_of < LIST_MAX_STALE:
                return stale
            return Entry(self._pending(spec, r, now), now, 0, r.key)
        fut = self._submit_rate_limited(spec, r, now)
        if stale is not None:
            return stale  # stale-while-revalidate: the background job refreshes it
        if fut is None:
            return Entry(
                placeholder(
                    spec, status=STATUS_PENDING, reason=REASON_BUSY, code=CODE_PENDING, now=now, source=r.source
                ),
                now,
                0,
                r.key,
            )
        return self._await(spec, r, fut, now, wait)

    # -------------------------------------------------------------- computation
    # -------------------------------------------------------------- circuit breaker
    @staticmethod
    def is_provider_level(exc: Exception) -> bool:
        """Network / rate-limit / 5xx failures concern the whole provider (not one symbol)."""
        return bool(_PROVIDER_LEVEL.search(str(exc)))

    def _guard(self, key: tuple) -> None:
        hit = self._down.get(key)
        if hit is not None and time.monotonic() < hit[0]:
            raise CircuitOpenError(hit[1])

    def _trip(self, key: tuple, exc: Exception) -> None:
        if not isinstance(exc, CircuitOpenError) and self.is_provider_level(exc):
            with self._lock:
                self._down[key] = (time.monotonic() + CIRCUIT_SECONDS, scrub_secrets(exc))

    def _compute(self, spec: AssetSpec, r: Route, now: int, budget: Budget | None) -> Entry:
        try:
            if not r.is_demo:
                self._guard(r.key)  # the provider failed moments ago → do not wait for another timeout
            if r.kind == KIND_BINANCE:
                quote, extra, ttl = self._compute_binance(spec, r, now, budget)
            elif r.kind == KIND_RATE_LIMITED:
                quote, extra, ttl = self._compute_daily_bars(spec, r, now)
            else:
                quote, extra, ttl = self._compute_direct(spec, r, now)
        except DataNotAvailableError as exc:
            quote, extra, ttl = (
                placeholder(spec, status=STATUS_UNAVAILABLE, reason=exc.reason, code=CODE_DNA, now=now),
                {},
                TTL_FAILED,
            )
        except MarketDataError as exc:
            if not r.is_demo:
                self._trip(r.key, exc)
            quote, extra, ttl = (
                placeholder(
                    spec, status=STATUS_ERROR, reason=scrub_secrets(exc), code=CODE_ERROR, now=now, source=r.source
                ),
                {},
                TTL_FAILED,
            )
        except Exception as exc:  # noqa: BLE001 - malformed provider data must not break a whole list
            log.warning("Quote snapshot for %s failed", spec.symbol, exc_info=True)
            quote, extra, ttl = (
                placeholder(
                    spec, status=STATUS_ERROR, reason=scrub_secrets(exc), code=CODE_ERROR, now=now, source=r.source
                ),
                {},
                TTL_FAILED,
            )
        entry = Entry(quote, now, ttl, r.key, extra)
        self._put(spec.symbol, entry)
        return entry

    def _compute_direct(self, spec: AssetSpec, r: Route, now: int) -> tuple[dict, dict, int]:
        provider = r.provider
        assert provider is not None
        ticker = provider.get_ticker(spec, now=now)
        hourly = provider.get_candles(spec, "1h", limit=HOURLY_LIMIT, now=now)
        daily_all = provider.get_candles(spec, "1d", limit=DAILY_CLOSED + 1, now=now)
        price = ticker.price
        window = hourly[-24:]
        high = max(c.high for c in window) if window else None
        low = min(c.low for c in window) if window else None
        if high is not None and price is not None:
            high, low = max(high, price), min(low, price)
        quote, extra = self._assemble(
            spec,
            r,
            now=now,
            price=price,
            change_24h_pct=ticker.change_24h_pct,
            change_basis="rolling_24h",
            high=high,
            low=low,
            volume=ticker.volume_24h,
            daily=closed_daily(daily_all, now)[-DAILY_CLOSED:],
            spark=[c.close for c in hourly[-SPARK_HOURS:]],
            spark_tf="1h",
        )
        return quote, extra, r.ttl

    def _compute_daily_bars(self, spec: AssetSpec, r: Route, now: int) -> tuple[dict, dict, int]:
        """Rate-limited providers: ONE 1d request gives every field (24h fields = the latest daily session)."""
        provider = r.provider
        assert provider is not None
        daily_all = provider.get_candles(spec, "1d", limit=DAILY_CLOSED + 1, now=now)
        if not daily_all:
            raise MarketDataError(
                f"{r.source['name'] if r.source else 'Provider'} returned no daily bars for {spec.symbol}"
            )
        last = daily_all[-1]
        prev = daily_all[-2] if len(daily_all) >= 2 else None
        price = last.close
        change = (price / prev.close - 1) * 100 if prev is not None and prev.close else None
        quote, extra = self._assemble(
            spec,
            r,
            now=now,
            price=price,
            change_24h_pct=change,
            change_basis="session",
            high=last.high,
            low=last.low,
            volume=last.volume if last.volume and last.volume > 0 else None,  # forex has no volume → None
            daily=closed_daily(daily_all, now)[-DAILY_CLOSED:],
            spark=[c.close for c in daily_all[-SPARK_POINTS:]],
            spark_tf="1d",
        )
        return quote, extra, r.ttl

    def _compute_binance(self, spec: AssetSpec, r: Route, now: int, budget: Budget | None) -> tuple[dict, dict, int]:
        provider = r.provider
        assert isinstance(provider, BinancePublicProvider)
        bsym = spec.provider_symbols.get("binance")
        tick = provider.tickers_24h().get(bsym) if bsym else None
        if not tick or tick.get("last") is None:
            raise MarketDataError(f"Binance did not return a 24h ticker for {spec.symbol} ({bsym})")
        price = tick["last"]
        daily_all, partial_reason = self._binance_daily(spec, r, now, budget)
        daily = closed_daily(daily_all, now)[-DAILY_CLOSED:] if daily_all else []
        spark = [c.close for c in daily[-(SPARK_POINTS - 1) :]] + [price] if daily else []
        quote, extra = self._assemble(
            spec,
            r,
            now=now,
            price=price,
            change_24h_pct=tick.get("change_pct"),
            change_basis="rolling_24h",
            high=tick.get("high"),
            low=tick.get("low"),
            volume=tick.get("base_volume"),
            quote_volume=tick.get("quote_volume"),
            daily=daily,
            spark=spark,
            spark_tf="1d" if daily else None,
            partial_reason=partial_reason,
        )
        return quote, extra, (TTL_FAILED if partial_reason else r.ttl)

    def _binance_daily(
        self, spec: AssetSpec, r: Route, now: int, budget: Budget | None
    ) -> tuple[list[Candle] | None, str | None]:
        hit = self._daily.get(spec.symbol)
        if hit is not None and hit[1] != r.key:
            hit = None
        if hit is not None and 0 <= now - hit[0] < BINANCE_DAILY_TTL:
            return hit[2], None
        if budget is None or budget.take():
            try:
                return self._fetch_binance_daily(spec, r, now), None
            except MarketDataError as exc:
                if hit is not None:
                    return hit[2], None
                return None, scrub_secrets(exc)
        self.background.submit(("binance-1d", spec.symbol, r.key), lambda: self._fetch_binance_daily(spec, r, now))
        if hit is not None:
            return hit[2], None  # slightly older daily candles are fine while the refresh runs
        return None, REASON_DAILY_PENDING

    def _fetch_binance_daily(self, spec: AssetSpec, r: Route, now: int) -> list[Candle]:
        assert r.provider is not None
        key = (*r.key, "1d")
        self._guard(key)
        try:
            rows = r.provider.get_candles(spec, "1d", limit=DAILY_CLOSED + 1, now=now)
        except MarketDataError as exc:
            self._trip(key, exc)
            raise
        with self._lock:
            self._daily[spec.symbol] = (now, r.key, rows)
            if len(self._daily) > MAX_DAILY_SERIES:
                for sym, _ in sorted(self._daily.items(), key=lambda kv: kv[1][0])[: MAX_DAILY_SERIES // 10]:
                    self._daily.pop(sym, None)
        return rows

    def _regime_1d(self, spec: AssetSpec, r: Route, daily: list[Candle]) -> dict | None:
        if not daily:
            return None
        key = (r.key, spec.symbol, daily[-1].ts, len(daily))
        with self._lock:
            hit = self._regimes.get(key)
            if hit is not None:
                self._regimes.move_to_end(key)
                return hit
        closes = [c.close for c in daily]
        if len(daily) >= 60:
            classified = classify(daily)
        else:
            classified = {"regime": "UNCLEAR", "reasons": [], "metrics": {}}
        out = regime_payload(classified, closes)
        with self._lock:
            self._regimes[key] = out
            while len(self._regimes) > 4000:
                self._regimes.popitem(last=False)
        return out

    def _assemble(
        self,
        spec: AssetSpec,
        r: Route,
        *,
        now: int,
        price: float | None,
        change_24h_pct: float | None,
        change_basis: str,
        high: float | None,
        low: float | None,
        volume: float | None,
        daily: list[Candle],
        spark: list[float],
        spark_tf: str | None,
        partial_reason: str | None = None,
        quote_volume: float | None = None,
    ) -> tuple[dict, dict]:
        p = spec.price_precision
        range_pct = (high - low) / low * 100 if high is not None and low is not None and low > 0 else None
        atr_percent = atr_pct(daily, price)
        reg = self._regime_1d(spec, r, daily)
        closes = [c.close for c in daily] + ([price] if price is not None else [])
        volume_usd = self._volume_usd(spec, r, volume, price, now, quote_volume=quote_volume)
        values = {
            "price": price,
            "change_24h_pct": _r(change_24h_pct, 3),
            "change_basis": change_basis,
            "high_24h": high,
            "low_24h": low,
            "volume_24h": _r(volume, 4),
            "volume_24h_usd": _r(volume_usd, 2),
            "range_24h_pct": _r(range_pct, 3),
            "change_7d_pct": _r(change_7d_pct(daily, price, now), 3),
            "atr_pct_1d": _r(atr_percent, 3),
            "trend": daily_trend(closes, atr_percent) if daily else None,
            "regime": reg["regime"] if reg else None,
        }
        quote = _quote_dict(
            spec,
            spec.symbol,
            status=STATUS_OK,
            now=now,
            source=r.source,
            reason=partial_reason,
            partial=partial_reason is not None,
            values=values,
            sparkline=[round(v, p) for v in downsample(spark)],
            sparkline_tf=spark_tf,
        )
        return quote, {"regime_1d": reg}

    # -------------------------------------------------------------- volume in USD
    def _volume_usd(
        self,
        spec: AssetSpec,
        r: Route,
        volume: float | None,
        price: float | None,
        now: int,
        *,
        quote_volume: float | None = None,
    ) -> float | None:
        """24h volume in USD; None when unknown (never invented).

        DEMO: the synthetic generator is parameterised so that base volume × price ≈ its ``daily_volume_usd`` for
        every quote currency, so volume × price is used as is. Live data: base volume × price is in the quote
        currency and is converted with a LIVE rate of that currency (C/USD, USD/C or C/USDT) taken from the
        snapshot cache only (no extra provider requests); a demo rate is never mixed into live data. When the
        provider reports the quote-currency volume itself (Binance quoteVolume) that exact value is used.
        """
        if r.is_demo:
            return volume * price if volume is not None and price is not None else None
        currency = (spec.currency or "USD").upper()
        if quote_volume is not None:
            rate = 1.0 if currency in USD_LIKE else self._usd_rate(currency, now)
            return None if rate is None else quote_volume * rate
        if volume is None or price is None:
            return None
        if (spec.base or "").upper() in USD_LIKE:
            return volume  # base units are dollars (e.g. USD/JPY)
        if currency in USD_LIKE:
            return volume * price
        rate = self._usd_rate(currency, now)
        return None if rate is None else volume * price * rate

    def _usd_rate(self, currency: str, now: int) -> float | None:
        """USD value of one unit of `currency` from a cached LIVE snapshot (None when not cached)."""
        for symbol, invert in ((f"{currency}/USD", False), (f"USD/{currency}", True), (f"{currency}/USDT", False)):
            try:
                spec = get_asset(symbol)
            except UnknownAssetError:
                continue
            r = route(spec)
            if r.kind is None or r.is_demo:
                continue
            e = self._get(symbol, r.key, now, LIST_MAX_STALE)
            price = e.quote.get("price") if e is not None and e.quote.get("available") else None
            if price:
                return 1 / price if invert else price
        return None

    # -------------------------------------------------------------- warm-up
    def warm(
        self, now: int | None = None, *, specs: Iterable[AssetSpec] | None = None, refresh_ratio: float = 0.5
    ) -> dict:
        """Compute (or refresh) the snapshots of the curated demo/Binance instruments. Rate-limited providers are
        never warmed (on demand only). Returns counts by status."""
        t0 = time.monotonic()
        now = self.now(now)
        todo = list(specs) if specs is not None else list(ASSETS)
        # USD-quoted instruments first: their prices convert the volume of the others to USD
        todo.sort(
            key=lambda s: 0 if (s.currency or "USD").upper() in USD_LIKE or (s.base or "").upper() in USD_LIKE else 1
        )
        counts: Counter = Counter()
        budget = unlimited()
        for spec in todo:
            if self._warm_stop.is_set() and threading.current_thread() is self._warm_thread:
                break
            r = route(spec)
            if r.kind is None:
                counts["unavailable"] += 1
                continue
            if not r.list_capable:
                counts["skipped_rate_limited"] += 1
                continue
            refresh = WARM_REFRESH_DEMO if r.is_demo else max(1, int(r.ttl * refresh_ratio))
            e = self.entry(spec, now=now, fetch="cheap", budget=budget, max_age=refresh, r=r)
            counts[e.quote.get("status") or "unknown"] += 1
        try:
            from app.market import marketcap

            marketcap.refresh_if_stale()
        except Exception:  # noqa: BLE001 - market caps are optional
            log.debug("Market cap refresh failed", exc_info=True)
        with self._lock:
            self.warm_state.update(
                {
                    "passes": self.warm_state.get("passes", 0) + 1,
                    "last_pass_ts": now,
                    "last_pass_seconds": round(time.monotonic() - t0, 3),
                    "last_counts": dict(counts),
                }
            )
        return dict(counts)

    def warmup_enabled(self) -> bool:
        s = get_settings()
        return bool(s.market_warmup) and s.app_env != "test"

    def start_warmup(self) -> bool:
        """Start the background warm-up thread (no-op when disabled by MARKET_WARMUP=false or in tests)."""
        if not self.warmup_enabled():
            return False
        with self._lock:
            if self._warm_thread is not None and self._warm_thread.is_alive():
                return True
            self._warm_stop.clear()
            self._warm_thread = threading.Thread(target=self._warm_loop, name="markets-warmup", daemon=True)
            self.warm_state["running"] = True
            self._warm_thread.start()
        return True

    def stop_warmup(self, timeout: float = 2.0) -> None:
        self._warm_stop.set()
        t = self._warm_thread
        if t is not None and t.is_alive() and t is not threading.current_thread():
            t.join(timeout)
        with self._lock:
            self.warm_state["running"] = bool(t is not None and t.is_alive())

    def _warm_loop(self) -> None:
        while not self._warm_stop.is_set():
            try:
                self.warm()
                self.warm_state["last_error"] = None
            except Exception as exc:  # noqa: BLE001 - the loop must survive provider outages
                self.warm_state["last_error"] = scrub_secrets(exc)
                log.warning("Market snapshot warm-up pass failed", exc_info=True)
            self._warm_stop.wait(WARM_INTERVAL)
        self.warm_state["running"] = False

    def warmup_status(self) -> dict:
        with self._lock:
            state = dict(self.warm_state)
        state["enabled"] = self.warmup_enabled()
        state["running"] = bool(self._warm_thread is not None and self._warm_thread.is_alive())
        return state


ENGINE = QuoteEngine()


# ------------------------------------------------------------------ module-level convenience (other packages)
def get_quote(
    symbol_or_spec: str | AssetSpec, *, now: int | None = None, on_demand: bool = False, wait: float = 0.0
) -> dict:
    """Quote snapshot of one instrument (curated or synced). Unknown symbols → status 'unknown'."""
    if isinstance(symbol_or_spec, AssetSpec):
        spec = symbol_or_spec
    else:
        try:
            spec = get_asset(symbol_or_spec)
        except UnknownAssetError:
            return unknown_quote(symbol_or_spec, ENGINE.now(now))
    return ENGINE.quote(spec, now=now, fetch="on_demand" if on_demand else "cheap", wait=wait)


def start_warmup() -> bool:
    return ENGINE.start_warmup()


def stop_warmup() -> None:
    ENGINE.stop_warmup()


def warm(now: int | None = None, *, specs: Iterable[AssetSpec] | None = None) -> dict:
    return ENGINE.warm(now, specs=specs)


def reset() -> None:
    ENGINE.reset()
