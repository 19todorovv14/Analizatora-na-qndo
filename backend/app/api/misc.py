"""Journal, statistics, dashboard, settings and news endpoints. (Replay endpoints live in app.api.replay.)"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import system
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.models import JournalEntry, User
from app.news.providers import get_news
from app.services import settings_service, stats_service

router = APIRouter(tags=["misc"])
# /system/data-sources + /system/ai (S7) — mounted through this router, so app.main needs no change
router.include_router(system.router)

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
    # v2 — only applied when sent (a PUT from an older client keeps the stored values)
    exit_price: float | None = Field(None, gt=0)
    strategy: str | None = Field(None, max_length=100)
    risk_amount: float | None = Field(None, ge=0)
    notes: str | None = Field(None, max_length=5000)


V2_FIELDS = ("exit_price", "strategy", "risk_amount", "notes")


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
    for f in V2_FIELDS:
        if f in body.model_fields_set:
            value = getattr(body, f)
            setattr(e, f, (value.strip() or None) if isinstance(value, str) else value)
    if body.trade_id:
        # auto-fill from the linked paper position (every closed slice): typed values win, result / R come from it
        link = stats_service.linked_position(db, user, body.trade_id)
        if link is not None:
            e.symbol = e.symbol or link["symbol"]
            e.side = e.side or link["side"]
            e.entry = e.entry if e.entry is not None else link["entry"]
            e.stop = e.stop if e.stop is not None else link["stop"]
            e.target = e.target if e.target is not None else link["target"]
            e.exit_price = e.exit_price if e.exit_price is not None else link["exit_price"]
            e.risk_amount = e.risk_amount if e.risk_amount is not None else link["risk_amount"]
            e.strategy = e.strategy or link["strategy"]
            e.result = link["result"]
            e.r_multiple = link["r_multiple"]
            e.timeframe = e.timeframe or link["timeframe"]
            e.setup = e.setup or link["setup"] or ""
    e.updated_ts = int(time.time())
    return e


@router.get("/journal")
def list_journal(
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Newest first. Bounded (W4a): entries can carry ~1.5 MB screenshots, so the list is paged (`total` = all)."""
    where = JournalEntry.user_id == user.id
    rows = db.scalars(select(JournalEntry).where(where).order_by(JournalEntry.id.desc()).offset(offset).limit(limit))
    total = db.scalar(select(func.count()).select_from(JournalEntry).where(where)) or 0
    return {"entries": [stats_service.journal_to_dict(e) for e in rows], "total": total}


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


@router.post("/journal/{entry_id}/ai-review")
def journal_ai_review(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Generate (or regenerate) the AI review of a journal entry; stored in `ai_review`, returns the entry."""
    e = db.get(JournalEntry, entry_id)
    if e is None or e.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    e.ai_review = stats_service.journal_ai_review(db, user, e, now_ts())
    e.updated_ts = int(time.time())
    db.commit()
    return stats_service.journal_to_dict(e)


@router.get("/journal/stats")
def journal_statistics(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.journal_statistics(db, user)


# ------------------------------------------------------------------- stats
@router.get("/stats/report")
def report(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.performance_report(db, user)


@router.get("/stats/performance")
def performance(
    scope: str = Query("manual", pattern="^(manual|bots|all)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """v2 performance report (equity/drawdown curves, breakdowns, monthly returns, R histogram, confidence notes)."""
    return stats_service.performance(db, user, scope)


@router.get("/stats/behavior")
def behavior(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.behavior(db, user)


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.dashboard(db, user, now_ts())


# ----------------------------------------------------------------- settings
@router.get("/settings")
def get_user_settings(user: User = Depends(current_user)):
    return {"settings": settings_service.user_settings(user), "mode": user.mode}


@router.put("/settings")
def put_user_settings(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    allowed = {k: v for k, v in body.items() if k in settings_service.DEFAULTS}
    try:  # types / ranges first (a non-string default_symbol must be a 422, not a 500)
        settings_service.validate_patch(allowed)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
