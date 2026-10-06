"""AI Teacher: explains the deterministic analysis and answers questions.

Both functions work fully offline. When an LLM provider is configured it is used to
phrase the answer — but always grounded on the engine's numbers and always passed
through the safety filter. If the LLM fails, the offline answer is returned.
"""

from __future__ import annotations

import json
import logging
import re

from app.ai import glossary
from app.ai.prompts import TEACHER_SYSTEM
from app.ai.providers import LLMError, LLMProvider
from app.ai.safety import sanitize

log = logging.getLogger(__name__)


def _p(analysis: dict) -> int:
    price = analysis.get("price") or 1
    return 2 if price >= 10 else 4 if price >= 1 else 5


def _fmt(v, p: int) -> str:
    return "—" if v is None else f"{v:,.{p}f}"


def decision_panel(analysis: dict) -> dict:
    """The TRADE DECISION PANEL fields (labels in English, as in professional terminals)."""
    p = _p(analysis)
    setup = analysis.get("setup") or {}
    sup = analysis.get("support") or []
    res = analysis.get("resistance") or []
    regime = (analysis.get("regime") or {}).get("regime", "UNCLEAR")
    vol = analysis.get("volatility") or {}
    return {
        "MARKET": analysis.get("market"),
        "TIMEFRAME": (analysis.get("timeframe") or "").upper(),
        "REGIME": regime,
        "STRUCTURE": (analysis.get("structure") or {}).get("text", "—"),
        "TREND": analysis.get("trend"),
        "MOMENTUM": (analysis.get("momentum") or {}).get("label"),
        "VOLATILITY": f"{vol.get('label', '—')} (ATR {_fmt(vol.get('atr'), p)}, {vol.get('atr_pct', 0):.2f}%)",
        "SUPPORT": ", ".join(_fmt(s["price"], p) for s in sup) or "—",
        "RESISTANCE": ", ".join(_fmt(r["price"], p) for r in res) or "—",
        "POSSIBLE SETUP": setup.get("name") or analysis.get("wait_reason") or "—",
        "INVALIDATION": _fmt(setup.get("invalidation"), p) if setup else "—",
        "RISK": setup.get("risk_text", "—") if setup else "—",
        "REWARD": setup.get("reward_text", "—") if setup else "—",
        "R:R": setup.get("reward_risk") if setup else None,
        "DECISION": analysis.get("decision"),
        "CONFIDENCE": analysis.get("confidence"),
    }


def offline_explanation(analysis: dict, mode: str = "beginner") -> str:
    if not analysis.get("observation"):
        reasons = analysis.get("no_trade_reasons") or []
        return "NO TRADE — " + "; ".join(r["text"] for r in reasons)
    parts = ["OBSERVATION"] + [f"- {o}" for o in analysis["observation"]]
    parts += ["", "ANALYSIS"] + [f"- {a}" for a in analysis["analysis"]]
    parts += ["", "HYPOTHESIS"] + [f"- {h}" for h in analysis["hypothesis"]]
    if analysis.get("no_trade_reasons"):
        parts += ["", "NO TRADE / RISK FACTORS"] + [
            f"- {r['title']}: {r['text']}" for r in analysis["no_trade_reasons"]
        ]
    parts += [
        "",
        f"DECISION: {analysis['decision']} · CONFIDENCE: {analysis['confidence']}",
        analysis.get("confidence_note", ""),
        "",
        analysis.get("conclusion", ""),
    ]
    if mode == "beginner":
        parts += ["", "💡 Beginner tip: натисни 'Teach me why', за да видиш разсъжденията стъпка по стъпка."]
    return "\n".join(parts).strip()


def explain_analysis(analysis: dict, *, llm: LLMProvider | None, mode: str = "beginner") -> dict:
    text = offline_explanation(analysis, mode)
    provider = "offline"
    if llm is not None and analysis.get("observation"):
        compact = {
            k: analysis.get(k)
            for k in (
                "market",
                "timeframe",
                "price",
                "trend",
                "regime",
                "structure",
                "momentum",
                "volatility",
                "support",
                "resistance",
                "setup",
                "no_trade_reasons",
                "decision",
                "confidence",
                "indicators",
                "candle",
            )
        }
        prompt = (
            "Обясни този анализ на " + ("начинаещ" if mode == "beginner" else "напреднал") + " trader. "
            "Структура: OBSERVATION / ANALYSIS / HYPOTHESIS (с invalidation и алтернативен сценарий), после DECISION и "
            "CONFIDENCE с бележка, че confidence не е вероятност за печалба.\n\n"
            f"<analysis>{json.dumps(compact, ensure_ascii=False, default=str)[:12000]}</analysis>"
        )
        try:
            text = llm.complete(TEACHER_SYSTEM, [{"role": "user", "content": prompt}])
            provider = llm.name
        except LLMError as exc:
            log.warning("LLM explanation failed: %s", exc)
    clean, removed = sanitize(text)
    return {"text": clean, "provider": provider, "safety_removed": removed}


# ---------------------------------------------------------------------- chat
_REVIEW_WORDS = ("загуб", "lost", "lose", "loss", "грешно", "грешк", "wrong", "mistake", "сгреш", "review", "ревю")
_CANDLE_WORDS = ("свещ", "candle")
_CANDLE_Q = ("bearish", "bullish", "меч", "бич", "защо", "why", "червен", "зелен")
_CHART_WORDS = (
    "сега",
    "now",
    "анализ",
    "analy",
    "виждаш",
    "графика",
    "chart",
    "setup",
    "сетъп",
    "да купя",
    "да продам",
    "should i",
    "влизам",
    "buy",
    "sell",
    "лонг",
    "шорт",
    "long",
    "short",
    "пазар",
    "market",
)
_GREETING = ("здравей", "hello", "hi ", "hey", "помощ", "help", "какво можеш")


def _has(text: str, words) -> bool:
    return any(w in text for w in words)


def offline_answer(question: str, context: dict) -> str:
    q = " " + question.lower().strip() + " "
    analysis = context.get("analysis")
    review = context.get("last_trade_review")

    if _has(q, _REVIEW_WORDS) and review:
        lines = [
            f"TRADE REVIEW — {review.get('symbol', '')} {review.get('side', '').upper()}",
            f"Result: {review.get('result')}",
            f"What happened: {review.get('what_happened')}",
        ]
        if review.get("did_well"):
            lines.append("What you did well:")
            lines += [f"- {x}" for x in review["did_well"]]
        if review.get("did_poorly"):
            lines.append("What you did poorly:")
            lines += [f"- {x}" for x in review["did_poorly"]]
        lines.append(f"Main lesson: {review.get('main_lesson')}")
        return "\n".join(lines)
    if _has(q, _REVIEW_WORDS) and not review:
        return (
            "Още нямаш затворена paper сделка за преглед. Направи сделка в Paper Trading (с stop loss!), "
            "затвори я и ме попитай отново — ще ти направя пълен trade review."
        )

    if _has(q, _CANDLE_WORDS) and _has(q, _CANDLE_Q) and analysis and analysis.get("candle"):
        return "Последната затворена свещ на графиката:\n" + analysis["candle"]["explanation"]

    term = glossary.lookup(question)
    chart_q = _has(q, _CHART_WORDS) and analysis and analysis.get("observation")
    if chart_q and (term is None or _has(q, ("сега", "now", "анализ", "analy", "графика", "chart", "виждаш"))):
        panel = decision_panel(analysis)
        lines = (
            [
                "Не казвам 'купи' или 'продай' — показвам как разсъждава един дисциплиниран trader върху тази графика.",
                "",
                "OBSERVATION",
            ]
            + [f"- {o}" for o in analysis["observation"][:5]]
            + [
                "",
                "ANALYSIS",
            ]
            + [f"- {a}" for a in analysis["analysis"][:4]]
            + [
                "",
                "HYPOTHESIS",
            ]
            + [f"- {h}" for h in analysis["hypothesis"]]
            + [
                "",
                f"DECISION: {panel['DECISION']} · CONFIDENCE: {panel['CONFIDENCE']} (не е вероятност за печалба)",
            ]
        )
        if analysis.get("no_trade_reasons"):
            lines.append("Причини за предпазливост: " + "; ".join(r["title"] for r in analysis["no_trade_reasons"]))
        return "\n".join(lines)

    if term is not None:
        answer = glossary.definition(term)
        if analysis and analysis.get("observation"):
            answer += "\n\n" + _contextual_note(term["slug"], analysis)
        return answer

    if _has(q, _GREETING) or len(q.strip()) < 3:
        return (
            "Здравей! Аз съм AI Teacher. Можеш да ме питаш например:\n"
            '- "Какво е RSI?"\n- "Защо тази свещ е bearish?"\n- "Какво означава breakout?"\n'
            '- "Какво виждаш на графиката сега?"\n- "Защо загубих този trade?"\n'
            "Аз обяснявам и уча — не давам сигнали за реални пари."
        )
    return (
        "Не съм сигурен, че разбрах въпроса. Опитай да попиташ за конкретен термин (RSI, spread, leverage, "
        "support…), за текущата графика или за последната си сделка."
    )


def _contextual_note(slug: str, a: dict) -> str:
    ind = a.get("indicators") or {}
    p = _p(a)
    if slug == "rsi" and ind.get("rsi") is not None:
        r = ind["rsi"]
        note = f"На текущата графика RSI е {r:.1f}. "
        if r > 70:
            note += "RSI is currently high. This does NOT automatically mean price must fall."
        elif r < 30:
            note += "RSI е нисък. Това НЕ означава автоматично, че цената трябва да се покачи."
        else:
            note += "Това е неутрална зона — momentum няма екстремна стойност."
        return note
    if slug in ("breakout", "pa-breakout") and a.get("resistance"):
        lvl = a["resistance"][0]["price"]
        return (
            f"На текущата графика най-близката resistance е {_fmt(lvl, p)}. Пробив би изисквал затваряне над нея, "
            "в идеалния случай с обем над средния. Без затваряне това е само тест на нивото."
        )
    if slug in ("support", "support-bounce") and a.get("support"):
        lvl = a["support"][0]
        return (
            f"На текущата графика най-близкият support е около {_fmt(lvl['price'], p)} ({lvl['touches']} докосвания)."
        )
    if slug == "atr" and ind.get("atr"):
        return f"Текущият ATR(14) е {_fmt(ind['atr'], p)} — стоп от 2 ATR би бил на {_fmt(2 * ind['atr'], p)} от входа."
    if slug in ("ema", "sma") and ind.get("ema200"):
        side = "над" if a["price"] > ind["ema200"] else "под"
        return f"На текущата графика цената е {side} EMA 200 ({_fmt(ind['ema200'], p)})."
    if slug in ("volatility", "pa-volatility"):
        v = a.get("volatility") or {}
        return f"Текущата волатилност е {v.get('label')} (ATR ранг {v.get('rank', 0):.0f}/100)."
    return f"Текущо решение на анализа за {a.get('market')}: {a.get('decision')}."


def chat(question: str, *, context: dict, history: list[dict], llm: LLMProvider | None) -> dict:
    question = question.strip()[:2000]
    answer = offline_answer(question, context)
    provider = "offline"
    if llm is not None:
        ctx = {
            "analysis": {
                k: (context.get("analysis") or {}).get(k)
                for k in (
                    "market",
                    "timeframe",
                    "price",
                    "trend",
                    "regime",
                    "structure",
                    "momentum",
                    "volatility",
                    "support",
                    "resistance",
                    "setup",
                    "no_trade_reasons",
                    "decision",
                    "confidence",
                    "indicators",
                    "candle",
                )
            }
            if context.get("analysis")
            else None,
            "last_trade_review": context.get("last_trade_review"),
            "user_mode": context.get("mode"),
            "relevant_lesson": (glossary.lookup(question) or {}).get("summary"),
        }
        msgs = []
        for m in history[-10:]:
            if m["role"] in ("user", "assistant") and (not msgs or msgs[-1]["role"] != m["role"]):
                msgs.append({"role": m["role"], "content": m["content"][:4000]})
        while msgs and msgs[0]["role"] != "user":
            msgs.pop(0)
        if msgs and msgs[-1]["role"] == "user":
            msgs.pop()
        msgs.append(
            {
                "role": "user",
                "content": f"{question}\n\n<context>{json.dumps(ctx, ensure_ascii=False, default=str)[:12000]}</context>",
            }
        )
        try:
            answer = llm.complete(TEACHER_SYSTEM, msgs)
            provider = llm.name
        except LLMError as exc:
            log.warning("LLM chat failed: %s", exc)
    clean, removed = sanitize(answer)
    clean = re.sub(r"\n{3,}", "\n\n", clean)
    return {"answer": clean, "provider": provider, "safety_removed": removed}
