"""Market replay endpoints (/api/replay…).

Owner: work package S5 (replay decisions LONG/SHORT/WAIT, scoring, AI history review) extends this
module. Moved unchanged from app.api.misc — paths and behaviour are identical.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user, symbol_param, timeframe_param
from app.database import get_db
from app.models import ReplaySession, User
from app.services import replay_service

router = APIRouter(tags=["replay"])


class ReplayIn(BaseModel):
    symbol: str
    timeframe: str
    start_ts: int
    bars: int = Field(200, ge=20, le=1000)
    balance: float = Field(10_000, ge=100, le=1_000_000)


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


def _replay(db: Session, user: User, sid: int) -> ReplaySession:
    s = db.get(ReplaySession, sid)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Replay session not found")
    return s


def _rguard(fn, *args):
    try:
        return fn(*args)
    except (replay_service.ReplayError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/replay")
def create_replay(body: ReplayIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    tf = timeframe_param(body.timeframe)
    s = _rguard(replay_service.create_session, db, user, body.symbol, tf, body.start_ts, body.bars, body.balance)
    return replay_service.state(db, s)


@router.get("/replay")
def list_replays(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(ReplaySession).where(ReplaySession.user_id == user.id).order_by(ReplaySession.id.desc()).limit(20)
    )
    return {
        "sessions": [
            {
                "id": s.id,
                "symbol": s.symbol,
                "timeframe": s.timeframe,
                "start_ts": s.start_ts,
                "cursor_ts": s.cursor_ts,
                "status": s.status,
            }
            for s in rows
        ]
    }


@router.get("/replay/{sid}")
def get_replay(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return replay_service.state(db, _replay(db, user, sid))


class StepIn(BaseModel):
    n: int = Field(1, ge=1, le=100)


@router.post("/replay/{sid}/step")
def step(sid: int, body: StepIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _rguard(replay_service.step, db, _replay(db, user, sid), body.n)


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
