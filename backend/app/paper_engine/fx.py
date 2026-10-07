"""Quote-currency → account-currency conversion for the paper engine.

Every paper account is kept in USD. Prices of an instrument are in its QUOTE currency
(``AssetSpec.currency``): USD/JPY is quoted in JPY, EUR/GBP in GBP, ETH/BTC in BTC. P/L, fees,
margin and exposure are therefore computed in the quote currency first and converted to USD with
the rate at the moment of the event:

* identity  — quote is USD or a USD stablecoin (USD, USDT, USDC, …): rate 1.
* inverse   — USD/XXX (the base is USD): rate = 1 / price of that same instrument at that moment
              (the fill price for fills/exits, the exit price for unrealized P/L).
* cross     — anything else (EUR/GBP, EUR/JPY, ETH/BTC, BTC/EUR …): the USD value of one unit of
              the quote currency, read from a REAL catalog instrument (GBP/USD, USD/JPY → 1/price,
              BTC/USD or BTC/USDT …) through a rate source.
* fixed     — sub-unit quotes of USD (US cents): a constant factor.

Rates are never invented: when no rate exists the converter raises ``ConversionUnavailableError``
(a ``DataNotAvailableError``) and the broker rejects new orders with that reason.

The broker itself stays pure. ``QuoteConverter`` only reaches market data through its rate source;
the default source (``MarketRateSource``) is created lazily the first time a cross rate is needed and
reads ``app.services.market_service`` — ticker prices for "now" (cached per 1-minute bar) and candle
closes at the bar time for historical events (replay, backtests, catch-up), cached per chunk.
"""

from __future__ import annotations

import bisect
import math
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from app.market.base import AssetSpec, DataNotAvailableError, MarketDataError, redact_secrets

ACCOUNT_CURRENCY = "USD"

# Quote currencies booked 1:1 in the USD account. Stablecoins are treated at their 1 USD peg — the usual
# convention for USDT/USDC-margined paper accounts.
USD_EQUIVALENTS = frozenset({"USD", "USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDP", "DAI"})

# Sub-unit currency codes used by exchanges (case-sensitive: "GBp" is pence, "GBP" is pounds).
SUBUNITS: dict[str, tuple[str, float]] = {
    "GBp": ("GBP", 0.01),
    "GBX": ("GBP", 0.01),
    "ZAc": ("ZAR", 0.01),
    "ZAC": ("ZAR", 0.01),
    "ILA": ("ILS", 0.01),
    "ILa": ("ILS", 0.01),
    "USc": ("USD", 0.01),
    "USX": ("USD", 0.01),
}

IDENTITY, FIXED, INVERSE, CROSS = "identity", "fixed", "inverse", "cross"

# Catalog instruments that can price one unit of currency C in USD, in order of preference.
ROUTE_CANDIDATES: tuple[tuple[str, bool], ...] = (
    ("{c}/USD", False),
    ("USD/{c}", True),
    ("{c}/USDT", False),
    ("USDT/{c}", True),
    ("{c}/USDC", False),
    ("USDC/{c}", True),
)

# Historical candle timeframes a rate can be read from (largest one not longer than the bar resolution).
_TIMEFRAMES: tuple[tuple[str, int], ...] = (
    ("1m", 60),
    ("5m", 300),
    ("15m", 900),
    ("30m", 1800),
    ("1h", 3600),
    ("4h", 14400),
    ("1d", 86400),
)

# (currency, ts, resolution_seconds) -> USD value of ONE unit of `currency`, or None when unknown.
RateSource = Callable[[str, int, int], "float | None"]
# The broker's conversion callable: (symbol, ts, price, resolution_seconds) -> USD per 1 quote unit.
ConversionFn = Callable[[str, int, "float | None", int], float]


class ConversionUnavailableError(DataNotAvailableError):
    """No real exchange rate exists for converting an instrument's quote currency into USD."""


@dataclass(frozen=True)
class FxRoute:
    """How one unit of `currency` is priced in USD: the catalog instrument and whether to invert it."""

    currency: str
    symbol: str
    invert: bool

    def to_dict(self) -> dict:
        return {"currency": self.currency, "symbol": self.symbol, "invert": self.invert}


def split_currency(code: str | None) -> tuple[str, float]:
    """("GBp") → ("GBP", 0.01); ("jpy") → ("JPY", 1.0); empty → the account currency."""
    raw = (code or ACCOUNT_CURRENCY).strip() or ACCOUNT_CURRENCY
    if raw in SUBUNITS:
        return SUBUNITS[raw]
    return raw.upper(), 1.0


def base_currency(spec: AssetSpec) -> str:
    base = (spec.base or "").strip().upper()
    if not base and "/" in spec.symbol:
        base = spec.symbol.split("/", 1)[0].strip().upper()
    return base


def conversion_method(spec: AssetSpec) -> str:
    """identity | fixed | inverse | cross (see the module docstring)."""
    quote, factor = split_currency(spec.currency)
    if quote in USD_EQUIVALENTS:
        return IDENTITY if factor == 1.0 else FIXED
    if factor == 1.0 and base_currency(spec) in USD_EQUIVALENTS:
        return INVERSE
    return CROSS


def _catalog_lookup(symbol: str) -> AssetSpec:
    from app.market.catalog import get_asset  # local: keeps this module importable without the catalog

    return get_asset(symbol)


def conversion_route(
    currency: str,
    *,
    lookup: Callable[[str], AssetSpec] | None = None,
    available: Callable[[AssetSpec], bool] | None = None,
) -> FxRoute | None:
    """The first catalog instrument (see ROUTE_CANDIDATES) that prices `currency` in USD and is available."""
    ccy, _ = split_currency(currency)
    lookup = lookup or _catalog_lookup
    for pattern, invert in ROUTE_CANDIDATES:
        try:
            spec = lookup(pattern.format(c=ccy))
        except KeyError:  # UnknownAssetError is a KeyError
            continue
        if available is not None:
            try:
                if not available(spec):
                    continue
            except (MarketDataError, KeyError, ValueError):
                continue
        return FxRoute(currency=ccy, symbol=spec.symbol, invert=invert)
    return None


def timeframe_for(resolution: int) -> str:
    """Largest supported candle timeframe that is not longer than `resolution` seconds (min 1m)."""
    tf = "1m"
    for name, sec in _TIMEFRAMES:
        if sec <= max(int(resolution or 60), 60):
            tf = name
    return tf


class StaticRates:
    """Fixed USD value per currency unit — tests and what-if tooling. Unknown currencies → None."""

    def __init__(self, rates: Mapping[str, float]):
        self.rates = {split_currency(k)[0]: float(v) for k, v in rates.items()}

    def __call__(self, currency: str, ts: int, resolution: int = 60) -> float | None:
        return self.rates.get(split_currency(currency)[0])


# ----------------------------------------------------------------- market-backed rate source
_CHUNK_BARS = 500
_CHUNK_TTL = 600.0
_CHUNK_MAX = 256
_chunk_cache: OrderedDict[tuple, tuple[float, tuple[list[int], list[float], list[float]]]] = OrderedDict()
_chunk_lock = threading.Lock()


def clear_rate_cache() -> None:
    """Drop the shared cache of historical conversion candles (tests, provider switches)."""
    with _chunk_lock:
        _chunk_cache.clear()


def _cache_get(key: tuple) -> tuple[list[int], list[float], list[float]] | None:
    with _chunk_lock:
        hit = _chunk_cache.get(key)
        if hit is None:
            return None
        if hit[0] < time.monotonic():
            _chunk_cache.pop(key, None)
            return None
        _chunk_cache.move_to_end(key)
        return hit[1]


def _cache_put(key: tuple, value: tuple[list[int], list[float], list[float]]) -> None:
    with _chunk_lock:
        _chunk_cache[key] = (time.monotonic() + _CHUNK_TTL, value)
        _chunk_cache.move_to_end(key)
        while len(_chunk_cache) > _CHUNK_MAX:
            _chunk_cache.popitem(last=False)


class MarketRateSource:
    """USD value of one unit of a currency at time `ts`, read from the catalog's conversion instrument.

    * ts within `live_window` seconds of now → ``market_service.ticker(route, now=ts)``, cached per 1-minute bar.
    * older ts (replay, backtests, catch-up of closed bars) → the close of the last conversion candle that had
      CLOSED at or before ts (no look-ahead), on the timeframe matching the broker's bar resolution, falling back
      to 1h and 1d candles across gaps (weekends). Candles are fetched in chunks of 500 bars and cached.
    Raises ConversionUnavailableError when the catalog has no available conversion instrument.
    """

    def __init__(self, *, now: int | None = None, live_window: int = 120, clock: Callable[[], float] = time.time):
        self.now = int(now) if now is not None else None
        self.live_window = int(live_window)
        self._clock = clock
        self._routes: dict[str, FxRoute | None] = {}
        self._ticks: dict[tuple[str, int], float] = {}
        self._local: dict[tuple, tuple[list[int], list[float], list[float]]] = {}

    def _now(self) -> int:
        return self.now if self.now is not None else int(self._clock())

    @staticmethod
    def _available(spec: AssetSpec) -> bool:
        from app.market.registry import availability

        return bool(availability(spec).get("available"))

    def route(self, currency: str) -> FxRoute | None:
        ccy, _ = split_currency(currency)
        if ccy not in self._routes:
            self._routes[ccy] = conversion_route(ccy, available=self._available)
        return self._routes[ccy]

    def __call__(self, currency: str, ts: int, resolution: int = 60) -> float | None:
        ccy, _ = split_currency(currency)
        route = self.route(ccy)
        if route is None:
            tried = ", ".join(p.format(c=ccy) for p, _ in ROUTE_CANDIDATES[:2])
            raise ConversionUnavailableError(
                f"Няма наличен инструмент за курс {ccy} → {ACCOUNT_CURRENCY} (търсени {tried}, …)."
            )
        now = self._now()
        ts = min(int(ts), now)
        if ts >= now - self.live_window:
            price = self._live_price(route.symbol, ts)
        else:
            price = self._historical_price(route.symbol, ts, resolution, now)
        if price is None or not math.isfinite(price) or price <= 0:
            return None
        return 1.0 / price if route.invert else float(price)

    # ---------------------------------------------------------------- live
    def _live_price(self, symbol: str, ts: int) -> float:
        key = (symbol, ts // 60)
        price = self._ticks.get(key)
        if price is None:
            from app.services import market_service

            price = float(market_service.ticker(symbol, now=ts).price)
            self._ticks[key] = price
        return price

    # ---------------------------------------------------------- historical
    def _historical_price(self, symbol: str, ts: int, resolution: int, now: int) -> float | None:
        errors: list[str] = []
        for tf in dict.fromkeys((timeframe_for(resolution), "1h", "1d")):
            try:
                price = self._candle_price(symbol, tf, ts, now)
            except MarketDataError as exc:
                errors.append(redact_secrets(exc))
                continue
            if price is not None:
                return price
        if errors:
            raise ConversionUnavailableError(f"Курсът от {symbol} не е наличен: {errors[-1]}", symbol=symbol)
        return None

    def _candle_price(self, symbol: str, tf: str, ts: int, now: int) -> float | None:
        sec = dict(_TIMEFRAMES)[tf]
        span = _CHUNK_BARS * sec
        first = (ts // span) * span
        for back in range(2):
            times, opens, closes = self._chunk(symbol, tf, first - back * span, span, now)
            closed = bisect.bisect_right(times, ts - sec) - 1  # last candle with open + sec <= ts
            if closed >= 0:
                return closes[closed]
            if back == 0:
                containing = bisect.bisect_right(times, ts) - 1
                if containing >= 0:  # only the candle containing ts exists: its open is known at ts
                    return opens[containing]
        return None

    def _chunk(self, symbol: str, tf: str, start: int, span: int, now: int) -> tuple[list[int], list[float], list[float]]:
        from app.services import market_service

        sec = dict(_TIMEFRAMES)[tf]
        end = min(start + span - sec, now)
        if end < start:
            return [], [], []
        try:
            source_id = market_service.source_of(symbol).get("id")
        except (MarketDataError, KeyError):
            source_id = None
        key = (source_id, symbol, tf, start)
        local = self._local.get(key)
        if local is not None:
            return local
        complete = start + span <= now
        cached = _cache_get(key) if complete else None
        if cached is None:
            rows = market_service.candles(
                symbol, tf, start=start, end=end, limit=_CHUNK_BARS + 2, now=now, include_partial=False
            )
            rows = [c for c in rows if start <= c.ts <= end]
            cached = ([c.ts for c in rows], [c.open for c in rows], [c.close for c in rows])
            if complete:
                _cache_put(key, cached)
        self._local[key] = cached
        return cached


# ----------------------------------------------------------------------- the converter
_MARKET: Any = object()  # sentinel: build a MarketRateSource the first time a cross rate is needed


class QuoteConverter:
    """The conversion callable used by PaperBroker.

    ``converter(symbol, ts, price, resolution) -> float`` returns the account-currency (USD) value of ONE unit of
    the instrument's quote currency at time `ts`. `price` is the instrument's own price at that moment (needed for
    USD/XXX instruments); `resolution` is the bar length in seconds (picks the candle timeframe of historical
    cross rates). Raises ConversionUnavailableError when no real rate exists.

    `rates`: a RateSource callable, a {currency: usd_value} mapping (static rates), None (no cross rates at all)
    or omitted (a MarketRateSource created on first use).
    """

    def __init__(self, specs: Mapping[str, AssetSpec] | None = None, rates: Any = _MARKET):
        self.specs = specs
        if isinstance(rates, Mapping):
            rates = StaticRates(rates)
        self._rates = rates
        self._methods: dict[str, str] = {}

    @property
    def rates(self) -> RateSource | None:
        if self._rates is _MARKET:
            self._rates = MarketRateSource()
        return self._rates

    def spec(self, symbol: str) -> AssetSpec:
        if self.specs is not None:
            try:
                return self.specs[symbol]
            except KeyError:
                pass
        return _catalog_lookup(symbol)

    def method(self, symbol: str) -> str:
        m = self._methods.get(symbol)
        if m is None:
            m = self._methods[symbol] = conversion_method(self.spec(symbol))
        return m

    def is_identity(self, symbol: str) -> bool:
        return self.method(symbol) == IDENTITY

    def __call__(self, symbol: str, ts: int, price: float | None = None, resolution: int = 60) -> float:
        method = self.method(symbol)
        if method == IDENTITY:
            return 1.0
        spec = self.spec(symbol)
        quote, factor = split_currency(spec.currency)
        if method == FIXED:
            return factor
        if method == INVERSE:
            if price is None or not math.isfinite(price) or price <= 0:
                raise ConversionUnavailableError(
                    f"Няма цена на {symbol} за конвертиране {quote} → {ACCOUNT_CURRENCY}.", symbol=symbol
                )
            return 1.0 / price
        return factor * self.currency_rate(quote, ts, resolution, symbol=symbol)

    def currency_rate(self, currency: str, ts: int, resolution: int = 60, *, symbol: str | None = None) -> float:
        """USD value of one unit of `currency` at `ts` (sub-units such as GBp handled)."""
        ccy, factor = split_currency(currency)
        if ccy in USD_EQUIVALENTS:
            return factor
        source = self.rates
        if source is None:
            raise ConversionUnavailableError(f"Няма източник на курс {ccy} → {ACCOUNT_CURRENCY}.", symbol=symbol)
        try:
            rate = source(ccy, int(ts), int(resolution))
        except ConversionUnavailableError:
            raise
        except (MarketDataError, KeyError, ValueError) as exc:
            raise ConversionUnavailableError(
                f"Курсът {ccy} → {ACCOUNT_CURRENCY} не е наличен: {redact_secrets(exc)}", symbol=symbol
            ) from exc
        if rate is None or not math.isfinite(rate) or rate <= 0:
            raise ConversionUnavailableError(
                f"Няма курс {ccy} → {ACCOUNT_CURRENCY} за този момент.", symbol=symbol
            )
        return factor * float(rate)

    def route(self, symbol: str) -> FxRoute | None:
        """The conversion instrument used for a cross-quoted symbol (None for identity/fixed/inverse)."""
        if self.method(symbol) != CROSS:
            return None
        quote, _ = split_currency(self.spec(symbol).currency)
        source = self.rates
        finder = getattr(source, "route", None)
        if callable(finder):
            try:
                return finder(quote)
            except (MarketDataError, KeyError, ValueError):
                return None
        return conversion_route(quote)

    def describe(self, symbol: str) -> dict:
        """{quote_currency, account_currency, method, route} — what the UI shows next to converted numbers."""
        spec = self.spec(symbol)
        method = self.method(symbol)
        route = self.route(symbol) if method == CROSS else None
        if method == INVERSE:
            route = FxRoute(currency=split_currency(spec.currency)[0], symbol=spec.symbol, invert=True)
        return {
            "quote_currency": (spec.currency or ACCOUNT_CURRENCY).strip() or ACCOUNT_CURRENCY,
            "account_currency": ACCOUNT_CURRENCY,
            "method": method,
            "route": route.to_dict() if route else None,
        }
