"""AI teacher API — teacher modes (EXPLAIN / ANALYZE / TEACH ME / REVIEW TRADE / REVIEW STRATEGY /
QUIZ ME / WHY? / COMPARE) and the strategy view checklist.

Owner: work package S4. Registered in app.main under /api (no prefix here: declare full paths such as
"/teacher/ask"). Educational only — no financial advice, no real orders; AI safety rules of app.ai apply.

    GET  /api/teacher/modes            → [{key, label, description, icon, needs, optional, sections, extra_sections, context}]
    POST /api/teacher/ask              → mode output (app.ai.modes) + session_id; stored as AISession kind='teacher'
    POST /api/teacher/strategy-view    → "What would the strategy do?" (app.strategies.view)
    GET  /api/teacher/context          → {symbol, timeframe, context_used, summary} for the "What the teacher knows" chips
    GET  /api/teacher/sessions         → recent teacher answers (history)
"""

from __future__ import annotations

from typing import Literal, get_args

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import context as teacher_context
from app.ai.context import TeacherError, collect, context_summary
from app.ai.modes import MODE_KEYS, MODES, modes_list, render_text, run_mode
from app.ai.providers import get_llm
from app.analysis.signal import analyze
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.backtesting.metrics import json_safe
from app.database import get_db
from app.market.catalog import get_asset
from app.models import AIMessage, AISession, User
from app.services import market_service, settings_service
from app.strategies.view import strategy_view

router = APIRouter(tags=["teacher"])

ModeName = Literal["explain", "analyze", "teach", "review_trade", "review_strategy", "quiz", "why", "compare"]
if set(MODE_KEYS) != set(get_args(ModeName)):  # keep the request schema in sync with the registry
    raise RuntimeError("teacher ModeName is out of sync with app.ai.modes.MODES")
DEFAULT_SYMBOL = "BTC/USDT"
DEFAULT_TIMEFRAME = "1h"


class DraftIn(BaseModel):
    """A draft order from the terminal ("Explain this setup")."""

    side: Literal["long", "short", "buy", "sell"]
    entry: float = Field(gt=0)
    stop: float | None = Field(None, gt=0)
    target: float | None = Field(None, gt=0)
    qty: float | None = Field(None, gt=0)


class AskIn(BaseModel):
    mode: ModeName
    symbol: str | None = None
    timeframe: str | None = None
    indicators: list[str] = Field(default_factory=list, max_length=20)
    strategy_id: int | None = None
    position_id: str | None = Field(None, max_length=32)
    backtest_id: int | None = None
    compare_symbol: str | None = None
    compare_timeframe: str | None = None
    question: str | None = Field(None, max_length=2000)
    topic: str | None = Field(None, max_length=80)
    draft: DraftIn | None = None
    session_id: int | None = None

    @field_validator("indicators")
    @classmethod
    def _short_names(cls, v: list[str]) -> list[str]:
        return [str(x)[:24] for x in v]


class StrategyViewIn(BaseModel):
    symbol: str = DEFAULT_SYMBOL
    timeframe: str = DEFAULT_TIMEFRAME
    strategy_id: int | None = None


def _teacher_error(exc: TeacherError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.detail)


@router.get("/teacher/modes")
def teacher_modes():
    return modes_list()


@router.post("/teacher/ask")
def teacher_ask(body: AskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    md = MODES[body.mode]
    chart_mode = "chart" in md.include
    symbol = body.symbol
    timeframe = body.timeframe
    if symbol is not None:
        symbol_param(symbol)
    if timeframe is not None:
        timeframe = timeframe_param(timeframe)
    position_id = body.position_id
    if body.mode == "review_trade" and not position_id:
        position_id = teacher_context.latest_closed_position_id(db, user)  # None → "no trade yet" answer
    if body.mode == "review_strategy" and symbol is None:
        # review the strategy on its own market by default
        try:
            _, info, _row = teacher_context.resolve_strategy(db, user, body.strategy_id)
        except TeacherError as exc:
            raise _teacher_error(exc) from exc
        if info.get("symbol"):
            try:
                symbol = symbol_param(info["symbol"])
                timeframe = timeframe or timeframe_param(info.get("timeframe") or DEFAULT_TIMEFRAME)
            except HTTPException:
                symbol = None
    if chart_mode and symbol is None and not position_id:
        symbol = DEFAULT_SYMBOL
    compare = None
    if body.mode == "compare":
        if body.compare_symbol:
            symbol_param(body.compare_symbol)
        compare = {
            "symbol": body.compare_symbol,
            "timeframe": timeframe_param(body.compare_timeframe) if body.compare_timeframe else None,
        }
    now = now_ts()
    try:
        bundle = collect(
            db,
            user,
            symbol=symbol,
            timeframe=timeframe,
            indicators=body.indicators,
            strategy_id=body.strategy_id,
            position_id=position_id if body.mode == "review_trade" else None,
            backtest_id=body.backtest_id if body.mode in ("review_strategy", "analyze") else None,
            compare=compare,
            include=md.include,
            now=now,
        )
    except TeacherError as exc:
        raise _teacher_error(exc) from exc
    answer = json_safe(
        run_mode(
            body.mode,
            bundle,
            llm=get_llm(),
            question=body.question,
            draft=body.draft.model_dump() if body.draft else None,
            topic=body.topic,
        )
    )

    sess = db.get(AISession, body.session_id) if body.session_id else None
    if sess is None or sess.user_id != user.id or sess.kind != "teacher":
        sess = AISession(
            user_id=user.id,
            kind="teacher",
            mode=body.mode,
            title=answer["title"][:200],
            context={
                "symbol": answer.get("symbol"),
                "timeframe": answer.get("timeframe"),
                "strategy_id": (answer.get("strategy") or {}).get("id"),
                "position_id": position_id if body.mode == "review_trade" else None,
            },
            provider=answer["provider"],
        )
        db.add(sess)
        db.flush()
    else:
        sess.mode = body.mode
        sess.provider = answer["provider"]
    request_data = body.model_dump(exclude={"session_id"}, exclude_none=True)
    db.add(
        AIMessage(
            session_id=sess.id,
            role="user",
            content=(
                body.question or f"[{md.label}] {answer.get('symbol') or ''} {answer.get('timeframe') or ''}"
            ).strip(),
            data={"mode": body.mode, "request": request_data},
        )
    )
    db.add(
        AIMessage(
            session_id=sess.id,
            role="assistant",
            content=render_text(answer),
            data={"mode": body.mode, "answer": answer},
        )
    )
    db.commit()
    return {**answer, "session_id": sess.id}


@router.post("/teacher/strategy-view")
def teacher_strategy_view(body: StrategyViewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    tf = timeframe_param(body.timeframe)
    try:
        defn, info, _row = teacher_context.resolve_strategy(db, user, body.strategy_id)
    except TeacherError as exc:
        raise _teacher_error(exc) from exc
    now = now_ts()
    # closed candles only; market-data errors propagate → 503 {detail, code, reason} (DATA NOT AVAILABLE)
    rows = market_service.candles(body.symbol, tf, limit=teacher_context.ANALYSIS_BARS, now=now, include_partial=False)
    source = market_service.source_of(body.symbol)
    rules = settings_service.risk_rules(user)
    spec = get_asset(body.symbol)
    analysis = (
        analyze(rows, spec=spec, timeframe=tf, min_rr=rules.min_reward_risk, source=source.get("id") or "demo")
        if len(rows) >= 60
        else None
    )
    view = strategy_view(rows, defn, spec, tf, info=info, analysis=analysis, source=source.get("id"))
    return json_safe({**view, "source": source})


@router.get("/teacher/context")
def teacher_context_endpoint(
    symbol: str = DEFAULT_SYMBOL,
    timeframe: str = DEFAULT_TIMEFRAME,
    strategy_id: int | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    symbol_param(symbol)
    tf = timeframe_param(timeframe)
    try:
        ctx = collect(db, user, symbol=symbol, timeframe=tf, strategy_id=strategy_id, now=now_ts()).context
    except TeacherError as exc:
        raise _teacher_error(exc) from exc
    return {
        "symbol": symbol,
        "timeframe": tf,
        "context_used": ctx["context_used"],
        "summary": context_summary(ctx),
    }


@router.get("/teacher/sessions")
def teacher_sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(AISession)
        .where(AISession.user_id == user.id, AISession.kind == "teacher")
        .order_by(AISession.id.desc())
        .limit(30)
    )
    return {
        "sessions": [
            {
                "id": s.id,
                "mode": s.mode,
                "title": s.title,
                "created_ts": s.created_ts,
                "provider": s.provider,
                "context": s.context or {},
            }
            for s in rows
        ]
    }
