"""Lessons, quizzes, XP and module unlocking."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.academy.content import LESSONS_BY_SLUG, MODULES, MODULES_BY_KEY, PASS_SCORE
from app.models import LearningProgress, Lesson, QuizResult, User

QUIZ_XP = 50


def sync_lessons(db: Session) -> None:
    """Mirror authored lessons into the `lessons` table (idempotent)."""
    existing = {lesson.slug: lesson for lesson in db.scalars(select(Lesson))}
    for m in MODULES:
        for i, data in enumerate(m["lessons"]):
            row = existing.get(data["slug"]) or Lesson(slug=data["slug"])
            row.module = m["key"]
            row.position = i
            row.title = data["title"]
            row.summary = data["summary"][:500]
            row.content = {
                k: data[k] for k in ("body", "sections", "key_points", "common_mistakes", "visual", "keywords")
            }
            row.xp = data["xp"]
            db.add(row)
    db.commit()


def _completed(db: Session, user: User) -> set[str]:
    return set(db.scalars(select(LearningProgress.lesson_slug).where(LearningProgress.user_id == user.id)))


def _best_quiz(db: Session, user: User) -> dict[str, QuizResult]:
    best: dict[str, QuizResult] = {}
    for r in db.scalars(select(QuizResult).where(QuizResult.user_id == user.id)):
        if r.module not in best or r.score > best[r.module].score:
            best[r.module] = r
    return best


def progress(db: Session, user: User) -> dict:
    done = _completed(db, user)
    best = _best_quiz(db, user)
    modules = []
    unlocked = True
    for m in MODULES:
        slugs = [lesson["slug"] for lesson in m["lessons"]]
        completed = sum(1 for s in slugs if s in done)
        quiz = best.get(m["key"])
        passed = bool(quiz and quiz.passed)
        pct = (completed / len(slugs) * 0.8 + (0.2 if passed else 0)) * 100
        modules.append(
            {
                "key": m["key"],
                "title": m["title"],
                "category": m["category"],
                "description": m["description"],
                "lessons_total": len(slugs),
                "lessons_completed": completed,
                "percent": round(pct),
                "quiz_score": quiz.score if quiz else None,
                "quiz_passed": passed,
                "unlocked": unlocked,
                "quiz_questions": len(m["quiz"]),
            }
        )
        unlocked = unlocked and passed
    total = sum(len(m["lessons"]) for m in MODULES)
    return {
        "xp": user.xp,
        "level": 1 + user.xp // 250,
        "lessons_completed": len(done & set(LESSONS_BY_SLUG)),
        "lessons_total": total,
        "modules": modules,
        "categories": _categories(modules),
        "pass_score": PASS_SCORE,
    }


def _categories(modules: list[dict]) -> list[dict]:
    """The 'Candlesticks 100% / Market Structure 60% ...' view."""
    agg: dict[str, list[float]] = {}
    for m in modules:
        agg.setdefault(m["category"], []).append(m["percent"])
    return [{"category": k, "percent": round(sum(v) / len(v))} for k, v in agg.items()]


def module_detail(db: Session, user: User, key: str) -> dict:
    m = MODULES_BY_KEY[key]
    done = _completed(db, user)
    p = next(x for x in progress(db, user)["modules"] if x["key"] == key)
    return {
        **p,
        "lessons": [
            {
                "slug": lesson["slug"],
                "title": lesson["title"],
                "summary": lesson["summary"],
                "xp": lesson["xp"],
                "completed": lesson["slug"] in done,
                "visual": (lesson.get("visual") or {}).get("type"),
            }
            for lesson in m["lessons"]
        ],
    }


def lesson_detail(db: Session, user: User, slug: str) -> dict:
    lesson = LESSONS_BY_SLUG[slug]
    m = MODULES_BY_KEY[lesson["module"]]
    slugs = [x["slug"] for x in m["lessons"]]
    i = slugs.index(slug)
    done = _completed(db, user)
    unlocked = next(x for x in progress(db, user)["modules"] if x["key"] == m["key"])["unlocked"]
    return {
        **lesson,
        "module_title": m["title"],
        "completed": slug in done,
        "module_unlocked": unlocked,
        "prev": slugs[i - 1] if i > 0 else None,
        "next": slugs[i + 1] if i + 1 < len(slugs) else None,
        "index": i + 1,
        "count": len(slugs),
    }


def complete_lesson(db: Session, user: User, slug: str) -> dict:
    lesson = LESSONS_BY_SLUG[slug]
    exists = db.scalar(
        select(LearningProgress).where(LearningProgress.user_id == user.id, LearningProgress.lesson_slug == slug)
    )
    gained = 0
    if exists is None:
        db.add(LearningProgress(user_id=user.id, lesson_slug=slug, module=lesson["module"]))
        user.xp += lesson["xp"]
        gained = lesson["xp"]
        db.commit()
    return {"xp_gained": gained, "xp": user.xp}


def quiz_for(key: str) -> dict:
    m = MODULES_BY_KEY[key]
    return {
        "module": key,
        "title": m["title"],
        "questions": [{"id": x["id"], "question": x["question"], "options": x["options"]} for x in m["quiz"]],
        "pass_score": PASS_SCORE,
    }


def submit_quiz(db: Session, user: User, key: str, answers: dict[str, int]) -> dict:
    m = MODULES_BY_KEY[key]
    results = []
    correct = 0
    for x in m["quiz"]:
        given = answers.get(x["id"])
        ok = given == x["answer"]
        correct += ok
        results.append(
            {
                "id": x["id"],
                "question": x["question"],
                "your_answer": given,
                "correct_answer": x["answer"],
                "options": x["options"],
                "correct": ok,
                "explanation": x["explanation"],
            }
        )
    total = len(m["quiz"])
    score = correct / total if total else 0
    passed = score >= PASS_SCORE
    already = db.scalar(
        select(QuizResult).where(QuizResult.user_id == user.id, QuizResult.module == key, QuizResult.passed.is_(True))
    )
    db.add(
        QuizResult(
            user_id=user.id,
            module=key,
            score=score,
            correct=correct,
            total=total,
            passed=passed,
            answers={k: v for k, v in answers.items()},
        )
    )
    gained = 0
    if passed and already is None:
        user.xp += QUIZ_XP
        gained = QUIZ_XP
    db.commit()
    nxt = None
    keys = [mm["key"] for mm in MODULES]
    if passed and keys.index(key) + 1 < len(keys):
        nxt = keys[keys.index(key) + 1]
    return {
        "score": score,
        "correct": correct,
        "total": total,
        "passed": passed,
        "results": results,
        "xp_gained": gained,
        "unlocked_module": nxt,
    }
