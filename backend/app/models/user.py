from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, now_ts


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(100), default="Trader")
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False)
    mode: Mapped[str] = mapped_column(String(20), default="beginner")  # beginner | advanced
    xp: Mapped[int] = mapped_column(Integer, default=0)
    # risk rules, execution realism, onboarding flags... (see services.settings_service)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)

    sessions: Mapped[list[UserSession]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Only an HMAC-SHA256 of the random session token is stored, never the token itself.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    expires_ts: Mapped[int] = mapped_column(BigInteger)

    user: Mapped[User] = relationship(back_populates="sessions")
