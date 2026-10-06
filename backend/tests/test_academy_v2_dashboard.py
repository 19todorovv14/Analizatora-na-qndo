"""S3a — /api/learn/dashboard: headline numbers, risk discipline, most common mistake, skills, recommendations."""

from __future__ import annotations

import pytest

from app.academy import levels as lv
from app.academy.content import MODULES_BY_KEY
from app.models import JournalEntry, PaperTrade, QuizResult, ReplaySession, Strategy, StructureAttempt, User
from app.services import learning_service, paper_service
from app.services.learning_service import most_common_mistake, risk_discipline

DASH_KEYS = {
    "current_level",
    "next",
    "xp",
    "xp_level",
    "xp_progress",
    "lessons_completed",
    "lessons_total",
    "levels_completed",
    "levels_total",
    "quiz_avg_score",
    "quizzes_passed",
    "quizzes_total",
    "replay_score",
    "replay_sessions",
    "replay_finished",
    "paper_trades",
    "risk_discipline",
    "most_common_mistake",
    "skills",
    "strongest_skill",
    "weakest_skill",
    "recommendations",
}
SKILL_KEYS = ["candles", "structure", "indicators", "risk", "leverage", "strategy", "backtesting", "psychology"]


def _user(db, client) -> User:
    db.expire_all()
    return db.get(User, client.get("/api/auth/me").json()["id"])


def _trade(pid: str, *, stop=None, target=None, risk_pct=None, planned_rr=None, widened=False, slice_no=0, **kw):
    meta = {"risk_pct": risk_pct, "stop_widened": widened}
    if planned_rr is not None:
        meta["planned_rr"] = planned_rr
    base = 1_780_000_000 + int(pid[-1]) * 3600
    return {
        "id": f"{pid}-{slice_no}",
        "position_id": pid,
        "symbol": "BTC/USDT",
        "side": "buy",
        "qty": 1.0,
        "entry_price": 100.0,
        "exit_price": 101.0,
        "stop_price": stop,
        "target_price": target,
        "gross_pnl": 1.0,
        "fees": 0.0,
        "net_pnl": kw.get("net", 1.0),
        "risk_amount": None,
        "r_multiple": None,
        "exit_reason": "manual",
        "opened_ts": base,
        "closed_ts": base + 600 + slice_no * 60,
        "meta": meta,
    }


THREE_POSITIONS = [
    _trade("p1", stop=98.0, target=104.0, risk_pct=0.8, planned_rr=2.0),  # textbook
    _trade("p2"),  # no stop, no target, risk unknown
    # oversized, poor R:R, stop widened before a partial close (two slices of one position)
    _trade("p3", stop=99.0, target=101.0, risk_pct=2.5, planned_rr=1.0, widened=True, slice_no=0),
    _trade("p3", stop=99.0, target=101.0, risk_pct=2.5, planned_rr=1.0, widened=True, slice_no=1),
]


# ------------------------------------------------------------------------------------ pure helpers
def test_risk_discipline_without_trades_is_null():
    rd = risk_discipline([], 1.0, 1.5)
    assert rd["score"] is None and rd["trades"] == 0
    assert rd["components"] == {
        "with_stop_pct": None,
        "within_risk_rule_pct": None,
        "no_widened_stops_pct": None,
        "rr_ok_pct": None,
    }


def test_risk_discipline_components_and_weights():
    rd = risk_discipline(THREE_POSITIONS, 1.0, 1.5)
    assert rd["trades"] == 3  # the partial close of p3 counts once
    c = rd["components"]
    assert c == {"with_stop_pct": 66.7, "within_risk_rule_pct": 33.3, "no_widened_stops_pct": 50.0, "rr_ok_pct": 33.3}
    expected = (66.7 * 0.35 + 33.3 * 0.30 + 50.0 * 0.20 + 33.3 * 0.15) / 1.0
    assert rd["score"] == round(expected) == 48
    assert rd["rules"] == {"max_risk_per_trade_pct": 1.0, "min_reward_risk": 1.5}
    perfect = risk_discipline([THREE_POSITIONS[0]], 1.0, 1.5)
    assert perfect["score"] == 100
    # planned R:R falls back to entry/stop/target when the order meta has none
    t = _trade("p4", stop=98.0, target=103.0, risk_pct=0.5)
    assert risk_discipline([t], 1.0, 1.5)["components"]["rr_ok_pct"] == 100.0


def test_most_common_mistake_merges_behaviour_and_journal():
    assert most_common_mistake([], []) is None
    findings = [
        {"kind": "no_stop", "title": "Trading without a stop", "severity": "high", "count": 1, "lesson": "stop-order"},
        {"kind": "moving_stops", "title": "Moving stops", "severity": "high", "count": 1, "lesson": "x"},
    ]
    journal = [{"mistakes": ["moved stop further away"]}, {"mistakes": ["Moved stop further away", "fomo"]}]
    m = most_common_mistake(findings, journal)
    assert m["key"] == "moving_stops" and m["count"] == 3 and m["source"] == "both"
    assert m["lesson"] == "stop-loss-placement" and m["href"] == "/learn/stop-loss-placement"
    assert m["title"] == "Moving stops" and m["title_bg"] and m["lesson_title"]
    # journal-only chips map onto lessons too
    early = most_common_mistake([], [{"mistakes": ["entered before confirmation"]}] * 2)
    assert early["key"] == "early_entry" and early["lesson"] == "fakeout" and early["source"] == "journal"
    # a free-text tag is reported honestly without a lesson
    custom = most_common_mistake([], [{"mistakes": ["Bought the news"]}])
    assert custom["key"] == "journal:bought the news" and custom["title"] == "Bought the news"
    assert custom["lesson"] is None and custom["href"] is None
    # ties: the high-severity behaviour finding wins
    tie = most_common_mistake(
        [
            {"kind": "overtrading", "title": "Overtrading", "severity": "warn", "count": 2},
            {"kind": "no_stop", "title": "Trading without a stop", "severity": "high", "count": 2},
        ],
        [],
    )
    assert tie["key"] == "no_stop"


def test_skill_score_formula():
    skill = lv.SKILLS_BY_KEY["candles"]
    charts = [x["slug"] for x in MODULES_BY_KEY["charts"]["lessons"]]
    half = charts[: len(charts) // 2]
    s = lv.skill_score(skill, half, {"charts": 0.5})
    lessons_pct = len(half) / len(charts) * 100
    assert s["score"] == round(0.6 * lessons_pct + 0.4 * 50)
    assert s["inputs"]["quiz_pct"] == 50.0 and s["inputs"]["practice_avg"] is None
    with_lab = lv.skill_score(skill, charts, {"charts": 1.0}, [{"key": "lab", "label": "Lab", "score": 50}])
    assert with_lab["score"] == round(0.6 * 100 + 0.4 * 50) == 80
    assert "Lab 50/100" in with_lab["basis"]
    assert lv.skill_score(skill, [], {})["score"] == 0


# --------------------------------------------------------------------------------------- endpoint
def test_dashboard_fresh_guest(guest):
    r = guest.get("/api/learn/dashboard")
    assert r.status_code == 200
    d = r.json()
    assert set(d) == DASH_KEYS
    assert d["current_level"] == {
        "level": 0,
        "key": "market-basics",
        "title": "Market Basics",
        "title_bg": "Основи на пазара",
        "status": "available",
        "percent": 0,
    }
    assert d["xp"] == 0 and d["xp_level"] == 1
    assert d["xp_progress"] == {"level_start": 0, "next_level_at": 250, "into_level": 0, "needed": 250, "percent": 0}
    assert d["lessons_completed"] == 0 and d["levels_total"] == 11 and d["quizzes_total"] == 11
    assert d["quiz_avg_score"] is None and d["quizzes_passed"] == 0
    assert d["replay_score"] is None and d["replay_sessions"] == 0 and d["paper_trades"] == 0
    assert d["risk_discipline"]["score"] is None and d["most_common_mistake"] is None
    assert [s["key"] for s in d["skills"]] == SKILL_KEYS
    assert all(s["score"] == 0 and s["basis"] for s in d["skills"])
    assert d["strongest_skill"] is None and d["weakest_skill"] is None
    assert d["next"]["href"] == "/learn/what-is-a-financial-market"
    recs = d["recommendations"]
    assert recs[0]["kind"] == "continue" and recs[0]["href"] == d["next"]["href"]
    assert all(set(x) == {"kind", "title", "href", "reason"} for x in recs)


def test_dashboard_after_lessons_quiz_and_practice(guest, db):
    charts = [x["slug"] for x in MODULES_BY_KEY["charts"]["lessons"]]
    for slug in charts:
        guest.post(f"/api/academy/lessons/{slug}/complete")
    answers = {q["id"]: q["answer"] for q in MODULES_BY_KEY["charts"]["quiz"]}
    assert guest.post("/api/academy/quiz/charts", json={"answers": answers}).json()["passed"]
    xp = sum(x["xp"] for x in MODULES_BY_KEY["charts"]["lessons"]) + learning_service.QUIZ_XP

    user = _user(db, guest)
    acc = paper_service.get_manual_account(db, user)
    db.add_all(
        [
            ReplaySession(
                user_id=user.id,
                account_id=acc.id,
                symbol="BTC/USDT",
                timeframe="1h",
                start_ts=0,
                cursor_ts=0,
                end_ts=1,
                status="finished",
                score=60.0,
            ),
            ReplaySession(
                user_id=user.id,
                account_id=acc.id,
                symbol="BTC/USDT",
                timeframe="1h",
                start_ts=0,
                cursor_ts=0,
                end_ts=1,
                status="finished",
                score=80.0,
            ),
            ReplaySession(
                user_id=user.id,
                account_id=acc.id,
                symbol="BTC/USDT",
                timeframe="1h",
                start_ts=0,
                cursor_ts=0,
                end_ts=1,
                status="active",
                score=None,
            ),
            StructureAttempt(
                user_id=user.id,
                symbol="BTC/USDT",
                timeframe="1h",
                start_ts=0,
                end_ts=1,
                marks=[],
                result={},
                score=40.0,
            ),
            StructureAttempt(
                user_id=user.id,
                symbol="BTC/USDT",
                timeframe="1h",
                start_ts=0,
                end_ts=1,
                marks=[],
                result={},
                score=60.0,
            ),
            QuizResult(
                user_id=user.id,
                module=learning_service.CANDLESTICK_LAB_QUIZ,
                score=0.9,
                correct=9,
                total=10,
                passed=True,
                answers={},
            ),
        ]
    )
    db.commit()

    d = guest.get("/api/learn/dashboard").json()
    assert d["xp"] == xp and d["xp_level"] == 1 + xp // 250
    assert d["xp_progress"]["into_level"] == xp % 250
    assert d["lessons_completed"] == len(charts)
    assert d["quiz_avg_score"] == 100.0 and d["quizzes_passed"] == 1  # the lab practice is not an academy quiz
    assert d["replay_score"] == 70.0 and d["replay_sessions"] == 3 and d["replay_finished"] == 2
    skills = {s["key"]: s for s in d["skills"]}
    assert skills["candles"]["score"] == round(0.6 * 100 + 0.4 * 90) == 96
    assert skills["candles"]["inputs"]["practice"] == [
        {"key": "candlestick_lab", "label": "Candlestick Lab", "score": 90.0}
    ]
    assert skills["structure"]["inputs"]["practice_avg"] == 50.0
    assert skills["structure"]["score"] == round(0.4 * 50)  # no structure lessons yet, lab average 50
    assert skills["strategy"]["inputs"]["practice"][0]["key"] == "replay"
    assert skills["strategy"]["score"] == round(0.4 * 70)
    assert d["strongest_skill"] == {"key": "candles", "title": "Candlesticks", "title_bg": "Японски свещи", "score": 96}
    assert d["weakest_skill"]["score"] == 0 and d["weakest_skill"]["key"] == "indicators"
    # level 0 is not finished, so the path continues there
    assert d["current_level"]["level"] == 0 and d["next"]["module"] == "level0"
    kinds = [x["kind"] for x in d["recommendations"]]
    assert kinds[0] == "continue" and "skill" in kinds and len(d["recommendations"]) <= 5
    labs = guest.get("/api/learn/path").json()["levels"]
    attempted = {lab["href"]: lab["attempted"] for x in labs for lab in x["labs"]}
    assert attempted["/learn/candlesticks"] is True and attempted["/learn/market-structure"] is True
    assert attempted["/replay"] is True
    assert attempted["/strategies"] is False  # only the onboarding sample strategy so far
    db.add(Strategy(user_id=user.id, name="Моят breakout", definition={}))
    db.commit()
    labs = guest.get("/api/learn/path").json()["levels"]
    assert {lab["href"]: lab["attempted"] for x in labs for lab in x["labs"]}["/strategies"] is True


def test_dashboard_with_paper_trades_and_journal(guest, db):
    user = _user(db, guest)
    acc = paper_service.get_manual_account(db, user)
    for t in THREE_POSITIONS:
        db.add(
            PaperTrade(
                **{**t, "id": f"{user.id}-{t['id']}", "position_id": f"{user.id}{t['position_id']}"}, account_id=acc.id
            )
        )
    db.add(JournalEntry(user_id=user.id, mistakes=["moved stop further away"]))
    db.commit()

    d = guest.get("/api/learn/dashboard").json()
    rules = d["risk_discipline"]["rules"]
    expected = risk_discipline(THREE_POSITIONS, rules["max_risk_per_trade_pct"], rules["min_reward_risk"])
    assert d["paper_trades"] == 3
    assert d["risk_discipline"] == expected
    m = d["most_common_mistake"]
    assert m["key"] == "moving_stops" and m["count"] == 2 and m["source"] == "both"
    assert m["href"] == "/learn/stop-loss-placement"
    skills = {s["key"]: s for s in d["skills"]}
    assert skills["risk"]["inputs"]["practice"][0] == {
        "key": "risk_discipline",
        "label": "Risk discipline",
        "score": float(expected["score"]),
    }
    assert skills["psychology"]["inputs"]["practice"][0]["key"] == "behavior"
    recs = {x["kind"]: x for x in d["recommendations"]}
    assert recs["mistake"]["href"] == "/learn/stop-loss-placement"
    assert recs["risk"]["href"] == "/learn/stop-order"  # a third of the trades had no stop loss
    assert "33%" in recs["risk"]["reason"]


@pytest.mark.parametrize(("xp", "level", "into"), [(0, 1, 0), (249, 1, 249), (250, 2, 0), (610, 3, 110)])
def test_xp_progress(xp, level, into):
    p = learning_service._xp_progress(xp)
    assert 1 + xp // learning_service.XP_PER_LEVEL == level
    assert p["into_level"] == into and p["needed"] == 250 - into and p["next_level_at"] == (level) * 250
