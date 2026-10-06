from __future__ import annotations

from app.exchange.base import ExchangeAdapter, LiveTradingDisabledError
from app.exchange.paper import PaperExecutionAdapter

# This is a constant on purpose — not an environment variable. Enabling live trading
# requires a separate, reviewed integration (see exchange/base.py).
LIVE_TRADING_AVAILABLE = False


def get_adapter(mode: str, **kwargs) -> ExchangeAdapter:
    """Only 'paper' exists. Anything else (live, exchange names, '') raises LiveTradingDisabledError —
    FutureLiveExecutionAdapter is intentionally never returned from here."""
    if mode != "paper":
        raise LiveTradingDisabledError(
            "Live trading is not available in this version. All execution is simulated (paper trading)."
        )
    return PaperExecutionAdapter(**kwargs)
