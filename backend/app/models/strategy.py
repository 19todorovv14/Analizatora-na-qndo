from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, now_ts


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    is_template: Mapped[bool] = mapped_column(Boolean, default=False)
    symbol: Mapped[str] = mapped_column(String(32), default="BTC/USDT")
    timeframe: Mapped[str] = mapped_column(String(8), default="1h")
    # Full validated definition (see app.strategies.rules.StrategyDefinition) — source of truth.
    definition: Mapped[dict] = mapped_column(JSON, default=dict)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)

    rules: Mapped[list[StrategyRule]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan", order_by="StrategyRule.position"
    )


class StrategyRule(Base):
    """Normalised copy of every condition for querying/analytics."""

    __tablename__ = "strategy_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    strategy_id: Mapped[int] = mapped_column(ForeignKey("strategies.id", ondelete="CASCADE"), index=True)
    block: Mapped[str] = mapped_column(String(20))  # entry_long | entry_short | exit_long | exit_short
    logic: Mapped[str] = mapped_column(String(4), default="all")  # all (AND) | any (OR)
    position: Mapped[int] = mapped_column(Integer, default=0)
    left: Mapped[dict] = mapped_column(JSON)
    op: Mapped[str] = mapped_column(String(16))
    right: Mapped[dict] = mapped_column(JSON)

    strategy: Mapped[Strategy] = relationship(back_populates="rules")
