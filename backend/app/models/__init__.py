"""SQLAlchemy models. All timestamps are integer UTC epoch seconds."""

from app.models.academy import ChallengeProgress, LearningProgress, Lesson, QuizResult, StructureAttempt
from app.models.ai import AIMessage, AISession
from app.models.backtest import Backtest, BacktestTrade
from app.models.bot import Bot, BotLog, BotRun
from app.models.journal import JournalEntry
from app.models.market import (
    Asset,
    Candle,
    CatalogSync,
    FavoriteAsset,
    IndicatorSnapshot,
    MarketData,
    RecentAsset,
    WatchlistItem,
)
from app.models.paper import (
    PaperAccount,
    PaperEvent,
    PaperOrder,
    PaperPosition,
    PaperTrade,
    ReplayDecision,
    ReplaySession,
)
from app.models.risk import RiskEvent
from app.models.strategy import Strategy, StrategyRule
from app.models.user import User, UserSession

__all__ = [
    "AIMessage",
    "AISession",
    "Asset",
    "Backtest",
    "BacktestTrade",
    "Bot",
    "BotLog",
    "BotRun",
    "Candle",
    "CatalogSync",
    "ChallengeProgress",
    "FavoriteAsset",
    "IndicatorSnapshot",
    "JournalEntry",
    "LearningProgress",
    "Lesson",
    "MarketData",
    "PaperAccount",
    "PaperEvent",
    "PaperOrder",
    "PaperPosition",
    "PaperTrade",
    "QuizResult",
    "RecentAsset",
    "ReplayDecision",
    "ReplaySession",
    "RiskEvent",
    "Strategy",
    "StrategyRule",
    "StructureAttempt",
    "User",
    "UserSession",
    "WatchlistItem",
]
