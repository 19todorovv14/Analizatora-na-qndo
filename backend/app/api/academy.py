from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.academy import challenges as ch
from app.academy.content import LESSONS_BY_SLUG, MODULES_BY_KEY
from app.academy.scenarios import SCENARIOS, get_scenario
from app.api.deps import current_user
from app.database import get_db
from app.models import User
from app.services import learning_service, stats_service

router = APIRouter(tags=["academy"])


def _module(key: str) -> str:
    if key not in MODULES_BY_KEY:
        raise HTTPException(status_code=404, detail="Модулът не е намерен.")
    return key


def _lesson(slug: str) -> str:
    if slug not in LESSONS_BY_SLUG:
        raise HTTPException(status_code=404, detail="Урокът не е намерен.")
    return slug


@router.get("/academy/progress")
def progress(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return learning_service.progress(db, user)


@router.get("/academy/modules")
def modules(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"modules": [learning_service.module_detail(db, user, k) for k in MODULES_BY_KEY]}


@router.get("/academy/modules/{key}")
def module(key: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return learning_service.module_detail(db, user, _module(key))


@router.get("/academy/lessons/{slug}")
def lesson(slug: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return learning_service.lesson_detail(db, user, _lesson(slug))


@router.post("/academy/lessons/{slug}/complete")
def complete(slug: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return learning_service.complete_lesson(db, user, _lesson(slug))


@router.get("/academy/quiz/{key}")
def quiz(key: str, user: User = Depends(current_user)):
    return learning_service.quiz_for(_module(key))


class QuizIn(BaseModel):
    answers: dict[str, int]


@router.post("/academy/quiz/{key}")
def submit_quiz(key: str, body: QuizIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return learning_service.submit_quiz(db, user, _module(key), body.answers)


@router.get("/academy/scenarios/{key}")
def scenario(key: str):
    if key not in SCENARIOS:
        raise HTTPException(status_code=404, detail="Unknown scenario")
    return get_scenario(key)


@router.get("/challenges")
def challenges(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"challenges": stats_service.evaluate_challenges(db, user), "xp": user.xp}


@router.get("/challenges/{key}/rounds")
def rounds(key: str, user: User = Depends(current_user)):
    if key not in ch.CHALLENGES_BY_KEY or ch.CHALLENGES_BY_KEY[key]["kind"] != "interactive":
        raise HTTPException(status_code=404, detail="Няма интерактивни рундове за това предизвикателство.")
    return {"key": key, "rounds": ch.new_rounds(key)}


class AttemptIn(BaseModel):
    answers: list[dict]


@router.post("/challenges/{key}/attempt")
def attempt(key: str, body: AttemptIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if key not in ch.CHALLENGES_BY_KEY or ch.CHALLENGES_BY_KEY[key]["kind"] != "interactive":
        raise HTTPException(status_code=404, detail="Unknown challenge")
    result = ch.grade(key, body.answers[:10])
    return stats_service.record_interactive(db, user, key, result)
