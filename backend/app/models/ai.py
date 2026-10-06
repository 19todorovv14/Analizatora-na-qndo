from __future__ import annotations

from sqlalchemy import JSON, BigInteger, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class AISession(Base):
    __tablename__ = "ai_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="chat")  # chat | analysis | review | coach | replay_review
    title: Mapped[str] = mapped_column(String(200), default="")
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    provider: Mapped[str] = mapped_column(String(20), default="offline")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)  # V2 teacher mode name (0002_v2)


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("ai_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(12))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
