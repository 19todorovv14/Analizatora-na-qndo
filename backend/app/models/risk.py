from __future__ import annotations

from sqlalchemy import JSON, BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class RiskEvent(Base):
    """Risk-rule violations and behavioural patterns detected in paper trading."""

    __tablename__ = "risk_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ts: Mapped[int] = mapped_column(BigInteger, default=now_ts, index=True)
    # oversized | no_stop | poor_rr | daily_loss | max_positions | exposure | revenge | overtrading
    # | moved_stop | chasing | liquidation
    kind: Mapped[str] = mapped_column(String(32), index=True)
    severity: Mapped[str] = mapped_column(String(8), default="warn")  # info | warn | high
    message: Mapped[str] = mapped_column(String(500))
    ref_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
