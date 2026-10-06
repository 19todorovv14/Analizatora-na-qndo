from __future__ import annotations

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class Asset(Base):
    """Instrument catalog.

    source='curated' rows mirror app.market.catalog (upserted by the seed); other sources
    (binance | twelvedata) are instruments discovered by app.market.discovery and loaded into the
    in-memory synced registry. Columns added in 0002_v2 are nullable or have server defaults.
    """

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    asset_class: Mapped[str] = mapped_column(String(20))  # crypto | stock | etf | forex | index | commodity
    price_precision: Mapped[int] = mapped_column(Integer, default=2)
    qty_step: Mapped[float] = mapped_column(Float, default=0.001)
    spread_bps: Mapped[float] = mapped_column(Float, default=1.0)
    maker_fee: Mapped[float] = mapped_column(Float, default=0.0002)
    taker_fee: Mapped[float] = mapped_column(Float, default=0.0006)
    max_leverage: Mapped[float] = mapped_column(Float, default=1.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # --- V2 catalog metadata (0002_v2) ---
    category: Mapped[str] = mapped_column(String(32), default="", server_default="")
    sector: Mapped[str] = mapped_column(String(64), default="", server_default="")
    industry: Mapped[str] = mapped_column(String(96), default="", server_default="")
    exchange: Mapped[str] = mapped_column(String(32), default="", server_default="")
    country: Mapped[str] = mapped_column(String(48), default="", server_default="")
    currency: Mapped[str] = mapped_column(String(12), default="USD", server_default="USD")
    base: Mapped[str] = mapped_column(String(32), default="", server_default="")
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    popularity: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    session: Mapped[str] = mapped_column(String(16), default="24x7", server_default="24x7")
    provider_symbols: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)
    source: Mapped[str] = mapped_column(String(16), default="curated", server_default="curated", index=True)
    slug: Mapped[str | None] = mapped_column(String(48), nullable=True, unique=True, index=True)
    min_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    demo: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # demo generator params (curated only)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts, server_default="0")


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


class FavoriteAsset(Base):
    """A user's favourite instruments (per user, unique symbol)."""

    __tablename__ = "favorite_assets"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_favorite_user_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(40))
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)


class RecentAsset(Base):
    """Recently viewed instruments (per user, unique symbol; viewed_ts upserted, views counted)."""

    __tablename__ = "recent_assets"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_recent_user_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(40))
    viewed_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts, index=True)
    views: Mapped[int] = mapped_column(Integer, default=1)


class CatalogSync(Base):
    """One run of a provider instrument-list sync (app.market.discovery)."""

    __tablename__ = "catalog_syncs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))  # binance | twelvedata
    kind: Mapped[str] = mapped_column(String(30))  # spot | stocks | etf | forex_pairs | indices | …
    started_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)
    finished_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | ok | error
    count: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
