"""S3a — unlock rule (incl. legacy users), /api/learn/path and the additive /api/academy/* changes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.academy import levels as lv
from app.academy.content import LESSONS_BY_SLUG, MODULES, MODULES_BY_KEY
from app.main import app
from app.models import LearningProgress, QuizResult, User

LEVEL_KEYS = {
    "level",
    "key",
    "title",
    "title_bg",
    "goal",
    "unlock",
    "status",
    "percent",
    "lessons_total",
    "lessons_completed",
    "xp_total",
    "quiz",
    "modules",
    "labs",
}
LESSON_KEYS = {"slug", "title", "summary", "completed", "xp", "visual_type", "href"}


def _user(db, client) -> User:
    db.expire_all()
    return db.get(User, client.get("/api/auth/me").json()["id"])


def _answers(key: str, correct: bool = True) -> dict:
    out = {}
    for q in MODULES_BY_KEY[key]["quiz"]:
        out[q["id"]] = q["answer"] if correct else (q["answer"] + 1) % len(q["options"])
    return {"answers": out}


def _complete_everything(db, user: User) -> None:
    for m in MODULES:
        for lesson in m["lessons"]:
            db.add(LearningProgress(user_id=user.id, lesson_slug=lesson["slug"], module=m["key"]))
        n = len(m["quiz"])
        db.add(QuizResult(user_id=user.id, module=m["key"], score=1.0, correct=n, total=n, passed=True, answers={}))
    db.commit()


# ------------------------------------------------------------------------------------- unlock rule
def _unlocked(done=(), passed=()) -> set[str]:
    return {k for k, v in lv.unlocked_modules(done, passed).items() if v}


def test_unlock_rule_fresh_and_previous_quiz():
    assert _unlocked() == {"level0"}
    assert _unlocked(passed={"level0"}) == {"level0", "charts"}
    # every module is unlocked by passing the quiz of the module before it in the V2 order
    order = [m["key"] for m in MODULES]
    for prev, key in zip(order, order[1:], strict=False):
        assert key in _unlocked(passed={prev}), key


def test_unlock_rule_any_completed_lesson_unlocks_its_module():
    assert "backtesting" in _unlocked(done={"walk-forward"})
    assert "advanced" in _unlocked(done={"event-risk"})
    assert "leverage" in _unlocked(done={"initial-margin"})
    assert _unlocked(done={"unknown-slug"}) == {"level0"}


def test_unlock_rule_keeps_legacy_users_unlocked():
    # legacy chain level0 → … → psychology passed: strategy was unlocked before V2 and stays unlocked even though the
    # new module before it ('leverage') has no passed quiz
    legacy = {"level0", "charts", "technical", "indicators", "price_action", "risk", "psychology"}
    got = _unlocked(passed=legacy)
    assert {"strategy", "psychology", "leverage", "advanced"} <= got
    assert "backtesting" not in got  # new module: needs the strategy quiz or a started lesson
    # legacy chain up to risk: psychology (old position 6) stays unlocked; strategy does not (it never was)
    upto_risk = {"level0", "charts", "technical", "indicators", "price_action", "risk"}
    got = _unlocked(passed=upto_risk)
    assert {"psychology", "leverage"} <= got and "strategy" not in got
    # the legacy rule is a chain: a lone risk pass does not unlock psychology
    assert _unlocked(passed={"risk"}) == {"level0", "leverage"}


# ----------------------------------------------------------------------------------- /api/learn/path
def test_learn_path_requires_login():
    anon = TestClient(app)
    assert anon.get("/api/learn/path").status_code == 401
    assert anon.get("/api/learn/dashboard").status_code == 401


def test_learn_path_fresh_guest(guest):
    r = guest.get("/api/learn/path")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {
        "levels",
        "current_level",
        "next",
        "pass_score",
        "lessons_total",
        "lessons_completed",
        "levels_completed",
    }
    levels = body["levels"]
    assert [x["level"] for x in levels] == list(range(11))
    for x in levels:
        assert set(x) == LEVEL_KEYS
        assert x["percent"] == 0 and x["lessons_completed"] == 0
        assert set(x["quiz"]) == {"key", "title", "best_score", "best_pct", "passed", "attempts", "questions", "href"}
        assert x["quiz"]["best_score"] is None and x["quiz"]["passed"] is False and x["quiz"]["attempts"] == 0
        for m in x["modules"]:
            for lesson in m["lessons"]:
                assert set(lesson) == LESSON_KEYS and lesson["completed"] is False
    assert [x["status"] for x in levels] == ["available"] + ["locked"] * 10
    assert body["current_level"] == 0 and body["levels_completed"] == 0
    assert body["lessons_total"] == len(LESSONS_BY_SLUG)
    assert body["next"] == {
        "type": "lesson",
        "href": "/learn/what-is-a-financial-market",
        "title": LESSONS_BY_SLUG["what-is-a-financial-market"]["title"],
        "level": 0,
        "slug": "what-is-a-financial-market",
        "module": "level0",
    }
    lvl0_lessons = {x["slug"]: x for x in levels[0]["modules"][0]["lessons"]}
    assert lvl0_lessons["leverage"]["href"] == "/learn/leverage-basics"  # /learn/leverage is the Leverage Lab
    assert levels[0]["quiz"]["href"] == "/learn/quiz/level0"
    labs = {lab["href"]: lab for x in levels for lab in x["labs"]}
    assert labs["/learn/candlesticks"]["attempted"] is False
    assert labs["/learn/market-structure"]["attempted"] is False
    assert labs["/learn/leverage"]["attempted"] is None  # not tracked
    for href in ("/strategies", "/backtesting", "/journal", "/replay"):
        assert labs[href]["attempted"] is False, href
    assert levels[6]["modules"][0]["key"] == "leverage" and levels[6]["title"] == "Leverage & Margin"


def test_learn_path_progression(guest):
    level0 = [x["slug"] for x in MODULES_BY_KEY["level0"]["lessons"]]
    assert guest.post(f"/api/academy/lessons/{level0[0]}/complete").json()["xp_gained"] == 10
    body = guest.get("/api/learn/path").json()
    lvl0 = body["levels"][0]
    assert lvl0["status"] == "in_progress" and lvl0["lessons_completed"] == 1 and lvl0["percent"] > 0
    assert body["next"]["slug"] == level0[1]

    for slug in level0[1:]:
        guest.post(f"/api/academy/lessons/{lv.lesson_route(slug)}/complete")  # alias routes work for completion
    body = guest.get("/api/learn/path").json()
    assert body["levels"][0]["percent"] == 80 and body["levels"][0]["lessons_completed"] == len(level0)
    assert body["next"] == {
        "type": "quiz",
        "href": "/learn/quiz/level0",
        "title": f"Quiz: {MODULES_BY_KEY['level0']['title']}",
        "level": 0,
        "slug": None,
        "module": "level0",
    }

    failed = guest.post("/api/academy/quiz/level0", json=_answers("level0", correct=False)).json()
    assert failed["passed"] is False
    body = guest.get("/api/learn/path").json()
    assert body["levels"][0]["status"] == "in_progress" and body["levels"][0]["quiz"]["attempts"] == 1
    assert body["levels"][1]["status"] == "locked" and body["next"]["type"] == "quiz"

    passed = guest.post("/api/academy/quiz/level0", json=_answers("level0")).json()
    assert passed["passed"] is True and passed["unlocked_module"] == "charts"
    body = guest.get("/api/learn/path").json()
    lvl0, lvl1 = body["levels"][0], body["levels"][1]
    assert lvl0["status"] == "completed" and lvl0["percent"] == 100
    assert lvl0["quiz"]["passed"] is True and lvl0["quiz"]["best_score"] == 1.0 and lvl0["quiz"]["best_pct"] == 100
    assert lvl0["quiz"]["attempts"] == 2
    assert lvl1["status"] == "available" and body["current_level"] == 1 and body["levels_completed"] == 1
    assert body["next"]["type"] == "lesson" and body["next"]["slug"] == "what-is-a-chart"
    assert body["next"]["href"] == "/learn/what-is-a-chart"


def test_learn_path_lesson_in_a_later_level_unlocks_it(guest):
    guest.post("/api/academy/lessons/event-risk/complete")
    body = guest.get("/api/learn/path").json()
    assert body["levels"][10]["status"] == "in_progress"
    assert body["levels"][9]["status"] == "locked"
    assert body["current_level"] == 0  # the path still starts from the first unfinished level


def test_learn_path_everything_completed(guest, db):
    _complete_everything(db, _user(db, guest))
    body = guest.get("/api/learn/path").json()
    assert all(x["status"] == "completed" and x["percent"] == 100 for x in body["levels"])
    assert body["current_level"] == 10 and body["levels_completed"] == 11
    assert body["next"]["type"] == "lab" and body["next"]["href"] == "/replay"


# ------------------------------------------------------------------------------- /api/academy compat
def test_academy_progress_and_modules_gain_level_additively(guest):
    prog = guest.get("/api/academy/progress").json()
    assert [m["key"] for m in prog["modules"]] == [m["key"] for m in MODULES]
    assert [m["level"] for m in prog["modules"]] == list(range(11))
    for m in prog["modules"]:  # the old keys are all still there
        assert {
            "key",
            "title",
            "category",
            "description",
            "lessons_total",
            "lessons_completed",
            "percent",
            "quiz_score",
            "quiz_passed",
            "unlocked",
            "quiz_questions",
        } <= set(m)
    assert {c["category"] for c in prog["categories"]} >= {"Leverage & Margin", "Backtesting", "Advanced Analysis"}
    mods = guest.get("/api/academy/modules").json()["modules"]
    assert [m["level"] for m in mods] == list(range(11))
    assert all(
        {"slug", "title", "summary", "xp", "completed", "visual", "href"} <= set(x) for m in mods for x in m["lessons"]
    )
    one = guest.get("/api/academy/modules/backtesting").json()
    assert one["level"] == 8 and one["lessons_total"] >= 7


def test_lesson_alias_routes_and_hrefs(guest):
    r = guest.get("/api/academy/lessons/leverage-basics")
    assert r.status_code == 200 and r.json()["slug"] == "leverage"
    assert r.json()["href"] == "/learn/leverage-basics"
    assert guest.get("/api/academy/lessons/market-structure-basics").json()["slug"] == "market-structure"
    assert guest.post("/api/academy/lessons/leverage-basics/complete").json()["xp_gained"] == 10
    assert guest.post("/api/academy/lessons/leverage/complete").json()["xp_gained"] == 0  # same lesson
    assert guest.get("/api/academy/lessons/leverage").json()["completed"] is True
    margin = guest.get("/api/academy/lessons/margin").json()
    assert margin["prev"] == "leverage" and margin["prev_href"] == "/learn/leverage-basics"
    assert margin["next"] == "liquidation" and margin["next_href"] == "/learn/liquidation"
    upper = guest.get("/api/academy/lessons/upper-wick").json()
    assert upper["prev"] == "wick" and upper["next"] == "lower-wick"
    assert (
        upper["level"] == 1
        and upper["level_title"] == "Charts & Candlesticks"
        and upper["quiz_href"] == "/learn/quiz/charts"
    )
    assert guest.get("/api/academy/lessons/leverage-basicsx").status_code == 404


@pytest.mark.parametrize("key", ["leverage", "backtesting", "advanced"])
def test_new_module_quizzes_through_the_academy_api(guest, key):
    quiz = guest.get(f"/api/academy/quiz/{key}").json()
    assert quiz["module"] == key and 8 <= len(quiz["questions"]) <= 10
    assert all("answer" not in q for q in quiz["questions"])
    res = guest.post(f"/api/academy/quiz/{key}", json=_answers(key)).json()
    order = [m["key"] for m in MODULES]
    nxt = order[order.index(key) + 1] if order.index(key) + 1 < len(order) else None
    assert res["passed"] is True and res["score"] == 1 and res["unlocked_module"] == nxt


def test_risk_quiz_now_unlocks_leverage(guest):
    res = guest.post("/api/academy/quiz/risk", json=_answers("risk")).json()
    assert res["unlocked_module"] == "leverage"
    prog = {m["key"]: m for m in guest.get("/api/academy/progress").json()["modules"]}
    assert prog["leverage"]["unlocked"] is True and prog["strategy"]["unlocked"] is False
