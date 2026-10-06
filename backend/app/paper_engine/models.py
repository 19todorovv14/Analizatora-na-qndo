"""Plain data structures used by the paper engine (no database dependencies)."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field, fields

BUY, SELL = "buy", "sell"
LONG, SHORT = "long", "short"
MARKET, LIMIT, STOP = "market", "limit", "stop"
ACTIVE_ORDER_STATUSES = ("pending", "open", "partially_filled")
EPS = 1e-12


def new_id() -> str:
    return uuid.uuid4().hex


@dataclass
class ExecutionConfig:
    """Realism settings. Every cost is modelled so paper trading is not unrealistically easy."""

    fees_enabled: bool = True
    spread_enabled: bool = True
    spread_multiplier: float = 1.0
    slippage_enabled: bool = True
    base_slippage_bps: float = 0.5
    volatility_slippage: float = 0.05  # up to this fraction of the bar range (random, adverse)
    impact_bps_per_pct_volume: float = 0.2  # market impact per 1% of the bar's volume
    latency_enabled: bool = True
    latency_ms: int = 250
    partial_fills_enabled: bool = True
    participation_rate: float = 0.25  # max share of a bar's volume we can take
    touch_fill_ratio: float = 0.5  # limit orders that are only "touched" fill partially
    liquidation_enabled: bool = True
    stop_out_level: float = 0.5  # margin level (equity / used margin) that triggers liquidation
    intrabar_policy: str = "worst_case"  # worst_case | path

    @classmethod
    def from_dict(cls, data: dict | None) -> ExecutionConfig:
        data = data or {}
        allowed = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in allowed})

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Bar:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    duration: int = 60


@dataclass
class Order:
    id: str
    symbol: str
    side: str
    type: str
    qty: float
    price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    status: str = "pending"
    filled_qty: float = 0.0
    avg_fill_price: float | None = None
    fees: float = 0.0
    slippage_cost: float = 0.0
    fill_mode: str = "immediate"
    position_id: str | None = None
    reduce_only: bool = False
    reject_reason: str | None = None
    active_from_ts: int = 0
    created_ts: int = 0
    updated_ts: int = 0
    meta: dict = field(default_factory=dict)

    @property
    def remaining(self) -> float:
        return max(self.qty - self.filled_qty, 0.0)

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_ORDER_STATUSES


@dataclass
class Position:
    id: str
    symbol: str
    side: str
    qty: float
    entry_price: float
    stop_loss: float | None
    take_profit: float | None
    initial_stop: float | None
    initial_qty: float
    leverage: float
    fees: float = 0.0  # entry fees not yet allocated to closed trades
    realized_pnl: float = 0.0
    mfe: float = 0.0
    mae: float = 0.0
    status: str = "open"
    sl_history: list = field(default_factory=list)
    active_from_ts: int = 0
    opened_ts: int = 0
    closed_ts: int | None = None
    meta: dict = field(default_factory=dict)

    @property
    def sign(self) -> int:
        return 1 if self.side == LONG else -1

    @property
    def is_open(self) -> bool:
        return self.status == "open" and self.qty > EPS


@dataclass
class Trade:
    id: str
    position_id: str
    symbol: str
    side: str
    qty: float
    entry_price: float
    exit_price: float
    stop_price: float | None
    target_price: float | None
    gross_pnl: float
    fees: float
    net_pnl: float
    risk_amount: float | None
    r_multiple: float | None
    exit_reason: str
    opened_ts: int
    closed_ts: int
    meta: dict = field(default_factory=dict)


@dataclass
class Event:
    ts: int
    type: str
    message: str
    data: dict = field(default_factory=dict)


@dataclass
class AccountState:
    cash: float
    leverage: float = 1.0
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    rng_counter: int = 0
    orders: dict[str, Order] = field(default_factory=dict)
    positions: dict[str, Position] = field(default_factory=dict)
