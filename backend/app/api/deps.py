from __future__ import annotations

import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.market.catalog import UnknownAssetError, get_asset
from app.market.timeframes import TimeframeError, validate_timeframe
from app.models import User
from app.services.user_service import user_from_token

SESSION_COOKIE = "ta_session"
CSRF_HEADER = "x-ta-client"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _token(request: Request) -> tuple[str | None, bool]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip(), False
    return request.cookies.get(SESSION_COOKIE), True


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token, via_cookie = _token(request)
    user = user_from_token(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Не си влязъл в профила си.")
    if via_cookie and request.method in UNSAFE_METHODS and request.headers.get(CSRF_HEADER) != "web":
        raise HTTPException(status_code=403, detail="Missing CSRF header.")
    return user


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token, _ = _token(request)
    return user_from_token(db, token)


def now_ts() -> int:
    return int(time.time())


def symbol_param(symbol: str) -> str:
    try:
        get_asset(symbol)
    except UnknownAssetError as exc:
        raise HTTPException(status_code=404, detail=f"Непознат инструмент: {symbol}") from exc
    return symbol


def timeframe_param(timeframe: str) -> str:
    try:
        return validate_timeframe(timeframe)
    except TimeframeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
