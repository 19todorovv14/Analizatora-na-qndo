"""AI Coach — WEEKLY REVIEW built from learning progress, journal, paper trades,
backtests and detected mistakes. It recommends the NEXT LESSONS."""

from __future__ import annotations

import json
import logging

from app.academy.content import LESSONS_BY_SLUG, MODULES
from app.ai.prompts import COACH_SYSTEM
from app.ai.providers import LLMError, LLMProvider
from app.ai.safety import sanitize
from app.backtesting.metrics import trade_metrics

log = logging.getLogger(__name__)

CATEGORY_NAMES = {
    "level0": "market basics",
    "charts": "candlesticks",
    "technical": "market structure",
    "indicators": "indicators",
    "price_action": "price action",
    "risk": "risk management",
    "psychology": "trading psychology",
    "strategy": "strategy testing",
}


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
) -> dict:
    strengths: list[str] = []
    weaknesses: list[str] = []
    summary: list[str] = []

    strong = [k for k, v in progress.items() if (v.get("quiz_score") or 0) >= 0.85]
    weak_modules = [k for k, v in progress.items() if v.get("quiz_score") is not None and v["quiz_score"] < 0.7]
    findings = behavior.get("findings") or []
    risk_findings = [f for f in findings if f["kind"] in ("oversizing", "no_stop", "moving_stops", "revenge_trading")]
    if risk_findings and "risk" not in weak_modules:
        weak_modules.append("risk")
    if strong and weak_modules:
        summary.append(
            f"You understand {CATEGORY_NAMES[strong[0]]} well, but your {CATEGORY_NAMES[weak_modules[0]]} is weak."
        )
    elif strong:
        summary.append(f"You understand {', '.join(CATEGORY_NAMES[s] for s in strong[:3])} well.")
    for s in strong:
        strengths.append(f"Quiz '{CATEGORY_NAMES[s]}': {progress[s]['quiz_score'] * 100:.0f}%.")
    for w in weak_modules:
        if progress.get(w, {}).get("quiz_score") is not None:
            weaknesses.append(f"Quiz '{CATEGORY_NAMES[w]}': {progress[w]['quiz_score'] * 100:.0f}% (< 70%).")

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

    if not summary:
        summary.append(
            "Още няма достатъчно данни. Завърши няколко урока, направи quiz и няколко paper сделки със стоп."
        )

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
    result["text"], _ = sanitize(text)
    return result
