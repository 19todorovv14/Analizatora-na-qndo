"""Exchange abstraction.

    ExchangeAdapter
     └── PaperExchangeAdapter   ← the ONLY adapter that exists in this version

Future live adapters (e.g. Bybit, MetaTrader) must live in a separate package with
their own credentials store (encrypted, least privilege, no withdrawal/transfer
permissions), their own tables and an explicit user confirmation flow. They must never
reuse paper tables or be selectable through `get_adapter` without a code change and
review. There is intentionally no configuration flag that enables live trading.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class LiveTradingDisabledError(RuntimeError):
    """Raised whenever anything asks for a non-paper execution venue."""


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
