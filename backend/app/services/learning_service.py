"""Lessons, quizzes, XP, module unlocking, the LEVEL 0–10 learning path and the learning dashboard."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from statistics import mean

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.academy import levels as lv
from app.academy.content import LESSONS_BY_SLUG, MODULES, MODULES_BY_KEY, PASS_SCORE
from app.analysis.candles import anatomy
from app.market.base import Candle
from app.models import (
    Backtest,
    JournalEntry,
    LearningProgress,
    Lesson,
    QuizResult,
    ReplaySession,
    Strategy,
    StructureAttempt,
    User,
)

QUIZ_XP = 50
XP_PER_LEVEL = 250  # /academy/progress "level" = 1 + xp // XP_PER_LEVEL
CANDLESTICK_LAB_QUIZ = "lab:candlesticks"  # QuizResult.module written by the Candlestick Lab practice (S3b)
RECENT_ATTEMPTS = 5  # lab / replay evidence = average of the most recent attempts


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


def _quiz_attempts(db: Session, user: User) -> dict[str, int]:
    rows = db.execute(
        select(QuizResult.module, func.count()).where(QuizResult.user_id == user.id).group_by(QuizResult.module)
    )
    return {module: int(n) for module, n in rows}


def _passed(best: dict[str, QuizResult]) -> set[str]:
    return {k for k, r in best.items() if r.passed}


def _module_percent(completed: int, total: int, passed: bool) -> float:
    return (completed / total * 0.8 + (0.2 if passed else 0)) * 100 if total else (100.0 if passed else 0.0)


def progress(db: Session, user: User) -> dict:
    done = _completed(db, user)
    best = _best_quiz(db, user)
    unlocked = lv.unlocked_modules(done, _passed(best))
    modules = []
    for m in MODULES:
        slugs = [lesson["slug"] for lesson in m["lessons"]]
        completed = sum(1 for s in slugs if s in done)
        quiz = best.get(m["key"])
        passed = bool(quiz and quiz.passed)
        modules.append(
            {
                "key": m["key"],
                "title": m["title"],
                "category": m["category"],
                "description": m["description"],
                "level": lv.LEVEL_OF_MODULE[m["key"]],
                "lessons_total": len(slugs),
                "lessons_completed": completed,
                "percent": round(_module_percent(completed, len(slugs), passed)),
                "quiz_score": quiz.score if quiz else None,
                "quiz_passed": passed,
                "unlocked": unlocked[m["key"]],
                "quiz_questions": len(m["quiz"]),
            }
        )
    total = sum(len(m["lessons"]) for m in MODULES)
    return {
        "xp": user.xp,
        "level": 1 + user.xp // XP_PER_LEVEL,
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


def _lesson_rows(m: dict, done: set[str]) -> list[dict]:
    return [
        {
            "slug": lesson["slug"],
            "title": lesson["title"],
            "summary": lesson["summary"],
            "xp": lesson["xp"],
            "completed": lesson["slug"] in done,
            "visual": (lesson.get("visual") or {}).get("type"),
            "href": lv.lesson_href(lesson["slug"]),
        }
        for lesson in m["lessons"]
    ]


def module_detail(db: Session, user: User, key: str) -> dict:
    m = MODULES_BY_KEY[key]
    done = _completed(db, user)
    p = next(x for x in progress(db, user)["modules"] if x["key"] == key)
    return {**p, "lessons": _lesson_rows(m, done)}


def lesson_detail(db: Session, user: User, slug: str) -> dict:
    lesson = LESSONS_BY_SLUG[slug]
    m = MODULES_BY_KEY[lesson["module"]]
    slugs = [x["slug"] for x in m["lessons"]]
    i = slugs.index(slug)
    done = _completed(db, user)
    unlocked = next(x for x in progress(db, user)["modules"] if x["key"] == m["key"])["unlocked"]
    prev_slug = slugs[i - 1] if i > 0 else None
    next_slug = slugs[i + 1] if i + 1 < len(slugs) else None
    level = lv.LEVELS_BY_NUMBER[lv.LEVEL_OF_MODULE[m["key"]]]
    return {
        **lesson,
        "module_title": m["title"],
        "completed": slug in done,
        "module_unlocked": unlocked,
        "prev": prev_slug,
        "next": next_slug,
        "index": i + 1,
        "count": len(slugs),
        # V2 (additive): routing + path context
        "href": lv.lesson_href(slug),
        "prev_href": lv.lesson_href(prev_slug) if prev_slug else None,
        "next_href": lv.lesson_href(next_slug) if next_slug else None,
        "quiz_href": lv.quiz_href(m["key"]),
        "level": level["level"],
        "level_title": level["title"],
        "level_title_bg": level["title_bg"],
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


# ------------------------------------------------------------------------------------ learning path
def _count(db: Session, model, user: User) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(model.user_id == user.id)) or 0)


def _strategy_practiced(db: Session, user: User) -> bool:
    """Every account starts with one sample strategy (user_service.onboard); practice = a second strategy or an
    edit of a strategy after it was created."""
    rows = db.execute(select(Strategy.created_ts, Strategy.updated_ts).where(Strategy.user_id == user.id)).all()
    return len(rows) > 1 or any((updated or 0) > (created or 0) + 5 for created, updated in rows)


def _lab_attempted(db: Session, user: User, quiz_attempts: dict[str, int]) -> dict[str, bool]:
    """Which labs have evidence of practice. Labs that cannot be tracked are absent (→ attempted: null)."""
    return {
        "/learn/candlesticks": quiz_attempts.get(CANDLESTICK_LAB_QUIZ, 0) > 0,
        "/learn/market-structure": _count(db, StructureAttempt, user) > 0,
        "/strategies": _strategy_practiced(db, user),
        "/backtesting": _count(db, Backtest, user) > 0,
        "/journal": _count(db, JournalEntry, user) > 0,
        "/replay": _count(db, ReplaySession, user) > 0,
    }


def _level_status(unlocked: bool, percent: float, started: bool) -> str:
    if not unlocked:
        return "locked"
    if percent >= 100:
        return "completed"
    return "in_progress" if started else "available"


def learning_path(db: Session, user: User) -> dict:
    """GET /api/learn/path — the LEVEL 0–10 path with per-level status, lessons, quiz, labs and the next step."""
    done = _completed(db, user)
    best = _best_quiz(db, user)
    attempts = _quiz_attempts(db, user)
    passed = _passed(best)
    unlocked = lv.unlocked_modules(done, passed)
    attempted_labs = _lab_attempted(db, user, attempts)

    levels: list[dict] = []
    for lvl in lv.LEVELS:
        modules = []
        lessons_total = lessons_completed = 0
        xp_total = 0
        for key in lvl["modules"]:
            m = MODULES_BY_KEY[key]
            rows = _lesson_rows(m, done)
            n_done = sum(1 for r in rows if r["completed"])
            lessons_total += len(rows)
            lessons_completed += n_done
            xp_total += sum(r["xp"] for r in rows) + QUIZ_XP
            modules.append(
                {
                    "key": key,
                    "title": m["title"],
                    "description": m["description"],
                    "category": m["category"],
                    "unlocked": unlocked[key],
                    "lessons_total": len(rows),
                    "lessons_completed": n_done,
                    "percent": round(_module_percent(n_done, len(rows), key in passed)),
                    "quiz_href": lv.quiz_href(key),
                    "lessons": [
                        {
                            "slug": r["slug"],
                            "title": r["title"],
                            "summary": r["summary"],
                            "completed": r["completed"],
                            "xp": r["xp"],
                            "visual_type": r["visual"],
                            "href": r["href"],
                        }
                        for r in rows
                    ],
                }
            )
        quiz_key = lvl["modules"][-1]
        q = best.get(quiz_key)
        quiz = {
            "key": quiz_key,
            "title": f"Quiz: {MODULES_BY_KEY[quiz_key]['title']}",
            "best_score": q.score if q else None,
            "best_pct": round(q.score * 100) if q else None,
            "passed": quiz_key in passed,
            "attempts": attempts.get(quiz_key, 0),
            "questions": len(MODULES_BY_KEY[quiz_key]["quiz"]),
            "href": lv.quiz_href(quiz_key),
        }
        n_mod = len(lvl["modules"])
        percent = sum(_module_percent(m["lessons_completed"], m["lessons_total"], m["key"] in passed) for m in modules)
        percent /= n_mod
        started = lessons_completed > 0 or any(attempts.get(k, 0) > 0 for k in lvl["modules"])
        status = _level_status(any(unlocked[k] for k in lvl["modules"]), percent, started)
        levels.append(
            {
                "level": lvl["level"],
                "key": lvl["key"],
                "title": lvl["title"],
                "title_bg": lvl["title_bg"],
                "goal": lvl["goal"],
                "unlock": dict(lvl["unlock"]),
                "status": status,
                "percent": round(percent),
                "lessons_total": lessons_total,
                "lessons_completed": lessons_completed,
                "xp_total": xp_total,
                "quiz": quiz,
                "modules": modules,
                "labs": [{**lab, "attempted": attempted_labs.get(lab["href"])} for lab in lvl["labs"]],
            }
        )

    statuses = {x["level"]: x["status"] for x in levels}
    current = next((x for x in levels if x["status"] != "completed"), levels[-1])
    return {
        "levels": levels,
        "current_level": current["level"],
        "next": lv.next_step(statuses, done, passed),
        "pass_score": PASS_SCORE,
        "lessons_total": sum(x["lessons_total"] for x in levels),
        "lessons_completed": sum(x["lessons_completed"] for x in levels),
        "levels_completed": sum(1 for x in levels if x["status"] == "completed"),
    }


# ------------------------------------------------------------------------------- learning dashboard
# Journal "mistakes" chips (frontend/components/journal/JournalForm.tsx) → behaviour finding kinds.
JOURNAL_MISTAKE_KEYS = {
    "no stop loss": "no_stop",
    "position too large": "oversizing",
    "entered before confirmation": "early_entry",
    "chased the entry": "chasing",
    "moved stop further away": "moving_stops",
    "exited too early": "cut_winners",
    "revenge trade": "revenge_trading",
    "traded against the trend": "against_trend",
    "overtrading": "overtrading",
}
_EXTRA_MISTAKES = {
    "early_entry": ("Entered before confirmation", "fakeout"),
    "against_trend": ("Trading against the trend", "trend"),
}
MISTAKE_TITLES_BG = {
    "overtrading": "Прекалено много сделки",
    "oversizing": "Твърде голям размер на позицията",
    "revenge_trading": "Revenge trading след загуба",
    "moving_stops": "Местене на стопа по-далеч",
    "chasing": "Гонене на входа",
    "no_stop": "Сделки без stop loss",
    "cut_winners": "Режеш печалбите, държиш загубите",
    "early_entry": "Вход преди потвърждение",
    "against_trend": "Търговия срещу тренда",
}

# risk discipline weights (renormalised over the components that can be computed)
RISK_DISCIPLINE_WEIGHTS = {
    "with_stop_pct": 0.35,
    "within_risk_rule_pct": 0.30,
    "no_widened_stops_pct": 0.20,
    "rr_ok_pct": 0.15,
}


def _positions(trades: list[dict]) -> list[dict]:
    """Closed trade rows → one record per position (partial closes produce several rows)."""
    by_pos: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        by_pos[t["position_id"]].append(t)
    out = []
    for rows in by_pos.values():
        first = min(rows, key=lambda r: (r["opened_ts"], r["closed_ts"]))
        meta = first.get("meta") or {}
        entry, stop, target = first["entry_price"], first.get("stop_price"), first.get("target_price")
        planned_rr = meta.get("planned_rr")
        if planned_rr is None and stop is not None and target is not None and entry != stop:
            planned_rr = abs(target - entry) / abs(entry - stop)
        out.append(
            {
                "position_id": first["position_id"],
                "has_stop": stop is not None,
                "risk_pct": meta.get("risk_pct"),
                "planned_rr": planned_rr,
                "stop_widened": any((r.get("meta") or {}).get("stop_widened") for r in rows),
            }
        )
    return out


def risk_discipline(trades: list[dict], max_risk_pct: float, min_rr: float) -> dict:
    """Risk discipline 0–100 over closed paper positions (manual + replay accounts).

    Components (each a % of positions):
      with_stop_pct        — had a stop loss at entry;
      within_risk_rule_pct — risk at entry ≤ the user's max risk per trade (a position without a stop violates the
                             rule; a stopped position whose risk % was not recorded is left out);
      no_widened_stops_pct — of the positions with a stop, the stop was never moved further away;
      rr_ok_pct            — planned reward:risk ≥ the user's minimum (no stop or no target → no plan → not OK).
    score = weighted mean (35 / 30 / 20 / 15) of the components that exist; null when there are no trades.
    """
    pos = _positions(trades)
    n = len(pos)

    def pct(num: int, den: int) -> float | None:
        return round(num / den * 100, 1) if den else None

    with_stop = [p for p in pos if p["has_stop"]]
    risk_known = [p for p in with_stop if p["risk_pct"] is not None]
    within = sum(1 for p in risk_known if p["risk_pct"] <= max_risk_pct + 1e-9)
    risk_den = len(risk_known) + (n - len(with_stop))
    components = {
        "with_stop_pct": pct(len(with_stop), n),
        "within_risk_rule_pct": pct(within, risk_den),
        "no_widened_stops_pct": pct(sum(1 for p in with_stop if not p["stop_widened"]), len(with_stop)),
        "rr_ok_pct": pct(sum(1 for p in pos if p["planned_rr"] is not None and p["planned_rr"] >= min_rr - 1e-9), n),
    }
    weights = {k: w for k, w in RISK_DISCIPLINE_WEIGHTS.items() if components[k] is not None}
    score = round(sum(components[k] * w for k, w in weights.items()) / sum(weights.values())) if weights else None
    return {
        "score": score,
        "trades": n,
        "components": components,
        "rules": {"max_risk_per_trade_pct": max_risk_pct, "min_reward_risk": min_rr},
    }


def most_common_mistake(findings: list[dict], journal: list[dict]) -> dict | None:
    """Most frequent mistake from behaviour findings (paper/replay trades) + journal mistake chips.

    Behaviour counts = flagged trades per finding; journal counts = entries tagged with the mistake. Ties → the
    behaviour finding with high severity first, then the order of detection."""
    from app.psychology.behavior import LESSON_FOR, TITLES  # read-only reuse

    counts: dict[str, int] = defaultdict(int)
    sources: dict[str, set[str]] = defaultdict(set)
    severity: dict[str, int] = {}
    order: dict[str, int] = {}
    for i, f in enumerate(findings):
        counts[f["kind"]] += int(f.get("count") or 1)
        sources[f["kind"]].add("behavior")
        severity[f["kind"]] = 0 if f.get("severity") == "high" else 1
        order.setdefault(f["kind"], i)
    custom_titles: dict[str, str] = {}
    for e in journal:
        for tag in e.get("mistakes") or []:
            text = str(tag).strip()
            if not text:
                continue
            key = JOURNAL_MISTAKE_KEYS.get(text.lower()) or "journal:" + text.lower()[:60]
            if key.startswith("journal:"):
                custom_titles[key] = text[:80]
            counts[key] += 1
            sources[key].add("journal")
            order.setdefault(key, len(order) + 1000)
    if not counts:
        return None
    key = min(counts, key=lambda k: (-counts[k], severity.get(k, 1), order[k]))
    if key in TITLES:
        title, lesson = TITLES[key], LESSON_FOR.get(key)
    elif key in _EXTRA_MISTAKES:
        title, lesson = _EXTRA_MISTAKES[key]
    else:
        title, lesson = custom_titles.get(key, key), None
    if lesson not in LESSONS_BY_SLUG:
        lesson = None
    return {
        "key": key,
        "title": title,
        "title_bg": MISTAKE_TITLES_BG.get(key, title),
        "count": counts[key],
        "lesson": lesson,
        "lesson_title": LESSONS_BY_SLUG[lesson]["title"] if lesson else None,
        "href": lv.lesson_href(lesson) if lesson else None,
        "source": "both" if len(sources[key]) > 1 else next(iter(sources[key])),
    }


def _recent_scores(values: list[float]) -> float | None:
    vals = [float(v) for v in values if v is not None]
    return round(mean(vals[-RECENT_ATTEMPTS:]), 1) if vals else None


def _xp_progress(xp: int) -> dict:
    level_start = (xp // XP_PER_LEVEL) * XP_PER_LEVEL
    into = xp - level_start
    return {
        "level_start": level_start,
        "next_level_at": level_start + XP_PER_LEVEL,
        "into_level": into,
        "needed": XP_PER_LEVEL - into,
        "percent": round(into / XP_PER_LEVEL * 100),
    }


def learning_dashboard(db: Session, user: User) -> dict:
    """GET /api/learn/dashboard — learning progress + practice evidence + skills + recommendations."""
    from app.services import settings_service, stats_service  # lazy: stats_service imports this module

    path = learning_path(db, user)
    done = _completed(db, user)
    best = _best_quiz(db, user)
    module_best = {k: r.score for k, r in best.items() if k in MODULES_BY_KEY}

    # practice evidence -------------------------------------------------------------------------------
    replay_rows = db.execute(
        select(ReplaySession.status, ReplaySession.score)
        .where(ReplaySession.user_id == user.id)
        .order_by(ReplaySession.created_ts, ReplaySession.id)
    ).all()
    finished_scores = [s for status, s in replay_rows if status == "finished" and s is not None]
    replay_score = round(mean(finished_scores), 1) if finished_scores else None

    structure_scores = list(
        db.scalars(
            select(StructureAttempt.score)
            .where(StructureAttempt.user_id == user.id)
            .order_by(StructureAttempt.created_ts, StructureAttempt.id)
        )
    )
    candle_lab_scores = [
        s * 100 if s <= 1 else s
        for s in db.scalars(
            select(QuizResult.score)
            .where(QuizResult.user_id == user.id, QuizResult.module == CANDLESTICK_LAB_QUIZ)
            .order_by(QuizResult.created_ts, QuizResult.id)
        )
    ]

    trades = []
    ids = stats_service.user_account_ids(db, user)
    if ids:
        from app.services import paper_service

        trades = paper_service.closed_trades(db, ids)
    rules = settings_service.risk_rules(user)
    discipline = risk_discipline(trades, rules.max_risk_per_trade_pct, rules.min_reward_risk)
    beh = stats_service.behavior(db, user) if trades else {"findings": [], "discipline_score": None}
    mistake = most_common_mistake(beh["findings"], stats_service.journal_dicts(db, user))

    # skills -------------------------------------------------------------------------------------------
    practice: dict[str, list[dict]] = defaultdict(list)
    lab = _recent_scores(candle_lab_scores)
    if lab is not None:
        practice["candles"].append({"key": "candlestick_lab", "label": "Candlestick Lab", "score": lab})
    struct = _recent_scores(structure_scores)
    if struct is not None:
        practice["structure"].append({"key": "structure_lab", "label": "Structure Lab", "score": struct})
    if discipline["score"] is not None:
        practice["risk"].append({"key": "risk_discipline", "label": "Risk discipline", "score": discipline["score"]})
    if replay_score is not None:
        practice["strategy"].append({"key": "replay", "label": "Replay", "score": replay_score})
    if trades and beh.get("discipline_score") is not None:
        practice["psychology"].append(
            {"key": "behavior", "label": "Behaviour discipline", "score": beh["discipline_score"]}
        )
    skills = [lv.skill_score(s, done, module_best, practice.get(s["key"])) for s in lv.SKILLS]
    started = any(s["score"] > 0 for s in skills)
    strongest = max(skills, key=lambda s: s["score"]) if started else None
    weakest = min(skills, key=lambda s: s["score"]) if started else None

    # headline numbers ---------------------------------------------------------------------------------
    quiz_scores = list(module_best.values())
    current = next(x for x in path["levels"] if x["level"] == path["current_level"])
    paper_positions = len({t["position_id"] for t in trades})
    result = {
        "current_level": {
            "level": current["level"],
            "key": current["key"],
            "title": current["title"],
            "title_bg": current["title_bg"],
            "status": current["status"],
            "percent": current["percent"],
        },
        "next": path["next"],
        "xp": user.xp,
        "xp_level": 1 + user.xp // XP_PER_LEVEL,
        "xp_progress": _xp_progress(user.xp),
        "lessons_completed": path["lessons_completed"],
        "lessons_total": path["lessons_total"],
        "levels_completed": path["levels_completed"],
        "levels_total": len(path["levels"]),
        "quiz_avg_score": round(mean(quiz_scores) * 100, 1) if quiz_scores else None,
        "quizzes_passed": sum(1 for k in MODULES_BY_KEY if best.get(k) and best[k].passed),
        "quizzes_total": len(MODULES),
        "replay_score": replay_score,
        "replay_sessions": len(replay_rows),
        "replay_finished": sum(1 for status, _ in replay_rows if status == "finished"),
        "paper_trades": paper_positions,
        "risk_discipline": discipline,
        "most_common_mistake": mistake,
        "skills": skills,
        "strongest_skill": _brief(strongest) if strongest else None,
        "weakest_skill": _brief(weakest) if weakest else None,
    }
    result["recommendations"] = _recommendations(path, result, weakest)
    return result


def _brief(skill: dict) -> dict:
    return {k: skill[k] for k in ("key", "title", "title_bg", "score")}


def _recommendations(path: dict, dash: dict, weakest: dict | None) -> list[dict]:
    """Up to 5 concrete next actions, most important first, unique by href."""
    recs: list[dict] = []

    def add(kind: str, title: str, href: str | None, reason: str) -> None:
        if href and all(r["href"] != href for r in recs):
            recs.append({"kind": kind, "title": title, "href": href, "reason": reason})

    nxt = path["next"]
    lvl = next(x for x in path["levels"] if x["level"] == nxt["level"])
    add(
        "continue",
        f"Продължи: {nxt['title']}",
        nxt["href"],
        f"Следващата стъпка в LEVEL {lvl['level']} — {lvl['title_bg']}.",
    )

    mistake = dash["most_common_mistake"]
    if mistake and mistake["href"]:
        add(
            "mistake",
            f"Урок: {mistake['lesson_title']}",
            mistake["href"],
            f"Най-честата ти грешка: {mistake['title_bg']} ({mistake['count']}×).",
        )

    rd = dash["risk_discipline"]
    comps = rd["components"]
    if rd["trades"]:
        if comps["with_stop_pct"] is not None and comps["with_stop_pct"] < 100:
            add(
                "risk",
                f"Урок: {LESSONS_BY_SLUG['stop-order']['title']}",
                lv.lesson_href("stop-order"),
                f"{round(100 - comps['with_stop_pct'])}% от paper сделките ти са без stop loss.",
            )
        elif comps["within_risk_rule_pct"] is not None and comps["within_risk_rule_pct"] < 80:
            add(
                "risk",
                f"Урок: {LESSONS_BY_SLUG['position-sizing']['title']}",
                lv.lesson_href("position-sizing"),
                f"Само {round(comps['within_risk_rule_pct'])}% от сделките са в правилото ти за риск.",
            )
        elif comps["rr_ok_pct"] is not None and comps["rr_ok_pct"] < 50:
            add(
                "risk",
                f"Урок: {LESSONS_BY_SLUG['reward-risk']['title']}",
                lv.lesson_href("reward-risk"),
                f"Само {round(comps['rr_ok_pct'])}% от сделките имат планиран R:R ≥ {rd['rules']['min_reward_risk']:g}.",
            )

    if weakest is not None:
        add(
            "skill",
            f"Упражнение: {weakest['title']}",
            weakest["href"],
            f"Най-слабото ти умение: {weakest['title_bg']} ({weakest['score']}/100).",
        )

    current = next(x for x in path["levels"] if x["level"] == path["current_level"])
    for lab in current["labs"]:
        if lab["attempted"] is not True:
            add("lab", lab["title"], lab["href"], f"Практика към LEVEL {current['level']}: {lab['description']}")

    if dash["lessons_completed"] < 3:
        add("teacher", "Попитай AI Teacher", "/ai?mode=teach", "Всеки термин може да бъде обяснен с прост пример.")
    if path["current_level"] >= 5 and dash["paper_trades"] == 0:
        add(
            "practice",
            "Първа paper сделка със stop loss",
            "/trade",
            "Приложи наученото с виртуални пари: стоп, риск ≤ 1%, ясен план.",
        )
    if path["current_level"] >= 4 and dash["replay_sessions"] == 0:
        add("practice", "Replay сесия", "/replay", "Упражнявай решения свещ по свещ, без да знаеш продължението.")
    return recs[:5]


# ------------------------------------------------------------------- interactive candle drill-down
# parent timeframe → the lower timeframe that shows "what happened inside the candle"
DRILLDOWN_TIMEFRAME = {
    "5m": "1m",
    "15m": "1m",
    "30m": "1m",
    "1h": "5m",
    "4h": "15m",
    "1d": "1h",
    "1w": "1d",
}
DRILLDOWN_DISCLAIMER = "Историческо описание на минал период — не е прогноза за бъдещето."


class DrilldownError(ValueError):
    """Invalid drill-down request (maps to HTTP 400)."""


def _close_to(a: float, b: float) -> bool:
    return abs(a - b) <= max(1e-9, abs(b) * 1e-6)


def _fmt_price(v: float, precision: int) -> str:
    return f"{v:,.{precision}f}"


def _fmt_time(ts: int, child_tf: str) -> str:
    """Children of a weekly candle are days (dd.mm); everything else is within one day (HH:MM UTC)."""
    return datetime.fromtimestamp(ts, UTC).strftime("%d.%m" if child_tf in ("1d", "1w") else "%H:%M UTC")


def explain_inside(parent: dict, children: list[dict], timeframe: str, child_tf: str, precision: int) -> dict:
    """Pure: where the high and the low happened first, how open/close relate, the strongest sub-candle."""
    o, h, low, c = parent["open"], parent["high"], parent["low"], parent["close"]
    a = anatomy(Candle(parent["time"], o, h, low, c, parent.get("volume") or 0.0))
    rng = h - low
    p = precision
    change_pct = (c / o - 1) * 100 if o else 0.0
    direction_bg = {"bullish": "bullish (Close > Open)", "bearish": "bearish (Close < Open)"}.get(
        a["direction"], "neutral (Close = Open)"
    )
    lines = [
        f"{timeframe.upper()} свещта отваря на {_fmt_price(o, p)} и затваря на {_fmt_price(c, p)} "
        f"({change_pct:+.2f}%) — {direction_bg}. Вътре в нея има {len(children)} свещи по {child_tf}."
    ]
    path: dict = {
        "high_time": None,
        "low_time": None,
        "high_index": None,
        "low_index": None,
        "first_extreme": None,
        "close_position_pct": round((c - low) / rng * 100, 1) if rng else None,
        "open_position_pct": round((o - low) / rng * 100, 1) if rng else None,
        "largest_move": None,
    }
    if children:
        hi = max(range(len(children)), key=lambda i: (children[i]["high"], -i))
        lo = min(range(len(children)), key=lambda i: (children[i]["low"], i))
        first = "high" if hi < lo else "low" if lo < hi else "same"
        big = max(range(len(children)), key=lambda i: abs(children[i]["close"] - children[i]["open"]))
        bc = children[big]
        big_pct = (bc["close"] / bc["open"] - 1) * 100 if bc["open"] else 0.0
        path.update(
            {
                "high_time": children[hi]["time"],
                "low_time": children[lo]["time"],
                "high_index": hi,
                "low_index": lo,
                "first_extreme": first,
                "largest_move": {"time": bc["time"], "index": big, "change_pct": round(big_pct, 3)},
            }
        )
        t_hi, t_lo = _fmt_time(children[hi]["time"], child_tf), _fmt_time(children[lo]["time"], child_tf)
        if first == "low":
            lines.append(
                f"Първо цената пада до Low {_fmt_price(children[lo]['low'], p)} ({t_lo}), а след това се изкачва "
                f"до High {_fmt_price(children[hi]['high'], p)} ({t_hi})."
            )
        elif first == "high":
            lines.append(
                f"Първо цената достига High {_fmt_price(children[hi]['high'], p)} ({t_hi}), а след това пада до "
                f"Low {_fmt_price(children[lo]['low'], p)} ({t_lo})."
            )
        else:
            lines.append(
                f"High и Low са достигнати в една и съща {child_tf} свещ ({t_hi}) — редът не се вижда дори на този "
                "timeframe."
            )
        lines.append(f"Най-силното движение е {child_tf} свещта в {_fmt_time(bc['time'], child_tf)}: {big_pct:+.2f}%.")
    if rng:
        pos = (c - low) / rng * 100
        if pos >= 70:
            lines.append("Затварянето е близо до High — в края на периода купувачите задържат цената високо.")
        elif pos <= 30:
            lines.append("Затварянето е близо до Low — в края на периода продавачите контролират цената.")
        else:
            lines.append("Затварянето е в средата на диапазона — в края нито една страна не доминира.")
        if a["upper_wick_pct"] >= 40:
            lines.append(
                f"Горната сянка е {a['upper_wick_pct']:.0f}% от диапазона: цените над {_fmt_price(max(o, c), p)} са "
                "достигнати, но отхвърлени."
            )
        if a["lower_wick_pct"] >= 40:
            lines.append(
                f"Долната сянка е {a['lower_wick_pct']:.0f}% от диапазона: цените под {_fmt_price(min(o, c), p)} са "
                "достигнати, но отхвърлени."
            )
    else:
        lines.append("High = Low: през целия период цената не се е движила.")
    rounded = {
        k: (round(v, 1) if k.endswith("_pct") else round(v, p + 2)) if isinstance(v, float) else v for k, v in a.items()
    }
    return {"anatomy": rounded, "path": path, "explanation": lines, "summary": " ".join(lines[:2])}


def candle_drilldown(symbol: str, timeframe: str, time: int | None, now: int) -> dict:
    """GET /api/learn/candle-drilldown — the lower-timeframe candles inside one candle + an explanation.

    `time` is any timestamp inside the parent candle (aligned to its open); default = the last closed candle.
    Market data errors propagate (→ 503 with code DATA_NOT_AVAILABLE / MARKET_DATA_ERROR)."""
    from app.market.timeframes import align, last_closed_open, tf_seconds
    from app.services import market_service

    child_tf = DRILLDOWN_TIMEFRAME.get(timeframe)
    if child_tf is None:
        raise DrilldownError(
            "1m е най-малкият timeframe в платформата — вътре в 1m свещта няма по-малки свещи."
            if timeframe == "1m"
            else f"Неподдържан timeframe за drill-down: {timeframe}"
        )
    sec, child_sec = tf_seconds(timeframe), tf_seconds(child_tf)
    parent_open = last_closed_open(now, timeframe) if time is None else align(int(time), timeframe)
    if parent_open > now:
        raise DrilldownError("Този период още не е започнал.")
    window_end = parent_open + sec - 1
    spec = market_service.spec(symbol)
    expected = sec // child_sec if timeframe != "1w" else 7
    parents = market_service.candles(symbol, timeframe, start=parent_open, end=window_end, limit=2, now=now)
    parent = next((c for c in parents if c.ts == parent_open), None)
    base = {
        "symbol": spec.symbol,
        "timeframe": timeframe,
        "child_timeframe": child_tf,
        "precision": spec.price_precision,
        "source": market_service.source_of(symbol),
        "disclaimer": DRILLDOWN_DISCLAIMER,
    }
    if parent is None:
        return {
            **base,
            "available": False,
            "reason": "Няма свещ за този период от доставчика на данни.",
            "parent": None,
            "candles": [],
            "complete": False,
            "matches_parent": False,
            "expected_candles": expected,
            "anatomy": None,
            "path": None,
            "explanation": [],
            "summary": "",
        }
    kids = market_service.candles(symbol, child_tf, start=parent_open, end=window_end, limit=expected + 2, now=now)
    children = [k.to_dict() for k in kids if parent_open <= k.ts <= window_end]
    pd = parent.to_dict()
    complete = parent_open + sec <= now
    matches = bool(children) and (
        _close_to(children[0]["open"], pd["open"])
        and _close_to(max(k["high"] for k in children), pd["high"])
        and _close_to(min(k["low"] for k in children), pd["low"])
        and (not complete or _close_to(children[-1]["close"], pd["close"]))
    )
    info = explain_inside(pd, children, timeframe, child_tf, spec.price_precision)
    if not children:
        info["explanation"].append(f"Няма данни от {child_tf} timeframe за този период — вътрешният път не е наличен.")
    if not complete:
        info["explanation"].append("Свещта още не е затворена — формата ѝ може да се промени до края на периода.")
    if children and not matches:
        info["explanation"].append(
            "Свещите от по-малкия timeframe не съвпадат напълно с голямата свещ (различно агрегиране при доставчика)."
        )
    return {
        **base,
        "available": bool(children),
        "reason": None if children else f"Няма {child_tf} данни за този период.",
        "parent": pd,
        "candles": children,
        "complete": complete,
        "matches_parent": matches,
        "expected_candles": expected,
        **info,
    }
