"""Users, sessions and demo (guest) onboarding."""

from __future__ import annotations

import secrets
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import hash_password, hash_session_token, new_session_token, verify_password
from app.market.catalog import DEFAULT_WATCHLIST
from app.models import Strategy, StrategyRule, User, UserSession, WatchlistItem
from app.services import paper_service
from app.strategies.rules import StrategyDefinition
from app.strategies.templates import TEMPLATES


class AuthError(ValueError):
    pass


def create_user(db: Session, *, email: str, password: str | None, display_name: str, is_guest: bool = False) -> User:
    email = email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise AuthError("Вече има акаунт с този email.")
    user = User(
        email=email,
        password_hash=hash_password(password) if password else None,
        display_name=display_name[:100] or "Trader",
        is_guest=is_guest,
        settings={},
    )
    db.add(user)
    db.commit()
    onboard(db, user)
    return user


def create_guest(db: Session) -> User:
    tag = secrets.token_hex(4)
    return create_user(
        db, email=f"guest-{tag}@demo.local", password=None, display_name=f"Guest {tag[:4]}", is_guest=True
    )


def onboard(db: Session, user: User) -> None:
    """Demo-ready starting point: paper account with $10,000, a watchlist and one sample strategy."""
    paper_service.get_manual_account(db, user)
    for i, sym in enumerate(DEFAULT_WATCHLIST):
        db.add(WatchlistItem(user_id=user.id, symbol=sym, position=i))
    tpl = TEMPLATES[1]
    save_strategy(
        db,
        user,
        name=f"Моята първа стратегия ({tpl['name']})",
        description=tpl["description"],
        symbol="BTC/USDT",
        timeframe=tpl["timeframe"],
        definition=tpl["definition"],
    )
    db.commit()


def save_strategy(
    db: Session,
    user: User | None,
    *,
    name: str,
    description: str,
    symbol: str,
    timeframe: str,
    definition: dict,
    strategy: Strategy | None = None,
    is_template: bool = False,
) -> Strategy:
    defn = StrategyDefinition(**definition)
    data = defn.model_dump()
    if strategy is None:
        strategy = Strategy(user_id=user.id if user else None, is_template=is_template)
        db.add(strategy)
    strategy.name = name[:120]
    strategy.description = description[:2000]
    strategy.symbol = symbol
    strategy.timeframe = timeframe
    strategy.definition = data
    strategy.updated_ts = int(time.time())
    strategy.rules.clear()
    pos = 0
    for block_name, block in defn.blocks().items():
        if not block:
            continue
        for c in block.conditions:
            strategy.rules.append(
                StrategyRule(
                    block=block_name,
                    logic=block.logic,
                    position=pos,
                    left=c.left.model_dump(),
                    op=c.op,
                    right=c.right.model_dump(),
                )
            )
            pos += 1
    db.commit()
    return strategy


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("Грешен email или парола.")
    return user


def start_session(db: Session, user: User, user_agent: str | None = None) -> str:
    token = new_session_token()
    days = get_settings().session_days
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            user_agent=(user_agent or "")[:255],
            expires_ts=int(time.time()) + days * 86400,
        )
    )
    db.commit()
    return token


def user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_session_token(token)))
    if sess is None or sess.expires_ts < time.time():
        return None
    return db.get(User, sess.user_id)


def end_session(db: Session, token: str | None) -> None:
    if not token:
        return
    db.query(UserSession).filter(UserSession.token_hash == hash_session_token(token)).delete()
    db.commit()


def claim_guest(db: Session, user: User, email: str, password: str, display_name: str | None) -> User:
    email = email.strip().lower()
    if db.scalar(select(User).where(User.email == email, User.id != user.id)):
        raise AuthError("Вече има акаунт с този email.")
    user.email = email
    user.password_hash = hash_password(password)
    user.is_guest = False
    if display_name:
        user.display_name = display_name[:100]
    db.commit()
    return user
