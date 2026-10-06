"""Per-asset-class market-data routing (READ-ONLY).

Each asset class has a provider CHAIN configured in settings (``MARKET_DATA_CRYPTO``,
``MARKET_DATA_STOCKS``, ``MARKET_DATA_ETF``, ``MARKET_DATA_FX``, ``MARKET_DATA_INDICES``,
``MARKET_DATA_COMMODITIES``), e.g. ``"binance,twelvedata"``. The FIRST provider in the chain that
*supports* an instrument serves it. The choice is static (by support only): when the chosen
provider fails, the error is raised — the platform never falls back to another provider or to
demo data because of an outage. When no provider in the chain supports an instrument,
:class:`DataNotAvailableError` is raised (``DATA_NOT_AVAILABLE``) instead of inventing numbers.

Classes
    AssetClassProvider (wraps one chain)
     ├── CryptoProvider     crypto
     ├── StockProvider      stock (and any unknown class)
     ├── ETFProvider        etf        (chain defaults to the stocks chain)
     ├── ForexProvider      forex
     ├── IndexProvider      index      (chain defaults to the stocks chain)
     └── CommodityProvider  commodity  (chain defaults to the stocks chain)
    MarketRouter            asset_class → AssetClassProvider

None of these classes has (or may ever get) order, transfer or withdrawal methods.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import ClassVar

from app.market.base import (
    AssetSpec,
    Candle,
    DataNotAvailableError,
    DataSource,
    MarketDataError,
    MarketDataProvider,
    Ticker,
)

ProviderFactory = Callable[[], MarketDataProvider]

UNAVAILABLE_SOURCE = DataSource(
    id="unavailable",
    name="No data source",
    is_live=False,
    disclaimer="Няма конфигуриран източник на данни за този инструмент (DATA NOT AVAILABLE).",
    status="unavailable",
)


def parse_chain(value: str | Sequence[str] | None) -> tuple[str, ...]:
    """'binance, TwelveData,,binance' → ('binance', 'twelvedata') (lower case, de-duplicated, order kept)."""
    if value is None:
        return ()
    parts = value.split(",") if isinstance(value, str) else list(value)
    out: list[str] = []
    for part in parts:
        name = str(part).strip().lower()
        if name and name not in out:
            out.append(name)
    return tuple(out)


class AssetClassProvider(MarketDataProvider):
    """Routes requests for one asset class to the first provider in its chain that supports the asset."""

    asset_class: ClassVar[str] = ""
    setting: ClassVar[str] = ""  # name of the Settings attribute holding the chain
    fallback_setting: ClassVar[str | None] = None  # used when `setting` is unset (None)

    def __init__(self, chain: str | Sequence[str] | None, factories: Mapping[str, ProviderFactory]):
        self.chain = parse_chain(chain)
        self._factories = factories

    @classmethod
    def chain_from_settings(cls, settings) -> tuple[str, ...]:
        value = getattr(settings, cls.setting, None)
        if value is None and cls.fallback_setting:
            value = getattr(settings, cls.fallback_setting, None)
        return parse_chain(value)

    # ------------------------------------------------------------- selection
    def backend(self, name: str) -> MarketDataProvider:
        factory = self._factories.get(name)
        if factory is None:
            raise MarketDataError(f"Unknown market data provider '{name}'")
        return factory()

    def select(self, asset: AssetSpec) -> tuple[str, MarketDataProvider] | None:
        """(provider_id, provider) of the first chain entry that supports `asset`, else None.

        Unknown provider names are configuration errors and raise MarketDataError.
        """
        for name in self.chain:
            provider = self.backend(name)
            if provider.supports(asset):
                return name, provider
        return None

    def unavailable_reason(self, asset: AssetSpec) -> str:
        configured = ", ".join(self.chain) or "none"
        return f"No configured provider for {self.asset_class} supports {asset.symbol} (configured: {configured})"

    def resolve(self, asset: AssetSpec) -> MarketDataProvider:
        """The concrete backend provider for `asset` or DataNotAvailableError."""
        hit = self.select(asset)
        if hit is None:
            raise DataNotAvailableError(self.unavailable_reason(asset), symbol=asset.symbol)
        return hit[1]

    def availability(self, asset: AssetSpec) -> dict:
        """{available, provider_id, reason, source} — cheap, never touches the network."""
        try:
            hit = self.select(asset)
        except MarketDataError as exc:
            return {"available": False, "provider_id": None, "reason": str(exc), "source": None}
        if hit is None:
            return {"available": False, "provider_id": None, "reason": self.unavailable_reason(asset), "source": None}
        name, provider = hit
        problem = provider.config_problem()
        if problem:
            return {"available": False, "provider_id": name, "reason": problem, "source": provider.source.to_dict()}
        return {"available": True, "provider_id": name, "reason": None, "source": provider.source.to_dict()}

    # ---------------------------------------------------- provider interface
    @property
    def source(self) -> DataSource:  # type: ignore[override]
        """Source of the primary (first) provider in the chain — per-instrument sources come from resolve()."""
        for name in self.chain:
            try:
                return self.backend(name).source
            except MarketDataError:
                continue
        return UNAVAILABLE_SOURCE

    def supports(self, asset: AssetSpec) -> bool:
        try:
            return self.select(asset) is not None
        except MarketDataError:
            return False

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
        return self.resolve(asset).get_candles(
            asset, timeframe, start=start, end=end, limit=limit, now=now, include_partial=include_partial
        )

    def get_ticker(self, asset: AssetSpec, *, now: int | None = None) -> Ticker:
        return self.resolve(asset).get_ticker(asset, now=now)

    def __repr__(self) -> str:
        return f"<{type(self).__name__} chain={','.join(self.chain) or '-'}>"


class CryptoProvider(AssetClassProvider):
    asset_class = "crypto"
    setting = "market_data_crypto"


class StockProvider(AssetClassProvider):
    asset_class = "stock"
    setting = "market_data_stocks"


class ETFProvider(AssetClassProvider):
    asset_class = "etf"
    setting = "market_data_etf"
    fallback_setting = "market_data_stocks"


class ForexProvider(AssetClassProvider):
    asset_class = "forex"
    setting = "market_data_fx"


class IndexProvider(AssetClassProvider):
    asset_class = "index"
    setting = "market_data_indices"
    fallback_setting = "market_data_stocks"


class CommodityProvider(AssetClassProvider):
    asset_class = "commodity"
    setting = "market_data_commodities"
    fallback_setting = "market_data_stocks"


CLASS_PROVIDERS: dict[str, type[AssetClassProvider]] = {
    "crypto": CryptoProvider,
    "stock": StockProvider,
    "etf": ETFProvider,
    "forex": ForexProvider,
    "index": IndexProvider,
    "commodity": CommodityProvider,
}


class MarketRouter:
    """Maps asset_class → AssetClassProvider built from the current settings.

    Chains are re-read from `settings_getter()` on every call (a string split — negligible), so tests
    that patch settings and runtime configuration changes are honoured.
    """

    def __init__(self, settings_getter: Callable[[], object], factories: Mapping[str, ProviderFactory]):
        self._settings = settings_getter
        self.factories = factories

    def provider_class(self, asset_class: str) -> type[AssetClassProvider]:
        return CLASS_PROVIDERS.get(asset_class, StockProvider)

    def for_class(self, asset_class: str) -> AssetClassProvider:
        cls = self.provider_class(asset_class)
        return cls(cls.chain_from_settings(self._settings()), self.factories)

    def chains(self) -> dict[str, list[str]]:
        s = self._settings()
        return {name: list(cls.chain_from_settings(s)) for name, cls in CLASS_PROVIDERS.items()}

    def provider_for(self, asset: AssetSpec) -> MarketDataProvider:
        return self.for_class(asset.asset_class).resolve(asset)

    def availability(self, asset: AssetSpec) -> dict:
        return self.for_class(asset.asset_class).availability(asset)
