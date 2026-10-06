"""Paper-trading tables. Everything here is VIRTUAL — no real orders ever exist."""

from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class PaperAccount(Base):
    __tablename__ = "paper_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), default="Paper account")
    kind: Mapped[str] = mapped_column(String(20), default="manual")  # manual | bot | replay
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    initial_balance: Mapped[float] = mapped_column(Float, default=10_000.0)
    cash: Mapped[float] = mapped_column(Float, default=10_000.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    fees_paid: Mapped[float] = mapped_column(Float, default=0.0)
    leverage: Mapped[float] = mapped_column(Float, default=1.0)
    execution: Mapped[dict] = mapped_column(JSON, default=dict)  # ExecutionConfig overrides
    peak_equity: Mapped[float] = mapped_column(Float, default=10_000.0)
    max_drawdown_pct: Mapped[float] = mapped_column(Float, default=0.0)
    rng_counter: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class PaperOrder(Base):
    __tablename__ = "paper_orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("paper_accounts.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(32))
    side: Mapped[str] = mapped_column(String(4))  # buy | sell
    type: Mapped[str] = mapped_column(String(10))  # market | limit | stop
    qty: Mapped[float] = mapped_column(Float)
    filled_qty: Mapped[float] = mapped_column(Float, default=0.0)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_fill_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    fill_mode: Mapped[str] = mapped_column(String(12), default="immediate")  # immediate | next_bar
    position_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reduce_only: Mapped[bool] = mapped_column(Boolean, default=False)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    slippage_cost: Mapped[float] = mapped_column(Float, default=0.0)
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active_from_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class PaperPosition(Base):
    __tablename__ = "paper_positions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("paper_accounts.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(32))
    side: Mapped[str] = mapped_column(String(5))  # long | short
    qty: Mapped[float] = mapped_column(Float)
    initial_qty: Mapped[float] = mapped_column(Float)
    entry_price: Mapped[float] = mapped_column(Float)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    initial_stop: Mapped[float | None] = mapped_column(Float, nullable=True)
    leverage: Mapped[float] = mapped_column(Float, default=1.0)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    mfe: Mapped[float] = mapped_column(Float, default=0.0)  # max favourable excursion (price units)
    mae: Mapped[float] = mapped_column(Float, default=0.0)  # max adverse excursion (price units)
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)
    sl_history: Mapped[list] = mapped_column(JSON, default=list)
    active_from_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    opened_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    closed_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class PaperTrade(Base):
    """A closed (fully or partially) position slice with its final result."""

    __tablename__ = "paper_trades"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("paper_accounts.id", ondelete="CASCADE"), index=True)
    position_id: Mapped[str] = mapped_column(String(32), index=True)
    symbol: Mapped[str] = mapped_column(String(32))
    side: Mapped[str] = mapped_column(String(5))
    qty: Mapped[float] = mapped_column(Float)
    entry_price: Mapped[float] = mapped_column(Float)
    exit_price: Mapped[float] = mapped_column(Float)
    stop_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    gross_pnl: Mapped[float] = mapped_column(Float)
    fees: Mapped[float] = mapped_column(Float)
    net_pnl: Mapped[float] = mapped_column(Float)
    risk_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    r_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_reason: Mapped[str] = mapped_column(String(20))  # manual | partial | stop_loss | take_profit | liquidation
    opened_ts: Mapped[int] = mapped_column(BigInteger)
    closed_ts: Mapped[int] = mapped_column(BigInteger, index=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class PaperEvent(Base):
    __tablename__ = "paper_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("paper_accounts.id", ondelete="CASCADE"), index=True)
    ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    type: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class ReplaySession(Base):
    __tablename__ = "replay_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("paper_accounts.id", ondelete="CASCADE"))
    symbol: Mapped[str] = mapped_column(String(32))
    timeframe: Mapped[str] = mapped_column(String(8))
    start_ts: Mapped[int] = mapped_column(BigInteger)
    cursor_ts: Mapped[int] = mapped_column(BigInteger)  # open time of the last revealed candle
    end_ts: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | finished
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    # --- V2 (0002_v2) ---
    mode: Mapped[str] = mapped_column(String(12), default="trade", server_default="trade")  # trade | predict
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    review: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    strategy_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ReplayDecision(Base):
    """A LONG / SHORT / WAIT decision taken on one revealed replay bar (with optional stop/target)."""

    __tablename__ = "replay_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("replay_sessions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bar_ts: Mapped[int] = mapped_column(BigInteger)
    action: Mapped[str] = mapped_column(String(6))  # long | short | wait
    entry_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop: Mapped[float | None] = mapped_column(Float, nullable=True)
    target: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    outcome: Mapped[dict] = mapped_column(JSON, default=dict)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
