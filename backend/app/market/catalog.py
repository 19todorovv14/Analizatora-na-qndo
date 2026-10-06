"""Instrument catalog.

Two kinds of instruments exist:

* **Curated** — the 15 original instruments (defined below, values frozen: demo data and
  tests depend on them) plus the reference universe in ``app.market.universe`` (validated
  provider symbols, metadata, demo parameters). Every curated instrument can be served by
  the DEMO generator.
* **Synced** — instruments discovered from provider reference lists (Binance exchangeInfo,
  Twelve Data reference endpoints) and stored in the ``assets`` table. They are loaded
  lazily through a loader installed with :func:`set_synced_loader` and have NO demo
  parameters, so they are only available from a real (read-only) provider.

Leverage caps follow typical EU retail (ESMA) limits so beginners learn realistic
constraints: crypto 2:1, major FX 30:1, minor FX 20:1, major indices 20:1,
gold 20:1, other commodities 10:1, stocks 5:1.

`anchor_price`, `daily_vol`, `daily_volume_usd` and `drift` only parameterise the
DEMO (synthetic) data generator — they are not real market statistics.
"""

from __future__ import annotations

import dataclasses
import hashlib
import logging
import threading
from collections.abc import Callable, Iterable, Iterator, Mapping

from app.market.base import AssetSpec, slug_for

log = logging.getLogger(__name__)

_CRYPTO_FEES = {"maker_fee": 0.0002, "taker_fee": 0.0006}
_FX_FEES = {"maker_fee": 0.00003, "taker_fee": 0.00003}
_CFD_FEES = {"maker_fee": 0.0, "taker_fee": 0.0}
_STOCK_FEES = {"maker_fee": 0.0005, "taker_fee": 0.0005}

CLASS_FEES: dict[str, dict[str, float]] = {
    "crypto": _CRYPTO_FEES,
    "forex": _FX_FEES,
    "index": _CFD_FEES,
    "commodity": _CFD_FEES,
    "stock": _STOCK_FEES,
    "etf": _STOCK_FEES,
}
ASSET_CLASSES = ("crypto", "stock", "etf", "forex", "index", "commodity")

# The 15 original instruments. DO NOT change these values (demo series and tests depend on them);
# search/filter metadata is added below from universe.EXISTING_METADATA via dataclasses.replace.
_CORE_ASSETS: list[AssetSpec] = [
    AssetSpec(
        "BTC/USDT",
        "Bitcoin",
        "crypto",
        2,
        0.0001,
        0.0001,
        1.0,
        **_CRYPTO_FEES,
        max_leverage=2,
        anchor_price=95_000,
        daily_vol=0.030,
        daily_volume_usd=2.0e10,
        drift=0.0006,
        provider_symbols={"binance": "BTCUSDT", "twelvedata": "BTC/USD"},
        description="Най-голямата криптовалута по пазарна капитализация. Търгува 24/7.",
    ),
    AssetSpec(
        "ETH/USDT",
        "Ethereum",
        "crypto",
        2,
        0.001,
        0.001,
        1.5,
        **_CRYPTO_FEES,
        max_leverage=2,
        anchor_price=3_400,
        daily_vol=0.040,
        daily_volume_usd=1.0e10,
        drift=0.0006,
        provider_symbols={"binance": "ETHUSDT", "twelvedata": "ETH/USD"},
        description="Втората по големина криптовалута; платформа за smart contracts.",
    ),
    AssetSpec(
        "SOL/USDT",
        "Solana",
        "crypto",
        3,
        0.01,
        0.01,
        3.0,
        **_CRYPTO_FEES,
        max_leverage=2,
        anchor_price=190,
        daily_vol=0.055,
        daily_volume_usd=2.0e9,
        drift=0.0007,
        provider_symbols={"binance": "SOLUSDT", "twelvedata": "SOL/USD"},
        description="Високоволатилна криптовалута — добър пример за риск и размер на позицията.",
    ),
    AssetSpec(
        "XRP/USDT",
        "XRP",
        "crypto",
        4,
        1.0,
        1.0,
        4.0,
        **_CRYPTO_FEES,
        max_leverage=2,
        anchor_price=2.2,
        daily_vol=0.050,
        daily_volume_usd=1.5e9,
        drift=0.0004,
        provider_symbols={"binance": "XRPUSDT", "twelvedata": "XRP/USD"},
        description="Криптовалута с ниска цена на единица — внимавай с броя единици.",
    ),
    AssetSpec(
        "EUR/USD",
        "Euro / US Dollar",
        "forex",
        5,
        100.0,
        1000.0,
        0.8,
        **_FX_FEES,
        max_leverage=30,
        anchor_price=1.10,
        daily_vol=0.005,
        daily_volume_usd=1.0e11,
        drift=0.0,
        provider_symbols={"twelvedata": "EUR/USD"},
        description="Най-търгуваната валутна двойка. Ниска волатилност, но често се търгува с leverage.",
    ),
    AssetSpec(
        "GBP/USD",
        "British Pound / US Dollar",
        "forex",
        5,
        100.0,
        1000.0,
        1.2,
        **_FX_FEES,
        max_leverage=30,
        anchor_price=1.30,
        daily_vol=0.006,
        daily_volume_usd=5.0e10,
        drift=0.0,
        provider_symbols={"twelvedata": "GBP/USD"},
        description='"Cable" — малко по-волатилна от EUR/USD.',
    ),
    AssetSpec(
        "AUD/USD",
        "Australian Dollar / US Dollar",
        "forex",
        5,
        100.0,
        1000.0,
        1.5,
        **_FX_FEES,
        max_leverage=20,
        anchor_price=0.66,
        daily_vol=0.007,
        daily_volume_usd=3.0e10,
        drift=0.0,
        provider_symbols={"twelvedata": "AUD/USD"},
        description="Валута, чувствителна към суровини и риск апетит.",
    ),
    AssetSpec(
        "XAU/USD",
        "Gold",
        "commodity",
        2,
        0.01,
        0.01,
        2.0,
        **_CFD_FEES,
        max_leverage=20,
        anchor_price=2_650,
        daily_vol=0.009,
        daily_volume_usd=2.0e10,
        drift=0.0002,
        provider_symbols={"twelvedata": "XAU/USD"},
        description="Златото — класически 'safe haven' актив. Цена за тройунция.",
    ),
    AssetSpec(
        "WTI/USD",
        "WTI Crude Oil",
        "commodity",
        2,
        0.1,
        0.1,
        4.0,
        **_CFD_FEES,
        max_leverage=10,
        anchor_price=72,
        daily_vol=0.022,
        daily_volume_usd=1.0e10,
        drift=0.0,
        provider_symbols={"twelvedata": "WTI/USD"},
        description="Петрол — силно зависим от новини и геополитика.",
    ),
    AssetSpec(
        "SPX",
        "S&P 500",
        "index",
        2,
        0.01,
        0.01,
        1.0,
        **_CFD_FEES,
        max_leverage=20,
        anchor_price=6_000,
        daily_vol=0.010,
        daily_volume_usd=2.0e10,
        drift=0.0003,
        provider_symbols={"twelvedata": "SPX"},
        description="Индекс на 500 големи американски компании (CFD, $1 на точка).",
    ),
    AssetSpec(
        "NDX",
        "NASDAQ 100",
        "index",
        2,
        0.01,
        0.01,
        1.2,
        **_CFD_FEES,
        max_leverage=20,
        anchor_price=21_500,
        daily_vol=0.013,
        daily_volume_usd=1.5e10,
        drift=0.0004,
        provider_symbols={"twelvedata": "NDX"},
        description="Технологично натоварен индекс на 100 компании (CFD, $1 на точка).",
    ),
    AssetSpec(
        "GER40",
        "Germany 40 (DAX)",
        "index",
        1,
        0.01,
        0.01,
        1.5,
        **_CFD_FEES,
        max_leverage=20,
        anchor_price=20_000,
        daily_vol=0.011,
        daily_volume_usd=5.0e9,
        drift=0.0003,
        provider_symbols={"twelvedata": "DAX"},
        description="Германският индекс DAX (CFD, котиран в USD за симулацията).",
    ),
    AssetSpec(
        "AAPL",
        "Apple",
        "stock",
        2,
        0.01,
        0.01,
        2.0,
        **_STOCK_FEES,
        max_leverage=5,
        anchor_price=245,
        daily_vol=0.017,
        daily_volume_usd=1.0e10,
        drift=0.0004,
        provider_symbols={"twelvedata": "AAPL"},
        description="Акция (CFD) — голяма, ликвидна компания.",
    ),
    AssetSpec(
        "TSLA",
        "Tesla",
        "stock",
        2,
        0.01,
        0.01,
        3.0,
        **_STOCK_FEES,
        max_leverage=5,
        anchor_price=380,
        daily_vol=0.035,
        daily_volume_usd=2.0e10,
        drift=0.0004,
        provider_symbols={"twelvedata": "TSLA"},
        description="Силно волатилна акция — добър пример за широки стопове.",
    ),
    AssetSpec(
        "NVDA",
        "NVIDIA",
        "stock",
        2,
        0.01,
        0.01,
        2.5,
        **_STOCK_FEES,
        max_leverage=5,
        anchor_price=140,
        daily_vol=0.030,
        daily_volume_usd=3.0e10,
        drift=0.0006,
        provider_symbols={"twelvedata": "NVDA"},
        description="Акция с голям momentum в миналото — внимавай с recency bias.",
    ),
]

CORE_SYMBOLS: tuple[str, ...] = tuple(a.symbol for a in _CORE_ASSETS)

DEFAULT_WATCHLIST = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "EUR/USD", "XAU/USD", "SPX", "NDX"]

_METADATA_FIELDS = (
    "category",
    "sector",
    "industry",
    "exchange",
    "country",
    "currency",
    "base",
    "aliases",
    "popularity",
    "session",
)


class UnknownAssetError(KeyError):
    pass


def class_fees(asset_class: str) -> dict[str, float]:
    """Default maker/taker fees of an asset class (stocks for unknown classes)."""
    return dict(CLASS_FEES.get(asset_class, _STOCK_FEES))


def compact_key(text: str) -> str:
    """Ticker comparison key: upper case without "/", "-", "_" and spaces ("btc-usdt" → "BTCUSDT")."""
    return "".join(ch for ch in text.strip().upper() if ch not in "/-_ ")


def spec_from_item(item: Mapping, *, curated: bool = True, source: str = "curated") -> AssetSpec:
    """Build an AssetSpec from a universe/discovery item dict.

    Expected keys: symbol, name, asset_class, price_precision, qty_step, min_qty, max_leverage,
    spread_bps, optional maker_fee/taker_fee (class defaults otherwise), providers (or
    provider_symbols), demo{anchor_price, daily_vol, daily_volume_usd, drift} (optional — without
    it the instrument is not demo-capable) and the metadata fields of AssetSpec.
    """
    demo = item.get("demo") or {}
    fees = class_fees(item["asset_class"])
    if item.get("maker_fee") is not None:
        fees["maker_fee"] = float(item["maker_fee"])
    if item.get("taker_fee") is not None:
        fees["taker_fee"] = float(item["taker_fee"])
    providers = item.get("providers")
    if providers is None:
        providers = item.get("provider_symbols") or {}
    symbol = str(item["symbol"])
    return AssetSpec(
        symbol=symbol,
        name=str(item.get("name") or symbol),
        asset_class=str(item["asset_class"]),
        price_precision=int(item["price_precision"]),
        qty_step=float(item["qty_step"]),
        min_qty=float(item["min_qty"]),
        spread_bps=float(item["spread_bps"]),
        maker_fee=fees["maker_fee"],
        taker_fee=fees["taker_fee"],
        max_leverage=float(item["max_leverage"]),
        anchor_price=float(demo.get("anchor_price") or 0.0),
        daily_vol=float(demo.get("daily_vol") or 0.0),
        daily_volume_usd=float(demo.get("daily_volume_usd") or 0.0),
        drift=float(demo.get("drift") or 0.0),
        provider_symbols=dict(providers),
        description=str(item.get("description") or ""),
        category=str(item.get("category") or ""),
        sector=str(item.get("sector") or ""),
        industry=str(item.get("industry") or ""),
        exchange=str(item.get("exchange") or ""),
        country=str(item.get("country") or ""),
        currency=str(item.get("currency") or "USD"),
        base=str(item.get("base") or ""),
        aliases=tuple(str(a) for a in (item.get("aliases") or ())),
        popularity=int(item.get("popularity") if item.get("popularity") is not None else 1000),
        session=str(item.get("session") or "24x7"),
        curated=curated,
        source=source,
        slug=str(item.get("slug") or slug_for(symbol)),
    )


def _enrich_core(spec: AssetSpec, meta: Mapping) -> AssetSpec:
    """Add search/filter metadata to an original instrument (metadata fields only)."""
    changes = {k: meta[k] for k in _METADATA_FIELDS if k in meta}
    if "aliases" in changes:
        changes["aliases"] = tuple(changes["aliases"])
    if "popularity" in changes:
        changes["popularity"] = int(changes["popularity"])
    return dataclasses.replace(spec, **changes, curated=True, source="curated", slug=slug_for(spec.symbol))


def _validate_curated(assets: list[AssetSpec]) -> None:
    symbols: set[str] = set()
    slugs: set[str] = set()
    for a in assets:
        if a.symbol in symbols:
            raise ValueError(f"Duplicate catalog symbol {a.symbol}")
        if a.slug in slugs:
            raise ValueError(f"Duplicate catalog slug {a.slug} ({a.symbol})")
        if len(a.symbol) > 32 or len(a.slug) > 48:
            raise ValueError(f"Catalog symbol too long: {a.symbol}")
        if a.asset_class not in ASSET_CLASSES:
            raise ValueError(f"Unknown asset class {a.asset_class!r} for {a.symbol}")
        if not (a.demo_capable and a.daily_vol > 0 and a.daily_volume_usd > 0):
            raise ValueError(f"Curated instrument {a.symbol} needs demo parameters")
        if a.qty_step <= 0 or a.min_qty <= 0 or a.max_leverage < 1:
            raise ValueError(f"Bad trading parameters for {a.symbol}")
        symbols.add(a.symbol)
        slugs.add(a.slug)


def _build_curated() -> list[AssetSpec]:
    from app.market.universe import ALL_ITEMS, EXISTING_METADATA

    core = [_enrich_core(a, EXISTING_METADATA.get(a.symbol, {})) for a in _CORE_ASSETS]
    extra = [spec_from_item(item) for item in ALL_ITEMS]
    assets = core + extra
    _validate_curated(assets)
    return assets


# All curated instruments in a stable order: the 15 originals first, then the universe items.
ASSETS: list[AssetSpec] = _build_curated()
ASSETS_BY_SYMBOL: dict[str, AssetSpec] = {a.symbol: a for a in ASSETS}
CURATED_BY_SLUG: dict[str, AssetSpec] = {a.slug: a for a in ASSETS}
_CURATED_BY_COMPACT: dict[str, AssetSpec] = {}
for _a in sorted(ASSETS, key=lambda a: (a.popularity, len(a.symbol))):
    _CURATED_BY_COMPACT.setdefault(compact_key(_a.symbol), _a)
del _a


# ----------------------------------------------------------------- synced registry
class _SyncedRegistry:
    """In-memory registry of provider-synced (non-curated) instruments, loaded lazily."""

    def __init__(self) -> None:
        self.by_symbol: dict[str, AssetSpec] = {}
        self.by_slug: dict[str, AssetSpec] = {}
        self.by_compact: dict[str, AssetSpec] = {}
        self.loader: Callable[[], Iterable[AssetSpec]] | None = None
        self.loaded = False
        self.lock = threading.RLock()

    def replace(self, specs: Iterable[AssetSpec]) -> list[AssetSpec]:
        by_symbol: dict[str, AssetSpec] = {}
        by_slug: dict[str, AssetSpec] = {}
        for spec in specs:
            if spec.symbol in ASSETS_BY_SYMBOL or spec.symbol in by_symbol:
                continue  # curated wins; first synced definition wins
            base_slug = slug = spec.slug or slug_for(spec.symbol)
            if slug in CURATED_BY_SLUG or slug in by_slug:
                # deterministic short suffix (independent of load order)
                digest = hashlib.blake2b(f"{spec.source}|{spec.symbol}".encode(), digest_size=3).hexdigest().upper()
                slug, n = f"{base_slug}-{digest}", 2
                while slug in CURATED_BY_SLUG or slug in by_slug:
                    slug, n = f"{base_slug}-{digest}{n}", n + 1
            if slug != spec.slug or spec.curated:
                spec = dataclasses.replace(spec, slug=slug, curated=False)
            by_symbol[spec.symbol] = spec
            by_slug[slug] = spec
        by_compact: dict[str, AssetSpec] = {}
        for spec in sorted(by_symbol.values(), key=lambda a: (a.popularity, len(a.symbol), a.symbol)):
            by_compact.setdefault(compact_key(spec.symbol), spec)
        with self.lock:
            self.by_symbol, self.by_slug, self.by_compact = by_symbol, by_slug, by_compact
            self.loaded = True
        return list(by_symbol.values())

    def ensure(self) -> None:
        if self.loaded or self.loader is None:  # lock-free fast path
            return
        with self.lock:
            if self.loaded:
                return
            loader = self.loader
            if loader is None:
                return  # nothing installed yet (e.g. tests, demo-only setups)
            try:
                specs = list(loader())
            except Exception:  # noqa: BLE001 - a missing table must not break curated lookups
                log.warning("Could not load synced instruments; continuing with the curated catalog", exc_info=True)
                specs = []
            self.replace(specs)


_SYNCED = _SyncedRegistry()


def set_synced_loader(loader: Callable[[], Iterable[AssetSpec]] | None) -> None:
    """Install the function that loads synced instruments (called lazily, once, on first use)."""
    with _SYNCED.lock:
        _SYNCED.loader = loader
        _SYNCED.loaded = False


def set_synced_assets(specs: Iterable[AssetSpec]) -> list[AssetSpec]:
    """Replace the synced registry. Curated symbols are skipped; colliding slugs get a short suffix.

    Returns the registered specs (with their final, unique slugs).
    """
    return _SYNCED.replace(specs)


def reload_synced() -> int:
    """Re-run the installed loader (after a discovery sync). Returns the number of synced instruments."""
    with _SYNCED.lock:
        _SYNCED.loaded = False
    _SYNCED.ensure()
    return len(_SYNCED.by_symbol)


def clear_synced() -> None:
    """Forget all synced instruments (tests). Keeps the installed loader; the next lookup reloads."""
    with _SYNCED.lock:
        _SYNCED.by_symbol, _SYNCED.by_slug, _SYNCED.by_compact = {}, {}, {}
        _SYNCED.loaded = False


def synced_assets() -> list[AssetSpec]:
    _SYNCED.ensure()
    return list(_SYNCED.by_symbol.values())


def all_assets() -> list[AssetSpec]:
    """Curated instruments first (stable order), then synced ones."""
    return ASSETS + synced_assets()


def get_asset(symbol: str) -> AssetSpec:
    """Exact symbol lookup: curated first, then the synced registry."""
    spec = ASSETS_BY_SYMBOL.get(symbol)
    if spec is not None:
        return spec
    _SYNCED.ensure()
    spec = _SYNCED.by_symbol.get(symbol)
    if spec is not None:
        return spec
    raise UnknownAssetError(symbol)


def resolve_asset(symbol_or_slug: str) -> AssetSpec:
    """Lenient lookup for URLs and user input: "BTC/USDT", "btc/usdt", "btc-usdt", "BTCUSDT" → BTC/USDT."""
    text = (symbol_or_slug or "").strip()
    if not text:
        raise UnknownAssetError(symbol_or_slug)
    slug, upper, key = slug_for(text), text.upper(), compact_key(text)
    # curated instruments win every lenient step (a URL slug such as "BTC-USDT" must open BTC/USDT
    # even if a synced instrument is literally called "BTC-USDT"; that one has a suffixed slug)
    spec = ASSETS_BY_SYMBOL.get(text) or CURATED_BY_SLUG.get(slug) or ASSETS_BY_SYMBOL.get(upper)
    if spec is not None:
        return spec
    _SYNCED.ensure()
    spec = _SYNCED.by_symbol.get(text) or _SYNCED.by_slug.get(slug) or _SYNCED.by_symbol.get(upper)
    if spec is not None:
        return spec
    spec = _CURATED_BY_COMPACT.get(key) or _SYNCED.by_compact.get(key)
    if spec is not None:
        return spec
    raise UnknownAssetError(symbol_or_slug)


class _SpecsView(Mapping[str, AssetSpec]):
    """Read-only symbol → AssetSpec mapping over curated + synced instruments (resolves via get_asset).

    Pass this (not ASSETS_BY_SYMBOL) to PaperBroker so synced instruments can be paper-traded.
    """

    def __getitem__(self, symbol: str) -> AssetSpec:
        return get_asset(symbol)  # UnknownAssetError is a KeyError

    def __contains__(self, symbol: object) -> bool:
        if not isinstance(symbol, str):
            return False
        try:
            get_asset(symbol)
        except UnknownAssetError:
            return False
        return True

    def __iter__(self) -> Iterator[str]:
        _SYNCED.ensure()
        yield from ASSETS_BY_SYMBOL
        yield from list(_SYNCED.by_symbol)

    def __len__(self) -> int:
        _SYNCED.ensure()
        return len(ASSETS_BY_SYMBOL) + len(_SYNCED.by_symbol)

    def __repr__(self) -> str:
        return f"<SPECS curated={len(ASSETS_BY_SYMBOL)} synced={len(_SYNCED.by_symbol)}>"


SPECS: Mapping[str, AssetSpec] = _SpecsView()
