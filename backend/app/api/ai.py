from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.providers import get_llm, provider_status
from app.ai.review import review_position
from app.ai.teacher import chat, decision_panel, explain_analysis
from app.analysis.signal import analyze
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.market.catalog import get_asset
from app.models import AIMessage, AISession, IndicatorSnapshot, PaperPosition, Strategy, User
from app.services import market_service, paper_service, settings_service, stats_service
from app.strategies.rules import StrategyDefinition

router = APIRouter(prefix="/ai", tags=["ai"])


class AnalyzeIn(BaseModel):
    symbol: str = "BTC/USDT"
    timeframe: str = "1h"
    strategy_id: int | None = None
    explain: bool = True


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: int | None = None
    symbol: str | None = None
    timeframe: str | None = None


def run_analysis(db: Session, user: User, symbol: str, timeframe: str, strategy_id: int | None = None) -> dict:
    now = now_ts()
    rows = market_service.candles(symbol, timeframe, limit=400, now=now, include_partial=False)
    t = market_service.ticker(symbol, now=now)
    defn = None
    if strategy_id:
        s = db.get(Strategy, strategy_id)
        if s is None or s.user_id not in (None, user.id):
            raise HTTPException(status_code=404, detail="Стратегията не е намерена.")
        defn = StrategyDefinition(**s.definition)
    settings = settings_service.user_settings(user)
    a = analyze(
        rows,
        spec=get_asset(symbol),
        timeframe=timeframe,
        strategy=defn,
        news_risk=bool(settings.get("news_risk")),
        min_rr=settings_service.risk_rules(user).min_reward_risk,
        price=t.price,
        source=t.source,
    )
    db.add(
        IndicatorSnapshot(
            symbol=symbol,
            timeframe=timeframe,
            ts=a.get("time") or now,
            values={k: v for k, v in (a.get("indicators") or {}).items()},
            source=t.source,
        )
    )
    db.commit()
    return a


def _last_review(db: Session, user: User) -> dict | None:
    ids = stats_service.user_account_ids(db, user)
    trades = paper_service.closed_trades(db, ids)
    if not trades:
        return None
    last = trades[-1]
    found = paper_service.position_detail(db, ids, last["position_id"])
    if not found:
        return None
    pos, pts = found
    return review_position(
        pos,
        pts,
        rules=settings_service.risk_rules(user),
        precision=get_asset(pos["symbol"]).price_precision,
        previous_trades=[t for t in trades if t["closed_ts"] <= pos["opened_ts"]],
    )


@router.get("/status")
def status():
    return provider_status()


@router.post("/analyze")
def analyze_endpoint(body: AnalyzeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    tf = timeframe_param(body.timeframe)
    a = run_analysis(db, user, body.symbol, tf, body.strategy_id)
    out = {"analysis": a, "panel": decision_panel(a)}
    if body.explain:
        out["explanation"] = explain_analysis(a, llm=get_llm(), mode=user.mode)
    sess = AISession(
        user_id=user.id,
        kind="analysis",
        title=f"{body.symbol} {tf}",
        context={"symbol": body.symbol, "timeframe": tf, "decision": a.get("decision")},
        provider=(out.get("explanation") or {}).get("provider", "offline"),
    )
    db.add(sess)
    db.commit()
    return out


@router.post("/chat")
def chat_endpoint(body: ChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sess = db.get(AISession, body.session_id) if body.session_id else None
    if sess is None or sess.user_id != user.id:
        sess = AISession(user_id=user.id, kind="chat", title=body.message[:80], context={})
        db.add(sess)
        db.commit()
    context: dict = {"mode": user.mode}
    if body.symbol:
        symbol_param(body.symbol)
        tf = timeframe_param(body.timeframe or "1h")
        try:
            context["analysis"] = run_analysis(db, user, body.symbol, tf)
        except Exception:  # noqa: BLE001 - chat still works without chart context
            context["analysis"] = None
    context["last_trade_review"] = _last_review(db, user)
    history = [
        {"role": m.role, "content": m.content}
        for m in db.scalars(select(AIMessage).where(AIMessage.session_id == sess.id).order_by(AIMessage.id))
    ]
    res = chat(body.message, context=context, history=history, llm=get_llm())
    db.add(
        AIMessage(
            session_id=sess.id,
            role="user",
            content=body.message,
            data={"symbol": body.symbol, "timeframe": body.timeframe},
        )
    )
    db.add(
        AIMessage(
            session_id=sess.id,
            role="assistant",
            content=res["answer"],
            data={"provider": res["provider"], "safety_removed": res["safety_removed"]},
        )
    )
    sess.provider = res["provider"]
    db.commit()
    return {"session_id": sess.id, **res}


@router.get("/sessions")
def sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(AISession)
        .where(AISession.user_id == user.id, AISession.kind == "chat")
        .order_by(AISession.id.desc())
        .limit(30)
    )
    return {
        "sessions": [{"id": s.id, "title": s.title, "created_ts": s.created_ts, "provider": s.provider} for s in rows]
    }


@router.get("/sessions/{session_id}")
def session(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(AISession, session_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    msgs = db.scalars(select(AIMessage).where(AIMessage.session_id == s.id).order_by(AIMessage.id))
    return {
        "id": s.id,
        "title": s.title,
        "messages": [{"role": m.role, "content": m.content, "ts": m.created_ts} for m in msgs],
    }


@router.get("/coach")
def coach(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.coach(db, user, now_ts())


@router.get("/reviews")
def reviews(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Reviews of the 10 most recently closed positions."""
    ids = stats_service.user_account_ids(db, user)
    trades = paper_service.closed_trades(db, ids)
    out = []
    rules = settings_service.risk_rules(user)
    for pid in list(dict.fromkeys(t["position_id"] for t in reversed(trades)))[:10]:
        row = db.get(PaperPosition, pid)
        if row is None or row.status != "closed":
            continue
        pos, pts = paper_service.position_detail(db, ids, pid)
        out.append(
            review_position(
                pos,
                pts,
                rules=rules,
                precision=get_asset(pos["symbol"]).price_precision,
                previous_trades=[t for t in trades if t["closed_ts"] <= pos["opened_ts"]],
            )
        )
    return {"reviews": out}
