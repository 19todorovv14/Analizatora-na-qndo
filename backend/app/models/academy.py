from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, now_ts


class Lesson(Base):
    """Lessons are authored in app.academy.content and synced here at startup."""

    __tablename__ = "lessons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    module: Mapped[str] = mapped_column(String(40), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(500), default="")
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    xp: Mapped[int] = mapped_column(Integer, default=10)


class LearningProgress(Base):
    __tablename__ = "learning_progress"
    __table_args__ = (UniqueConstraint("user_id", "lesson_slug", name="uq_progress_user_lesson"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lesson_slug: Mapped[str] = mapped_column(String(80))
    module: Mapped[str] = mapped_column(String(40))
    completed_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)


class QuizResult(Base):
    __tablename__ = "quiz_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    module: Mapped[str] = mapped_column(String(40), index=True)
    score: Mapped[float] = mapped_column(Float)
    correct: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    passed: Mapped[bool] = mapped_column(Boolean)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=now_ts)


class ChallengeProgress(Base):
    __tablename__ = "challenge_progress"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_challenge_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(12), default="in_progress")  # in_progress | completed
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    completed_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
