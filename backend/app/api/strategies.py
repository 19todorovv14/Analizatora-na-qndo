from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import indicators as ind
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.config import get_settings
from app.database import SessionLocal, get_db
from app.models import Backtest, Bot, Strategy, User
from app.services import backtest_service, bot_service, market_service, user_service
from app.strategies.rules import OPS, PRICE_FIELDS, IndicatorCache, StrategyDefinition, describe, evaluate
from app.strategies.templates import TEMPLATES

router = APIRouter(tags=["strategies"])


# ------------------------------------------------------------- strategies
class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    symbol: str = "BTC/USDT"
    timeframe: str = "1h"
    definition: dict


def _strategy_out(s: Strategy) -> dict:
    try:
        desc = describe(StrategyDefinition(**s.definition))
    except (ValidationError, ValueError):
        desc = []
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "is_template": s.is_template,
        "symbol": s.symbol,
        "timeframe": s.timeframe,
        "definition": s.definition,
        "summary": desc,
        "rules_count": len(s.rules),
        "updated_ts": s.updated_ts,
    }


def _get_strategy(db: Session, user: User, strategy_id: int, *, writable: bool = False) -> Strategy:
    s = db.get(Strategy, strategy_id)
    if s is None or (s.user_id is not None and s.user_id != user.id):
        raise HTTPException(status_code=404, detail="Стратегията не е намерена.")
    if writable and s.user_id != user.id:
        raise HTTPException(status_code=403, detail="Шаблоните не могат да се редактират — направи копие.")
    return s


@router.get("/strategies/meta")
def meta():
    return {
        "indicators": ind.INDICATOR_CATALOG,
        "operators": OPS,
        "price_fields": PRICE_FIELDS,
        "templates": [{"key": t["key"], "name": t["name"], "description": t["description"]} for t in TEMPLATES],
    }


@router.get("/strategies")
def list_strategies(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Strategy)
        .where(or_(Strategy.user_id == user.id, Strategy.is_template.is_(True)))
        .order_by(Strategy.is_template, Strategy.id.desc())
    )
    return {"strategies": [_strategy_out(s) for s in rows]}


@router.post("/strategies")
def create_strategy(body: StrategyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    timeframe_param(body.timeframe)
    try:
        s = user_service.save_strategy(
            db,
            user,
            name=body.name,
            description=body.description,
            symbol=body.symbol,
            timeframe=body.timeframe,
            definition=body.definition,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=_validation_message(exc)) from exc
    return _strategy_out(s)


@router.get("/strategies/{strategy_id}")
def get_strategy(strategy_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _strategy_out(_get_strategy(db, user, strategy_id))


@router.put("/strategies/{strategy_id}")
def update_strategy(
    strategy_id: int, body: StrategyIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    s = _get_strategy(db, user, strategy_id, writable=True)
    symbol_param(body.symbol)
    timeframe_param(body.timeframe)
    try:
        s = user_service.save_strategy(
            db,
            user,
            name=body.name,
            description=body.description,
            symbol=body.symbol,
            timeframe=body.timeframe,
            definition=body.definition,
            strategy=s,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=_validation_message(exc)) from exc
    return _strategy_out(s)


@router.delete("/strategies/{strategy_id}")
def delete_strategy(strategy_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _get_strategy(db, user, strategy_id, writable=True)
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/strategies/{strategy_id}/copy")
def copy_strategy(strategy_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _get_strategy(db, user, strategy_id)
    new = user_service.save_strategy(
        db,
        user,
        name=f"{s.name} (копие)",
        description=s.description,
        symbol=s.symbol,
        timeframe=s.timeframe,
        definition=s.definition,
    )
    return _strategy_out(new)


@router.get("/strategies/{strategy_id}/signal")
def strategy_signal(
    strategy_id: int, symbol: str, timeframe: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Evaluate the strategy on the latest closed candle — shows which conditions pass."""
    s = _get_strategy(db, user, strategy_id)
    symbol_param(symbol)
    tf = timeframe_param(timeframe)
    rows = market_service.candles(symbol, tf, limit=400, now=now_ts(), include_partial=False)
    ev = evaluate(StrategyDefinition(**s.definition), IndicatorCache(rows), len(rows) - 1)
    signal = (
        "LONG SETUP"
        if ev["entry_long"]["passed"] and not ev["entry_short"]["passed"]
        else "SHORT SETUP"
        if ev["entry_short"]["passed"] and not ev["entry_long"]["passed"]
        else "NO TRADE"
    )
    return {"signal": signal, "evaluation": ev, "time": rows[-1].ts if rows else None}


def _validation_message(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:5])


# --------------------------------------------------------------- backtests
class BacktestIn(BaseModel):
    strategy_id: int
    symbol: str
    timeframe: str
    start_ts: int
    end_ts: int
    initial_balance: float = Field(10_000, ge=100, le=10_000_000)
    risk_per_trade_pct: float | None = Field(None, gt=0, le=100)
    fees_enabled: bool = True
    fee_bps: float | None = Field(None, ge=0, le=100)
    slippage_bps: float = Field(1.0, ge=0, le=200)
    spread_enabled: bool = True
    allow_short: bool = True
    leverage: float | None = Field(None, ge=1, le=30)
    intrabar_policy: str = Field("worst_case", pattern="^(worst_case|path)$")


def _run_inline(backtest_id: int) -> None:
    with SessionLocal() as db:
        backtest_service.execute(db, backtest_id)


@router.post("/backtests")
def create_backtest(
    body: BacktestIn, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    s = _get_strategy(db, user, body.strategy_id)
    symbol_param(body.symbol)
    tf = timeframe_param(body.timeframe)
    now = now_ts()
    if body.end_ts <= body.start_ts:
        raise HTTPException(status_code=400, detail="Крайната дата трябва да е след началната.")
    settings = body.model_dump(exclude={"strategy_id", "symbol", "timeframe", "start_ts", "end_ts"})
    bt = Backtest(
        user_id=user.id,
        strategy_id=s.id,
        strategy_name=s.name,
        strategy_snapshot=s.definition,
        symbol=body.symbol,
        timeframe=tf,
        start_ts=body.start_ts,
        end_ts=min(body.end_ts, now),
        settings=settings,
        status="pending",
    )
    db.add(bt)
    db.commit()
    if get_settings().use_celery:
        from app.workers.tasks import run_backtest_task

        run_backtest_task.delay(bt.id)
    else:
        background.add_task(_run_inline, bt.id)
    return backtest_service.to_dict(bt)


@router.get("/backtests")
def list_backtests(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Backtest).where(Backtest.user_id == user.id).order_by(Backtest.id.desc()).limit(50))
    return {"backtests": [backtest_service.to_dict(b) for b in rows]}


@router.get("/backtests/{backtest_id}")
def get_backtest(backtest_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bt = db.get(Backtest, backtest_id)
    if bt is None or bt.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    return backtest_service.to_dict(bt, with_trades=True, db=db)


@router.delete("/backtests/{backtest_id}")
def delete_backtest(backtest_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bt = db.get(Backtest, backtest_id)
    if bt is None or bt.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(bt)
    db.commit()
    return {"ok": True}


# -------------------------------------------------------------------- bots
class BotIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    symbol: str
    timeframe: str
    strategy_id: int
    run_mode: str = Field("forward", pattern="^(forward|warm_start)$")
    stop: dict | None = None
    take_profit: dict | None = None
    config: dict = Field(default_factory=dict)


def _bot(db: Session, user: User, bot_id: int) -> Bot:
    bot = db.get(Bot, bot_id)
    if bot is None or bot.user_id != user.id:
        raise HTTPException(status_code=404, detail="Ботът не е намерен.")
    return bot


@router.get("/bots")
def list_bots(user: User = Depends(current_user), db: Session = Depends(get_db)):
    now = now_ts()
    out = []
    for b in db.scalars(select(Bot).where(Bot.user_id == user.id).order_by(Bot.id.desc())):
        bot_service.run_bot(db, b, now)
        v = bot_service.bot_view(db, b, now)
        out.append(
            {
                k: v[k]
                for k in (
                    "id",
                    "name",
                    "symbol",
                    "timeframe",
                    "status",
                    "pause_reason",
                    "equity",
                    "pnl",
                    "drawdown_pct",
                    "regime",
                    "last_signal",
                    "run_mode",
                )
            }
            | {"trades": v["metrics"]["total_trades"], "win_rate": v["metrics"]["win_rate"]}
        )
    return {"bots": out}


@router.post("/bots")
def create_bot(body: BotIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    timeframe_param(body.timeframe)
    try:
        bot = bot_service.create_bot(db, user, body.model_dump())
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bot_service.bot_view(db, bot)


@router.get("/bots/{bot_id}")
def get_bot(bot_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bot = _bot(db, user, bot_id)
    now = now_ts()
    bot_service.run_bot(db, bot, now)
    return bot_service.bot_view(db, bot, now)


@router.post("/bots/{bot_id}/{action}")
def bot_action(bot_id: int, action: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bot = _bot(db, user, bot_id)
    now = now_ts()
    if action == "start":
        bot_service.start_bot(db, bot, now)
        bot_service.run_bot(db, bot, now)  # warm start processes history immediately
    elif action == "pause":
        bot_service.pause_bot(db, bot)
    elif action == "stop":
        bot_service.stop_bot(db, bot, now)
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
    return bot_service.bot_view(db, bot, now)


@router.delete("/bots/{bot_id}")
def delete_bot(bot_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bot = _bot(db, user, bot_id)
    if bot.status != "STOPPED":
        bot_service.stop_bot(db, bot)
    db.delete(bot)
    db.commit()
    return {"ok": True}
