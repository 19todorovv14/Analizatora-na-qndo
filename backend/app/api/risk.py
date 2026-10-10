from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import current_user, now_ts
from app.database import get_db
from app.market.catalog import UnknownAssetError, get_asset
from app.models import User
from app.risk.engine import RiskRules, position_size, risk_of_ruin_table, trade_plan
from app.services import settings_service, stats_service

router = APIRouter(prefix="/risk", tags=["risk"])


class SizeIn(BaseModel):
    balance: float = Field(gt=0)
    risk_pct: float = Field(gt=0, le=100)
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    take_profit: float | None = Field(None, gt=0)
    symbol: str | None = None
    leverage: float = Field(1.0, ge=1, le=100)
    include_fees: bool = True


@router.post("/position-size")
def size(body: SizeIn):
    spec = None
    if body.symbol:
        try:
            spec = get_asset(body.symbol)
        except UnknownAssetError as exc:
            raise HTTPException(status_code=404, detail="Непознат инструмент") from exc
    fee = spec.taker_fee if (spec and body.include_fees) else 0.0
    lev = min(body.leverage, spec.max_leverage) if spec else body.leverage
    try:
        res = position_size(
            balance=body.balance,
            risk_pct=body.risk_pct,
            entry=body.entry,
            stop=body.stop,
            spec=spec,
            leverage=lev,
            fee_rate=fee,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    side = "buy" if body.stop < body.entry else "sell"
    plan = trade_plan(
        side=side,
        entry=body.entry,
        stop=body.stop,
        take_profit=body.take_profit,
        qty=res["qty"],
        balance=body.balance,
        fee_rate=fee,
    )
    explanation = [
        f"Рискуваш {body.risk_pct:g}% от {body.balance:,.2f} = {res['risk_amount']:,.2f}.",
        f"Разстоянието до стопа е {res['stop_distance']:.6g} ({res['stop_distance_pct']:.2f}%).",
        f"{res['risk_amount']:,.2f} / {res['stop_distance']:.6g} ≈ {res['qty']:g} единици"
        + (" (с отчетени такси)." if fee else "."),
        "Ако стопът е по-далеч, позицията става по-малка — рискът в пари остава същият. Затова първо избираш стопа, "
        "после размера.",
    ]
    if plan.get("reward_risk"):
        explanation.append(
            f"Reward:Risk = {plan['reward_risk']:.2f}. Break-even win rate ≈ "
            f"{100 / (1 + plan['reward_risk']):.0f}% (без разходите)."
        )
    return {
        **res,
        "side": "long" if side == "buy" else "short",
        "leverage": lev,
        "plan": plan,
        "explanation": explanation,
        "ruin": risk_of_ruin_table(body.risk_pct),
    }


@router.get("/ruin")
def ruin(risk_pct: float = Query(1.0, gt=0, le=100)):
    return {"table": risk_of_ruin_table(risk_pct, (1, 3, 5, 10, 15, 20))}


@router.get("/status")
def status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return stats_service.risk_status(db, user, now_ts())


@router.get("/rules")
def rules(user: User = Depends(current_user)):
    return settings_service.risk_rules(user).to_dict()


@router.put("/rules")
def update_rules(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:  # wrong types / out-of-range values → 400 (they used to be a 500, or were stored and broke later checks)
        clean = RiskRules.from_dict(body, strict=True).to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Невалидно правило: {exc}") from exc
    for k in (
        "max_risk_per_trade_pct",
        "warn_risk_pct",
        "max_daily_loss_pct",
        "max_portfolio_exposure_pct",
        "min_reward_risk",
    ):
        if not 0 < float(clean[k]) <= 10_000:
            raise HTTPException(status_code=400, detail=f"Невалидна стойност за {k}")
    if not 1 <= int(clean["max_open_positions"]) <= 100:
        raise HTTPException(status_code=400, detail="max_open_positions трябва да е между 1 и 100")
    return settings_service.update_settings(db, user, {"risk_rules": clean})["risk_rules"]
