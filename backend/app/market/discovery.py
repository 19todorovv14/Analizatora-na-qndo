"""Discovery sync: provider instrument lists → ``assets`` table → in-memory synced registry.

Only READ-ONLY public reference endpoints are used:

* Binance      ``GET /api/v3/exchangeInfo?permissions=SPOT`` (public, no key)
* Twelve Data  ``GET /stocks``, ``/etf``, ``/forex_pairs``, ``/indices``, ``/commodities``,
  ``/cryptocurrencies`` (reference endpoints work without an API key; no key is ever sent)

Synced instruments carry NO demo parameters: they are served only by a configured real provider and
show DATA_NOT_AVAILABLE otherwise (never invented numbers). Curated instruments (app.market.catalog)
are never modified here — the seed upserts them — and a synced instrument never takes a curated
symbol or slug.

Every run of one (provider, kind) writes a ``catalog_syncs`` row (running → ok | error). Rows of the
same provider and asset class that disappear from the provider list are deactivated (``active=False``),
not deleted, so their slugs stay reserved and old links keep resolving to 404 instead of to another
instrument.

The mapping functions (:func:`binance_items`, :func:`twelvedata_items`) are pure and are what the
tests exercise with inline fixtures — tests never touch the network.

CLI::

    python -m app.market.discovery --provider binance
    python -m app.market.discovery --provider twelvedata --kinds forex_pairs,commodities
    python -m app.market.discovery --provider all

Celery: ``app.workers.tasks.sync_catalog`` (daily beat entry only when ``CATALOG_AUTO_SYNC=true``).
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import re
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from decimal import Decimal, InvalidOperation

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.market import catalog
from app.market.base import AssetSpec, MarketDataError, slug_for
from app.market.catalog import ASSETS, CURATED_BY_SLUG, spec_from_item, suffixed_slug
from app.models import Asset, CatalogSync

log = logging.getLogger(__name__)

PROVIDERS = ("binance", "twelvedata")
BINANCE_KIND = "spot"
TWELVEDATA_KINDS = ("stocks", "etf", "forex_pairs", "indices", "commodities", "cryptocurrencies")
TWELVEDATA_PATHS = {
    "stocks": "/stocks",
    "etf": "/etf",
    "forex_pairs": "/forex_pairs",
    "indices": "/indices",
    "commodities": "/commodities",
    "cryptocurrencies": "/cryptocurrencies",
}
# kind → asset_class of the instruments it produces
KIND_CLASS = {
    BINANCE_KIND: "crypto",
    "stocks": "stock",
    "etf": "etf",
    "forex_pairs": "forex",
    "indices": "index",
    "commodities": "commodity",
    "cryptocurrencies": "crypto",
}

MAX_SYMBOL_LEN = 32  # assets.symbol is String(32)
ETF_EXCHANGES = frozenset({"NASDAQ", "NYSE", "NYSE ARCA", "CBOE"})  # applied to US-listed ETFs
FX_MAJOR_CURRENCIES = frozenset({"USD", "EUR", "JPY", "GBP", "CAD", "CHF"})  # ESMA: 30:1 when both are majors
# security types in the Twelve Data /stocks list that are not plain shares
_SKIP_STOCK_TYPE_WORDS = frozenset(
    {"warrant", "warrants", "right", "rights", "unit", "units", "preferred", "structured", "bond", "note", "notes"}
)

# Popularity of synced instruments (lower = more popular). Curated instruments are 1…~300, so synced
# ones always sort after them; within a provider the order is deterministic.
POPULARITY = {
    "binance": 5000,  # + 100 × position of the quote asset in CATALOG_BINANCE_QUOTES (+50 unknown base)
    "forex_major": 5500,
    "forex_cross": 5600,
    "forex_exotic": 5800,
    "commodities": 5600,
    "indices": 5700,
    "stocks": 6000,
    "etf": 6000,
    "cryptocurrencies": 7000,
}

COUNTRY_SESSIONS = {
    "United States": "us_equity",
    "Germany": "eu_xetra",
    "United Kingdom": "uk_lse",
    "France": "eu_euronext",
    "Netherlands": "eu_euronext",
    "Belgium": "eu_euronext",
    "Portugal": "eu_euronext",
    "Ireland": "eu_euronext",
    "Japan": "jp_tse",
    "Hong Kong": "hk_hkex",
    "Australia": "au_asx",
}
# Not a calendar id: app.market.sessions falls back to the class default and says it is approximate.
UNKNOWN_SESSION = "unknown"

_EUROPE = frozenset(
    {
        "Austria",
        "Belgium",
        "Czech Republic",
        "Denmark",
        "Eurozone",
        "Euro Area",
        "Europe",
        "Finland",
        "France",
        "Germany",
        "Greece",
        "Hungary",
        "Iceland",
        "Ireland",
        "Italy",
        "Luxembourg",
        "Netherlands",
        "Norway",
        "Poland",
        "Portugal",
        "Romania",
        "Russia",
        "Spain",
        "Sweden",
        "Switzerland",
        "Turkey",
        "United Kingdom",
    }
)
_ASIA = frozenset(
    {
        "China",
        "Hong Kong",
        "India",
        "Indonesia",
        "Japan",
        "Malaysia",
        "Pakistan",
        "Philippines",
        "Singapore",
        "South Korea",
        "Korea",
        "Sri Lanka",
        "Taiwan",
        "Thailand",
        "Vietnam",
    }
)

_PAREN_SUFFIX = re.compile(r"\s*\([^)]*\)\s*$")

NO_DEMO_NOTE = "Няма демо данни — цените идват само от реален източник."


# ------------------------------------------------------------------------ helpers
def _pos_float(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def tick_decimals(tick, default: int = 8) -> int:
    """Number of decimals of a tick size string ("0.01000000" → 2, "1.00" → 0); `default` when unusable."""
    try:
        d = Decimal(str(tick))
    except (InvalidOperation, ValueError, TypeError):
        return default
    if not d.is_finite() or d <= 0:
        return default
    exponent = d.normalize().as_tuple().exponent
    if not isinstance(exponent, int):
        return default
    return max(0, min(12, -exponent))


def _item(
    *,
    symbol: str,
    name: str,
    asset_class: str,
    provider: str,
    provider_symbol: str,
    price_precision: int,
    qty_step: float,
    min_qty: float,
    max_leverage: float,
    spread_bps: float,
    popularity: int,
    category: str = "other",
    exchange: str = "",
    country: str = "",
    currency: str = "USD",
    base: str = "",
    session: str = "24x7",
    description: str = "",
) -> dict:
    """An instrument dict in the universe/catalog schema (see catalog.spec_from_item)."""
    return {
        "symbol": symbol,
        "name": (name or symbol).strip()[:100],
        "asset_class": asset_class,
        "category": category,
        "sector": "",
        "industry": "",
        "exchange": exchange[:32],
        "country": country[:48],
        "currency": (currency or "USD")[:12],
        "base": base[:32],
        "aliases": [],
        "popularity": int(popularity),
        "session": session,
        "description": description,
        "providers": {provider: provider_symbol},
        "price_precision": int(price_precision),
        "qty_step": float(qty_step),
        "min_qty": float(min_qty),
        "max_leverage": float(max_leverage),
        "spread_bps": float(spread_bps),
    }


def _crypto_base_names(curated: Iterable[AssetSpec]) -> dict[str, str]:
    """Base code → coin name from curated crypto instruments ("BTC" → "Bitcoin")."""
    names: dict[str, str] = {}
    for spec in sorted(curated, key=lambda a: (a.popularity, a.symbol)):
        if spec.asset_class != "crypto":
            continue
        base = spec.base or spec.symbol.split("/")[0]
        names.setdefault(base.upper(), _PAREN_SUFFIX.sub("", spec.name) or base)
    return names


def _curated_crypto_bases(curated: Iterable[AssetSpec]) -> set[str]:
    out: set[str] = set()
    for spec in curated:
        if spec.asset_class == "crypto":
            out.add((spec.base or spec.symbol.split("/")[0]).upper())
    return out


def _curated_provider_symbols(curated: Iterable[AssetSpec], provider: str, classes: Iterable[str]) -> set[str]:
    wanted = set(classes)
    return {
        str(s.provider_symbols[provider]) for s in curated if provider in s.provider_symbols and s.asset_class in wanted
    }


def _is_spot(row: Mapping) -> bool:
    if row.get("isSpotTradingAllowed") is True:
        return True
    perms = row.get("permissions") or []
    sets = row.get("permissionSets") or []
    if "SPOT" in perms or any(isinstance(s, list) and "SPOT" in s for s in sets):
        return True
    # requested with permissions=SPOT: rows without any permission info are spot rows
    return row.get("isSpotTradingAllowed") is None and not perms and not sets


def _region(country: str) -> str:
    if country == "United States":
        return "us"
    if country in _EUROPE:
        return "europe"
    if country in _ASIA:
        return "asia"
    return "other"


def _commodity_category(text: str) -> str:
    t = (text or "").lower()
    if "metal" in t:
        return "metal"
    if "energy" in t or "oil" in t or "gas" in t:
        return "energy"
    if any(w in t for w in ("agri", "grain", "soft", "livestock", "food")):
        return "agriculture"
    return "other"


def _fx_category(group: str) -> str:
    g = (group or "").lower()
    if "exotic" in g:
        return "exotic"
    if "major" in g:
        return "major"
    return "cross"  # Twelve Data "Minor" = crosses


# ------------------------------------------------------------------ Binance mapping
def binance_items(
    exchange_info: Mapping,
    *,
    quotes: Sequence[str],
    curated: Iterable[AssetSpec] | None = None,
) -> list[dict]:
    """Map Binance ``/api/v3/exchangeInfo`` to instrument dicts.

    Keeps TRADING spot symbols whose quote asset is in `quotes`; skips curated instruments (by symbol
    and by Binance symbol). price_precision comes from PRICE_FILTER.tickSize, qty_step/min_qty from
    LOT_SIZE. Class crypto, category 'other', session 24x7, leverage 2, spread 5 bps, crypto fees.
    """
    curated = list(ASSETS if curated is None else curated)
    curated_symbols = {a.symbol for a in curated}
    curated_binance = _curated_provider_symbols(curated, "binance", ("crypto",))
    names = _crypto_base_names(curated)
    quote_rank = {str(q).upper(): i for i, q in enumerate(quotes)}
    out: list[dict] = []
    seen: set[str] = set()
    for row in exchange_info.get("symbols") or ():
        if not isinstance(row, Mapping):
            continue
        bsym = str(row.get("symbol") or "").strip()
        base = str(row.get("baseAsset") or "").strip().upper()
        quote = str(row.get("quoteAsset") or "").strip().upper()
        if not (bsym and base and quote) or row.get("status") != "TRADING" or not _is_spot(row):
            continue
        if quote not in quote_rank:
            continue
        symbol = f"{base}/{quote}"
        if symbol in curated_symbols or bsym in curated_binance or symbol in seen or len(symbol) > MAX_SYMBOL_LEN:
            continue
        filters = {f.get("filterType"): f for f in row.get("filters") or () if isinstance(f, Mapping)}
        lot = filters.get("LOT_SIZE") or {}
        step, min_qty = _pos_float(lot.get("stepSize")), _pos_float(lot.get("minQty"))
        if step is None and min_qty is None:
            continue  # cannot size orders without lot information
        step = step or min_qty
        min_qty = max(min_qty or step, step)
        default_precision = int(row.get("quotePrecision") or row.get("quoteAssetPrecision") or 8)
        precision = tick_decimals((filters.get("PRICE_FILTER") or {}).get("tickSize"), default=default_precision)
        name = names.get(base, base)
        seen.add(symbol)
        out.append(
            _item(
                symbol=symbol,
                name=name,
                asset_class="crypto",
                provider="binance",
                provider_symbol=bsym,
                price_precision=precision,
                qty_step=step,
                min_qty=min_qty,
                max_leverage=2,
                spread_bps=5,
                popularity=POPULARITY["binance"] + 100 * quote_rank[quote] + (0 if base in names else 50),
                category="other",
                exchange="Binance",
                currency=quote,
                base=base,
                session="24x7",
                description=f"{name} ({base}) срещу {quote} — спот двойка от Binance, добавена автоматично. "
                + NO_DEMO_NOTE,
            )
        )
    return out


# --------------------------------------------------------------- Twelve Data mapping
def _td_rows(rows) -> list[Mapping]:
    if isinstance(rows, Mapping):  # whole response {"data": [...], "status": "ok"}
        rows = rows.get("data") or []
    return [r for r in rows or () if isinstance(r, Mapping)]


def _equity_items(kind: str, rows, countries: Sequence[str], skip_symbols: set[str]) -> list[dict]:
    asset_class = KIND_CLASS[kind]
    wanted = {c.lower(): i for i, c in enumerate(countries)}
    candidates: list[tuple[tuple[int, int, int], Mapping]] = []
    for idx, r in enumerate(_td_rows(rows)):
        country = str(r.get("country") or "").strip()
        if country.lower() not in wanted:
            continue
        exchange = str(r.get("exchange") or "").strip()
        ex_upper = exchange.upper()
        if "OTC" in ex_upper:
            continue
        if kind == "etf" and country == "United States" and ex_upper not in ETF_EXCHANGES:
            continue
        if kind == "stocks":
            type_words = set(re.findall(r"[a-z]+", str(r.get("type") or "").lower()))
            if type_words & _SKIP_STOCK_TYPE_WORDS:
                continue
        primary = 0 if ex_upper in ("NASDAQ", "NYSE") else 1
        candidates.append(((wanted[country.lower()], primary, idx), r))
    candidates.sort(key=lambda c: c[0])  # first country, then main exchanges, then provider order
    out: list[dict] = []
    seen: set[str] = set()
    label = "акция" if asset_class == "stock" else "ETF"
    for _, r in candidates:
        symbol = str(r.get("symbol") or "").strip().upper()
        if not symbol or symbol in seen or symbol in skip_symbols or len(symbol) > MAX_SYMBOL_LEN:
            continue
        country = str(r.get("country") or "").strip()
        exchange = str(r.get("exchange") or "").strip()
        name = str(r.get("name") or symbol).strip()
        seen.add(symbol)
        out.append(
            _item(
                symbol=symbol,
                name=name,
                asset_class=asset_class,
                provider="twelvedata",
                provider_symbol=str(r.get("symbol")).strip(),
                price_precision=2,
                qty_step=0.01,
                min_qty=0.01,
                max_leverage=5,
                spread_bps=5,
                popularity=POPULARITY[kind],
                category="other",
                exchange=exchange,
                country=country,
                currency=str(r.get("currency") or "USD").strip(),
                base=symbol,
                session=COUNTRY_SESSIONS.get(country, UNKNOWN_SESSION),
                description=f"{name} — {label} ({exchange or country}), добавена автоматично от списъка на "
                f"Twelve Data. {NO_DEMO_NOTE}",
            )
        )
    return out


def _forex_items(rows, skip_symbols: set[str]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in _td_rows(rows):
        symbol = str(r.get("symbol") or "").strip().upper()
        parts = symbol.split("/")
        if len(parts) != 2 or not all(parts) or symbol in seen or symbol in skip_symbols:
            continue
        base, quote = parts
        if len(symbol) > MAX_SYMBOL_LEN:
            continue
        category = _fx_category(str(r.get("currency_group") or ""))
        base_name = str(r.get("currency_base") or "").strip()
        quote_name = str(r.get("currency_quote") or "").strip()
        name = f"{base_name} / {quote_name}" if base_name and quote_name else symbol
        seen.add(symbol)
        out.append(
            _item(
                symbol=symbol,
                name=name,
                asset_class="forex",
                provider="twelvedata",
                provider_symbol=str(r.get("symbol")).strip(),
                price_precision=3 if quote == "JPY" else 5,
                qty_step=100,
                min_qty=1000,
                max_leverage=30 if base in FX_MAJOR_CURRENCIES and quote in FX_MAJOR_CURRENCIES else 20,
                spread_bps=3,
                popularity=POPULARITY[f"forex_{category}"],
                category=category,
                exchange="FX",
                currency=quote,
                base=base,
                session="fx",
                description=f"Валутна двойка {name}, добавена автоматично от списъка на Twelve Data. {NO_DEMO_NOTE}",
            )
        )
    return out


def _index_items(rows, skip_symbols: set[str]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in _td_rows(rows):
        symbol = str(r.get("symbol") or "").strip().upper()
        if not symbol or symbol in seen or symbol in skip_symbols or len(symbol) > MAX_SYMBOL_LEN:
            continue
        country = str(r.get("country") or "").strip()
        name = str(r.get("name") or symbol).strip()
        seen.add(symbol)
        out.append(
            _item(
                symbol=symbol,
                name=name,
                asset_class="index",
                provider="twelvedata",
                provider_symbol=str(r.get("symbol")).strip(),
                price_precision=2,
                qty_step=0.01,
                min_qty=0.01,
                max_leverage=10,
                spread_bps=3,
                popularity=POPULARITY["indices"],
                category=_region(country),
                exchange=str(r.get("exchange") or "INDEX").strip(),
                country=country,
                currency=str(r.get("currency") or "USD").strip(),
                base=symbol,
                session=COUNTRY_SESSIONS.get(country, UNKNOWN_SESSION),
                description=f"Индекс {name} ({country or 'n/a'}), добавен автоматично от списъка на Twelve Data. "
                + NO_DEMO_NOTE,
            )
        )
    return out


def _commodity_items(rows, skip_symbols: set[str]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in _td_rows(rows):
        symbol = str(r.get("symbol") or "").strip().upper()
        if not symbol or symbol in seen or symbol in skip_symbols or len(symbol) > MAX_SYMBOL_LEN:
            continue
        parts = symbol.split("/")
        base = parts[0]
        currency = parts[1] if len(parts) == 2 and parts[1] else "USD"
        name = str(r.get("name") or symbol).strip()
        if currency != "USD":  # Twelve Data repeats e.g. "Gold Spot" for every quote currency
            name = f"{name} ({currency})"
        seen.add(symbol)
        out.append(
            _item(
                symbol=symbol,
                name=name,
                asset_class="commodity",
                provider="twelvedata",
                provider_symbol=str(r.get("symbol")).strip(),
                price_precision=3,
                qty_step=0.01,
                min_qty=0.01,
                max_leverage=20 if base == "XAU" else 10,
                spread_bps=5,
                popularity=POPULARITY["commodities"],
                category=_commodity_category(str(r.get("category") or "") + " " + name),
                exchange="OTC",
                currency=currency,
                base=base,
                session="cme",
                description=f"{name} — суровина, добавена автоматично от списъка на Twelve Data. {NO_DEMO_NOTE}",
            )
        )
    return out


def _crypto_items(rows, skip_symbols: set[str], curated_bases: set[str]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in _td_rows(rows):
        symbol = str(r.get("symbol") or "").strip().upper()
        parts = symbol.split("/")
        if len(parts) != 2 or not all(parts) or symbol in seen or symbol in skip_symbols:
            continue
        base, quote = parts
        # Twelve Data reuses some tickers for unrelated coins: never add a second "BTC", "DOT", …
        if base in curated_bases or len(symbol) > MAX_SYMBOL_LEN:
            continue
        name = str(r.get("currency_base") or base).strip()
        seen.add(symbol)
        out.append(
            _item(
                symbol=symbol,
                name=name,
                asset_class="crypto",
                provider="twelvedata",
                provider_symbol=str(r.get("symbol")).strip(),
                price_precision=8 if quote in ("BTC", "ETH") else 6,
                qty_step=0.0001,
                min_qty=0.0001,
                max_leverage=2,
                spread_bps=10,
                popularity=POPULARITY["cryptocurrencies"],
                category="other",
                exchange="Aggregated",
                currency=quote,
                base=base,
                session="24x7",
                description=f"{name} ({base}) срещу {quote} — добавена автоматично от списъка на Twelve Data. "
                + NO_DEMO_NOTE,
            )
        )
    return out


def twelvedata_items(
    kind: str,
    rows,
    *,
    countries: Sequence[str] = ("United States",),
    curated: Iterable[AssetSpec] | None = None,
) -> list[dict]:
    """Map one Twelve Data reference list (`rows` = the ``data`` array or the whole response) to instrument dicts.

    * stocks / etf: only `countries`; OTC listings skipped; US ETFs only on NASDAQ/NYSE/NYSE ARCA/CBOE;
      warrants/rights/units/preferred shares skipped; leverage 5, qty_step 0.01.
    * forex_pairs: leverage 30 when both currencies are majors (USD EUR JPY GBP CAD CHF), else 20;
      qty_step 100, min 1000.
    * indices: leverage 10.  * commodities: leverage 10 (gold 20).
    * cryptocurrencies: only pairs whose base is NOT a curated coin (Twelve Data reuses tickers).
    Curated symbols — and Twelve Data symbols already mapped by a curated instrument of the same
    class — are skipped.
    """
    if kind not in TWELVEDATA_KINDS:
        raise ValueError(f"Unknown Twelve Data kind {kind!r} (expected one of {', '.join(TWELVEDATA_KINDS)})")
    curated = list(ASSETS if curated is None else curated)
    asset_class = KIND_CLASS[kind]
    same_group = ("stock", "etf") if asset_class in ("stock", "etf") else (asset_class,)
    skip = {a.symbol.upper() for a in curated} | {
        s.upper() for s in _curated_provider_symbols(curated, "twelvedata", same_group)
    }
    if kind in ("stocks", "etf"):
        return _equity_items(kind, rows, countries, skip)
    if kind == "forex_pairs":
        return _forex_items(rows, skip)
    if kind == "indices":
        return _index_items(rows, skip)
    if kind == "commodities":
        return _commodity_items(rows, skip)
    return _crypto_items(rows, skip, _curated_crypto_bases(curated))


# --------------------------------------------------------------------------- DB upsert
def upsert_items(db: Session, provider: str, kinds: Sequence[str], items: Sequence[Mapping], *, now: int | None = None):
    """Upsert synced instruments of one provider; deactivate this provider's rows (of the kinds' classes)
    that are no longer listed. Never touches curated rows or rows owned by another provider.

    Returns {count, inserted, updated, deactivated, skipped}.
    """
    from app.seed import asset_row_values  # local import: app.seed pulls in the service layer

    now = int(now if now is not None else time.time())
    classes = {KIND_CLASS[k] for k in kinds}
    rows = list(db.scalars(select(Asset)))
    by_symbol = {r.symbol: r for r in rows}
    slug_owner = {r.slug: r.symbol for r in rows if r.slug}
    seen: set[str] = set()
    inserted = updated = skipped = 0
    for item in items:
        try:
            spec = spec_from_item(item, curated=False, source=provider)
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("Skipping malformed %s instrument %r: %s", provider, item.get("symbol"), exc)
            skipped += 1
            continue
        symbol = spec.symbol
        if symbol in seen:
            continue
        row = by_symbol.get(symbol)
        if symbol in catalog.ASSETS_BY_SYMBOL or (row is not None and row.source != provider):
            skipped += 1  # curated instruments and other providers' rows are never taken over
            continue
        seen.add(symbol)

        def taken(slug: str, _symbol: str = symbol) -> bool:
            owner = slug_owner.get(slug)
            if owner is not None and owner != _symbol:
                return True
            curated_spec = CURATED_BY_SLUG.get(slug)
            return curated_spec is not None and curated_spec.symbol != _symbol

        if row is not None and row.slug and not taken(row.slug):
            slug = row.slug  # stable URLs
        else:
            slug = suffixed_slug(slug_for(symbol), provider, symbol, taken)
        values = asset_row_values(dataclasses.replace(spec, slug=slug))
        values["active"] = True
        if row is None:
            row = Asset(symbol=symbol, updated_ts=now, **values)
            db.add(row)
            by_symbol[symbol] = row
            inserted += 1
        else:
            dirty = [k for k, v in values.items() if getattr(row, k) != v]
            if dirty:
                for k in dirty:
                    setattr(row, k, values[k])
                row.updated_ts = now
                updated += 1
        slug_owner[slug] = symbol
    deactivated = 0
    for row in rows:
        if row.source == provider and row.asset_class in classes and row.symbol not in seen and row.active:
            row.active = False
            row.updated_ts = now
            deactivated += 1
    db.commit()
    return {
        "count": len(seen),
        "inserted": inserted,
        "updated": updated,
        "deactivated": deactivated,
        "skipped": skipped,
    }


# ----------------------------------------------------------------------- HTTP + runs
_QUERY = re.compile(r"\?[^\s'\"]*=[^\s'\"]*")


def _safe_message(text: str) -> str:
    """Error text without query strings (never echo parameters such as API keys)."""
    return _QUERY.sub("?…", str(text))[:500]


def _get_json(client: httpx.Client, url: str, params: Mapping | None = None):
    try:
        resp = client.get(url, params=dict(params or {}))
    except httpx.HTTPError as exc:
        raise MarketDataError(_safe_message(f"Request to {url} failed: {type(exc).__name__}: {exc}")) from exc
    try:
        data = resp.json()
    except ValueError as exc:
        raise MarketDataError(f"{url} returned HTTP {resp.status_code} with a non-JSON body") from exc
    if resp.status_code >= 400 or (isinstance(data, Mapping) and data.get("status") == "error"):
        message = data.get("message") if isinstance(data, Mapping) else None
        raise MarketDataError(_safe_message(f"{url} → HTTP {resp.status_code}: {message or resp.text[:200]}"))
    return data


def _start_run(db: Session, provider: str, kind: str) -> CatalogSync:
    run = CatalogSync(provider=provider, kind=kind, started_ts=int(time.time()), status="running", count=0, message="")
    db.add(run)
    db.commit()
    return run


def _finish_run(db: Session, run: CatalogSync, status: str, count: int, message: str) -> dict:
    run.status = status
    run.count = count
    run.message = message
    run.finished_ts = int(time.time())
    db.commit()
    return {
        "id": run.id,
        "provider": run.provider,
        "kind": run.kind,
        "status": run.status,
        "count": run.count,
        "message": run.message,
        "started_ts": run.started_ts,
        "finished_ts": run.finished_ts,
    }


def _run(db: Session, provider: str, kind: str, fetch_items: Callable[[], list[dict]]) -> dict:
    run = _start_run(db, provider, kind)
    try:
        items = fetch_items()
        if not items:
            # an empty/changed provider response must not deactivate every instrument of this kind
            raise MarketDataError(
                f"{provider}/{kind}: the provider list produced no instruments — nothing was changed "
                "(check the provider response and the CATALOG_* settings)"
            )
        stats = upsert_items(db, provider, (kind,), items)
    except Exception as exc:  # noqa: BLE001 - every failure is recorded on the catalog_syncs row
        db.rollback()
        log.warning("Catalog sync %s/%s failed: %s", provider, kind, exc)
        result = _finish_run(db, run, "error", 0, _safe_message(f"{type(exc).__name__}: {exc}"))
        result.update(inserted=0, updated=0, deactivated=0, skipped=0)
        return result
    message = (
        f"{stats['count']} instruments: {stats['inserted']} new, {stats['updated']} updated, "
        f"{stats['deactivated']} deactivated, {stats['skipped']} skipped"
    )
    result = _finish_run(db, run, "ok", stats["count"], message)
    result.update({k: stats[k] for k in ("inserted", "updated", "deactivated", "skipped")})
    log.info("Catalog sync %s/%s: %s", provider, kind, message)
    return result


def _client(settings: Settings) -> httpx.Client:
    # reference lists are large (Binance exchangeInfo is several MB)
    return httpx.Client(timeout=max(30.0, settings.market_http_timeout), headers={"Accept": "application/json"})


def sync_binance(db: Session, *, client: httpx.Client | None = None, settings: Settings | None = None) -> dict:
    """Sync Binance spot pairs (one catalog_syncs row, kind 'spot')."""
    settings = settings or get_settings()
    own = client is None
    http = client or _client(settings)
    try:

        def fetch() -> list[dict]:
            data = _get_json(
                http, f"{settings.binance_base_url.rstrip('/')}/api/v3/exchangeInfo", {"permissions": "SPOT"}
            )
            if not isinstance(data, Mapping):
                raise MarketDataError("Unexpected exchangeInfo response from Binance")
            return binance_items(data, quotes=settings.catalog_quotes)

        result = _run(db, "binance", BINANCE_KIND, fetch)
    finally:
        if own:
            http.close()
    catalog.mark_synced_stale()
    return result


def sync_twelvedata(
    db: Session,
    kinds: Sequence[str] = TWELVEDATA_KINDS,
    *,
    client: httpx.Client | None = None,
    settings: Settings | None = None,
    pause: float = 1.0,
) -> list[dict]:
    """Sync Twelve Data reference lists (one catalog_syncs row per kind). No API key is sent."""
    settings = settings or get_settings()
    kinds = tuple(kinds)
    unknown = [k for k in kinds if k not in TWELVEDATA_KINDS]
    if unknown:
        raise ValueError(f"Unknown Twelve Data kinds: {', '.join(unknown)}")
    own = client is None
    http = client or _client(settings)
    base_url = settings.twelvedata_base_url.rstrip("/")
    countries = settings.catalog_countries
    results: list[dict] = []
    requests = 0

    def get(path: str, params: Mapping | None = None):
        nonlocal requests
        if requests and pause > 0:
            time.sleep(pause)  # be gentle with the (keyless) reference endpoints
        requests += 1
        return _get_json(http, f"{base_url}{path}", params)

    try:
        for kind in kinds:

            def fetch(kind: str = kind) -> list[dict]:
                path = TWELVEDATA_PATHS[kind]
                if kind in ("stocks", "etf"):
                    rows: list = []
                    for country in countries:
                        rows.extend(_td_rows(get(path, {"country": country})))
                else:
                    rows = _td_rows(get(path))
                return twelvedata_items(kind, rows, countries=countries)

            results.append(_run(db, "twelvedata", kind, fetch))
    finally:
        if own:
            http.close()
    catalog.mark_synced_stale()
    return results


def run_sync(
    db: Session,
    provider: str = "all",
    kinds: Sequence[str] | None = None,
    *,
    client: httpx.Client | None = None,
    pause: float = 1.0,
) -> list[dict]:
    """Run the discovery sync for 'binance', 'twelvedata' or 'all'. Returns one result per catalog_syncs row."""
    if provider not in (*PROVIDERS, "all"):
        raise ValueError(f"Unknown provider {provider!r}")
    results: list[dict] = []
    if provider in ("binance", "all"):
        results.append(sync_binance(db, client=client))
    if provider in ("twelvedata", "all"):
        results.extend(sync_twelvedata(db, tuple(kinds or TWELVEDATA_KINDS), client=client, pause=pause))
    return results


# ---------------------------------------------------------------- registry loader
def load_synced_specs() -> list[AssetSpec]:
    """Active non-curated rows of the assets table as AssetSpecs (the synced registry loader)."""
    from app.database import SessionLocal

    cols = (
        Asset.symbol,
        Asset.name,
        Asset.asset_class,
        Asset.price_precision,
        Asset.qty_step,
        Asset.min_qty,
        Asset.spread_bps,
        Asset.maker_fee,
        Asset.taker_fee,
        Asset.max_leverage,
        Asset.category,
        Asset.sector,
        Asset.industry,
        Asset.exchange,
        Asset.country,
        Asset.currency,
        Asset.base,
        Asset.aliases,
        Asset.popularity,
        Asset.session,
        Asset.provider_symbols,
        Asset.source,
        Asset.slug,
        Asset.description,
    )
    with SessionLocal() as db:
        rows = db.execute(
            select(*cols)
            .where(Asset.source != "curated", Asset.active.is_(True))
            .order_by(Asset.popularity, Asset.symbol)
        ).all()
    specs: list[AssetSpec] = []
    for r in rows:
        m = r._mapping
        item = {k.key: m[k.key] for k in cols}
        item["min_qty"] = item["min_qty"] or item["qty_step"]
        try:
            specs.append(spec_from_item(item, curated=False, source=str(m["source"] or "synced")))
        except (KeyError, TypeError, ValueError):
            log.warning("Skipping malformed synced asset row %r", m["symbol"])
    return specs


def synced_version() -> int:
    """Id of the newest successful catalog sync (cheap; lets other processes notice a new sync)."""
    from app.database import SessionLocal

    with SessionLocal() as db:
        return int(db.scalar(select(func.max(CatalogSync.id)).where(CatalogSync.status == "ok")) or 0)


def install_db_loader(check_every: float = 300.0) -> None:
    """Load synced instruments lazily from the database (and re-check every `check_every` seconds)."""
    catalog.set_synced_loader(load_synced_specs, version=synced_version, check_every=check_every)


def ensure_db_loader() -> None:
    """install_db_loader() unless a loader is already installed (processes without the FastAPI lifespan,
    e.g. Celery workers: paper-account sync, bots and backtests must resolve synced symbols too)."""
    if catalog.synced_loader() is None:
        install_db_loader()


# ------------------------------------------------------------------------------- CLI
def _parse_kinds(values: Sequence[str] | None) -> tuple[str, ...] | None:
    if not values:
        return None
    out: list[str] = []
    for value in values:
        for part in value.split(","):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return tuple(out) or None


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.market.discovery",
        description="Sync provider instrument lists (read-only reference endpoints) into the catalog.",
    )
    parser.add_argument("--provider", required=True, choices=(*PROVIDERS, "all"))
    parser.add_argument(
        "--kinds",
        nargs="*",
        help=f"Twelve Data kinds, space or comma separated (default: all of {', '.join(TWELVEDATA_KINDS)})",
    )
    parser.add_argument("--pause", type=float, default=1.0, help="seconds between Twelve Data requests")
    args = parser.parse_args(argv)
    kinds = _parse_kinds(args.kinds)
    if kinds:
        bad = [k for k in kinds if k not in TWELVEDATA_KINDS]
        if bad:
            parser.error(f"unknown kinds: {', '.join(bad)}")
        if args.provider == "binance":
            parser.error("--kinds applies to --provider twelvedata (or all)")

    logging.basicConfig(level=logging.INFO)
    from app.database import SessionLocal, init_db
    from app.seed import _check_schema

    if get_settings().auto_create_tables:
        init_db()
    with SessionLocal() as db:
        _check_schema(db)
        results = run_sync(db, args.provider, kinds, pause=args.pause)
    print(json.dumps(results, ensure_ascii=False, indent=1))
    return 0 if all(r["status"] == "ok" for r in results) else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(main())
