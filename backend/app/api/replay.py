"""Market replay endpoints (/api/replay…).

Owner: work package S5 (Historical Replay V2). The original endpoints were moved unchanged from app.api.misc
(same paths and response keys); V2 adds — all additive — session options (mode trade|predict, period presets,
strategy for the comparison), LONG / SHORT / WAIT decisions, live scoring, the AI HISTORY REVIEW at finish,
GET /replay/stats, GET /replay/options and GET /replay/{sid}/review.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import current_user, symbol_param, timeframe_param
from app.database import get_db
from app.models import ReplaySession, User
from app.replay.comparison import StrategyNotFound
from app.services import replay_service

router = APIRouter(tags=["replay"])

PRESET_PATTERN = "^(random|trend|range|high_volatility|breakout)$"


class ReplayIn(BaseModel):
    symbol: str
    timeframe: str
    start_ts: int | None = None  # required unless `preset` is given
    bars: int = Field(200, ge=20, le=1000)
    balance: float = Field(10_000, ge=100, le=1_000_000)
    mode: str = Field("trade", pattern="^(trade|predict)$")
    preset: str | None = Field(None, pattern=PRESET_PATTERN)
    strategy_id: int | None = None
    seed: int | None = Field(None, ge=0, le=1_000_000_000)

    @field_validator("preset", mode="before")
    @classmethod
    def _blank_preset(cls, v):
        return None if v in ("", "none", "custom") else v


class ReplayOrderIn(BaseModel):
    side: str = Field(pattern="^(buy|sell)$")
    type: str = Field("market", pattern="^(market|limit|stop)$")
    qty: float = Field(gt=0)
    price: float | None = Field(None, gt=0)
    stop_loss: float | None = Field(None, gt=0)
    take_profit: float | None = Field(None, gt=0)
    setup: str | None = Field(None, max_length=100)


class ReplayActionIn(BaseModel):
    kind: str = Field(pattern="^(close|modify|cancel)$")
    position_id: str | None = None
    order_id: str | None = None
    qty: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None


class DecisionIn(BaseModel):
    action: str = Field(pattern="^(long|short|wait)$")
    stop: float | None = Field(None, gt=0)
    target: float | None = Field(None, gt=0)
    note: str | None = Field(None, max_length=300)
    place_order: bool = False  # 'trade' mode only: also place a paper market order (fills on the next candle)
    qty: float | None = Field(None, gt=0)  # default: sized by risk_pct to the stop
    risk_pct: float | None = Field(None, gt=0, le=10)  # default: the user's max risk per trade
    preview: bool = False  # validate + flags + planned R:R without recording anything


class StepIn(BaseModel):
    n: int = Field(1, ge=1, le=100)


def _replay(db: Session, user: User, sid: int) -> ReplaySession:
    s = db.get(ReplaySession, sid)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Replay session not found")
    return s


def _rguard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except StrategyNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (replay_service.ReplayError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/replay")
def create_replay(body: ReplayIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    tf = timeframe_param(body.timeframe)
    s = _rguard(
        replay_service.create_session,
        db,
        user,
        body.symbol,
        tf,
        body.start_ts,
        body.bars,
        body.balance,
        mode=body.mode,
        preset=body.preset,
        strategy_id=body.strategy_id,
        seed=body.seed,
    )
    return replay_service.state(db, s)


@router.get("/replay")
def list_replays(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return {"sessions": replay_service.list_sessions(db, user, limit)}


# declared before /replay/{sid} so "stats" / "options" are never parsed as a session id
@router.get("/replay/stats")
def replay_stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return replay_service.stats(db, user)


@router.get("/replay/options")
def replay_options():
    """Static setup metadata (modes, period presets, limits, scoring rules, flags) — no account data."""
    return replay_service.options()


@router.get("/replay/{sid}")
def get_replay(
    sid: int,
    indicators: str | None = Query(None, description="e.g. ema:20,rsi:14,bb — computed without lookahead"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return _rguard(replay_service.state, db, _replay(db, user, sid), indicators=indicators)


@router.post("/replay/{sid}/step")
def step(
    sid: int,
    body: StepIn,
    indicators: str | None = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return _rguard(replay_service.step, db, _replay(db, user, sid), body.n, indicators=indicators)


@router.post("/replay/{sid}/decision")
def replay_decision(
    sid: int,
    body: DecisionIn,
    indicators: str | None = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return _rguard(replay_service.decide, db, user, _replay(db, user, sid), body.model_dump(), indicators=indicators)


@router.post("/replay/{sid}/order")
def replay_order(sid: int, body: ReplayOrderIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _rguard(replay_service.order, db, user, _replay(db, user, sid), body.model_dump())


@router.post("/replay/{sid}/action")
def replay_action(sid: int, body: ReplayActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    payload = body.model_dump(exclude_none=True)
    return _rguard(replay_service.action, db, user, _replay(db, user, sid), payload.pop("kind"), payload)


@router.post("/replay/{sid}/finish")
def replay_finish(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _rguard(replay_service.finish, db, user, _replay(db, user, sid))


@router.get("/replay/{sid}/review")
def replay_review(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = replay_service.stored_review(db, _replay(db, user, sid))
    if out is None:
        raise HTTPException(status_code=404, detail="Review not available yet — finish the replay session first.")
    return out
