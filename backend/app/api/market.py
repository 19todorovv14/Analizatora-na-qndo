from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import indicators as ind
from app.analysis.candles import anatomy, patterns
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.market.timeframes import PUBLIC_TIMEFRAMES
from app.models import User, WatchlistItem
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
def assets():
    return {"assets": market_service.asset_list(), "timeframes": PUBLIC_TIMEFRAMES, "indicators": ind.INDICATOR_CATALOG}


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


@router.get("/watchlist")
def watchlist(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(select(WatchlistItem).where(WatchlistItem.user_id == user.id).order_by(WatchlistItem.position))
    now = now_ts()
    return {"items": [market_service.watch_row(w.symbol, now) for w in items]}


@router.post("/watchlist")
def add_watch(body: WatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    exists = db.scalar(
        select(WatchlistItem).where(WatchlistItem.user_id == user.id, WatchlistItem.symbol == body.symbol)
    )
    if exists is None:
        pos = db.scalar(select(func.max(WatchlistItem.position)).where(WatchlistItem.user_id == user.id)) or 0
        db.add(WatchlistItem(user_id=user.id, symbol=body.symbol, position=pos + 1))
        db.commit()
    return {"ok": True}


@router.delete("/watchlist/{symbol:path}")
def remove_watch(symbol: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id, WatchlistItem.symbol == symbol).delete()
    db.commit()
    return {"ok": True}
