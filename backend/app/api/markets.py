"""Markets explorer API — market overview, lists (gainers/losers/volume/volatility/trending/popular), quotes,
heatmap, asset page, watchlist rows with AI status, news, events calendar and "what does this event mean?".

Owner: work package S1. Registered in app.main under /api (no prefix here: full paths such as
"/markets/overview"). Market data is READ-ONLY; when no provider can serve an instrument the payload says
``available: false`` with the reason (DATA_NOT_AVAILABLE) — never invented numbers. Demo data stays labelled
DEMO through the DataSource dict in every quote.

Public: overview, list, quotes, heatmap, asset/{slug} (optional auth), news, calendar.
Auth: watchlist, membership, news/explain.

The router's lifespan starts the quote-snapshot warm-up thread (app.market.overview, setting MARKET_WARMUP;
FastAPI merges router lifespans into the app's).
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import current_user, now_ts, optional_user
from app.database import get_db
from app.market import overview
from app.models import User
from app.services import markets_service


async def _lifespan(_app):
    overview.start_warmup()  # no-op when MARKET_WARMUP=false or APP_ENV=test
    try:
        yield
    finally:
        overview.stop_warmup()


router = APIRouter(tags=["markets"], lifespan=_lifespan)

ListKind = Literal["gainers", "losers", "most_volume", "high_volatility", "low_volatility", "trending", "popular"]
MAX_QUOTES = 100


def _spec_or_404(token: str):
    spec = markets_service.lookup(token)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"Непознат инструмент: {token}")
    return spec


@router.get("/markets/overview")
def markets_overview():
    """Categories (top 8 by popularity each), 7 lists (10 items each) and the data source per asset class."""
    return markets_service.overview_payload(now=now_ts())


@router.get("/markets/list")
def markets_list(
    kind: ListKind = Query(
        ..., description="gainers | losers | most_volume | high_volatility | low_volatility | trending | popular"
    ),
    asset_class: str | None = Query(
        None, description="crypto | stock | etf | forex | index | commodity (or metal | energy | agriculture)"
    ),
    category: str | None = None,
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100),
):
    try:
        return markets_service.list_payload(
            kind, asset_class=asset_class, category=category, page=page, page_size=page_size, now=now_ts()
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/markets/quotes")
def markets_quotes(symbols: str = Query("", max_length=8000, description="Comma separated symbols or slugs (≤ 100)")):
    tokens: list[str] = []
    for part in symbols.split(","):
        tok = part.strip()
        if tok and tok not in tokens:
            tokens.append(tok)
    if len(tokens) > MAX_QUOTES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_QUOTES} symbols per request")
    return markets_service.quotes_payload(tokens, now=now_ts())


@router.get("/markets/heatmap")
def markets_heatmap(asset_class: Literal["crypto", "stock", "etf"] = "crypto"):
    return markets_service.heatmap_payload(asset_class, now=now_ts())


@router.get("/markets/asset/{slug:path}")
def markets_asset(slug: str, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    """Asset page payload. Public; is_favorite / in_watchlist are filled only for a logged-in user (null otherwise)."""
    return markets_service.asset_payload(_spec_or_404(slug), user=user, db=db, now=now_ts())


@router.get("/markets/watchlist")
def markets_watchlist(
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(100, ge=1, le=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return markets_service.watchlist_payload(user, db, page=page, page_size=page_size, now=now_ts())


@router.get("/markets/membership")
def markets_membership(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Symbols in the user's watchlist and favorites (cheap; for Watchlist / Favorite buttons)."""
    return markets_service.membership_payload(user, db)


@router.get("/markets/news")
def markets_news(
    symbol: str | None = Query(None, max_length=64),
    category: Literal["general", "forex", "crypto", "merger"] | None = None,
):
    spec = _spec_or_404(symbol) if symbol else None
    return markets_service.news_payload(spec, category, now=now_ts())


@router.get("/markets/calendar")
def markets_calendar(
    start: date | None = Query(None, alias="from", description="YYYY-MM-DD (default today, UTC)"),
    end: date | None = Query(None, alias="to", description="YYYY-MM-DD (default from + 7 days, max 31 days)"),
):
    try:
        return markets_service.calendar_payload(start, end, now=now_ts())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ExplainIn(BaseModel):
    headline: str = Field(min_length=1, max_length=500)
    summary: str | None = Field(None, max_length=4000)
    symbol: str | None = Field(None, max_length=64)


@router.post("/markets/news/explain")
def markets_news_explain(body: ExplainIn, user: User = Depends(current_user)):
    """Educational "What does this event mean?" — never a price prediction (passes the AI safety filter)."""
    return markets_service.explain_payload(body.headline, body.summary, body.symbol)
