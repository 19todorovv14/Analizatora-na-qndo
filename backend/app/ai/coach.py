"""AI Coach — WEEKLY REVIEW built from learning progress, journal, paper trades,
backtests and detected mistakes. It recommends the NEXT LESSONS.

v2 (additive): pattern FINDINGS with thresholds and evidence counts (app.psychology.patterns), one NEXT LESSON
{slug, title, why, href} and one PRACTICE EXERCISE {title, description, href, success_criteria}. The coach talks
about the user's PROCESS only — it never predicts prices and never promises a result."""

from __future__ import annotations

import json
import logging

from app.academy import levels as lv
from app.academy.content import LESSONS_BY_SLUG, MODULES
from app.ai.prompts import COACH_SYSTEM
from app.ai.providers import LLMError, LLMProvider
from app.ai.safety import sanitize, sanitize_lines
from app.backtesting.metrics import trade_metrics
from app.psychology.patterns import detect_patterns, lesson_ref, tf_label
from app.risk.engine import RiskRules

log = logging.getLogger(__name__)

CATEGORY_NAMES = {
    "level0": "market basics",
    "charts": "candlesticks",
    "technical": "market structure",
    "indicators": "indicators",
    "price_action": "price action",
    "risk": "risk management",
    "leverage": "leverage & margin",
    "psychology": "trading psychology",
    "strategy": "strategy testing",
    "backtesting": "backtesting",
    "advanced": "advanced analysis",
}

COACH_DISCLAIMER = (
    "Обратна връзка за твоя процес върху минали paper сделки — не прогноза и не финансов съвет. "
    "Миналите резултати не предсказват бъдещите."
)

# One exercise per finding key. `{rule}` / `{tf}` / `{tf_label}` are filled in at runtime.
PRACTICE_EXERCISES: dict[str, dict] = {
    "entered_early": {
        "title": "Structure Lab: изчакай потвърждението",
        "description": "Упражнения за пазарна структура на средна трудност: маркирай последния swing high/low и "
        "реши дали има потвърден пробив на ЗАТВОРЕНА свещ, преди да влезеш.",
        "href": "/learn/market-structure?difficulty=medium",
        "success_criteria": [
            "5 поредни упражнения с резултат ≥ 70/100",
            "След това 10 решения в Replay без флаг „Entered too early“",
        ],
    },
    "moving_stops": {
        "title": "Replay: стопът остава там, където е поставен",
        "description": "Сесия в Replay (trend): поставяй стопа зад последния swing преди входа и не го местиш по-далеч "
        "— само към breakeven или trailing.",
        "href": "/replay?preset=trend",
        "success_criteria": [
            "10 сделки без нито едно преместване на стопа по-далеч",
            "Всяка загуба ≤ 1.1R",
        ],
    },
    "timeframe_performance": {
        "title": "Replay на {tf_label}: тренирай там, където процесът ти е по-добър",
        "description": "Една Replay сесия на {tf_label} в режим predict: LONG / SHORT / WAIT със stop и target при "
        "всяко решение; после сравни score-а с другите timeframes.",
        "href": "/replay?preset=trend&mode=predict&timeframe={tf}",
        "success_criteria": [
            "20 решения в Replay на {tf_label}",
            "Среден score ≥ 70/100",
            "Запиши в журнала защо избираш този timeframe",
        ],
    },
    "volatility": {
        "title": "Replay: висока волатилност с по-малък размер",
        "description": "Сесия с preset High volatility: стоп ≥ 1 ATR от входа и риск ≤ 0.5% на сделка; ако стопът не се "
        "побира в риска — WAIT.",
        "href": "/replay?preset=high_volatility",
        "success_criteria": [
            "3 завършени Replay сесии",
            "Нито една загуба по-голяма от 1.2R",
            "Поне едно WAIT решение при свещ, по-голяма от 1 ATR",
        ],
    },
    "overtrading_after_losses": {
        "title": "Challenge: Do not overtrade",
        "description": "След всяка загуба — пауза от поне 30 минути и запис в журнала преди следващата сделка; "
        "1–3 сделки на ден.",
        "href": "/challenges?focus=no_overtrade",
        "success_criteria": [
            "5 дни с 1–3 сделки",
            "Нито една нова сделка до 30 мин след загуба",
            "Запис в журнала след всяка загуба",
        ],
    },
    "holding_losers": {
        "title": "Replay: излизай по план",
        "description": "Задай stop и target ПРЕДИ входа; ръчен изход само когато setup-ът е нарушен — не защото "
        "„може да се върне“.",
        "href": "/replay?preset=range",
        "success_criteria": [
            "10 сделки със зададени stop и target",
            "Медианата на времето в губещите ≤ тази в печелившите",
            "Нито една загуба под −1.1R",
        ],
    },
    "no_stop": {
        "title": "Challenge: 20 сделки със стоп",
        "description": "Всяка paper сделка със stop loss, зададен при входа — там, където setup-ът става невалиден.",
        "href": "/challenges?focus=twenty_with_stop",
        "success_criteria": [
            "20 затворени сделки, всяка със stop loss при входа",
            "0 сделки без стоп",
        ],
    },
    "oversized_risk": {
        "title": "Challenge: Risk {rule}% or less",
        "description": "Изчислявай размера от риска и разстоянието до стопа (Position Size Calculator) — не обратното.",
        "href": "/challenges?focus=risk_1pct",
        "success_criteria": [
            "10 поредни сделки с риск ≤ {rule}%",
            "Position Size Calculator преди всяка сделка",
        ],
    },
}

SKILL_EXERCISES: dict[str, dict] = {
    "candles": {
        "title": "Candlestick Lab: разчети свещите",
        "description": "Практика с реални графики: тяло, сенки и модели в контекст — без да гадаеш посоката.",
        "href": "/learn/candlesticks",
        "success_criteria": ["5 упражнения с резултат ≥ 70%"],
    },
    "structure": {
        "title": "Structure Lab: HH / HL / LH / LL",
        "description": "Маркирай swing върховете и дъната и определи структурата на лесна трудност.",
        "href": "/learn/market-structure?difficulty=easy",
        "success_criteria": ["5 поредни упражнения с резултат ≥ 70/100"],
    },
    "risk": {
        "title": "Risk Manager: размер от риска",
        "description": "Изчисли размера на 5 позиции от риска и разстоянието до стопа в Position Size Calculator.",
        "href": "/risk",
        "success_criteria": ["5 изчисления с риск ≤ 1%", "Reward:Risk ≥ 1.5 при всяко"],
    },
}

DEFAULT_EXERCISE = {
    "title": "Replay: една сесия в режим predict",
    "description": "Вземи 10 решения LONG / SHORT / WAIT върху исторически данни, всяко със stop и target; после "
    "прочети history review-то.",
    "href": "/replay?preset=trend&mode=predict",
    "success_criteria": ["10 решения", "Replay score ≥ 60/100", "Всяко LONG/SHORT решение със stop"],
}


def _fill(value, **params):
    if isinstance(value, str):
        return value.format(**params)
    if isinstance(value, list):
        return [_fill(v, **params) for v in value]
    return value


def practice_exercise(findings: list[dict], rules: RiskRules, learning: dict | None = None) -> dict:
    """The exercise for the top finding; without findings, one for the weakest skill (else a Replay session)."""
    top = findings[0] if findings else None
    if top and top["key"] in PRACTICE_EXERCISES:
        tf = ((top.get("data") or {}).get("best") or {}).get("timeframe") or "1h"
        params = {"rule": f"{rules.max_risk_per_trade_pct:g}", "tf": tf, "tf_label": tf_label(tf)}
        base = {k: _fill(v, **params) for k, v in PRACTICE_EXERCISES[top["key"]].items()}
        return {"key": top["key"], **base, "reason": f"Заради находката: {top['title']}."}
    weakest = ((learning or {}).get("weakest_skill") or {}).get("key")
    if weakest in SKILL_EXERCISES:
        title_bg = (learning or {}).get("weakest_skill", {}).get("title_bg") or weakest
        return {"key": f"skill:{weakest}", **SKILL_EXERCISES[weakest], "reason": f"Най-слабото ти умение: {title_bg}."}
    return {"key": "default", **DEFAULT_EXERCISE, "reason": "Практика на процеса без реален риск."}


def next_lesson(
    findings: list[dict],
    learning: dict | None,
    fallback: list[dict],
    completed: set[str] | None = None,
) -> dict | None:
    """{slug, title, why, href, completed} — the lesson behind the top finding, else the next learning-path lesson,
    else the first legacy next_lessons item."""
    completed = completed or set()
    for f in findings:
        ref = f.get("lesson")
        if not ref:
            continue
        done = ref["slug"] in completed
        why = f"{f['title']}: {f['evidence']}"
        if done:
            why += " Урокът вече е минат, но моделът продължава — прегледай го отново и приложи правилото в Replay."
        return {**ref, "why": why, "completed": done}
    nxt = (learning or {}).get("next") or {}
    if nxt.get("type") == "lesson" and nxt.get("slug") in LESSONS_BY_SLUG:
        ref = lesson_ref(nxt["slug"])
        level = nxt.get("level")
        why = "Следващата стъпка в твоя learning path" + (f" (LEVEL {level})." if level is not None else ".")
        return {**ref, "why": why, "completed": False}
    for item in fallback:
        ref = lesson_ref(item.get("slug"))
        if ref:
            return {**ref, "why": item.get("reason") or "Препоръчан урок.", "completed": ref["slug"] in completed}
    return None


def _clean(text: str, removed: list[str]) -> str:
    lines, hits = sanitize_lines([text])
    removed.extend(hits)
    return lines[0] if lines else ""


def _safe_findings(findings: list[dict], removed: list[str]) -> list[dict]:
    out = []
    for f in findings:
        out.append({**f, **{k: _clean(f[k], removed) for k in ("title", "evidence", "impact")}})
    return out


def weekly_review(
    *,
    progress: dict[str, dict],  # module_key -> {"completed": n, "total": n, "quiz_score": float|None}
    week_trades: list[dict],
    all_trades: list[dict],
    behavior: dict,
    journal_count: int,
    journal_emotions: dict[str, int],
    backtests: list[dict],
    period: dict,
    llm: LLMProvider | None = None,
    patterns: dict | None = None,  # app.psychology.patterns.detect_patterns(...) — computed here when None
    rules: RiskRules | None = None,
    learning: dict | None = None,  # learning_service.learning_dashboard(...) (next step, weakest skill)
    completed_lessons: set[str] | None = None,
) -> dict:
    strengths: list[str] = []
    weaknesses: list[str] = []
    summary: list[str] = []
    rules = rules or RiskRules()

    def name(key: str) -> str:
        return CATEGORY_NAMES.get(key, key)

    strong = [k for k, v in progress.items() if (v.get("quiz_score") or 0) >= 0.85]
    weak_modules = [k for k, v in progress.items() if v.get("quiz_score") is not None and v["quiz_score"] < 0.7]
    findings = behavior.get("findings") or []
    risk_findings = [f for f in findings if f["kind"] in ("oversizing", "no_stop", "moving_stops", "revenge_trading")]
    if risk_findings and "risk" not in weak_modules:
        weak_modules.append("risk")
    if strong and weak_modules:
        summary.append(f"You understand {name(strong[0])} well, but your {name(weak_modules[0])} is weak.")
    elif strong:
        summary.append(f"You understand {', '.join(name(s) for s in strong[:3])} well.")
    for s in strong:
        strengths.append(f"Quiz '{name(s)}': {progress[s]['quiz_score'] * 100:.0f}%.")
    for w in weak_modules:
        if progress.get(w, {}).get("quiz_score") is not None:
            weaknesses.append(f"Quiz '{name(w)}': {progress[w]['quiz_score'] * 100:.0f}% (< 70%).")

    stats = trade_metrics(week_trades) if week_trades else None
    overall = trade_metrics(all_trades) if all_trades else None
    ref = stats if stats and stats["total_trades"] >= 3 else overall
    if ref and ref.get("average_win_r") is not None and ref.get("average_loss_r") is not None:
        aw, al = ref["average_win_r"], abs(ref["average_loss_r"])
        line = f"Your average losing trade is {al:.1f}R while your winners average {aw:.1f}R."
        (weaknesses if al > aw else strengths).append(line)
        summary.append(line)
    if ref and ref.get("win_rate") is not None:
        summary.append(
            f"Win rate {ref['win_rate']:.0f}% от {ref['total_trades']} сделки; expectancy "
            f"{(ref.get('expectancy_r') or 0):+.2f}R (малка извадка — не прави изводи прибързано)."
        )

    biggest = findings[0] if findings else None
    if biggest:
        summary.append(f"Your biggest recurring mistake is {biggest['title'].lower()}: {biggest['text']}")
        weaknesses.append(biggest["text"])
    elif all_trades:
        strengths.append("Не са засечени повтарящи се поведенчески грешки.")

    with_stop = [t for t in all_trades if t.get("stop_price") is not None]
    if all_trades and len(with_stop) == len(all_trades):
        strengths.append("Всяка сделка е имала stop loss — отлична дисциплина.")
    if journal_count == 0 and all_trades:
        weaknesses.append("Нито една сделка не е записана в журнала — без журнал няма обратна връзка.")
    elif journal_count:
        strengths.append(f"{journal_count} записа в журнала.")
    if journal_emotions:
        top_emotion = max(journal_emotions, key=journal_emotions.get)
        if top_emotion.lower() in ("fomo", "страх", "fear", "гняв", "anger", "алчност", "greed"):
            weaknesses.append(f"Най-честата емоция в журнала е '{top_emotion}'.")
    good_bt = [b for b in backtests if (b.get("metrics") or {}).get("total_trades", 0) >= 30]
    if backtests and not good_bt:
        weaknesses.append("Backtest-ите ти имат под 30 сделки — извадката е твърде малка за изводи.")
    elif good_bt:
        strengths.append(f"{len(good_bt)} backtest-а с достатъчна извадка (≥ 30 сделки).")

    next_lessons: list[dict] = []
    for f in findings[:3]:
        slug = f.get("lesson")
        if slug in LESSONS_BY_SLUG:
            next_lessons.append({"slug": slug, "title": LESSONS_BY_SLUG[slug]["title"], "reason": f["title"]})
    for w in weak_modules:
        mod = next((m for m in MODULES if m["key"] == w), None)
        if mod:
            first = mod["lessons"][0]
            next_lessons.append(
                {"slug": first["slug"], "title": first["title"], "reason": f"Слаб резултат в {mod['title']}"}
            )
    for m in MODULES:  # first unfinished module
        pr = progress.get(m["key"])
        if pr and pr["completed"] < pr["total"]:
            idx = min(pr["completed"], len(m["lessons"]) - 1)
            lesson = m["lessons"][idx]
            next_lessons.append({"slug": lesson["slug"], "title": lesson["title"], "reason": f"Продължи {m['title']}"})
            break
    seen = set()
    next_lessons = [x for x in next_lessons if not (x["slug"] in seen or seen.add(x["slug"]))][:4]
    for item in next_lessons:
        item["href"] = lv.lesson_href(item["slug"])

    if not summary:
        summary.append(
            "Още няма достатъчно данни. Завърши няколко урока, направи quiz и няколко paper сделки със стоп."
        )

    # ---- v2: findings, next lesson, practice exercise ------------------------------------------
    pat = patterns if patterns is not None else detect_patterns(all_trades, rules)
    removed: list[str] = []
    v2_findings = _safe_findings(pat.get("findings") or [], removed)
    lesson = next_lesson(v2_findings, learning, next_lessons, completed_lessons)
    if lesson:
        lesson["why"] = _clean(lesson["why"], removed)
    exercise = practice_exercise(v2_findings, rules, learning)
    if v2_findings:
        top = v2_findings[0]
        weaknesses.append(f"{top['title']}: {top['evidence']}")

    result = {
        "title": "WEEKLY REVIEW",
        "period": period,
        "summary": summary,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "week_stats": stats,
        "overall_stats": overall,
        "biggest_mistake": biggest,
        "next_lessons": next_lessons,
        "discipline_score": behavior.get("discipline_score"),
        "provider": "offline",
        "version": 2,
        "findings": v2_findings,
        "checks": pat.get("checks") or [],
        "sample": pat.get("sample") or {},
        "next_lesson": lesson,
        "practice_exercise": exercise,
        "disclaimer": COACH_DISCLAIMER,
    }
    text = "\n".join(summary)
    if llm is not None:
        try:
            text = llm.complete(
                COACH_SYSTEM,
                [{"role": "user", "content": json.dumps(result, ensure_ascii=False, default=str)[:12000]}],
                max_tokens=2000,
            )
            result["provider"] = llm.name
        except LLMError as exc:
            log.warning("LLM coach failed: %s", exc)
    result["text"], text_removed = sanitize(text)
    result["safety_removed"] = removed + text_removed
    return result
