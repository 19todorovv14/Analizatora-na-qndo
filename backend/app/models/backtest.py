from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class Backtest(Base):
    __tablename__ = "backtests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    strategy_id: Mapped[int | None] = mapped_column(ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True)
    strategy_name: Mapped[str] = mapped_column(String(120), default="")
    strategy_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    symbol: Mapped[str] = mapped_column(String(32))
    timeframe: Mapped[str] = mapped_column(String(8))
    start_ts: Mapped[int] = mapped_column(BigInteger)
    end_ts: Mapped[int] = mapped_column(BigInteger)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | running | done | failed
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    equity_curve: Mapped[list] = mapped_column(JSON, default=list)
    validation: Mapped[dict] = mapped_column(JSON, default=dict)
    data_source: Mapped[str] = mapped_column(String(32), default="demo")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    finished_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class BacktestTrade(Base):
    __tablename__ = "backtest_trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    backtest_id: Mapped[int] = mapped_column(ForeignKey("backtests.id", ondelete="CASCADE"), index=True)
    side: Mapped[str] = mapped_column(String(5))
    entry_ts: Mapped[int] = mapped_column(BigInteger)
    exit_ts: Mapped[int] = mapped_column(BigInteger)
    entry_price: Mapped[float] = mapped_column(Float)
    exit_price: Mapped[float] = mapped_column(Float)
    qty: Mapped[float] = mapped_column(Float)
    net_pnl: Mapped[float] = mapped_column(Float)
    fees: Mapped[float] = mapped_column(Float)
    r_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_reason: Mapped[str] = mapped_column(String(20))
    regime: Mapped[str | None] = mapped_column(String(32), nullable=True)
