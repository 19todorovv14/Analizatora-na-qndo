"""AI review of a journal entry.

* Linked to a CLOSED paper position → app.ai.review.review_position (the TRADE REVIEW used everywhere else),
  wrapped with `kind: "trade"`.
* Otherwise → a deterministic REFLECTION review built only from what the user wrote down (reason, entry / stop /
  target, risk, exit, emotion, mistakes, lesson), `kind: "reflection"`.

Both judge the PROCESS that was recorded — never the market direction — and point to lessons. Nothing here
predicts prices or promises results."""

from __future__ import annotations

from app.academy import levels as lv
from app.academy.content import LESSONS_BY_SLUG
from app.risk.engine import RiskRules

TITLE = "JOURNAL REVIEW"
DISCLAIMER = (
    "Обратна връзка за записания процес върху paper сделка — не прогноза за цената и не финансов съвет."
)

# JournalForm "mistakes" chips → lesson
MISTAKE_LESSONS = {
    "no stop loss": "stop-order",
    "position too large": "position-sizing",
    "entered before confirmation": "fakeout",
    "chased the entry": "fomo",
    "moved stop further away": "stop-loss-placement",
    "exited too early": "loss-aversion",
    "revenge trade": "revenge-trading",
    "traded against the trend": "trend",
    "overtrading": "overtrading",
}
# JournalForm emotions → lesson (calm / confident are neutral)
EMOTION_LESSONS = {
    "fomo": "fomo",
    "fear": "fear",
    "greed": "greed",
    "anger": "revenge-trading",
    "frustrated": "revenge-trading",
    "bored": "overtrading",
    "hopeful": "loss-aversion",
}
MIN_REASON_CHARS = 15
MIN_LESSON_CHARS = 10


def lesson_refs(slugs: list[str]) -> list[dict]:
    """[{slug, title, href}] for the known lesson slugs (unknown ones are skipped, order kept, no duplicates)."""
    out = []
    for slug in dict.fromkeys(s for s in slugs if s):
        if slug in LESSONS_BY_SLUG:
            out.append({"slug": slug, "title": LESSONS_BY_SLUG[slug]["title"], "href": lv.lesson_href(slug)})
    return out


def _num(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def infer_side(side: str | None, entry: float | None, stop: float | None, target: float | None) -> str | None:
    s = (side or "").lower()
    if s in ("long", "buy"):
        return "long"
    if s in ("short", "sell"):
        return "short"
    if entry is not None and stop is not None and stop != entry:
        return "long" if stop < entry else "short"
    if entry is not None and target is not None and target != entry:
        return "long" if target > entry else "short"
    return None


def stop_on_valid_side(side: str | None, entry: float | None, stop: float | None) -> bool | None:
    if side is None or entry is None or stop is None:
        return None
    return stop < entry if side == "long" else stop > entry


def planned_rr(side: str | None, entry: float | None, stop: float | None, target: float | None) -> float | None:
    if None in (entry, stop, target) or stop_on_valid_side(side, entry, stop) is not True:
        return None
    reward = (target - entry) if side == "long" else (entry - target)
    risk = abs(entry - stop)
    return reward / risk if risk > 0 and reward > 0 else None


def realized_r(side: str | None, entry: float | None, stop: float | None, exit_price: float | None) -> float | None:
    if None in (entry, stop, exit_price) or stop_on_valid_side(side, entry, stop) is not True:
        return None
    move = (exit_price - entry) if side == "long" else (entry - exit_price)
    return move / abs(entry - stop)


def _fmt(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v:,.6g}"


def grade(score: int) -> str:
    return "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 55 else "D"


def reflection_review(entry: dict, rules: RiskRules | None = None) -> dict:
    """Process review of a journal entry from its own fields (JournalEntry as dict)."""
    rules = rules or RiskRules()
    e_entry, e_stop = _num(entry.get("entry")), _num(entry.get("stop"))
    e_target, e_exit = _num(entry.get("target")), _num(entry.get("exit_price"))
    side = infer_side(entry.get("side"), e_entry, e_stop, e_target)
    risk_amount, result = _num(entry.get("risk_amount")), _num(entry.get("result"))
    well: list[str] = []
    poorly: list[tuple[int, str, str | None]] = []  # (priority 1 = most serious, text, lesson)
    questions: list[str] = []

    reason = (entry.get("reason") or "").strip()
    if len(reason) >= MIN_REASON_CHARS:
        well.append("Записал си причината за входа — така можеш да провериш дали setup-ът наистина е бил налице.")
    else:
        poorly.append(
            (2, "Липсва ясна причина за входа (setup + какво го потвърди). Без нея процесът не може да се провери.",
             "what-is-a-strategy")
        )
        questions.append("Кое конкретно условие от плана ти беше изпълнено на ЗАТВОРЕНА свещ, преди да влезеш?")

    valid_stop = stop_on_valid_side(side, e_entry, e_stop)
    if e_stop is None:
        poorly.append((1, "Няма stop loss — загубата нямаше граница и рискът не може да се измери в R.", "stop-order"))
        questions.append("Къде щеше да е invalidation-ът на идеята (нивото, при което setup-ът вече не важи)?")
    elif valid_stop is False:
        poorly.append(
            (1, f"Stop-ът ({_fmt(e_stop)}) е от грешната страна на входа ({_fmt(e_entry)}) за {side.upper()} позиция.",
             "stop-loss-placement")
        )
    elif valid_stop is True:
        well.append(f"Invalidation-ът е дефиниран преди входа (stop {_fmt(e_stop)}).")
    else:
        questions.append("На каква цена влезе? Без входа рискът (1R) не може да се изчисли.")

    rr = planned_rr(side, e_entry, e_stop, e_target)
    if e_target is None:
        poorly.append((7, "Няма target — планът за изход е неясен. Реши предварително къде излизаш.", "reward-risk"))
    elif rr is not None:
        if rr >= rules.min_reward_risk:
            well.append(f"Планиран reward:risk {rr:.2f} — в правилото ти (≥ {rules.min_reward_risk:g}).")
        elif rr < 1:
            poorly.append((4, f"Планиран reward:risk само {rr:.2f} — нужен е много висок win rate.", "reward-risk"))
        else:
            poorly.append(
                (6, f"Планиран reward:risk {rr:.2f} е под правилото ти ({rules.min_reward_risk:g}).", "reward-risk")
            )

    if risk_amount is not None and risk_amount > 0:
        well.append(f"Рискът в пари е записан ({risk_amount:,.2f} USD) — размерът е избран спрямо стопа.")
    elif e_stop is not None:
        poorly.append((8, "Не е записан рискът в пари — изчислявай размера от риска и разстоянието до стопа.",
                       "position-sizing"))

    r_real = realized_r(side, e_entry, e_stop, e_exit)
    if r_real is not None:
        if r_real < -1.2:
            poorly.append(
                (3, f"Загубата е {r_real:+.2f}R — по-голяма от планирания 1R (стопът не е спазен или е преместен).",
                 "stop-loss-placement")
            )
        elif r_real < 0:
            well.append(f"Загубата остана в рамките на плана ({r_real:+.2f}R) — дисциплинирана загуба е част от процеса.")
        else:
            well.append(f"Изход на {r_real:+.2f}R спрямо планирания риск.")
    elif e_exit is None and result is None:
        questions.append("Как и защо излезе от сделката — по план или по емоция?")

    emotion = (entry.get("emotion") or "").strip()
    lesson_for_emotion = EMOTION_LESSONS.get(emotion.lower())
    if lesson_for_emotion:
        poorly.append(
            (5, f"Емоция при входа: {emotion}. Решенията под {emotion} често нарушават плана — пауза преди входа.",
             lesson_for_emotion)
        )
    elif emotion.lower() == "calm":
        well.append("Спокойно състояние при входа.")

    chips = [str(m).strip() for m in entry.get("mistakes") or [] if str(m).strip()]
    for chip in chips:
        poorly.append((3, f"Отбелязана грешка: {chip}.", MISTAKE_LESSONS.get(chip.lower())))
    if chips:
        well.append("Сам си отбелязал грешките — това е първата стъпка да не се повторят.")

    lost = (result is not None and result < 0) or (r_real is not None and r_real < 0)
    if entry.get("confidence") == 5 and lost:
        poorly.append(
            (6, "Увереност 5/5, но загуба — провери дали не си търсил само потвърждения на идеята си.",
             "confirmation-bias")
        )

    lesson = (entry.get("lesson") or "").strip()
    if len(lesson) >= MIN_LESSON_CHARS:
        well.append("Записал си урок от сделката.")
    else:
        poorly.append((9, "Запиши един конкретен урок — какво ще направиш различно следващия път.", "discipline"))

    poorly.sort(key=lambda x: x[0])
    if poorly:
        main = poorly[0][1]
    elif lost:
        main = "Добър процес, лош резултат. Загуба с дефиниран риск е нормален разход — не сменяй правилата заради нея."
    else:
        main = "Добър записан процес — повтаряй процеса, не резултата."
    questions.append("Би ли влязъл отново при абсолютно същите условия?")

    severe = sum(1 for pr, _, _ in poorly if pr <= 3)
    score = max(0, 100 - 25 * severe - 10 * (len(poorly) - severe))
    slugs = list(dict.fromkeys(lesson for _, _, lesson in poorly if lesson))[:3]
    return {
        "title": TITLE,
        "kind": "reflection",
        "symbol": entry.get("symbol"),
        "side": side,
        "summary": main,
        "main_lesson": main,
        "did_well": well,
        "did_poorly": [t for _, t, _ in poorly],
        "questions": list(dict.fromkeys(questions))[:4],
        "planned_rr": round(rr, 3) if rr is not None else None,
        "r_multiple": round(r_real, 3) if r_real is not None else None,
        "stop_valid": valid_stop,
        "process_score": score,
        "grade": grade(score),
        "lessons": slugs,
        "lesson_refs": lesson_refs(slugs),
        "disclaimer": DISCLAIMER,
    }


def trade_review(review: dict) -> dict:
    """Wrap an app.ai.review.review_position result for the journal (same keys + kind / lesson_refs)."""
    return {
        **review,
        "kind": "trade",
        "summary": review.get("main_lesson"),
        "questions": ["Би ли влязъл отново при абсолютно същите условия?"],
        "lesson_refs": lesson_refs(list(review.get("lessons") or [])),
        "disclaimer": DISCLAIMER,
    }
