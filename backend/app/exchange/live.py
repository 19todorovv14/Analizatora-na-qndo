"""FutureLiveExecutionAdapter — a deliberately disabled placeholder for real-money execution.

Real-money execution is intentionally not implemented. Enabling it would require a separate audited
module, encrypted credential storage, API keys without withdrawal/transfer permissions and an explicit
user opt-in. This class exists only so the architecture names the boundary: it cannot be constructed,
and every method raises LiveTradingDisabledError. `get_adapter` never returns it.
"""

from __future__ import annotations

from typing import NoReturn

from app.exchange.base import ExchangeAdapter, LiveTradingDisabledError

LIVE_DISABLED_MESSAGE = (
    "Live trading is not available in this version. All execution is simulated (paper trading). "
    "Real-money execution would require a separate audited module, encrypted credentials without "
    "withdrawal permissions and explicit user opt-in."
)


def _disabled() -> NoReturn:
    raise LiveTradingDisabledError(LIVE_DISABLED_MESSAGE)


class FutureLiveExecutionAdapter(ExchangeAdapter):
    name = "live"
    is_live = True
    enabled = False

    def __init__(self, *args, **kwargs) -> None:
        _disabled()

    def get_balance(self) -> dict:
        _disabled()

    def get_positions(self) -> list[dict]:
        _disabled()

    def get_ticker(self, symbol: str) -> dict:
        _disabled()

    def get_ohlcv(self, symbol: str, timeframe: str, limit: int = 500) -> list[dict]:
        _disabled()

    def create_order(self, **order) -> dict:
        _disabled()

    def cancel_order(self, order_id: str) -> dict:
        _disabled()
