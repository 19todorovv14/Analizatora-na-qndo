from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trade_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    timeframe: Mapped[str | None] = mapped_column(String(8), nullable=True)
    side: Mapped[str | None] = mapped_column(String(5), nullable=True)
    setup: Mapped[str] = mapped_column(String(100), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    entry: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop: Mapped[float | None] = mapped_column(Float, nullable=True)
    target: Mapped[float | None] = mapped_column(Float, nullable=True)
    emotion: Mapped[str] = mapped_column(String(40), default="")
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1..5
    result: Mapped[float | None] = mapped_column(Float, nullable=True)  # net P/L
    r_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)
    lesson: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    mistakes: Mapped[list] = mapped_column(JSON, default=list)
    screenshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # PNG data URL
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    # --- V2 (0002_v2) ---
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(100), nullable=True)
    risk_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_review: Mapped[dict | None] = mapped_column(JSON, nullable=True)
