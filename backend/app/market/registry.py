"""Chooses the market-data provider for each instrument from configuration (READ-ONLY providers).

Routing per asset class is done by :class:`app.market.providers.MarketRouter` (provider chains, static
selection by support). ``provider_for(asset)`` returns the concrete backend provider (so ``.source``
stays meaningful) or raises :class:`DataNotAvailableError`.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.market.base import AssetSpec, DataNotAvailableError, MarketDataProvider
from app.market.demo import DemoMarketDataProvider
from app.market.http_providers import BinancePublicProvider, TwelveDataProvider
from app.market.providers import AssetClassProvider, MarketRouter


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
    return TwelveDataProvider(
        s.twelvedata_api_key, s.twelvedata_base_url, timeout=s.market_http_timeout, realtime=s.twelvedata_realtime
    )


_FACTORIES = {"demo": _demo, "binance": _binance, "twelvedata": _twelvedata}
PROVIDER_IDS = tuple(_FACTORIES)

ROUTER = MarketRouter(get_settings, _FACTORIES)

_override: MarketDataProvider | None = None


def set_provider_override(provider: MarketDataProvider | None) -> None:
    """Force a single provider for every asset (tests, replay tooling). It still has to support the asset."""
    global _override
    _override = provider


def get_router() -> MarketRouter:
    return ROUTER


def class_provider(asset_class: str) -> AssetClassProvider:
    """The CryptoProvider/StockProvider/… for an asset class, with its configured chain."""
    return ROUTER.for_class(asset_class)


def provider_for(asset: AssetSpec) -> MarketDataProvider:
    """Concrete provider serving `asset`; DataNotAvailableError when nothing configured supports it."""
    if _override is not None:
        if not _override.supports(asset):
            raise DataNotAvailableError(
                f"Provider '{_override.source.id}' does not support {asset.symbol}", symbol=asset.symbol
            )
        return _override
    return ROUTER.provider_for(asset)


def availability(asset: AssetSpec) -> dict:
    """{available, provider_id|None, reason|None, source: DataSource dict|None} — cheap, no network."""
    if _override is not None:
        if not _override.supports(asset):
            return {
                "available": False,
                "provider_id": None,
                "reason": f"Provider '{_override.source.id}' does not support {asset.symbol}",
                "source": None,
            }
        problem = _override.config_problem()
        return {
            "available": problem is None,
            "provider_id": _override.source.id,
            "reason": problem,
            "source": _override.source.to_dict(),
        }
    return ROUTER.availability(asset)


def demo_provider() -> DemoMarketDataProvider:
    return _demo()


def binance_provider() -> BinancePublicProvider:
    """The shared Binance public-data provider (e.g. for the bulk tickers_24h() of market lists)."""
    return _binance()
