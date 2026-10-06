from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, _token, current_user
from app.config import get_settings
from app.core.rate_limit import SlidingWindowLimiter
from app.core.security import password_problems
from app.database import get_db
from app.models import User
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["auth"])
_limiter = SlidingWindowLimiter(get_settings().auth_rate_limit_per_minute, 60)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field("Trader", max_length=100)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(max_length=128)


class ProfileIn(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    mode: str | None = Field(None, pattern="^(beginner|advanced)$")


def _rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    if not _limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Твърде много опити. Изчакай минута.")


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        max_age=s.session_days * 86400,
        path="/",
    )


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "is_guest": u.is_guest,
        "mode": u.mode,
        "xp": u.xp,
        "created_ts": u.created_ts,
    }


@router.post("/register")
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _rate_limit(request)
    problems = password_problems(body.password)
    if problems:
        raise HTTPException(status_code=400, detail=" ".join(problems))
    try:
        user = user_service.create_user(db, email=body.email, password=body.password, display_name=body.display_name)
    except user_service.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = user_service.start_session(db, user, request.headers.get("user-agent"))
    _set_cookie(response, token)
    return {"user": user_out(user), "token": token}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _rate_limit(request)
    try:
        user = user_service.authenticate(db, body.email, body.password)
    except user_service.AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    token = user_service.start_session(db, user, request.headers.get("user-agent"))
    _set_cookie(response, token)
    return {"user": user_out(user), "token": token}


@router.post("/guest")
def guest(request: Request, response: Response, db: Session = Depends(get_db)):
    """One-click demo: a fresh, isolated guest profile with a $10,000 virtual account."""
    _rate_limit(request)
    user = user_service.create_guest(db)
    token = user_service.start_session(db, user, request.headers.get("user-agent"))
    _set_cookie(response, token)
    return {"user": user_out(user), "token": token}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token, _ = _token(request)
    user_service.end_session(db, token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.display_name:
        user.display_name = body.display_name
    if body.mode:
        user.mode = body.mode
    db.commit()
    return user_out(user)


@router.post("/claim")
def claim(body: RegisterIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Turn a guest profile into a normal account (keeps all progress)."""
    if not user.is_guest:
        raise HTTPException(status_code=400, detail="Профилът вече е регистриран.")
    problems = password_problems(body.password)
    if problems:
        raise HTTPException(status_code=400, detail=" ".join(problems))
    try:
        user_service.claim_guest(db, user, body.email, body.password, body.display_name)
    except user_service.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return user_out(user)
