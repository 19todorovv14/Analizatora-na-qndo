"""Market-data abstraction.

MarketDataProvider implementations are READ-ONLY. They never place orders; order
execution lives exclusively in app.paper_engine (simulation).
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field

# ------------------------------------------------------------------ secret redaction
# Query parameters that carry credentials (Twelve Data `apikey`, Finnhub `token`, …). Their values must
# never reach logs or API error messages.
_SECRET_PARAM = re.compile(
    r"(?i)([?&;](?:api[_-]?key|apikey|token|access[_-]?token|key|secret|password|signature)=)[^&\s'\"#]+"
)


def redact_secrets(text: object) -> str:
    """`text` with the values of credential query parameters replaced by "***" (URLs stay readable)."""
    return _SECRET_PARAM.sub(r"\1***", str(text))


class _RedactSecretsFilter(logging.Filter):
    """Logging filter that removes credential query parameters from a record's final message."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - a malformed record is left to the logging module
            return True
        redacted = redact_secrets(message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


def install_http_log_redaction() -> None:
    """httpx logs every request URL at INFO ("HTTP Request: GET https://…?apikey=…"); with the app's
    INFO logging that would write provider API keys to the logs. Idempotent."""
    logger = logging.getLogger("httpx")
    if not any(isinstance(f, _RedactSecretsFilter) for f in logger.filters):
        logger.addFilter(_RedactSecretsFilter())


install_http_log_redaction()


@dataclass(frozen=True, slots=True)
class Candle:
    ts: int  # open time, UTC epoch seconds
    open: float
    high: float
    low: float
    close: float
    volume: float

    def to_dict(self) -> dict:
        return {
            "time": self.ts,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
        }


@dataclass(slots=True)
class Ticker:
    symbol: str
    price: float
    ts: int
    change_24h_pct: float | None = None
    volume_24h: float | None = None
    source: str = "demo"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class AssetSpec:
    symbol: str
    name: str
    asset_class: str  # crypto | forex | index | commodity | stock | etf
    price_precision: int
    qty_step: float
    min_qty: float
    spread_bps: float
    maker_fee: float
    taker_fee: float
    max_leverage: float
    # demo generator parameters
    anchor_price: float
    daily_vol: float
    daily_volume_usd: float
    drift: float = 0.0
    provider_symbols: dict = field(default_factory=dict)
    description: str = ""
    # --- V2 catalog metadata (all defaulted, appended so positional construction keeps working) ---
    category: str = ""  # e.g. layer1, major, mega, broad, metal, energy, agriculture …
    sector: str = ""
    industry: str = ""
    exchange: str = ""
    country: str = ""
    currency: str = "USD"  # quote currency
    base: str = ""
    aliases: tuple[str, ...] = ()
    popularity: int = 1000  # lower = more popular
    session: str = "24x7"  # trading calendar id, see app.market.sessions
    curated: bool = True
    source: str = "curated"  # curated | binance | twelvedata (where the instrument definition came from)
    slug: str = ""  # URL-safe id, see slug_for()

    def __post_init__(self) -> None:
        if not self.slug:
            object.__setattr__(self, "slug", slug_for(self.symbol))

    @property
    def demo_capable(self) -> bool:
        """True when the synthetic DEMO generator has parameters for this instrument."""
        return self.anchor_price > 0

    def round_price(self, price: float) -> float:
        return round(price, self.price_precision)

    def round_qty(self, qty: float) -> float:
        steps = int(qty / self.qty_step + 1e-9)
        return round(steps * self.qty_step, 10)


_SLUG_SAFE = re.compile(r"[^A-Z0-9._-]")


def slug_for(symbol: str) -> str:
    """Stable, URL-safe instrument id: upper case, "/" → "-", spaces → "_".

    Any other character that is not URL-safe ([A-Z0-9._-]) also becomes "_"
    (none of the curated symbols contain such characters).
    """
    s = symbol.strip().upper().replace("/", "-").replace(" ", "_")
    return _SLUG_SAFE.sub("_", s)


DATA_STATUSES = ("live", "delayed", "demo", "unavailable")


@dataclass(frozen=True, slots=True)
class DataSource:
    id: str
    name: str
    is_live: bool
    disclaimer: str
    # live | delayed | demo | unavailable — None → derived from is_live ("live" / "demo")
    status: str | None = None

    @property
    def effective_status(self) -> str:
        return self.status or ("live" if self.is_live else "demo")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_live": self.is_live,
            "disclaimer": self.disclaimer,
            "status": self.effective_status,
        }


class MarketDataError(RuntimeError):
    """Raised when a provider cannot deliver data. We never silently swap in fake data."""


class DataNotAvailableError(MarketDataError):
    """No configured provider can serve this instrument (configuration/support, not an outage).

    The platform never invents numbers in this case: callers show an explicit
    DATA_NOT_AVAILABLE state instead.
    """

    code = "DATA_NOT_AVAILABLE"

    def __init__(self, reason: str, *, symbol: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.symbol = symbol

    def to_dict(self) -> dict:
        return {"code": self.code, "reason": self.reason}


class MarketDataProvider(ABC):
    source: DataSource

    @abstractmethod
    def supports(self, asset: AssetSpec) -> bool: ...

    @abstractmethod
    def get_candles(
        self,
        asset: AssetSpec,
        timeframe: str,
        *,
        start: int | None = None,
        end: int | None = None,
        limit: int = 500,
        now: int | None = None,
        include_partial: bool = True,
    ) -> list[Candle]:
        """Candles ordered by time.

        * With `start`: candles whose open time is in [start, end].
        * Without `start`: the last `limit` candles up to `end` (or now).
        * Candles that open after `now` are never returned (no future data).
        * `include_partial=False` drops the still-forming candle.
        """

    @abstractmethod
    def get_ticker(self, asset: AssetSpec, *, now: int | None = None) -> Ticker: ...

    def config_problem(self) -> str | None:
        """Why this provider cannot work at all as configured (e.g. a missing API key), else None.

        Must be cheap and must not touch the network (used by availability checks).
        """
        return None
