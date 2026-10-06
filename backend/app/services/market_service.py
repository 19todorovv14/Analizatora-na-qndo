"""Market-data access for the rest of the app (read-only)."""

from __future__ import annotations

import threading
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.regime import classify
from app.market.base import AssetSpec, Candle, DataNotAvailableError, MarketDataError, Ticker, slug_for
from app.market.catalog import ASSETS, UnknownAssetError, get_asset
from app.market.registry import availability as provider_availability
from app.market.registry import provider_for
from app.market.sessions import market_status
from app.market.timeframes import tf_seconds
from app.models import Candle as CandleRow
from app.models import MarketData

_regime_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_lock = threading.Lock()


def spec(symbol: str) -> AssetSpec:
    return get_asset(symbol)


def source_of(symbol: str) -> dict:
    return provider_for(get_asset(symbol)).source.to_dict()


def candles(
    symbol: str,
    timeframe: str,
    *,
    start: int | None = None,
    end: int | None = None,
    limit: int = 500,
    now: int | None = None,
    include_partial: bool = True,
    db: Session | None = None,
) -> list[Candle]:
    asset = get_asset(symbol)
    provider = provider_for(asset)
    rows = provider.get_candles(
        asset, timeframe, start=start, end=end, limit=limit, now=now, include_partial=include_partial
    )
    if db is not None and provider.source.is_live and rows:
        _cache_closed(db, symbol, timeframe, rows, provider.source.id, now or int(time.time()))
    return rows


def _cache_closed(db: Session, symbol: str, timeframe: str, rows: list[Candle], source: str, now: int) -> None:
    """Persist closed candles from real providers (audit trail + fewer API calls for replay)."""
    sec = tf_seconds(timeframe)
    closed = [c for c in rows if c.ts + sec <= now]
    if not closed:
        return
    existing = set(
        db.scalars(
            select(CandleRow.ts).where(
                CandleRow.symbol == symbol,
                CandleRow.timeframe == timeframe,
                CandleRow.source == source,
                CandleRow.ts >= closed[0].ts,
                CandleRow.ts <= closed[-1].ts,
            )
        )
    )
    for c in closed:
        if c.ts not in existing:
            db.add(
                CandleRow(
                    symbol=symbol,
                    timeframe=timeframe,
                    ts=c.ts,
                    open=c.open,
                    high=c.high,
                    low=c.low,
                    close=c.close,
                    volume=c.volume,
                    source=source,
                )
            )
    db.commit()


def ticker(symbol: str, *, now: int | None = None, db: Session | None = None) -> Ticker:
    asset = get_asset(symbol)
    provider = provider_for(asset)
    t = provider.get_ticker(asset, now=now)
    if db is not None:
        row = db.scalar(select(MarketData).where(MarketData.symbol == symbol, MarketData.source == t.source))
        if row is None:
            row = MarketData(symbol=symbol, source=t.source, price=t.price)
            db.add(row)
        row.price = t.price
        row.change_24h_pct = t.change_24h_pct
        row.volume_24h = t.volume_24h
        row.updated_ts = int(time.time())
        db.commit()
    return t


def last_closed_1m(symbol: str, now: int) -> Candle | None:
    rows = candles(symbol, "1m", limit=2, now=now, include_partial=False)
    return rows[-1] if rows else None


def regime_snapshot(symbol: str, timeframe: str = "1h", now: int | None = None) -> dict:
    """Regime + simple stats for watchlists (cached for 60 seconds)."""
    key = (symbol, timeframe)
    with _lock:
        hit = _regime_cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    rows = candles(symbol, timeframe, limit=300, now=now, include_partial=False)
    reg = classify(rows) if len(rows) >= 60 else {"regime": "UNCLEAR", "reasons": [], "metrics": {}}
    trend = {"TRENDING_UP": "Up", "TRENDING_DOWN": "Down", "RANGING": "Sideways"}.get(reg["regime"], "Mixed")
    if reg["regime"] in ("HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCLEAR") and len(rows) > 50:
        trend = "Up" if rows[-1].close > rows[-50].close else "Down"
    out = {
        "regime": reg["regime"],
        "trend": trend,
        "volatility_pct": (reg.get("metrics") or {}).get("atr_pct"),
        "reasons": reg.get("reasons", []),
    }
    with _lock:
        _regime_cache[key] = (time.monotonic() + 60, out)
    return out


def watch_row(symbol: str, now: int | None = None) -> dict:
    """One watchlist row. A stale/unknown symbol or unavailable data gives an {error, code} row instead of
    failing the whole watchlist."""
    try:
        asset = get_asset(symbol)
    except UnknownAssetError:
        return {
            "symbol": symbol,
            "name": symbol,
            "asset_class": None,
            "error": f"Непознат инструмент: {symbol} (вече не е в каталога)",
            "code": "UNKNOWN_INSTRUMENT",
        }
    try:
        t = ticker(symbol, now=now)
        snap = regime_snapshot(symbol, "1h", now=now)
        return {
            "symbol": symbol,
            "name": asset.name,
            "asset_class": asset.asset_class,
            "price": t.price,
            "change_24h_pct": t.change_24h_pct,
            "volume_24h": t.volume_24h,
            "volatility_pct": snap["volatility_pct"],
            "trend": snap["trend"],
            "regime": snap["regime"],
            "source": t.source,
            "precision": asset.price_precision,
        }
    except MarketDataError as exc:
        return {
            "symbol": symbol,
            "name": asset.name,
            "asset_class": asset.asset_class,
            "error": str(exc),
            "code": getattr(exc, "code", "MARKET_DATA_ERROR"),
        }


def availability(symbol: str) -> dict:
    """{available, provider_id, reason, source} for an instrument — cheap, no network."""
    return provider_availability(get_asset(symbol))


def asset_row(a: AssetSpec) -> dict:
    """Row of GET /api/market/assets (shape unchanged since V1, plus availability)."""
    av = provider_availability(a)
    return {
        "symbol": a.symbol,
        "name": a.name,
        "asset_class": a.asset_class,
        "price_precision": a.price_precision,
        "qty_step": a.qty_step,
        "min_qty": a.min_qty,
        "spread_bps": a.spread_bps,
        "maker_fee": a.maker_fee,
        "taker_fee": a.taker_fee,
        "max_leverage": a.max_leverage,
        "description": a.description,
        "source": av["source"],
        "available": av["available"],
        "unavailable_reason": av["reason"],
    }


def asset_list(symbol: str | None = None) -> list[dict]:
    """All curated instruments (or just `symbol`, curated or synced). An instrument no configured provider
    supports gets source=None and available=False (with the reason) instead of failing the whole list."""
    if symbol is not None:
        return [asset_row(get_asset(symbol))]
    return [asset_row(a) for a in ASSETS]


# ------------------------------------------------------------------ catalog payloads (V2)
UNKNOWN_INSTRUMENT_REASON = "Инструментът вече не е в каталога."


def asset_summary(spec: AssetSpec, av: dict | None = None) -> dict:
    """Compact instrument description used by search, catalog, favorites, recent and market lists.

    `source` is the DataSource dict of the provider that would serve the instrument (None when no
    configured provider supports it); `catalog_source` says where the instrument definition came from
    (curated | binance | twelvedata). Cheap: no network, no market data.
    """
    av = av if av is not None else provider_availability(spec)
    return {
        "symbol": spec.symbol,
        "slug": spec.slug,
        "name": spec.name,
        "asset_class": spec.asset_class,
        "category": spec.category,
        "sector": spec.sector,
        "exchange": spec.exchange,
        "country": spec.country,
        "currency": spec.currency,
        "base": spec.base,
        "popularity": spec.popularity,
        "curated": spec.curated,
        "catalog_source": spec.source,
        "available": av["available"],
        "unavailable_reason": av["reason"],
        "source": av["source"],
        "price_precision": spec.price_precision,
        "max_leverage": spec.max_leverage,
    }


def unknown_summary(symbol: str) -> dict:
    """asset_summary-shaped row for a stored symbol that is no longer in the catalog (stale favorite …)."""
    return {
        "symbol": symbol,
        "slug": slug_for(symbol),
        "name": symbol,
        "asset_class": None,
        "category": "",
        "sector": "",
        "exchange": "",
        "country": "",
        "currency": None,
        "base": "",
        "popularity": None,
        "curated": False,
        "catalog_source": None,
        "available": False,
        "unavailable_reason": UNKNOWN_INSTRUMENT_REASON,
        "source": None,
        "price_precision": None,
        "max_leverage": None,
        "code": "UNKNOWN_INSTRUMENT",
    }


def summary_for_symbol(symbol: str) -> dict:
    """asset_summary of a stored symbol, or unknown_summary when it left the catalog."""
    try:
        return asset_summary(get_asset(symbol))
    except UnknownAssetError:
        return unknown_summary(symbol)


def instrument_payload(spec: AssetSpec, now: int | None = None) -> dict:
    """asset_summary + trading spec fields + market_status (GET /api/market/instrument/{slug})."""
    av = provider_availability(spec)
    out = asset_summary(spec, av)
    out.update(
        {
            "industry": spec.industry,
            "qty_step": spec.qty_step,
            "min_qty": spec.min_qty,
            "spread_bps": spec.spread_bps,
            "maker_fee": spec.maker_fee,
            "taker_fee": spec.taker_fee,
            "description": spec.description,
            "aliases": list(spec.aliases),
            "provider_symbols": dict(spec.provider_symbols),
            "session": spec.session,
            "demo_capable": spec.demo_capable,
            "market_status": market_status(spec, now, demo=av.get("provider_id") == "demo"),
        }
    )
    if not av["available"]:
        out["code"] = DataNotAvailableError.code
    return out
