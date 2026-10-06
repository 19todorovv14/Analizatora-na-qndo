"""Chooses the market-data provider for each asset class from configuration."""

from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.market.base import AssetSpec, MarketDataError, MarketDataProvider
from app.market.demo import DemoMarketDataProvider
from app.market.http_providers import BinancePublicProvider, TwelveDataProvider


@lru_cache
def _demo() -> DemoMarketDataProvider:
    return DemoMarketDataProvider()


@lru_cache
def _binance() -> BinancePublicProvider:
    s = get_settings()
    return BinancePublicProvider(s.binance_base_url, timeout=s.market_http_timeout)


@lru_cache
def _twelvedata() -> TwelveDataProvider:
    s = get_settings()
    return TwelveDataProvider(s.twelvedata_api_key, s.twelvedata_base_url, timeout=s.market_http_timeout)


_FACTORIES = {"demo": _demo, "binance": _binance, "twelvedata": _twelvedata}

_override: MarketDataProvider | None = None


def set_provider_override(provider: MarketDataProvider | None) -> None:
    """Force a single provider for every asset (tests, replay tooling)."""
    global _override
    _override = provider


def provider_for(asset: AssetSpec) -> MarketDataProvider:
    if _override is not None:
        return _override
    s = get_settings()
    choice = {
        "crypto": s.market_data_crypto,
        "forex": s.market_data_fx,
    }.get(asset.asset_class, s.market_data_stocks)
    factory = _FACTORIES.get(choice)
    if factory is None:
        raise MarketDataError(f"Unknown market data provider '{choice}'")
    provider = factory()
    if not provider.supports(asset):
        raise MarketDataError(f"Provider '{choice}' does not support {asset.symbol}")
    return provider


def demo_provider() -> DemoMarketDataProvider:
    return _demo()
