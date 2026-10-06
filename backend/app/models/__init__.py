"""SQLAlchemy models. All timestamps are integer UTC epoch seconds."""

from app.models.academy import ChallengeProgress, LearningProgress, Lesson, QuizResult
from app.models.ai import AIMessage, AISession
from app.models.backtest import Backtest, BacktestTrade
from app.models.bot import Bot, BotLog, BotRun
from app.models.journal import JournalEntry
from app.models.market import Asset, Candle, IndicatorSnapshot, MarketData, WatchlistItem
from app.models.paper import (
    PaperAccount,
    PaperEvent,
    PaperOrder,
    PaperPosition,
    PaperTrade,
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
    "ChallengeProgress",
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
    "ReplaySession",
    "RiskEvent",
    "Strategy",
    "StrategyRule",
    "User",
    "UserSession",
    "WatchlistItem",
]
