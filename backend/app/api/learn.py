"""Learning API — learning path (LEVEL 0–10), learning dashboard, interactive candle drill-down; interactive labs
(candlesticks, market structure) and the leverage lab are appended below by work package S3b.

Owner: work package S3 (S3a: path/dashboard/drill-down routes at the top; S3b: lab routes below the marker).
Registered in app.main under /api (no prefix here: declare full paths such as "/learn/path"). Educational only —
every simulation is paper/virtual.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.academy import patterns, structure_lab
from app.api.deps import current_user, now_ts, symbol_param, timeframe_param
from app.database import get_db
from app.market.catalog import get_asset
from app.models import User
from app.paper_engine.broker import effective_daily_vol
from app.risk import leverage as leverage_lab
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
# Candlestick Lab, Market Structure Lab and Leverage Lab (S3b). Public: pure maths / market data / signed rounds.
# Auth (they store results): POST /learn/candlesticks/practice, POST /learn/structure/check, GET /learn/structure/history.


class PracticeAnswerIn(BaseModel):
    token: str = Field(min_length=1, max_length=8000)
    answer: str | None = Field(default=None, max_length=64)


class PracticeIn(BaseModel):
    answers: list[PracticeAnswerIn] = Field(min_length=1, max_length=50)


class StructureMarkIn(BaseModel):
    time: int = Field(ge=0)
    price: float = Field(gt=0, allow_inf_nan=False)
    label: Literal["HH", "HL", "LH", "LL", "BREAKOUT", "RETEST", "FAKEOUT"]


class StructureCheckIn(BaseModel):
    token: str = Field(min_length=1, max_length=8000)
    marks: list[StructureMarkIn] = Field(default_factory=list, max_length=200)
    structure: Literal["uptrend", "downtrend", "range"] | None = None
    polish: bool = False


class LeverageIn(BaseModel):
    leverage: float = Field(ge=1, le=leverage_lab.MAX_LEVERAGE, allow_inf_nan=False)
    equity: float = Field(default=leverage_lab.DEFAULT_EQUITY, gt=0, le=1e9, allow_inf_nan=False)
    position_notional: float | None = Field(default=None, gt=0, le=1e11, allow_inf_nan=False)
    margin: float | None = Field(default=None, gt=0, le=1e11, allow_inf_nan=False)
    entry_price: float = Field(default=leverage_lab.DEFAULT_ENTRY_PRICE, gt=0, le=1e9, allow_inf_nan=False)
    side: Literal["long", "short", "buy", "sell"] = "long"
    price_move_pct: float = Field(default=0.0, gt=-100, le=1000, allow_inf_nan=False)
    maintenance_ratio: float = Field(default=leverage_lab.MAINTENANCE_RATIO, ge=0, lt=1, allow_inf_nan=False)
    fee_rate: float | None = Field(default=None, ge=0, le=0.05, allow_inf_nan=False)
    daily_vol_pct: float | None = Field(default=None, gt=0, le=100, allow_inf_nan=False)
    symbol: str | None = Field(default=None, max_length=64)
    include_curves: bool = True


def _pattern_or_404(key: str) -> dict:
    p = patterns.PATTERNS_BY_KEY.get(key)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Непознат свещен модел: {key}")
    return p


# ---------------------------------------------------------------------------------- S3b: Candlestick Lab
@router.get("/learn/candlesticks")
def candlestick_gallery():
    """Candlestick Lab gallery: 24 patterns with a synthetic illustration in context + educational text."""
    return patterns.gallery()


@router.get("/learn/candlesticks/practice")
def candlestick_practice(n: int = Query(10, ge=1, le=patterns.PRACTICE_MAX_ROUNDS)):
    """HMAC-signed practice rounds (synthetic pattern + context, 4 options). The answer is not readable from the
    token; grade with POST /learn/candlesticks/practice."""
    return patterns.practice_rounds(n)


@router.post("/learn/candlesticks/practice")
def candlestick_practice_submit(body: PracticeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Grade a practice set and store it as QuizResult(module="lab:candlesticks") — once per set (409 after)."""
    try:
        return patterns.submit_practice(db, user, [a.model_dump() for a in body.answers])
    except patterns.PracticeAlreadySubmitted as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except patterns.PracticeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/learn/candlesticks/{key}")
def candlestick_pattern(key: str):
    """One pattern card (same shape as an item of GET /learn/candlesticks)."""
    return _pattern_or_404(key)


@router.get("/learn/candlesticks/{key}/examples")
def candlestick_examples(
    key: str,
    symbol: str = Query("BTC/USDT", max_length=64),
    timeframe: str = Query("1h"),
    bars: int = Query(patterns.EXAMPLES_DEFAULT_BARS, ge=50, le=1000),
):
    """Recent occurrences of the pattern on CLOSED candles + the move over the next 5/10 bars (historical behaviour
    on this data, not a prediction). A provider problem → 200 with available:false, code and reason."""
    _pattern_or_404(key)
    symbol = symbol_param(symbol)
    timeframe = timeframe_param(timeframe)
    return patterns.examples(key, symbol, timeframe, now=now_ts(), bars=bars)


# -------------------------------------------------------------------------------- S3b: Market Structure Lab
@router.get("/learn/structure/exercise")
def structure_exercise(
    difficulty: Literal["easy", "medium", "hard"] = "medium",
    symbol: str | None = Query(None, max_length=64),
    timeframe: str | None = Query(None),
):
    """A past window of 80–140 closed candles chosen by difficulty + a signed token for the check.
    No market data → 503 {detail, code:"DATA_NOT_AVAILABLE", reason, symbol}."""
    if symbol is not None:
        symbol = symbol_param(symbol)
    if timeframe is not None:
        timeframe = timeframe_param(timeframe)
    return structure_lab.exercise(difficulty, now=now_ts(), symbol=symbol, timeframe=timeframe)


@router.post("/learn/structure/check")
def structure_check(body: StructureCheckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Deterministic check of the user's marks + structure; stores the attempt in structure_attempts (once per
    exercise token). Invalid/expired/tampered token → 400."""
    try:
        return structure_lab.check(
            db,
            user,
            token=body.token,
            marks=[m.model_dump() for m in body.marks],
            structure=body.structure,
            now=now_ts(),
            polish=body.polish,
        )
    except structure_lab.StructureTokenError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/learn/structure/history")
def structure_history(
    limit: int = Query(20, ge=1, le=100), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Last attempts + best/average score (overall and per difficulty)."""
    return structure_lab.history(db, user, limit=limit)


# ------------------------------------------------------------------------------------- S3b: Leverage Lab
@router.post("/learn/leverage/simulate")
def leverage_simulate(body: LeverageIn):
    """Pure leverage maths on a virtual account (same margin/stop-out model as the paper broker) + curves of
    equity vs price move for 1x…100x. Never recommends a leverage value."""
    data = body.model_dump()
    symbol = data.pop("symbol")
    asset = None
    if symbol:
        spec = get_asset(symbol_param(symbol))
        vol_pct = effective_daily_vol(spec) * 100
        if data["daily_vol_pct"] is None:
            data["daily_vol_pct"] = vol_pct
        if data["fee_rate"] is None:
            data["fee_rate"] = spec.taker_fee
        asset = {
            "symbol": spec.symbol,
            "name": spec.name,
            "asset_class": spec.asset_class,
            "max_leverage": spec.max_leverage,
            "leverage_allowed": data["leverage"] <= spec.max_leverage,
            "daily_vol_pct": vol_pct,
            "taker_fee": spec.taker_fee,
        }
    if data["fee_rate"] is None:
        data["fee_rate"] = 0.0
    try:
        result = leverage_lab.simulate_with_curves(**data)
    except leverage_lab.LeverageInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if asset is not None:
        result["daily_vol_source"] = "asset" if body.daily_vol_pct is None else "given"
        if not asset["leverage_allowed"]:
            result["notes"].append(
                f"Paper брокерът позволява до {asset['max_leverage']:g}x за {asset['symbol']} — по-висок leverage "
                "ще бъде отказан при реална paper поръчка."
            )
    result["asset"] = asset
    return result


@router.get("/learn/leverage/scenario")
def leverage_scenario(
    stake: float = Query(leverage_lab.DEFAULT_NOTIONAL, gt=0, le=1e9),
    move_pct: float = Query(-5.0, gt=-100, le=100),
    equity: float = Query(leverage_lab.DEFAULT_EQUITY, gt=0, le=1e9),
    side: Literal["long", "short"] = "long",
):
    """Guided walkthrough: the same stake of margin at 1x → 5x → 20x and one price move."""
    try:
        return leverage_lab.scenario(stake=stake, move_pct=move_pct, equity=equity, side=side)
    except leverage_lab.LeverageInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
