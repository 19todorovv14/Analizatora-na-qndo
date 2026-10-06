"""Exchange abstraction — market data and order execution are strictly separated.

    MarketDataAdapter (app.exchange.market_data)   READ-ONLY market data (ticker/OHLCV/availability);
                                                   it has no order methods at all.
    ExchangeAdapter                                execution venue interface
     ├── PaperExchangeAdapter / PaperExecutionAdapter   ← the ONLY working execution adapter (simulation)
     └── FutureLiveExecutionAdapter                      placeholder: is_live=True, enabled=False — its
                                                         constructor and every method raise
                                                         LiveTradingDisabledError

Real-money execution is intentionally NOT implemented. Enabling it would require a separate, audited
module (never this package's paper code paths or tables), encrypted credential storage, API keys
with NO withdrawal/transfer permissions, and an explicit, informed user opt-in. Future live adapters
must never be selectable through `get_adapter` without a code change and review. There is
intentionally no configuration flag that enables live trading.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class LiveTradingDisabledError(NotImplementedError):
    """Raised whenever anything asks for a non-paper execution venue (live trading is not implemented).

    NotImplementedError is a RuntimeError subclass, so existing `except RuntimeError` handlers still match.
    """


class ExchangeAdapter(ABC):
    name: str
    is_live: bool

    @abstractmethod
    def get_balance(self) -> dict: ...

    @abstractmethod
    def get_positions(self) -> list[dict]: ...

    @abstractmethod
    def get_ticker(self, symbol: str) -> dict: ...

    @abstractmethod
    def get_ohlcv(self, symbol: str, timeframe: str, limit: int = 500) -> list[dict]: ...

    @abstractmethod
    def create_order(self, **order) -> dict: ...

    @abstractmethod
    def cancel_order(self, order_id: str) -> dict: ...
