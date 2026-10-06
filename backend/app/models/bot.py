from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class Bot(Base):
    """A simulation bot. It can only ever trade its own PAPER account."""

    __tablename__ = "bots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    symbol: Mapped[str] = mapped_column(String(32))
    timeframe: Mapped[str] = mapped_column(String(8))
    strategy_id: Mapped[int | None] = mapped_column(ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True)
    strategy_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    # risk_per_trade_pct, max_open_positions, daily_loss_limit_pct, trading_hours, stop/tp overrides
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(10), default="STOPPED")  # STOPPED | RUNNING | PAUSED
    pause_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paper_account_id: Mapped[int] = mapped_column(ForeignKey("paper_accounts.id", ondelete="CASCADE"))
    run_mode: Mapped[str] = mapped_column(String(12), default="forward")  # forward | warm_start
    last_processed_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_signal: Mapped[dict] = mapped_column(JSON, default=dict)
    runtime: Mapped[dict] = mapped_column(JSON, default=dict)  # day-start equity etc.
    regime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)


class BotRun(Base):
    __tablename__ = "bot_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bot_id: Mapped[int] = mapped_column(ForeignKey("bots.id", ondelete="CASCADE"), index=True)
    started_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    stopped_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="running")
    start_equity: Mapped[float] = mapped_column(Float)
    end_equity: Mapped[float | None] = mapped_column(Float, nullable=True)
    trades: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)


class BotLog(Base):
    __tablename__ = "bot_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bot_id: Mapped[int] = mapped_column(ForeignKey("bots.id", ondelete="CASCADE"), index=True)
    ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    level: Mapped[str] = mapped_column(String(8), default="info")  # info | signal | trade | warn | error
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
