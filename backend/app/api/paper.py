"""Paper trading endpoints. Every action here is VIRTUAL."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.providers import get_llm
from app.ai.review import narrate, review_position
from app.api.deps import current_user, now_ts, symbol_param
from app.database import get_db
from app.exchange.registry import get_adapter
from app.market.catalog import get_asset, resolve_asset
from app.models import PaperAccount, PaperTrade, User
from app.paper_engine.models import ExecutionConfig
from app.services import paper_service, settings_service
from app.services.stats_service import user_account_ids

router = APIRouter(prefix="/paper", tags=["paper"])


class OrderIn(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    type: Literal["market", "limit", "stop"] = "market"
    qty: float = Field(gt=0)
    price: float | None = Field(None, gt=0)
    stop_loss: float | None = Field(None, gt=0)
    take_profit: float | None = Field(None, gt=0)
    timeframe: str | None = None
    setup: str | None = Field(None, max_length=100)
    note: str | None = Field(None, max_length=500)
    # per-order leverage (1 … the instrument's max_leverage, checked by the service → 400); None = account default
    leverage: float | None = Field(None, ge=1, le=100)
    # preview only: risk-based sizing helper (% of equity risked at the stop)
    risk_pct: float | None = Field(None, gt=0, le=100)

    @model_validator(mode="after")
    def _price_for_pending(self):
        if self.type in ("limit", "stop") and self.price is None:
            raise ValueError("Limit/Stop поръчка изисква цена.")
        return self


class CloseIn(BaseModel):
    qty: float | None = Field(None, gt=0)


class ModifyIn(BaseModel):
    stop_loss: float | None = Field(None, gt=0)
    take_profit: float | None = Field(None, gt=0)
    clear_stop: bool = False
    clear_target: bool = False


class ResetIn(BaseModel):
    balance: float = Field(10_000, ge=100, le=10_000_000)
    leverage: float | None = Field(None, ge=1, le=30)


class AccountSettingsIn(BaseModel):
    leverage: float | None = Field(None, ge=1, le=30)
    execution: dict | None = None


def _account(db: Session, user: User) -> PaperAccount:
    return paper_service.get_manual_account(db, user)


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except paper_service.PaperError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/account")
def account(user: User = Depends(current_user), db: Session = Depends(get_db)):
    acc = _account(db, user)
    broker = paper_service.sync_account(db, acc, now_ts())
    return paper_service.account_view(db, acc, broker)


@router.get("/instrument")
def instrument(
    symbol: str = Query(..., min_length=1, max_length=40),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Order-panel parameters of one instrument: leverage cap/default, sizes, costs, quote-currency conversion."""
    symbol_param(symbol)
    return paper_service.instrument_info(db, _account(db, user), symbol, now_ts())


@router.post("/orders/preview")
def preview(body: OrderIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    return _guard(paper_service.preview_order, db, user, _account(db, user), body.model_dump(), now_ts())


@router.post("/orders")
def place(body: OrderIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    symbol_param(body.symbol)
    adapter = get_adapter("paper", db=db, user=user, account=_account(db, user))
    return _guard(adapter.create_order, **body.model_dump())


@router.delete("/orders/{order_id}")
def cancel(order_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    adapter = get_adapter("paper", db=db, user=user, account=_account(db, user))
    return _guard(adapter.cancel_order, order_id)


@router.post("/positions/{position_id}/close")
def close(position_id: str, body: CloseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _guard(paper_service.close_position, db, user, _account(db, user), position_id, body.qty, now_ts())


@router.patch("/positions/{position_id}")
def modify(position_id: str, body: ModifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    changes: dict = {}
    if body.stop_loss is not None or body.clear_stop:
        changes["stop_loss"] = None if body.clear_stop else body.stop_loss
    if body.take_profit is not None or body.clear_target:
        changes["take_profit"] = None if body.clear_target else body.take_profit
    return _guard(paper_service.modify_position, db, user, _account(db, user), position_id, changes, now_ts())


@router.get("/trades")
def trades(
    limit: int = Query(200, le=1000),
    symbol: str | None = Query(None, min_length=1, max_length=40),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Closed trades (parts of positions), newest first; `symbol` keeps only that instrument (chart markers)."""
    acc = _account(db, user)
    q = select(PaperTrade).where(PaperTrade.account_id == acc.id)
    if symbol:
        q = q.where(PaperTrade.symbol == resolve_asset(symbol).symbol)
    rows = db.scalars(q.order_by(PaperTrade.closed_ts.desc()).limit(limit))
    return {"trades": [paper_service.trade_to_dict(t) for t in rows]}


@router.get("/events")
def events(
    limit: int = Query(50, ge=1, le=500),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Account activity (fills, rejections, SL/TP, stop-outs …), newest first."""
    return {"events": paper_service.events(db, _account(db, user), limit)}


@router.post("/reset")
def reset(body: ResetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    acc = paper_service.reset_account(db, _account(db, user), body.balance, body.leverage)
    broker = paper_service.load_broker(db, acc)
    return paper_service.account_view(db, acc, broker)


@router.patch("/account")
def update_account(body: AccountSettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    acc = _account(db, user)
    if body.leverage:
        acc.leverage = body.leverage
    if body.execution is not None:
        acc.execution = ExecutionConfig.from_dict({**(acc.execution or {}), **body.execution}).to_dict()
        settings_service.update_settings(db, user, {"execution": acc.execution})
    db.commit()
    broker = paper_service.sync_account(db, acc, now_ts())
    return paper_service.account_view(db, acc, broker)


@router.get("/positions/{position_id}/review")
def review(position_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """AI TRADE REVIEW of a (closed or partially closed) paper position."""
    ids = user_account_ids(db, user, ("manual", "replay", "bot"))
    found = paper_service.position_detail(db, ids, position_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Позицията не е намерена.")
    pos, trades_ = found
    if not trades_:
        raise HTTPException(status_code=400, detail="Позицията още няма затворена част — review е след затваряне.")
    previous = [t for t in paper_service.closed_trades(db, ids) if t["closed_ts"] <= pos["opened_ts"]]
    r = review_position(
        pos,
        trades_,
        rules=settings_service.risk_rules(user),
        precision=get_asset(pos["symbol"]).price_precision,
        previous_trades=previous,
    )
    return narrate(r, get_llm())
