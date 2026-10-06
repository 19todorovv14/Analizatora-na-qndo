"""MarketDataAdapter — READ-ONLY market data for execution code paths.

A thin wrapper around the market-data router (app.market.registry). It deliberately has NO order,
cancel, transfer or withdrawal methods: market-data providers are read-only and live strictly apart
from (paper) execution.
"""

from __future__ import annotations

from app.market.catalog import get_asset
from app.market.registry import availability, provider_for


class MarketDataAdapter:
    is_live_execution = False  # this adapter never executes anything

    def __init__(self, clock=None):
        self._clock = clock

    def _now(self, now: int | None) -> int | None:
        if now is not None:
            return int(now)
        return int(self._clock()) if self._clock is not None else None

    def supports(self, symbol: str) -> bool:
        return bool(availability(get_asset(symbol))["available"])

    def availability(self, symbol: str) -> dict:
        return availability(get_asset(symbol))

    def source(self, symbol: str) -> dict:
        return provider_for(get_asset(symbol)).source.to_dict()

    def get_ticker(self, symbol: str, *, now: int | None = None) -> dict:
        asset = get_asset(symbol)
        return provider_for(asset).get_ticker(asset, now=self._now(now)).to_dict()

    def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 500,
        *,
        start: int | None = None,
        end: int | None = None,
        now: int | None = None,
        include_partial: bool = True,
    ) -> list[dict]:
        asset = get_asset(symbol)
        rows = provider_for(asset).get_candles(
            asset, timeframe, start=start, end=end, limit=limit, now=self._now(now), include_partial=include_partial
        )
        return [c.to_dict() for c in rows]
