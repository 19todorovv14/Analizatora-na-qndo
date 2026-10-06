"""Learning API — learning path (LEVEL 0–10), learning dashboard, interactive candle drill-down; interactive labs
(candlesticks, market structure) and the leverage lab are appended below by work package S3b.

Owner: work package S3 (S3a: path/dashboard/drill-down routes at the top; S3b: lab routes below the marker).
Registered in app.main under /api (no prefix here: declare full paths such as "/learn/path"). Educational only —
every simulation is paper/virtual.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.models import User
from app.services import learning_service

router = APIRouter(tags=["learn"])


# ------------------------------------------------------------------------------- S3a: path & dashboard
@router.get("/learn/path")
def learning_path(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """LEVEL 0–10 learning path: per-level status, percent, lessons, quiz, labs, current level and next step."""
    return learning_service.learning_path(db, user)


@router.get("/learn/dashboard")
def learning_dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Learning dashboard: level, XP, quizzes, replay, paper trades, risk discipline, mistakes, skills, advice."""
    return learning_service.learning_dashboard(db, user)


@router.get("/learn/candle-drilldown")
def candle_drilldown(
    symbol: str = Depends(symbol_param),
    timeframe: str = Depends(timeframe_param),
    time: int | None = Query(None, ge=0, description="Any epoch second inside the candle; default = last closed"),
):
    """What happened inside one candle: its lower-timeframe candles (1h → 5m, 1d → 1h …) plus an explanation.
    Public (market data + maths only), like /api/market/candle-anatomy."""
    try:
        return learning_service.candle_drilldown(symbol, timeframe, time, now_ts())
    except learning_service.DrilldownError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ------------------------------------------------------------------------ S3b: lab routes go below here
