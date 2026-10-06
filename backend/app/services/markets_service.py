"""Markets explorer payloads (work package S1): overview, ranked lists, quotes, heatmap, asset page,
watchlist rows with AI status, membership, news / calendar / "what does this event mean?".

Every item of a list is ``asset_summary`` (app.services.market_service) + ``"quote"`` (a snapshot from
app.market.overview). Market data is READ-ONLY and never invented: anything a provider cannot serve is
reported as ``available: false`` with the reason.
"""

from __future__ import annotations

import time
from collections.abc import Iterable
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import UTC, date, datetime, timedelta
from functools import partial

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.providers import get_llm
from app.analysis.signal import analyze
from app.market import marketcap, overview
from app.market.base import AssetSpec, DataNotAvailableError, MarketDataError
from app.market.catalog import ASSET_CLASSES, ASSETS, UnknownAssetError, all_assets, get_asset, resolve_asset
from app.market.overview import ENGINE, Collected
from app.market.registry import class_provider, get_router
from app.models import FavoriteAsset, User, WatchlistItem
from app.news import explain as news_explain
from app.news import providers as news
from app.services import market_service, settings_service

LIST_KINDS = ("gainers", "losers", "most_volume", "high_volatility", "low_volatility", "trending", "popular")
LIST_META: dict[str, dict] = {
    "gainers": {
        "label": "Top gainers",
        "label_bg": "Най-голям ръст (24h)",
        "metric": "change_24h_pct",
        "description": "Инструменти с положителна 24h промяна, подредени от най-голямата.",
    },
    "losers": {
        "label": "Top losers",
        "label_bg": "Най-голям спад (24h)",
        "metric": "change_24h_pct",
        "description": "Инструменти с отрицателна 24h промяна, подредени от най-големия спад.",
    },
    "most_volume": {
        "label": "Most volume",
        "label_bg": "Най-голям обем (24h, USD)",
        "metric": "volume_24h_usd",
        "description": "24h обем в USD (≈ обем в базови единици × цена).",
    },
    "high_volatility": {
        "label": "High volatility",
        "label_bg": "Висока волатилност (24h range)",
        "metric": "range_24h_pct",
        "description": "Най-широк 24h диапазон: (high − low) / low.",
    },
    "low_volatility": {
        "label": "Low volatility",
        "label_bg": "Ниска волатилност (24h range)",
        "metric": "range_24h_pct",
        "description": "Най-тесен 24h диапазон: (high − low) / low.",
    },
    "trending": {
        "label": "Trending",
        "label_bg": "В ясен тренд (7d)",
        "metric": "change_7d_pct",
        "description": "Ясен дневен тренд (EMA 20 спрямо EMA 50), подредени по абсолютната 7d промяна.",
    },
    "popular": {
        "label": "Popular",
        "label_bg": "Популярни",
        "metric": None,
        "description": "Най-следваните инструменти в каталога.",
    },
}

CATEGORY_DEFS: tuple[dict, ...] = (
    {"key": "crypto", "label": "Crypto", "label_bg": "Криптовалути", "filter": {"asset_class": "crypto"}},
    {"key": "stock", "label": "Stocks", "label_bg": "Акции", "filter": {"asset_class": "stock"}},
    {"key": "etf", "label": "ETFs", "label_bg": "ETF фондове", "filter": {"asset_class": "etf"}},
    {"key": "forex", "label": "Forex", "label_bg": "Валути", "filter": {"asset_class": "forex"}},
    {"key": "index", "label": "Indices", "label_bg": "Индекси", "filter": {"asset_class": "index"}},
    {"key": "commodity", "label": "Commodities", "label_bg": "Суровини", "filter": {"asset_class": "commodity"}},
    {
        "key": "metal",
        "label": "Metals",
        "label_bg": "Метали",
        "filter": {"asset_class": "commodity", "category": "metal"},
    },
    {
        "key": "energy",
        "label": "Energy",
        "label_bg": "Енергия",
        "filter": {"asset_class": "commodity", "category": "energy"},
    },
    {
        "key": "agriculture",
        "label": "Agriculture",
        "label_bg": "Селскостопански",
        "filter": {"asset_class": "commodity", "category": "agriculture"},
    },
)
PSEUDO_CLASSES = {"metal": "commodity", "energy": "commodity", "agriculture": "commodity"}
HEATMAP_CLASSES = ("crypto", "stock", "etf")

OVERVIEW_LIST_SIZE = 10
CATEGORY_ITEMS = 8
RELATED_COUNT = 6
MAX_LESSONS = 5
ASSET_PAGE_WAIT = 6.0  # seconds an asset page may wait for on-demand (rate-limited) data
WATCHLIST_WAIT = 2.5
AI_TTL = 300  # AI status cache per symbol (5 minutes)
AI_SYNC_SECONDS = 2.0  # demo AI statuses computed synchronously within this budget, the rest in the background
AI_CANDLES = 400

REASON_PLAN = "The configured provider plan cannot compute this list"
REASON_NO_PROVIDER = "DATA NOT AVAILABLE: no configured provider supports these instruments"
REASON_WARMING = "Пазарните snapshot-и се подготвят (warm-up) — опитай отново след няколко секунди."
REASON_AI_PENDING = "AI статусът се изчислява — ще се появи след малко."

# education links per asset class: preferred slugs first; slugs that do not exist (yet) are skipped
LESSONS_BY_CLASS: dict[str, tuple[str, ...]] = {
    "crypto": ("crypto-24-7", "volatility", "pa-volatility", "liquidation", "position-sizing", "fomo"),
    "forex": ("pips", "trading-sessions", "leverage", "margin", "spread", "position-sizing"),
    "stock": ("earnings", "gaps", "stocks-crypto-forex-indices", "volume-analysis", "support", "fees"),
    "etf": ("etf", "what-is-an-asset", "stocks-crypto-forex-indices", "fees", "trend"),
    "index": ("stocks-crypto-forex-indices", "trend", "market-structure", "leverage", "volatility"),
    "commodity": ("volatility", "trend", "leverage", "stop-loss-placement", "range"),
}

_ai_cache: dict[tuple, tuple[int, dict]] = {}


def reset_caches() -> None:
    """Forget AI statuses (tests)."""
    _ai_cache.clear()


# ------------------------------------------------------------------ helpers
def lookup(token: str) -> AssetSpec | None:
    """Exact symbol first, then lenient (slug, "btcusdt"); None for unknown instruments."""
    token = (token or "").strip()
    if not token:
        return None
    try:
        return get_asset(token)
    except UnknownAssetError:
        pass
    try:
        return resolve_asset(token)
    except UnknownAssetError:
        return None


def resolve_filter(asset_class: str | None, category: str | None) -> tuple[str | None, str | None]:
    """(asset_class, category); 'metal' / 'energy' / 'agriculture' are accepted as asset_class aliases."""
    ac = (asset_class or "").strip().lower() or None
    cat = (category or "").strip().lower() or None
    if ac in PSEUDO_CLASSES:
        cat = cat or ac
        ac = PSEUDO_CLASSES[ac]
    if ac is not None and ac not in ASSET_CLASSES:
        raise ValueError(f"Unknown asset_class '{asset_class}' (expected one of: {', '.join(ASSET_CLASSES)})")
    return ac, cat


def _matches(spec: AssetSpec, ac: str | None, cat: str | None) -> bool:
    return (ac is None or spec.asset_class == ac) and (cat is None or spec.category == cat)


def _universe(ac: str | None, cat: str | None) -> list[AssetSpec]:
    """Curated instruments for universe-wide lists (synced instruments are listed in the catalog browser)."""
    return [s for s in ASSETS if _matches(s, ac, cat)]


def _item(spec: AssetSpec, quote: dict) -> dict:
    return {**market_service.asset_summary(spec), "quote": quote}


def _pages(total: int, page_size: int) -> int:
    return (total + page_size - 1) // page_size if page_size else 0


def _pk(spec: AssetSpec) -> tuple:
    return (spec.popularity, spec.symbol)


def rank(kind: str, items: Iterable[tuple[AssetSpec, dict]]) -> list[tuple[AssetSpec, dict]]:
    """Order snapshots for a list kind (ties: popularity, then symbol). Items without the metric are left out."""
    ok = [(s, q) for s, q in items if q.get("available")]

    def has(field: str):
        return [(s, q) for s, q in ok if q.get(field) is not None]

    if kind == "gainers":
        sel = [(s, q) for s, q in has("change_24h_pct") if q["change_24h_pct"] > 0]
        return sorted(sel, key=lambda it: (-it[1]["change_24h_pct"], *_pk(it[0])))
    if kind == "losers":
        sel = [(s, q) for s, q in has("change_24h_pct") if q["change_24h_pct"] < 0]
        return sorted(sel, key=lambda it: (it[1]["change_24h_pct"], *_pk(it[0])))
    if kind == "most_volume":
        sel = [(s, q) for s, q in has("volume_24h_usd") if q["volume_24h_usd"] > 0]
        return sorted(sel, key=lambda it: (-it[1]["volume_24h_usd"], *_pk(it[0])))
    if kind == "high_volatility":
        return sorted(has("range_24h_pct"), key=lambda it: (-it[1]["range_24h_pct"], *_pk(it[0])))
    if kind == "low_volatility":
        return sorted(has("range_24h_pct"), key=lambda it: (it[1]["range_24h_pct"], *_pk(it[0])))
    if kind == "trending":
        sel = [(s, q) for s, q in has("change_7d_pct") if q.get("trend") in ("up", "down")]
        return sorted(sel, key=lambda it: (-abs(it[1]["change_7d_pct"]), *_pk(it[0])))
    raise ValueError(f"Unknown list kind '{kind}'")


def _coverage(col: Collected) -> dict:
    return {
        "ranked": len(col.items),
        "eligible": col.eligible,
        "unavailable": col.unavailable,
        "rate_limited": col.rate_limited,
        "missing": col.missing,
        "excluded_classes": list(col.rate_limited_classes),
    }


def _ranked_list(kind: str, col: Collected, *, page: int, page_size: int) -> dict:
    """{available, items|reason, total, pages, coverage, note} for a computed list kind."""
    meta = {"kind": kind, **LIST_META[kind], "page": page, "page_size": page_size}
    coverage = _coverage(col)
    notes: list[str] = []
    if col.missing:
        ENGINE.start_warmup()
        notes.append(f"{col.missing} инструмента още се зареждат (warm-up) и не са в класацията.")
    if col.rate_limited_classes:
        notes.append(
            f"{REASON_PLAN} for: {', '.join(col.rate_limited_classes)} (Twelve Data — само on demand на страницата на актива)."
        )
    if not col.items:
        if col.eligible == 0:
            return {
                **meta,
                "available": True,
                "status": "ok",
                "items": [],
                "total": 0,
                "pages": 0,
                "reason": None,
                "code": None,
                "coverage": coverage,
                "note": None,
            }
        if col.missing:
            reason, code, status = REASON_WARMING, "WARMING", "warming"
        elif col.rate_limited:
            reason, code, status = REASON_PLAN, "PLAN_LIMIT", "unavailable"
        else:
            reason, code, status = REASON_NO_PROVIDER, "DATA_NOT_AVAILABLE", "unavailable"
        return {
            **meta,
            "available": False,
            "status": status,
            "items": [],
            "total": 0,
            "pages": 0,
            "reason": reason,
            "code": code,
            "coverage": coverage,
            "note": " ".join(notes) or None,
        }
    ranked = rank(kind, col.items)
    total = len(ranked)
    chunk = ranked[(page - 1) * page_size : page * page_size]
    return {
        **meta,
        "available": True,
        "status": "ok",
        "items": [_item(s, q) for s, q in chunk],
        "total": total,
        "pages": _pages(total, page_size),
        "reason": None,
        "code": None,
        "coverage": coverage,
        "note": " ".join(notes) or None,
    }


def _popular_list(specs: list[AssetSpec], *, page: int, page_size: int, now: int) -> dict:
    ordered = sorted(specs, key=_pk)
    chunk = ordered[(page - 1) * page_size : page * page_size]
    quotes = ENGINE.quotes(chunk, now=now, fetch="cheap")
    return {
        "kind": "popular",
        **LIST_META["popular"],
        "page": page,
        "page_size": page_size,
        "available": True,
        "status": "ok",
        "items": [_item(s, quotes[s.symbol]) for s in chunk],
        "total": len(ordered),
        "pages": _pages(len(ordered), page_size),
        "reason": None,
        "code": None,
        "coverage": None,
        "note": None,
    }


# ------------------------------------------------------------------ overview & lists
def list_payload(
    kind: str,
    *,
    asset_class: str | None = None,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
    now: int | None = None,
) -> dict:
    if kind not in LIST_KINDS:
        raise ValueError(f"Unknown list kind '{kind}'")
    now = ENGINE.now(now)
    ac, cat = resolve_filter(asset_class, category)
    specs = _universe(ac, cat)
    if kind == "popular":
        out = _popular_list(specs, page=page, page_size=page_size, now=now)
    else:
        out = _ranked_list(kind, ENGINE.collect(specs, now=now), page=page, page_size=page_size)
    return {**out, "asset_class": ac, "category": cat, "as_of": now}


def _category_block(cdef: dict, everything: list[AssetSpec], now: int) -> dict:
    ac, cat = cdef["filter"].get("asset_class"), cdef["filter"].get("category")
    members = [s for s in everything if _matches(s, ac, cat)]
    top = sorted(members, key=lambda s: (s.popularity, 0 if s.curated else 1, s.symbol))[:CATEGORY_ITEMS]
    quotes = ENGINE.quotes(top, now=now, fetch="cheap")
    return {
        "key": cdef["key"],
        "label": cdef["label"],
        "label_bg": cdef["label_bg"],
        "filter": dict(cdef["filter"]),
        "count": len(members),
        "items": [_item(s, quotes[s.symbol]) for s in top],
    }


def sources_by_class() -> dict[str, dict]:
    return {cls: class_provider(cls).source.to_dict() for cls in ASSET_CLASSES}


def overview_payload(now: int | None = None) -> dict:
    """Categories (top 8 by popularity), the 7 lists (10 items each) and the data source per asset class."""
    now = ENGINE.now(now)
    col = ENGINE.collect(ASSETS, now=now)
    lists = {
        kind: (
            _popular_list(list(ASSETS), page=1, page_size=OVERVIEW_LIST_SIZE, now=now)
            if kind == "popular"
            else _ranked_list(kind, col, page=1, page_size=OVERVIEW_LIST_SIZE)
        )
        for kind in LIST_KINDS
    }
    everything = all_assets()
    return {
        "as_of": now,
        "categories": [_category_block(c, everything, now) for c in CATEGORY_DEFS],
        "lists": lists,
        "sources": sources_by_class(),
        "provider_chains": get_router().chains(),
        "coverage": _coverage(col),
        "warmup": ENGINE.warmup_status(),
    }


def quotes_payload(tokens: list[str], now: int | None = None) -> dict:
    """{quotes: {requested token: quote}, as_of}. Rate-limited providers are never fetched here (on_demand)."""
    now = ENGINE.now(now)
    resolved: dict[str, AssetSpec] = {}
    out: dict[str, dict] = {}
    for tok in tokens:
        spec = lookup(tok)
        if spec is None:
            out[tok] = overview.unknown_quote(tok, now)
        else:
            resolved[tok] = spec
    unique = list({s.symbol: s for s in resolved.values()}.values())
    quotes = ENGINE.quotes(unique, now=now, fetch="cheap")
    for tok, spec in resolved.items():
        out[tok] = quotes[spec.symbol]
    return {"quotes": {tok: out[tok] for tok in tokens}, "as_of": now}


# ------------------------------------------------------------------ heatmap
def heatmap_payload(asset_class: str, now: int | None = None) -> dict:
    if asset_class not in HEATMAP_CLASSES:
        raise ValueError(f"Heatmap supports asset_class {', '.join(HEATMAP_CLASSES)}")
    now = ENGINE.now(now)
    specs = [s for s in ASSETS if s.asset_class == asset_class]
    deduplicated = False
    if asset_class == "crypto":  # one tile per coin (BTC/USDT, BTC/USD and BTC/EUR are the same market cap)
        seen: set[str] = set()
        keep: list[AssetSpec] = []
        for s in sorted(specs, key=_pk):
            base = (s.base or s.symbol).upper()
            if base not in seen:
                seen.add(base)
                keep.append(s)
        deduplicated = len(keep) != len(specs)
        specs = keep
    col = ENGINE.collect(specs, now=now)
    source = class_provider(asset_class).source.to_dict()
    base = {
        "asset_class": asset_class,
        "as_of": now,
        "source": source,
        "deduplicated_by_base": deduplicated,
        "coverage": _coverage(col),
    }
    if not col.items:
        if col.missing:
            ENGINE.start_warmup()
            reason, code = REASON_WARMING, "WARMING"
        elif col.rate_limited:
            reason, code = REASON_PLAN, "PLAN_LIMIT"
        else:
            reason, code = REASON_NO_PROVIDER, "DATA_NOT_AVAILABLE"
        return {
            **base,
            "available": False,
            "reason": reason,
            "code": code,
            "tiles": [],
            "excluded": [],
            "size_basis": None,
            "note": None,
            "market_cap_source": None,
        }

    caps = marketcap.crypto_market_caps([s.base or s.symbol for s, _ in col.items]) if asset_class == "crypto" else None
    use_caps = bool(caps and caps["available"] and any(v for v in caps["caps"].values()))
    size_basis = "market_cap" if use_caps else "volume"
    tiles: list[dict] = []
    excluded: list[dict] = []
    for spec, q in col.items:
        if not q.get("available"):
            excluded.append({"symbol": spec.symbol, "reason": q.get("reason") or "DATA NOT AVAILABLE"})
            continue
        mcap = caps["caps"].get((spec.base or spec.symbol).upper()) if use_caps and caps else None
        size = mcap if use_caps else q.get("volume_24h_usd")
        if q.get("change_24h_pct") is None:
            excluded.append({"symbol": spec.symbol, "reason": "24h change: DATA NOT AVAILABLE"})
            continue
        if not size:
            what = "Market cap" if use_caps else "24h volume"
            excluded.append({"symbol": spec.symbol, "reason": f"{what}: DATA NOT AVAILABLE"})
            continue
        tiles.append(
            {
                "symbol": spec.symbol,
                "slug": spec.slug,
                "name": spec.name,
                "sector": spec.sector,
                "category": spec.category,
                "group": spec.sector or spec.category or spec.asset_class,
                "change_24h_pct": q["change_24h_pct"],
                "volume_24h_usd": q.get("volume_24h_usd"),
                "market_cap": mcap,
                "size": size,
                "price": q.get("price"),
                "precision": spec.price_precision,
                "source_status": (q.get("source") or {}).get("status"),
            }
        )
    tiles.sort(key=lambda t: (-t["size"], t["symbol"]))
    if asset_class in ("stock", "etf"):
        note = (
            "Market cap: DATA NOT AVAILABLE (provider does not supply it). Размерът на плочките е по 24h volume (USD)."
        )
    elif use_caps:
        note = "Размер = market cap (CoinGecko, обновява се на 15 мин). Цвят = 24h промяна."
    else:
        why = (caps or {}).get("reason") or "MARKET_CAP_PROVIDER=none"
        note = (
            f"Market cap: DATA NOT AVAILABLE ({why}). Размерът на плочките е по 24h volume (USD). "
            "За market cap задай MARKET_CAP_PROVIDER=coingecko."
        )
    if source.get("status") == "demo":
        note += " DEMO: промяната и обемът са синтетични (не са реални пазарни данни)."
    return {
        **base,
        "available": True,
        "reason": None,
        "code": None,
        "tiles": tiles,
        "excluded": excluded,
        "size_basis": size_basis,
        "note": note,
        "market_cap_source": caps.get("source") if caps and use_caps else None,
    }


# ------------------------------------------------------------------ asset page
def lessons_for(spec: AssetSpec) -> list[dict]:
    from app.academy.content import LESSONS_BY_SLUG  # content may grow (S3a); read at call time

    out: list[dict] = []
    for slug in LESSONS_BY_CLASS.get(spec.asset_class, ()):
        lesson = LESSONS_BY_SLUG.get(slug)
        if lesson is None:
            continue
        out.append(
            {
                "slug": slug,
                "title": lesson["title"],
                "module": lesson.get("module"),
                "summary": lesson.get("summary", ""),
                "href": f"/learn/{slug}",
            }
        )
        if len(out) >= MAX_LESSONS:
            break
    return out


def related_for(spec: AssetSpec, now: int, limit: int = RELATED_COUNT) -> list[dict]:
    """Same asset class; same sector first, then same category, then by popularity (other quotes of the same
    coin, e.g. BTC/USD for BTC/USDT, are skipped)."""
    base = (spec.base or "").upper()

    def ok(s: AssetSpec) -> bool:
        if s.symbol == spec.symbol or s.asset_class != spec.asset_class:
            return False
        return not (spec.asset_class == "crypto" and base and (s.base or "").upper() == base)

    def score(s: AssetSpec) -> tuple:
        tier = (
            0 if spec.sector and s.sector == spec.sector else 1 if spec.category and s.category == spec.category else 2
        )
        return (tier, s.popularity, s.symbol)

    pick = sorted((s for s in ASSETS if ok(s)), key=score)[:limit]
    quotes = ENGINE.quotes(pick, now=now, fetch="cheap")
    return [_item(s, quotes[s.symbol]) for s in pick]


def _state(status: str, reason: str | None, code: str | None) -> dict:
    return {"available": False, "status": status, "code": code, "reason": reason}


def _regime_value(res: dict, timeframe: str) -> dict:
    return {"available": True, "status": "ok", "code": None, "reason": None, "timeframe": timeframe, **res}


def _regime_error(exc: Exception) -> dict:
    if isinstance(exc, DataNotAvailableError):
        return _state("unavailable", exc.reason, DataNotAvailableError.code)
    return _state("error", overview.scrub_secrets(exc), "MARKET_DATA_ERROR")


def _wait(fut: Future | None, deadline: float):
    """(done, result, exception) of a background job waited until `deadline` (monotonic)."""
    if fut is None:
        return False, None, None
    try:
        return True, fut.result(timeout=max(0.0, deadline - time.monotonic())), None
    except FutureTimeout:
        return False, None, None
    except Exception as exc:  # noqa: BLE001 - reported to the caller as a state
        return True, None, exc


def asset_payload(spec: AssetSpec, *, user: User | None, db: Session, now: int | None = None) -> dict:
    """Everything the asset page needs. Never 503s: unavailable data is reported per block."""
    now = ENGINE.now(now)
    deadline = time.monotonic() + ASSET_PAGE_WAIT
    instrument = market_service.instrument_payload(spec, now=now)
    r = overview.route(spec)
    live = r.kind is not None and r.kind != overview.KIND_DIRECT

    # live providers: start the slow parts in the background first so they run in parallel
    regime_fut = None
    if live:
        regime_fut = ENGINE.background.submit(
            ("regime", spec.symbol, "1h", r.key), partial(market_service.regime_snapshot, spec.symbol, "1h", now)
        )
    news_fut = None
    if news.is_configured():
        news_fut = ENGINE.background.submit(
            ("news", spec.symbol), partial(news.news_feed, symbol=spec.symbol, asset_class=spec.asset_class, now=now)
        )

    entry = ENGINE.entry(spec, now=now, fetch="on_demand", wait=ASSET_PAGE_WAIT, r=r)
    quote = entry.quote

    # regime 1h (market_service.regime_snapshot) and 1d (same closed daily candles as the quote)
    if r.kind is None:
        regime_1h = _state("unavailable", r.reason, r.code)
    elif not live:
        try:
            regime_1h = _regime_value(market_service.regime_snapshot(spec.symbol, "1h", now), "1h")
        except MarketDataError as exc:
            regime_1h = _regime_error(exc)
    else:
        done, res, exc = _wait(regime_fut, deadline)
        if exc is not None:
            regime_1h = _regime_error(exc)
        elif done:
            regime_1h = _regime_value(res, "1h")
        else:
            regime_1h = _state("pending", overview.REASON_PENDING, "PENDING")
    reg1d = entry.extra.get("regime_1d") if quote.get("available") else None
    if reg1d:
        regime_1d = _regime_value(reg1d, "1d")
    elif quote.get("status") in (overview.STATUS_OK, overview.STATUS_PENDING, overview.STATUS_ON_DEMAND):
        regime_1d = _state("pending", overview.REASON_PENDING, "PENDING")
    else:
        regime_1d = _state(quote.get("status") or "unavailable", quote.get("reason"), quote.get("code"))

    if news_fut is None:
        news_block = news.news_feed(symbol=spec.symbol, asset_class=spec.asset_class, now=now)  # not configured
    else:
        done, res, exc = _wait(news_fut, deadline)
        if exc is not None:
            news_block = {
                "available": False,
                "status": "error",
                "code": "NEWS_PROVIDER_ERROR",
                "reason": overview.scrub_secrets(exc),
                "items": [],
            }
        elif done:
            news_block = res
        else:
            news_block = {
                "available": False,
                "status": "pending",
                "code": "PENDING",
                "reason": "Новините се зареждат — опитай отново след малко.",
                "items": [],
            }
    news_block = {**news_block, "items": list(news_block.get("items") or [])[:10]}

    is_favorite = in_watchlist = None
    if user is not None:
        is_favorite = (
            db.scalar(
                select(FavoriteAsset.id).where(FavoriteAsset.user_id == user.id, FavoriteAsset.symbol == spec.symbol)
            )
            is not None
        )
        in_watchlist = (
            db.scalar(
                select(WatchlistItem.id).where(WatchlistItem.user_id == user.id, WatchlistItem.symbol == spec.symbol)
            )
            is not None
        )
    return {
        "symbol": spec.symbol,
        "slug": spec.slug,
        "available": instrument["available"],
        "code": instrument.get("code"),
        "reason": instrument.get("unavailable_reason"),
        "instrument": instrument,
        "quote": quote,
        "market_status": instrument["market_status"],
        "regime": {"1h": regime_1h, "1d": regime_1d},
        "volatility": {
            "atr_pct_1d": quote.get("atr_pct_1d"),
            "range_24h_pct": quote.get("range_24h_pct"),
            "atr_pct_1h": regime_1h.get("volatility_pct") if regime_1h.get("available") else None,
        },
        "related": related_for(spec, now),
        "lessons": lessons_for(spec),
        "news": news_block,
        "is_favorite": is_favorite,
        "in_watchlist": in_watchlist,
        "authenticated": user is not None,
        "as_of": now,
    }


# ------------------------------------------------------------------ watchlist (auth)
def _ai_reason(a: dict) -> str:
    signal = a.get("signal")
    if signal in ("LONG SETUP", "SHORT SETUP"):
        setup = a.get("setup") or {}
        rr = setup.get("reward_risk")
        return f"{setup.get('name') or signal}" + (f" · R:R {rr:.2f}" if rr is not None else "")
    reasons = a.get("no_trade_reasons") or []
    if signal == "NO TRADE" and reasons:
        return f"{reasons[0]['title']}: {reasons[0]['text']}"
    return a.get("wait_reason") or (a.get("hypothesis") or [""])[0] or a.get("conclusion") or ""


def compute_ai_status(
    spec: AssetSpec, *, now: int, min_rr: float = 1.5, news_risk: bool = False, price: float | None = None
) -> dict:
    """AI status of the watchlist: app.analysis.signal.analyze on closed 1h candles (as /api/ai/analyze does)."""
    try:
        rows = market_service.candles(spec.symbol, "1h", limit=AI_CANDLES, now=now, include_partial=False)
        source = market_service.source_of(spec.symbol)["id"]
        a = analyze(rows, spec=spec, timeframe="1h", min_rr=min_rr, news_risk=news_risk, price=price, source=source)
    except DataNotAvailableError as exc:
        return {
            "ai_status": None,
            "ai_reason": f"DATA NOT AVAILABLE: {exc.reason}",
            "ai_confidence": None,
            "ai_as_of": now,
        }
    except MarketDataError as exc:
        return {
            "ai_status": None,
            "ai_reason": f"Market data error: {overview.scrub_secrets(exc)}",
            "ai_confidence": None,
            "ai_as_of": now,
        }
    return {"ai_status": a["signal"], "ai_reason": _ai_reason(a), "ai_confidence": a.get("confidence"), "ai_as_of": now}


def _ai_job(key: tuple, spec: AssetSpec, now: int, min_rr: float, news_risk: bool, price: float | None) -> dict:
    res = compute_ai_status(spec, now=now, min_rr=min_rr, news_risk=news_risk, price=price)
    _ai_cache[key] = (now, res)
    return res


def ai_statuses(rows: list[tuple[AssetSpec, dict]], *, user: User, now: int) -> dict[str, dict]:
    """AI status per symbol for one watchlist page (cached 5 min). Demo instruments are computed synchronously
    within a small time budget; live ones in the background (rows not ready yet → ai_pending)."""
    rules = settings_service.risk_rules(user)
    news_risk = bool(settings_service.user_settings(user).get("news_risk"))
    min_rr = float(rules.min_reward_risk)
    sync_deadline = time.monotonic() + AI_SYNC_SECONDS
    out: dict[str, dict] = {}
    waiting: dict[str, Future] = {}
    for spec, quote in rows:
        r = overview.route(spec)
        if r.kind is None:
            out[spec.symbol] = {"ai_status": None, "ai_reason": f"DATA NOT AVAILABLE: {r.reason}", "ai_pending": False}
            continue
        key = (spec.symbol, r.key, min_rr, news_risk)
        hit = _ai_cache.get(key)
        if hit is not None and 0 <= now - hit[0] < AI_TTL:
            out[spec.symbol] = {**hit[1], "ai_pending": False}
            continue
        price = quote.get("price") if quote.get("available") else None
        job = partial(_ai_job, key, spec, now, min_rr, news_risk, price)
        if r.kind == overview.KIND_DIRECT and time.monotonic() < sync_deadline:
            out[spec.symbol] = {**job(), "ai_pending": False}
            continue
        fut = ENGINE.background.submit(("ai",) + key, job)
        if fut is None:
            out[spec.symbol] = {"ai_status": None, "ai_reason": REASON_AI_PENDING, "ai_pending": True}
        else:
            waiting[spec.symbol] = fut
    deadline = time.monotonic() + WATCHLIST_WAIT
    for symbol, fut in waiting.items():
        done, res, exc = _wait(fut, deadline)
        if done and exc is None:
            out[symbol] = {**res, "ai_pending": False}
        elif exc is not None:
            out[symbol] = {"ai_status": None, "ai_reason": overview.scrub_secrets(exc), "ai_pending": False}
        else:
            out[symbol] = {"ai_status": None, "ai_reason": REASON_AI_PENDING, "ai_pending": True}
    return out


def watchlist_payload(user: User, db: Session, *, page: int = 1, page_size: int = 100, now: int | None = None) -> dict:
    """Paginated watchlist rows ordered by position: asset_summary + quote + ai_status / ai_reason."""
    now = ENGINE.now(now)
    items = list(
        db.scalars(
            select(WatchlistItem)
            .where(WatchlistItem.user_id == user.id)
            .order_by(WatchlistItem.position, WatchlistItem.id)
        )
    )
    total = len(items)
    chunk = items[(page - 1) * page_size : page * page_size]
    specs: dict[str, AssetSpec] = {}
    for w in chunk:
        try:
            specs[w.symbol] = get_asset(w.symbol)
        except UnknownAssetError:
            continue
    quotes = ENGINE.quotes(list(specs.values()), now=now, fetch="on_demand", wait_total=WATCHLIST_WAIT)
    ai = ai_statuses([(s, quotes[s.symbol]) for s in specs.values()], user=user, now=now)
    rows = []
    for w in chunk:
        spec = specs.get(w.symbol)
        if spec is None:
            rows.append(
                {
                    **market_service.unknown_summary(w.symbol),
                    "position": w.position,
                    "quote": overview.unknown_quote(w.symbol, now),
                    "ai_status": None,
                    "ai_reason": None,
                    "ai_confidence": None,
                    "ai_pending": False,
                    "ai_as_of": None,
                }
            )
            continue
        status = ai[spec.symbol]
        rows.append(
            {
                **market_service.asset_summary(spec),
                "position": w.position,
                "quote": quotes[spec.symbol],
                "ai_status": status.get("ai_status"),
                "ai_reason": status.get("ai_reason"),
                "ai_confidence": status.get("ai_confidence"),
                "ai_pending": status.get("ai_pending", False),
                "ai_as_of": status.get("ai_as_of"),
            }
        )
    return {
        "items": rows,
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": _pages(total, page_size),
        "as_of": now,
    }


def membership_payload(user: User, db: Session) -> dict:
    """Cheap membership lists for Favorite / Watchlist buttons: {watchlist:[symbols by position], favorites:[…]}."""
    watch = db.scalars(
        select(WatchlistItem.symbol)
        .where(WatchlistItem.user_id == user.id)
        .order_by(WatchlistItem.position, WatchlistItem.id)
    ).all()
    favs = db.scalars(
        select(FavoriteAsset.symbol)
        .where(FavoriteAsset.user_id == user.id)
        .order_by(FavoriteAsset.created_ts.desc(), FavoriteAsset.id.desc())
    ).all()
    return {"watchlist": list(watch), "favorites": list(favs)}


# ------------------------------------------------------------------ news, calendar, explain
def news_payload(spec: AssetSpec | None, category: str | None, now: int | None = None) -> dict:
    now = ENGINE.now(now)
    if spec is None:
        return news.news_feed(category=category or "general", now=now)
    return news.news_feed(symbol=spec.symbol, asset_class=spec.asset_class, category=category, now=now)


def _catalog_lookup(symbol: str) -> tuple[str, str] | None:
    try:
        spec = get_asset(symbol)
    except UnknownAssetError:
        return None
    if spec.asset_class not in ("stock", "etf"):
        return None
    return spec.slug, spec.name


def calendar_payload(start: date | None, end: date | None, now: int | None = None) -> dict:
    now = ENGINE.now(now)
    first = start or datetime.fromtimestamp(now, UTC).date()
    last = end or first + timedelta(days=7)
    if last < first:
        raise ValueError("'to' must not be before 'from'")
    if (last - first).days > 31:
        raise ValueError("The calendar range is limited to 31 days")
    return news.calendar(start=first.isoformat(), end=last.isoformat(), now=now, catalog_lookup=_catalog_lookup)


def explain_payload(headline: str, summary: str | None, symbol: str | None) -> dict:
    spec = lookup(symbol) if symbol else None
    return news_explain.explain_event(headline, summary, spec, llm=get_llm())
