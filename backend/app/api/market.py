"""Market data, catalog search and personal instrument lists (READ-ONLY market data, PAPER execution).

Public (no auth — the frontend redirects to /login on 401): assets, candles, ticker, regime,
candle-anatomy, search, catalog, instrument. Auth required: watchlist, favorites, recent.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import indicators as ind
from app.analysis.candles import anatomy, patterns
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.market import search as catalog_search
from app.market.base import AssetSpec
from app.market.catalog import UnknownAssetError, get_asset, resolve_asset
from app.market.timeframes import PUBLIC_TIMEFRAMES
from app.models import FavoriteAsset, RecentAsset, User, WatchlistItem
from app.services import market_service

router = APIRouter(prefix="/market", tags=["market"])


def _parse_indicators(spec: str | None) -> list[tuple[str, dict]]:
    """'ema:20,ema:200,rsi:14,macd,bb:20:2' → [(name, params)]"""
    out: list[tuple[str, dict]] = []
    if not spec:
        return out
    for part in spec.split(","):
        bits = [b for b in part.strip().split(":") if b]
        if not bits:
            continue
        name = bits[0].lower()
        if name not in ind.INDICATOR_CATALOG:
            raise HTTPException(status_code=400, detail=f"Unknown indicator '{name}'")
        keys = list(ind.INDICATOR_CATALOG[name]["params"].keys())
        params = {}
        for k, v in zip(keys, bits[1:], strict=False):
            try:
                params[k] = float(v)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"Bad indicator parameter '{v}'") from exc
        out.append((name, params))
        if len(out) > 12:
            raise HTTPException(status_code=400, detail="Too many indicators")
    return out


@router.get("/assets")
def assets(symbol: str | None = Query(None, description="Return only this instrument (curated or synced)")):
    if symbol is not None:
        symbol_param(symbol)  # 404 for unknown symbols
    return {
        "assets": market_service.asset_list(symbol),
        "timeframes": PUBLIC_TIMEFRAMES,
        "indicators": ind.INDICATOR_CATALOG,
    }


# ------------------------------------------------------------------ search & catalog (public)
RECENT_KEEP = 100  # recently viewed instruments kept per user


def _blank_to_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


@router.get("/search")
def search_assets(
    q: str = Query("", max_length=200),
    limit: int = Query(12, ge=1, le=50),
    asset_class: str | None = None,
    category: str | None = None,
    sector: str | None = None,
    source: str | None = Query(None, description="curated | binance | twelvedata"),
):
    """Instrument search over curated + synced instruments. Empty q → the most popular instruments."""
    total, matches = catalog_search.search_with_total(
        q,
        limit,
        _blank_to_none(asset_class),
        _blank_to_none(category),
        sector=_blank_to_none(sector),
        source=_blank_to_none(source),
    )
    return {
        "query": catalog_search.normalize_query(q),
        "total": total,
        "results": [{**market_service.asset_summary(m.spec), "score": m.score} for m in matches],
    }


@router.get("/catalog")
def catalog(
    asset_class: str | None = None,
    category: str | None = None,
    sector: str | None = None,
    q: str = Query("", max_length=200),
    source: str | None = Query(None, description="curated | binance | twelvedata"),
    sort: Literal["relevance", "popularity", "symbol", "name"] | None = Query(
        None, description="default: relevance with q, popularity without"
    ),
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(50, ge=1, le=200),
):
    """Paginated catalog with disjunctive facets (each facet ignores its own filter) for the Markets explorer."""
    res = catalog_search.browse(
        q=q,
        asset_class=_blank_to_none(asset_class),
        category=_blank_to_none(category),
        sector=_blank_to_none(sector),
        source=_blank_to_none(source),
        sort=sort,
        page=page,
        page_size=page_size,
    )
    total = res["total"]
    return {
        "items": [market_service.asset_summary(spec) for spec in res["items"]],
        "page": res["page"],
        "page_size": res["page_size"],
        "total": total,
        "pages": (total + page_size - 1) // page_size,
        "sort": res["sort"],
        "facets": res["facets"],
    }


@router.get("/instrument/{slug:path}")
def instrument(slug: str):
    """Instrument detail by slug ("BTC-USDT"); symbols and their variants ("BTC/USDT", "btcusdt") work too."""
    try:
        spec = resolve_asset(slug)
    except UnknownAssetError as exc:
        raise HTTPException(status_code=404, detail=f"Непознат инструмент: {slug}") from exc
    return market_service.instrument_payload(spec, now=now_ts())


@router.get("/candles")
def candles(
    symbol: str = Depends(symbol_param),
    timeframe: str = Depends(timeframe_param),
    limit: int = Query(300, ge=10, le=2000),
    end: int | None = None,
    indicators: str | None = None,
    db: Session = Depends(get_db),
):
    now = now_ts()
    rows = market_service.candles(symbol, timeframe, limit=limit, end=end, now=now, db=db)
    times = [c.ts for c in rows]
    out_ind = {}
    for name, params in _parse_indicators(indicators):
        series = ind.compute(name, rows, params)
        key = name + "_" + "_".join(f"{v:g}" for v in params.values()) if params else name
        out_ind[key] = {
            "name": name,
            "params": params,
            "pane": ind.INDICATOR_CATALOG[name]["pane"],
            "series": {
                out: [{"time": t, "value": v} for t, v in zip(times, vals, strict=True) if v is not None]
                for out, vals in series.items()
            },
        }
    spec = market_service.spec(symbol)
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "precision": spec.price_precision,
        "source": market_service.source_of(symbol),
        "execution": "PAPER",
        "candles": [c.to_dict() for c in rows],
        "indicators": out_ind,
        "server_time": now,
    }


@router.get("/ticker")
def ticker(symbol: str = Depends(symbol_param)):
    t = market_service.ticker(symbol, now=now_ts())
    spec = market_service.spec(symbol)
    hs = t.price * spec.spread_bps / 2 / 1e4
    return {
        **t.to_dict(),
        "bid": t.price - hs,
        "ask": t.price + hs,
        "precision": spec.price_precision,
        "source_info": market_service.source_of(symbol),
    }


@router.get("/regime")
def regime(symbol: str = Depends(symbol_param), timeframe: str = Depends(timeframe_param)):
    return market_service.regime_snapshot(symbol, timeframe, now_ts())


@router.get("/candle-anatomy")
def candle_anatomy(o: float, h: float, low: float, c: float):
    """Used by the interactive candle builder in lessons."""
    from app.market.base import Candle

    if not (low <= min(o, c) <= max(o, c) <= h):
        raise HTTPException(status_code=400, detail="Невалидна свещ: трябва Low ≤ Open/Close ≤ High.")
    candle = Candle(0, o, h, low, c, 0)
    return {"anatomy": anatomy(candle), "patterns": patterns(candle)}


class WatchIn(BaseModel):
    symbol: str


class SymbolIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=64)


def _known(symbol: str) -> AssetSpec:
    """Exact symbol first, then lenient (slug / "btcusdt"); 404 for unknown instruments."""
    try:
        return get_asset(symbol)
    except UnknownAssetError:
        pass
    try:
        return resolve_asset(symbol)
    except UnknownAssetError as exc:
        raise HTTPException(status_code=404, detail=f"Непознат инструмент: {symbol}") from exc


# ------------------------------------------------------------------ watchlist (auth; no size cap)
@router.get("/watchlist")
def watchlist(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(WatchlistItem).where(WatchlistItem.user_id == user.id).order_by(WatchlistItem.position, WatchlistItem.id)
    )
    now = now_ts()
    return {"items": [market_service.watch_row(w.symbol, now) for w in items]}


@router.post("/watchlist")
def add_watch(body: WatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol = _known(body.symbol).symbol
    exists = db.scalar(select(WatchlistItem).where(WatchlistItem.user_id == user.id, WatchlistItem.symbol == symbol))
    if exists is None:
        pos = db.scalar(select(func.max(WatchlistItem.position)).where(WatchlistItem.user_id == user.id)) or 0
        db.add(WatchlistItem(user_id=user.id, symbol=symbol, position=pos + 1))
        try:
            db.commit()
        except IntegrityError:  # concurrent add of the same symbol
            db.rollback()
    return {"ok": True}


@router.delete("/watchlist/{symbol:path}")
def remove_watch(symbol: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id, WatchlistItem.symbol == symbol).delete()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ favorites (auth)
@router.get("/favorites")
def favorites(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(FavoriteAsset)
        .where(FavoriteAsset.user_id == user.id)
        .order_by(FavoriteAsset.created_ts.desc(), FavoriteAsset.id.desc())
    )
    return {"items": [{**market_service.summary_for_symbol(r.symbol), "favorited_ts": r.created_ts} for r in rows]}


@router.post("/favorites")
def add_favorite(body: SymbolIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol = _known(body.symbol).symbol
    exists = db.scalar(select(FavoriteAsset.id).where(FavoriteAsset.user_id == user.id, FavoriteAsset.symbol == symbol))
    if exists is None:
        db.add(FavoriteAsset(user_id=user.id, symbol=symbol, created_ts=now_ts()))
        try:
            db.commit()
        except IntegrityError:  # concurrent add of the same symbol — still idempotent
            db.rollback()
    return {"ok": True, "symbol": symbol}


@router.delete("/favorites/{symbol:path}")
def remove_favorite(symbol: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    removed = db.execute(
        delete(FavoriteAsset).where(FavoriteAsset.user_id == user.id, FavoriteAsset.symbol == symbol)
    ).rowcount
    if not removed:  # allow slugs / symbol variants too
        try:
            canonical = resolve_asset(symbol).symbol
        except UnknownAssetError:
            canonical = None
        if canonical and canonical != symbol:
            db.execute(delete(FavoriteAsset).where(FavoriteAsset.user_id == user.id, FavoriteAsset.symbol == canonical))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ recently viewed (auth)
@router.get("/recent")
def recent(
    limit: int = Query(20, ge=1, le=RECENT_KEEP), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    rows = db.scalars(
        select(RecentAsset)
        .where(RecentAsset.user_id == user.id)
        .order_by(RecentAsset.viewed_ts.desc(), RecentAsset.id.desc())
        .limit(limit)
    )
    return {
        "items": [
            {**market_service.summary_for_symbol(r.symbol), "viewed_ts": r.viewed_ts, "views": r.views} for r in rows
        ]
    }


@router.post("/recent")
def add_recent(body: SymbolIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Record a view: upsert viewed_ts, views + 1; only the newest RECENT_KEEP instruments are kept."""
    symbol = _known(body.symbol).symbol
    now = now_ts()
    for attempt in range(2):
        row = db.scalar(select(RecentAsset).where(RecentAsset.user_id == user.id, RecentAsset.symbol == symbol))
        if row is None:
            row = RecentAsset(user_id=user.id, symbol=symbol, viewed_ts=now, views=1)
            db.add(row)
        else:
            row.viewed_ts = now
            row.views = (row.views or 0) + 1
        try:
            db.commit()
            break
        except IntegrityError:  # a concurrent first view inserted the row — update it instead
            db.rollback()
            if attempt:
                raise
    stale = db.scalars(
        select(RecentAsset.id)
        .where(RecentAsset.user_id == user.id)
        .order_by(RecentAsset.viewed_ts.desc(), RecentAsset.id.desc())
        .offset(RECENT_KEEP)
    ).all()
    if stale:
        db.execute(delete(RecentAsset).where(RecentAsset.id.in_(stale)))
        db.commit()
    return {"ok": True, "symbol": symbol, "views": row.views, "viewed_ts": row.viewed_ts}
