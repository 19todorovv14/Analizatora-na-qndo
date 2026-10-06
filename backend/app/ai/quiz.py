"""QUIZ ME — questions from the academy quiz banks (weighted to the user's weak modules) plus questions
generated from the current chart whose answer is COMPUTED by the analysis engine (never guessed).

Bank weighting (per module that has quiz questions):
* locked modules are skipped (unless nothing else is available);
* quiz taken: weight = 1 + 4 × (1 − best score)  → a 40% module is ~3× more likely than a 100% module;
* quiz not taken but lessons started: 2.5; untouched: 1.5.
Questions whose text contains a phrase the safety filter forbids (e.g. a wrong option "гарантира печалба")
are excluded so the quiz never shows such a phrase.
"""

from __future__ import annotations

import random

from app.ai.safety import find_violations

BANK_QUESTIONS = 3
BANK_QUESTIONS_NO_CHART = 4
CHART_QUESTIONS = 2


def _modules() -> list[dict]:
    from app.academy.content import MODULES  # imported lazily: the academy package evolves independently

    return MODULES


def _valid(q: dict) -> bool:
    try:
        opts = q["options"]
        ok = isinstance(opts, list) and len(opts) >= 2 and 0 <= int(q["answer"]) < len(opts) and q.get("question")
    except (KeyError, TypeError, ValueError):
        return False
    if not ok:
        return False
    text = " ".join([str(q["question"]), *map(str, opts), str(q.get("explanation", ""))])
    return not find_violations(text)


def module_weights(progress: dict | None) -> list[dict]:
    """[{key, title, weight, quiz_score, reason}] for modules with usable quiz questions, heaviest first."""
    prog = {m["key"]: m for m in (progress or {}).get("modules", []) if isinstance(m, dict) and "key" in m}
    rows = []
    for m in _modules():
        if not any(_valid(q) for q in m.get("quiz") or []):
            continue
        p = prog.get(m["key"], {})
        unlocked = p.get("unlocked", True) if prog else True
        score = p.get("quiz_score")
        started = (p.get("lessons_completed") or 0) > 0
        if score is not None:
            weight = 1 + 4 * (1 - float(score))
            reason = f"най-добър резултат в quiz-а {float(score) * 100:.0f}%"
        elif started:
            weight, reason = 2.5, "започнат модул, quiz-ът още не е решен"
        else:
            weight, reason = 1.5, "модулът още не е започнат"
        rows.append(
            {
                "key": m["key"],
                "title": m.get("title", m["key"]),
                "weight": round(weight, 2),
                "quiz_score": score,
                "unlocked": bool(unlocked),
                "reason": reason,
            }
        )
    usable = [r for r in rows if r["unlocked"]] or rows
    return sorted(usable, key=lambda r: -r["weight"])


def bank_questions(progress: dict | None, count: int, rng: random.Random) -> tuple[list[dict], list[dict]]:
    """Weighted sampling without replacement. Returns (questions, focus modules)."""
    weights = module_weights(progress)
    by_key = {m["key"]: m for m in _modules()}
    pools = {w["key"]: [q for q in by_key[w["key"]].get("quiz") or [] if _valid(q)] for w in weights}
    picked: list[dict] = []
    used_modules: dict[str, dict] = {}
    while len(picked) < count:
        avail = [w for w in weights if pools.get(w["key"])]
        if not avail:
            break
        w = rng.choices(avail, weights=[x["weight"] for x in avail], k=1)[0]
        q = pools[w["key"]].pop(rng.randrange(len(pools[w["key"]])))
        used_modules[w["key"]] = w
        picked.append(
            {
                "id": f"bank:{q['id']}",
                "question": q["question"],
                "options": list(q["options"]),
                "answer_index": int(q["answer"]),
                "explanation": q.get("explanation", ""),
                "source": "academy",
                "module": w["key"],
                "module_title": w["title"],
                "lesson": None,
            }
        )
    focus = sorted(used_modules.values(), key=lambda r: -r["weight"])
    return picked, focus


def _shuffled(options: list[str], answer: int, rng: random.Random) -> tuple[list[str], int]:
    order = list(range(len(options)))
    rng.shuffle(order)
    return [options[i] for i in order], order.index(answer)


def chart_questions(chart: dict | None, rng: random.Random, limit: int = CHART_QUESTIONS) -> list[dict]:
    """Questions about the CURRENT chart. `chart` is the compact chart section of the teacher context."""
    if not chart or not chart.get("available"):
        return []
    sym, tf = chart.get("symbol", ""), (chart.get("tf") or "").upper()
    out: list[dict] = []
    st = chart.get("structure") or {}
    trend = st.get("trend")
    if trend in ("bullish", "bearish", "mixed") and st.get("high") and st.get("low"):
        options = [
            "Higher highs и higher lows — бичя структура (uptrend)",
            "Lower highs и lower lows — меча структура (downtrend)",
            "Смесена структура — range или преход",
        ]
        answer = {"bullish": 0, "bearish": 1, "mixed": 2}[trend]
        opts, idx = _shuffled(options, answer, rng)
        out.append(
            {
                "id": "chart:structure",
                "question": f"Каква е структурата на {sym} {tf} според последните потвърдени swing точки "
                f"(последен връх {st['high']}, последно дъно {st['low']})?",
                "options": opts,
                "answer_index": idx,
                "explanation": f"Последният swing high е {st['high']}, а последният swing low е {st['low']}. "
                + {
                    "bullish": "HH + HL = бичя структура. Това описва миналото — не гарантира продължение.",
                    "bearish": "LH + LL = меча структура. Това описва миналото — не гарантира продължение.",
                    "mixed": "Комбинацията не е нито HH+HL, нито LH+LL → смесена структура, често range/преход.",
                }[trend],
                "source": "chart",
                "module": None,
                "module_title": None,
                "lesson": "market-structure",
            }
        )
    rsi = (chart.get("ind") or {}).get("rsi")
    if rsi is not None:
        options = [
            "Над 70 — висока (overbought) зона; това НЕ означава автоматично спад",
            "Между 30 и 70 — неутрална зона",
            "Под 30 — ниска (oversold) зона; това НЕ означава автоматично отскок",
        ]
        answer = 0 if rsi > 70 else 2 if rsi < 30 else 1
        out.append(
            {
                "id": "chart:rsi",
                "question": f"RSI(14) на {sym} {tf} е {rsi:.1f}. В коя зона е?",
                "options": options,
                "answer_index": answer,
                "explanation": f"RSI {rsi:.1f} е в зона '{options[answer].split(' — ')[0]}'. RSI измерва силата на "
                "последните движения — сам по себе си не е сигнал за вход.",
                "source": "chart",
                "module": None,
                "module_title": None,
                "lesson": "rsi",
            }
        )
    regime = chart.get("regime")
    if regime and len(out) < limit:
        options = ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCLEAR"]
        if regime in options:
            out.append(
                {
                    "id": "chart:regime",
                    "question": f"Какъв е пазарният режим (market regime) на {sym} {tf} според engine-а?",
                    "options": options,
                    "answer_index": options.index(regime),
                    "explanation": f"Engine-ът класифицира режима като {regime} по ADX, наклона на EMA 50 и ATR ранга.",
                    "source": "chart",
                    "module": None,
                    "module_title": None,
                    "lesson": "market-regimes",
                }
            )
    return out[:limit]


def build_quiz(progress: dict | None, chart: dict | None, *, rng: random.Random | None = None) -> dict:
    rng = rng or random.Random()
    chart_qs = chart_questions(chart, rng)
    n_bank = BANK_QUESTIONS if chart_qs else BANK_QUESTIONS_NO_CHART
    bank, focus = bank_questions(progress, n_bank, rng)
    questions = bank + chart_qs
    return {
        "questions": questions,
        "focus": [{"module": f["key"], "title": f["title"], "reason": f["reason"]} for f in focus],
        "sources": {"academy": len(bank), "chart": len(chart_qs)},
        "pass_score": 0.7,
    }
