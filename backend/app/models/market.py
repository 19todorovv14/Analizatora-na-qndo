from __future__ import annotations

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class Asset(Base):
    """Instrument catalog (mirrors app.market.catalog, used for FKs and the watchlist)."""

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    asset_class: Mapped[str] = mapped_column(String(20))  # crypto | forex | index | commodity | stock
    price_precision: Mapped[int] = mapped_column(Integer, default=2)
    qty_step: Mapped[float] = mapped_column(Float, default=0.001)
    spread_bps: Mapped[float] = mapped_column(Float, default=1.0)
    maker_fee: Mapped[float] = mapped_column(Float, default=0.0002)
    taker_fee: Mapped[float] = mapped_column(Float, default=0.0006)
    max_leverage: Mapped[float] = mapped_column(Float, default=1.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_watchlist_user_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(32))
    position: Mapped[int] = mapped_column(Integer, default=0)


class MarketData(Base):
    """Latest ticker snapshot per symbol and data source (cache)."""

    __tablename__ = "market_data"
    __table_args__ = (UniqueConstraint("symbol", "source", name="uq_market_data_symbol_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(32))
    price: Mapped[float] = mapped_column(Float)
    change_24h_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume_24h: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)


class Candle(Base):
    """Cache of closed OHLCV candles fetched from external (non-demo) providers."""

    __tablename__ = "candles"
    __table_args__ = (UniqueConstraint("symbol", "timeframe", "ts", "source", name="uq_candle"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    timeframe: Mapped[str] = mapped_column(String(8))
    ts: Mapped[int] = mapped_column(BigInteger, index=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(32))


class IndicatorSnapshot(Base):
    """Indicator values that an AI analysis was based on (audit trail)."""

    __tablename__ = "indicators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    timeframe: Mapped[str] = mapped_column(String(8))
    ts: Mapped[int] = mapped_column(BigInteger)
    values: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(32), default="demo")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
