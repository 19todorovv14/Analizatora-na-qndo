"""Market-data access for the rest of the app (read-only)."""

from __future__ import annotations

import threading
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.regime import classify
from app.market.base import AssetSpec, Candle, MarketDataError, Ticker
from app.market.catalog import ASSETS, get_asset
from app.market.registry import availability as provider_availability
from app.market.registry import provider_for
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
    asset = get_asset(symbol)
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
        return {"symbol": symbol, "name": asset.name, "asset_class": asset.asset_class, "error": str(exc)}


def availability(symbol: str) -> dict:
    """{available, provider_id, reason, source} for an instrument — cheap, no network."""
    return provider_availability(get_asset(symbol))


def asset_list() -> list[dict]:
    """All curated instruments. An instrument no configured provider supports gets source=None and
    available=False (with the reason) instead of failing the whole list."""
    out = []
    for a in ASSETS:
        av = provider_availability(a)
        out.append(
            {
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
        )
    return out
