"""Market-data abstraction.

MarketDataProvider implementations are READ-ONLY. They never place orders; order
execution lives exclusively in app.paper_engine (simulation).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field


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
    asset_class: str  # crypto | forex | index | commodity | stock
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

    def round_price(self, price: float) -> float:
        return round(price, self.price_precision)

    def round_qty(self, qty: float) -> float:
        steps = int(qty / self.qty_step + 1e-9)
        return round(steps * self.qty_step, 10)


@dataclass(frozen=True, slots=True)
class DataSource:
    id: str
    name: str
    is_live: bool
    disclaimer: str

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "is_live": self.is_live, "disclaimer": self.disclaimer}


class MarketDataError(RuntimeError):
    """Raised when a provider cannot deliver data. We never silently swap in fake data."""


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
