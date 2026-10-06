"""Journal, statistics, dashboard, replay, settings and news endpoints."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.journal.stats import journal_stats
from app.models import JournalEntry, PaperTrade, ReplaySession, User
from app.news.providers import get_news
from app.services import paper_service, replay_service, settings_service, stats_service

router = APIRouter(tags=["misc"])

MAX_SCREENSHOT = 1_500_000  # ~1.5 MB data URL


# ----------------------------------------------------------------- journal
class JournalIn(BaseModel):
    trade_id: str | None = Field(None, max_length=32)
    symbol: str | None = Field(None, max_length=32)
    timeframe: str | None = Field(None, max_length=8)
    side: str | None = Field(None, pattern="^(long|short)$")
    setup: str = Field("", max_length=100)
    reason: str = Field("", max_length=5000)
    entry: float | None = None
    stop: float | None = None
    target: float | None = None
    emotion: str = Field("", max_length=40)
    confidence: int | None = Field(None, ge=1, le=5)
    result: float | None = None
    lesson: str = Field("", max_length=5000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    mistakes: list[str] = Field(default_factory=list, max_length=20)
    screenshot: str | None = None


def _apply_journal(db: Session, user: User, e: JournalEntry, body: JournalIn) -> JournalEntry:
    if body.screenshot is not None:
        if body.screenshot and (not body.screenshot.startswith("data:image/") or len(body.screenshot) > MAX_SCREENSHOT):
            raise HTTPException(status_code=400, detail="Screenshot трябва да е изображение до ~1.5 MB.")
        e.screenshot = body.screenshot or None
    for f in (
        "trade_id",
        "symbol",
        "timeframe",
        "side",
        "setup",
        "reason",
        "entry",
        "stop",
        "target",
        "emotion",
        "confidence",
        "result",
        "lesson",
    ):
        setattr(e, f, getattr(body, f))
    e.tags = [t.strip()[:40] for t in body.tags if t.strip()]
    e.mistakes = [m.strip()[:80] for m in body.mistakes if m.strip()]
    if body.trade_id:
        trade = db.get(PaperTrade, body.trade_id)
        if trade is not None and trade.account_id in stats_service.user_account_ids(
            db, user, ("manual", "replay", "bot")
        ):
            e.symbol = e.symbol or trade.symbol
            e.side = e.side or trade.side
            e.entry = e.entry if e.entry is not None else trade.entry_price
            e.stop = e.stop if e.stop is not None else trade.stop_price
            e.target = e.target if e.target is not None else trade.target_price
            e.result = trade.net_pnl
            e.r_multiple = trade.r_multiple
            e.timeframe = e.timeframe or (trade.meta or {}).get("timeframe")
            e.setup = e.setup or (trade.meta or {}).get("setup") or ""
    e.updated_ts = int(time.time())
    return e


@router.get("/journal")
def list_journal(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(JournalEntry).where(JournalEntry.user_id == user.id).order_by(JournalEntry.id.desc()))
    return {"entries": [stats_service.journal_to_dict(e) for e in rows]}


@router.post("/journal")
def create_journal(body: JournalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = _apply_journal(db, user, JournalEntry(user_id=user.id), body)
    db.add(e)
    db.commit()
    return stats_service.journal_to_dict(e)


@router.put("/journal/{entry_id}")
def update_journal(entry_id: int, body: JournalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if e is None or e.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    _apply_journal(db, user, e, body)
    db.commit()
    return stats_service.journal_to_dict(e)


@router.delete("/journal/{entry_id}")
def delete_journal(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if e is None or e.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(e)
    db.commit()
    return {"ok": True}


@router.get("/journal/stats")
def journal_statistics(user: User = Depends(current_user), db: Session = Depends(get_db)):
    trades = paper_service.closed_trades(db, stats_service.user_account_ids(db, user))
    return journal_stats(stats_service.journal_dicts(db, user), trades, stats_service.behavior(db, user))


# ------------------------------------------------------------------- stats
@router.get("/stats/report")
def report(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.performance_report(db, user)


@router.get("/stats/behavior")
def behavior(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.behavior(db, user)


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.dashboard(db, user, now_ts())


# ------------------------------------------------------------------ replay
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


# ----------------------------------------------------------------- settings
@router.get("/settings")
def get_user_settings(user: User = Depends(current_user)):
    return {"settings": settings_service.user_settings(user), "mode": user.mode}


@router.put("/settings")
def put_user_settings(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    allowed = {k: v for k, v in body.items() if k in settings_service.DEFAULTS}
    if "default_symbol" in allowed:
        symbol_param(allowed["default_symbol"])
    if "default_timeframe" in allowed:
        timeframe_param(allowed["default_timeframe"])
    return {"settings": settings_service.update_settings(db, user, allowed)}


# --------------------------------------------------------------------- news
@router.get("/news")
def news(category: str = "general"):
    if category not in ("general", "forex", "crypto", "merger"):
        raise HTTPException(status_code=400, detail="Unknown category")
    return get_news(category)
