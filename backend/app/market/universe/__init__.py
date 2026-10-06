"""Instrument universe: reference data for the extended instrument catalog.

Every module exports
* ``ITEMS: list[dict]`` - new instruments (plain dict literals, one schema for all asset classes), and
* ``EXISTING_METADATA: dict[str, dict]`` - search/filter metadata for the 15 instruments that already live in
  ``app.market.catalog`` (those are deliberately NOT repeated in ``ITEMS``).

This package concatenates them into ``ALL_ITEMS`` (crypto, forex, indices, commodities, stocks, etfs), groups them
by asset class in ``BY_CLASS`` and merges all ``EXISTING_METADATA`` dicts.

Provider symbols were validated against the public Binance / Twelve Data reference lists. Instruments with an
empty ``providers`` dict are demo-only. The ``demo`` parameters only drive the synthetic demo generator.
"""

from app.market.universe import commodities, crypto, etfs, forex, indices, stocks

_MODULES = (crypto, forex, indices, commodities, stocks, etfs)

ALL_ITEMS: list[dict] = [item for module in _MODULES for item in module.ITEMS]

EXISTING_METADATA: dict[str, dict] = {}
for _module in _MODULES:
    EXISTING_METADATA.update(_module.EXISTING_METADATA)

# asset_class -> new instruments of that class (same dict objects as in ALL_ITEMS, module order preserved)
BY_CLASS: dict[str, list[dict]] = {}
for _item in ALL_ITEMS:
    BY_CLASS.setdefault(_item["asset_class"], []).append(_item)

__all__ = ["ALL_ITEMS", "BY_CLASS", "EXISTING_METADATA"]
