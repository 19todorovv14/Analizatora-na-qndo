"""AI TRADING TEACHER — modes.

EXPLAIN · ANALYZE · TEACH ME · REVIEW TRADE · REVIEW STRATEGY · QUIZ ME · WHY? · COMPARE

Every mode has a deterministic OFFLINE generator (Bulgarian, educational, built only from the numbers in the
teacher context — see app.ai.context) and an LLM prompt (hard rules + mode instructions + the compact context JSON
+ the offline draft). When an LLM is configured it may rephrase the sections; on any LLM error, refusal or
unparsable output the offline result is returned with provider 'offline'. Sections that must stay exact (the RULES
checklist, the COMPARISON table, the QUIZ questions) are always produced by the engine, never by the LLM.

Output (JSON):
    {mode, title, symbol, timeframe, sections:[{key, title, body: [str]}], follow_ups:[{label, mode, payload}],
     context_used, provider, provider_label, fallback, disclaimer, safety_removed, safety_note, data_available,
     generated_ts, + mode extras (quiz | comparison | lesson/next_lesson | review | strategy | examples | overlay)}

Standard sections (ALWAYS present for explain / analyze / why / compare), titles exactly:
    observation OBSERVATION · rules RULES · scenario SCENARIO · invalidation INVALIDATION · risk RISK ·
    alternative ALTERNATIVE SCENARIO
Every string passes through app.ai.safety (forbidden promises / buy-sell commands are removed).
"""

from __future__ import annotations

import bisect
import json
import logging
import random
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.academy.content import LESSONS_BY_SLUG, MODULES
from app.academy.levels import lesson_href
from app.ai import glossary
from app.ai.context import HIGHER_TF, ContextBundle, fmt_price, llm_payload
from app.ai.examples import NOT_A_FORECAST
from app.ai.prompts import TEACHER_V2_MODE_PROMPTS, TEACHER_V2_SECTION_GUIDE, TEACHER_V2_SYSTEM
from app.ai.providers import LLMProvider
from app.ai.quiz import build_quiz
from app.ai.safety import SAFETY_NOTE, STANDARD_DISCLAIMER, sanitize_lines
from app.ai.teacher import _contextual_note
from app.analysis.signal import CONFIDENCE_NOTE
from app.strategies.rules import describe
from app.strategies.view import RESULT_NONE, SETUP_DISCLAIMER

log = logging.getLogger(__name__)

PAST_PERFORMANCE = "Past backtest performance does not guarantee future results."
LEVERAGE_NOTE = "Higher leverage magnifies exposure and liquidation risk."
COMPARE_NOTE = "Това са разлики, не прогноза (differences, not a prediction)."
LLM_MAX_TOKENS = 2500
MAX_LINES = 14

STANDARD = ("observation", "rules", "scenario", "invalidation", "risk", "alternative")
TITLES = {
    "observation": "OBSERVATION",
    "rules": "RULES",
    "scenario": "SCENARIO",
    "invalidation": "INVALIDATION",
    "risk": "RISK",
    "alternative": "ALTERNATIVE SCENARIO",
    "examples": "HISTORICAL EXAMPLES",
    "why": "WHY",
    "draft": "YOUR DRAFT ORDER",
    "lesson": "LESSON",
    "example": "CHART EXAMPLE",
    "next_lesson": "NEXT LESSON",
    "what_happened": "WHAT HAPPENED",
    "did_well": "WHAT YOU DID WELL",
    "did_poorly": "WHAT TO IMPROVE",
    "main_lesson": "MAIN LESSON",
    "strengths": "STRENGTHS",
    "weaknesses": "WEAKNESSES",
    "overfitting": "OVERFITTING RISK",
    "next_test": "NEXT TEST",
    "quiz": "QUIZ",
    "comparison": "COMPARISON",
    "conclusion": "CONCLUSION",
}
# produced by the engine only — an LLM may not rewrite rule checks, draft checks, the comparison table or the
# historical-examples statistics (quiz questions/answers live in the `quiz` extra and never go through the LLM)
DETERMINISTIC = frozenset({"rules", "draft", "comparison", "examples"})


@dataclass(frozen=True)
class ModeDef:
    key: str
    label: str
    description: str
    icon: str
    needs: tuple[str, ...]
    optional: tuple[str, ...]
    sections: tuple[str, ...]  # always present in the output
    extra_sections: tuple[str, ...] = ()  # present when the data exists
    include: tuple[str, ...] = ()  # context sections (app.ai.context.SECTIONS)
    setup_disclaimer: bool = False

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "icon": self.icon,
            "needs": list(self.needs),
            "optional": list(self.optional),
            "sections": [{"key": k, "title": TITLES[k]} for k in self.sections],
            "extra_sections": [{"key": k, "title": TITLES[k]} for k in self.extra_sections],
            "context": list(self.include),
        }


_CHART_CTX = ("chart", "strategy", "historical_examples", "account", "learning")
MODES: dict[str, ModeDef] = {
    m.key: m
    for m in (
        ModeDef(
            "explain",
            "EXPLAIN",
            "Обяснява setup-а на текущата графика (или твоята чернова на поръчка): правила, invalidation и риск.",
            "MessageSquareText",
            needs=("symbol", "timeframe"),
            optional=("draft", "strategy_id", "question"),
            sections=STANDARD,
            extra_sections=("draft",),
            include=_CHART_CTX,
            setup_disclaimer=True,
        ),
        ModeDef(
            "analyze",
            "ANALYZE",
            "Пълен анализ на графиката: факти, правила, сценарий, invalidation, риск, алтернатива и исторически примери.",
            "ScanSearch",
            needs=("symbol", "timeframe"),
            optional=("strategy_id", "indicators", "question"),
            sections=STANDARD,
            extra_sections=("examples",),
            include=(
                "chart",
                "strategy",
                "historical_examples",
                "account",
                "trades",
                "journal",
                "learning",
                "backtest",
            ),
            setup_disclaimer=True,
        ),
        ModeDef(
            "teach",
            "TEACH ME",
            "Урок по концепция с текущата графика като пример и линк към следващия урок.",
            "GraduationCap",
            needs=("symbol", "timeframe"),
            optional=("topic", "question"),
            sections=("lesson", "next_lesson"),
            extra_sections=("example",),
            include=("chart", "learning", "trades", "journal"),
        ),
        ModeDef(
            "review_trade",
            "REVIEW TRADE",
            "Честен преглед на затворена paper сделка: какво стана, какво беше добре и зле, главен урок.",
            "ClipboardCheck",
            needs=("position_id",),
            optional=(),
            sections=("what_happened", "did_well", "did_poorly", "main_lesson"),
            include=("trades", "journal", "learning"),
        ),
        ModeDef(
            "review_strategy",
            "REVIEW STRATEGY",
            "Силни и слаби страни на стратегията, overfitting риск и следващ тест.",
            "FlaskConical",
            needs=("strategy_id",),
            optional=("backtest_id", "symbol", "timeframe"),
            sections=("strengths", "weaknesses", "overfitting", "next_test"),
            extra_sections=("rules",),
            include=("chart", "strategy", "backtest", "historical_examples"),
            setup_disclaimer=True,
        ),
        ModeDef(
            "quiz",
            "QUIZ ME",
            "3–5 въпроса от академията (фокус върху слабите ти модули) + въпроси от текущата графика.",
            "ListChecks",
            needs=(),
            optional=("symbol", "timeframe"),
            sections=("quiz",),
            include=("chart", "learning"),
        ),
        ModeDef(
            "why",
            "WHY?",
            "Защо engine-ът и стратегията казват това сега — стъпка по стъпка.",
            "HelpCircle",
            needs=("symbol", "timeframe"),
            optional=("strategy_id", "question"),
            sections=STANDARD,
            extra_sections=("why", "examples"),
            include=_CHART_CTX,
            setup_disclaimer=True,
        ),
        ModeDef(
            "compare",
            "COMPARE",
            "Сравнява два символа или два timeframe-а (режим, структура, волатилност, нива, strategy fit) — "
            "разлики, не прогноза.",
            "Columns2",
            needs=("symbol", "timeframe", "compare_symbol|compare_timeframe"),
            optional=("strategy_id",),
            sections=(*STANDARD, "comparison", "conclusion"),
            include=("chart", "compare", "strategy"),
            setup_disclaimer=True,
        ),
    )
}
MODE_KEYS = tuple(MODES)


def modes_list() -> list[dict]:
    return [m.to_dict() for m in MODES.values()]


# ---------------------------------------------------------------- plumbing
@dataclass
class Request:
    question: str | None = None
    draft: dict | None = None
    topic: str | None = None
    rng: random.Random = field(default_factory=random.Random)


@dataclass
class Draft:
    sections: list[tuple[str, list[str]]]
    extras: dict = field(default_factory=dict)
    follow_ups: list[dict] = field(default_factory=list)
    llm_extra: dict = field(default_factory=dict)
    title: str | None = None


def _tf(tf: str | None) -> str:
    return (tf or "").upper()


def _utc(ts: int | None) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M UTC") if ts else "—"


def _chart_ok(b: ContextBundle) -> bool:
    return b.chart is not None and b.chart.available and b.chart.analysis is not None


def _pp(b: ContextBundle) -> int:
    return b.chart.spec.price_precision if b.chart is not None and b.chart.spec is not None else 2


def _f(b: ContextBundle, v) -> str:
    return fmt_price(v, _pp(b))


def _payload(b: ContextBundle, **extra) -> dict:
    out: dict = {}
    if b.chart is not None:
        out = {"symbol": b.chart.symbol, "timeframe": b.chart.timeframe}
    info = b.strategy_info or {}
    if info.get("selected") and info.get("id") is not None:
        out["strategy_id"] = info["id"]
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def _fu(label: str, mode: str, payload: dict) -> dict:
    return {"label": label, "mode": mode, "payload": payload}


def _lesson(slug: str | None) -> dict | None:
    return LESSONS_BY_SLUG.get(slug) if slug else None


def _lesson_title(slug: str) -> str:
    lesson = _lesson(slug)
    return lesson["title"] if lesson else slug


def _chart_topic(b: ContextBundle) -> str:
    if not _chart_ok(b):
        return "market-structure"
    c = b.chart.compact
    rsi = (c.get("ind") or {}).get("rsi")
    if rsi is not None and (rsi > 70 or rsi < 30):
        slug = "rsi"
    else:
        slug = {
            "TRENDING_UP": "trend",
            "TRENDING_DOWN": "trend",
            "RANGING": "range",
            "HIGH_VOLATILITY": "volatility",
            "LOW_VOLATILITY": "consolidation",
        }.get(c.get("regime"), "market-structure")
    return slug if slug in LESSONS_BY_SLUG else "market-structure"


def _asks_for_signal(question: str | None) -> bool:
    q = (question or "").lower()
    words = (
        "buy",
        "sell",
        "купя",
        "купи",
        "продам",
        "продай",
        "влизам",
        "long",
        "short",
        "лонг",
        "шорт",
        "guarantee",
        "гарант",
        "signal",
        "сигнал",
        "should i",
        "трябва ли",
    )
    return any(w in q for w in words)


SIGNAL_REFUSAL = (
    "Не давам команди 'купи' или 'продай' и не обещавам резултат — показвам какво казват правилата, "
    "сценариите и риска, а решението и отговорността остават твои (в paper среда)."
)


def _no_data(b: ContextBundle) -> str:
    reason = b.chart.reason if b.chart is not None else "Не е избран инструмент."
    sym = f"{b.chart.symbol} {_tf(b.chart.timeframe)}: " if b.chart is not None else ""
    return f"DATA NOT AVAILABLE — {sym}{reason}"


def _no_data_sections(b: ContextBundle) -> list[tuple[str, list[str]]]:
    msg = _no_data(b)
    return [
        ("observation", [msg, "Без пазарни данни учителят не измисля цени, нива или индикатори."]),
        ("rules", ["Правилата не могат да бъдат проверени без затворени свещи."]),
        ("scenario", ["Няма сценарий без данни — избери друг инструмент/timeframe или провери Data sources."]),
        ("invalidation", ["Няма setup, следователно няма invalidation."]),
        ("risk", ["Най-големият риск е да търгуваш без данни. NO TRADE."]),
        ("alternative", ["Когато данните са налични, поискай анализа отново."]),
    ]


# --------------------------------------------------------- standard blocks
def _observation(b: ContextBundle, limit: int = 8) -> list[str]:
    a, c = b.analysis, b.chart.compact
    status = (c.get("status") or "").upper()
    lines = [f"{c['symbol']} {_tf(c['tf'])} · данни {status}: последна ЗАТВОРЕНА свещ {_utc(c.get('time'))}."]
    lines += list(a.get("observation") or [])[:limit]
    l20 = c.get("last20") or {}
    if l20.get("chg_pct") is not None:
        lines.append(
            f"Последните 20 свещи: {l20['chg_pct']:+.2f}%, диапазон {_f(b, l20.get('lo'))} – {_f(b, l20.get('hi'))}, "
            f"{l20.get('up_bars')}/20 бичи свещи."
        )
    bbw = (c.get("ind") or {}).get("bb_width_pct")
    if bbw is not None:
        lines.append(f"Bollinger Bands ширина: {bbw:.2f}% от цената.")
    return lines


def _strategy_name(b: ContextBundle) -> str:
    info = b.strategy_info or {}
    return info.get("name") or "стратегията"


def _strategy_origin(b: ContextBundle) -> str:
    info = b.strategy_info or {}
    return {
        "selected": "избрана",
        "recent": "по подразбиране — последната ти стратегия",
        "template": "по подразбиране — образователен шаблон",
    }.get(info.get("source"), "")


def _rules(b: ContextBundle) -> list[str]:
    lines: list[str] = []
    v = b.view
    if v and v.get("available"):
        lines.append(f"Стратегия '{_strategy_name(b)}' ({_strategy_origin(b)}):")
        for side, rows in (("LONG", v["conditions"]["long"]), ("SHORT", v["conditions"]["short"])):
            for r in rows:
                lines.append(f"{'✓' if r['passed'] else '✗'} {side}: {r['explanation']}")
        rf = v["regime_filter"]
        req = ", ".join(rf["required"]) if rf["required"] else "всеки режим"
        lines.append(f"{'✓' if rf['passed'] else '✗'} Regime filter: позволени {req}; текущ режим {rf['actual']}.")
    a = b.analysis
    if a:
        reasons = a.get("no_trade_reasons") or []
        if reasons:
            for r in reasons:
                lines.append(f"✗ No-trade проверка — {r['title']}: {r['text']}")
        else:
            lines.append("✓ No-trade проверки (ликвидност, волатилност, спред, структура, R:R): няма блокиращ фактор.")
        setup = a.get("setup")
        if setup and setup.get("reward_risk") is not None:
            rr, min_rr = setup["reward_risk"], b.rules.min_reward_risk
            lines.append(
                f"{'✓' if rr >= min_rr else '✗'} R:R на engine setup-а {rr:.2f} спрямо минимума ти {min_rr:g}."
            )
    if len(lines) > MAX_LINES:
        lines = lines[: MAX_LINES - 1] + [f"… и още {len(lines) - MAX_LINES + 1} проверки."]
    return lines or ["Няма правила за проверка."]


def _plan_line(b: ContextBundle, plan: dict) -> str:
    tgt = (
        f", target {_f(b, plan['target'])} (R:R {plan['rr']:.2f})"
        if plan.get("target") is not None and plan.get("rr") is not None
        else ", без фиксирана цел"
    )
    stop = f"stop {_f(b, plan['stop'])}" if plan.get("stop") is not None else "stop: няма стойност"
    return f"entry ~{_f(b, plan['entry'])}, {stop}{tgt}"


def _scenario(b: ContextBundle, question: str | None) -> list[str]:
    a, c = b.analysis, b.chart.compact
    lines: list[str] = []
    if _asks_for_signal(question):
        lines.append(SIGNAL_REFUSAL)
    reg = a.get("regime") or {}
    reasons = reg.get("reasons") or []
    lines.append(
        f"Контекст: режим {reg.get('regime')}"
        + (f" ({reasons[0]})" if reasons else "")
        + f"; {(a.get('structure') or {}).get('text', '')} Momentum: {c.get('momentum')}."
    )
    v = b.view
    if v and v.get("available"):
        if v["result"] != RESULT_NONE and v.get("risk_plan"):
            lines.append(f"Стратегията '{_strategy_name(b)}' показва {v['result']}: {_plan_line(b, v['risk_plan'])}.")
        else:
            failing = next((w for w in v["why"][1:3] if "Не е изпълнено" in w or "БЛОКИРАНО" in w), None)
            lines.append(f"Стратегията '{_strategy_name(b)}': NO SETUP" + (f" — {failing}" if failing else "."))
    setup = a.get("setup")
    if setup:
        lines.append(
            f"Signal engine (общ анализ): {a.get('decision')} — {setup['name']}. Хипотеза: движение към "
            f"{_f(b, setup.get('target'))} (R:R {setup.get('reward_risk')}), докато {_f(b, setup.get('invalidation'))} "
            "не бъде пробито."
        )
    else:
        lines.append(
            f"Signal engine (общ анализ): {a.get('decision')} — "
            f"{a.get('wait_reason') or 'няма setup, който да отговаря на критериите'}."
        )
    lines.append(f"Confidence {a.get('confidence')}: {CONFIDENCE_NOTE}")
    lines.append(SETUP_DISCLAIMER)
    return lines


def _last_swing(b: ContextBundle, label: str) -> float | None:
    swings = ((b.analysis or {}).get("structure") or {}).get("swings") or []
    for s in reversed(swings):
        if s.get("label") == label:
            return s.get("price")
    return None


def _invalidation(b: ContextBundle) -> list[str]:
    a = b.analysis
    lines: list[str] = []
    v = b.view
    plan = (v or {}).get("risk_plan")
    if plan and plan.get("stop") is not None:
        word = "затваряне под" if plan["side"] == "long" else "затваряне над"
        atr_txt = f", {plan['stop_atr']:.2f} ATR от входа" if plan.get("stop_atr") else ""
        lines.append(
            f"Стратегия: идеята е невалидна при {word} {_f(b, plan['stop'])} (stop правило: {plan.get('stop_rule')}{atr_txt})."
        )
    setup = a.get("setup")
    if setup:
        lines.append(f"Engine setup: invalidation {_f(b, setup.get('invalidation'))}. {setup.get('risk_text', '')}")
    if not lines:
        lines.append("Няма активен setup, следователно няма invalidation на сделка.")
    sup, res = a.get("support") or [], a.get("resistance") or []
    if sup and res:
        lines.append(
            f"Ключови нива: support {_f(b, sup[0]['price'])} и resistance {_f(b, res[0]['price'])} — затваряне извън тях "
            "би променило картината."
        )
    lines += _structure_invalidation(b)
    return lines


def _structure_invalidation(b: ContextBundle) -> list[str]:
    a = b.analysis
    st = (a.get("structure") or {}).get("trend")
    close = b.chart.candles[-1].close if b.chart is not None and b.chart.candles else a.get("price")
    if st == "bullish" and _last_swing(b, "HL") is not None:
        hl = _last_swing(b, "HL")
        if close is not None and close < hl:
            return [
                f"Цената ({_f(b, close)}) вече е под последното потвърдено HL {_f(b, hl)} — бичата структура е нарушена; "
                "новата структура ще се потвърди със следващите swing точки."
            ]
        return [f"Бичата структура (HH + HL) се нарушава при затваряне под последното HL {_f(b, hl)}."]
    if st == "bearish" and _last_swing(b, "LH") is not None:
        lh = _last_swing(b, "LH")
        if close is not None and close > lh:
            return [
                f"Цената ({_f(b, close)}) вече е над последното потвърдено LH {_f(b, lh)} — мечата структура е нарушена; "
                "новата структура ще се потвърди със следващите swing точки."
            ]
        return [f"Мечата структура (LH + LL) се нарушава при затваряне над последното LH {_f(b, lh)}."]
    return []


def _sizing_line(b: ContextBundle, risk_per_unit: float | None) -> str | None:
    acc = b.context.get("account") or {}
    if not acc.get("available") or not risk_per_unit:
        return None
    equity = acc.get("equity") or 0
    rule = acc.get("risk_rule_pct") or b.rules.max_risk_per_trade_pct
    max_risk = equity * rule / 100
    if max_risk <= 0:
        return None
    qty = max_risk / risk_per_unit
    return (
        f"Position sizing по правилото ти {rule:g}% риск: equity {equity:,.2f} → максимален риск {max_risk:,.2f} "
        f"→ размер ≈ {qty:,.4g} единици при stop разстояние {_f(b, risk_per_unit)}."
    )


def _risk(b: ContextBundle) -> list[str]:
    a = b.analysis
    vol = a.get("volatility") or {}
    lines = [
        f"Волатилност {vol.get('label')}: ATR(14) {_f(b, vol.get('atr'))} = {vol.get('atr_pct', 0):.2f}% от цената "
        f"(ранг {vol.get('rank', 0):.0f}/100)."
    ]
    if vol.get("label") in ("High", "Extreme"):
        lines.append("По-висока волатилност → по-широк stop и по-малка позиция при същия риск в пари.")
    plan = (b.view or {}).get("risk_plan")
    rpu = (plan or {}).get("risk_per_unit") or ((a.get("setup") or {}).get("risk_per_unit"))
    sizing = _sizing_line(b, rpu)
    if sizing:
        lines.append(sizing)
    acc = b.context.get("account") or {}
    if acc.get("available"):
        n, mx = acc.get("open") or 0, acc.get("max_open") or b.rules.max_open_positions
        if n >= mx:
            lines.append(f"Вече имаш {n} отворени позиции (лимит {mx}) — нова позиция би нарушила правилото ти.")
        elif n:
            lines.append(
                f"Отворени позиции: {n} (exposure {acc.get('exposure') or 0:,.2f}) — новата сделка добавя риск."
            )
    hard = [r["title"] for r in a.get("no_trade_reasons") or [] if r.get("code") != "strategy_not_satisfied"]
    if hard:
        lines.append("Рискови фактори от no-trade системата: " + ", ".join(hard) + ".")
    ex = b.examples or {}
    if ex.get("available") and ex.get("count"):
        lines.append(
            f"Исторически ({ex['count']} подобни случая): медиана {ex['median_move_atr']:+.2f} ATR за {ex['horizon']} "
            "свещи — past examples, not a forecast."
        )
    lines.append(LEVERAGE_NOTE)
    return lines


def _alternative(b: ContextBundle) -> list[str]:
    a = b.analysis
    lines: list[str] = []
    hyp = a.get("hypothesis") or []
    alt = next((h for h in hyp if h.startswith("Алтернативен") or h.startswith("Наблюдавай")), None)
    if alt:
        lines.append(alt)
    v = b.view
    if v and v.get("available"):
        rf = v["regime_filter"]
        if not rf["passed"]:
            lines.append(
                f"Ако режимът се смени на {', '.join(rf['required'])}, regime filter-ът би разрешил setup — "
                "стига условията да останат изпълнени."
            )
        if v["result"] == RESULT_NONE:
            failed = [r["label"] for r in v["conditions"]["long"] + v["conditions"]["short"] if not r["passed"]]
            if failed:
                lines.append(
                    f"Ако '{failed[0]}' се изпълни на следваща затворена свещ (и останалите условия останат), "
                    "стратегията би показала setup."
                )
        else:
            lines.append(
                "Ако следващата затворена свещ отмени някое условие, setup-ът изчезва — правилата се проверяват на всяка свещ."
            )
    lines.append("Пазарът може да остане и без ясна посока — тогава NO TRADE е валидно решение.")
    return lines


def _examples_lines(b: ContextBundle) -> list[str]:
    ex = b.examples or {}
    if not ex.get("available"):
        return [(ex.get("reason") or "Няма исторически примери."), NOT_A_FORECAST]
    return [ex.get("summary") or NOT_A_FORECAST]


def _standard(b: ContextBundle, req: Request, *, obs_limit: int = 8) -> list[tuple[str, list[str]]]:
    if not _chart_ok(b):
        return _no_data_sections(b)
    return [
        ("observation", _observation(b, obs_limit)),
        ("rules", _rules(b)),
        ("scenario", _scenario(b, req.question)),
        ("invalidation", _invalidation(b)),
        ("risk", _risk(b)),
        ("alternative", _alternative(b)),
    ]


def _overlay(b: ContextBundle, draft: dict | None = None) -> dict | None:
    if not _chart_ok(b):
        return None
    a = b.analysis
    pp = _pp(b)
    setup = None
    plan = (b.view or {}).get("risk_plan")
    if plan and plan.get("stop") is not None:
        setup = {k: plan.get(k) for k in ("side", "entry", "stop", "target")} | {"source": "strategy"}
    elif a.get("setup"):
        s = a["setup"]
        setup = {
            "side": s["side"],
            "entry": s.get("entry"),
            "stop": s.get("invalidation"),
            "target": s.get("target"),
            "source": "engine",
        }
    return {
        "support": [round(x["price"], pp) for x in a.get("support") or []],
        "resistance": [round(x["price"], pp) for x in a.get("resistance") or []],
        "swings": [
            {**s, "price": round(s["price"], pp)} for s in ((a.get("structure") or {}).get("swings") or [])[-10:]
        ],
        "setup": setup,
        "draft": draft,
    }


def _strategy_extra(b: ContextBundle) -> dict | None:
    info = b.strategy_info
    if not info:
        return None
    v = b.view or {}
    return {
        "id": info.get("id"),
        "name": info.get("name"),
        "selected": info.get("selected"),
        "source": info.get("source"),
        "result": v.get("result"),
    }


def _chart_follow_ups(b: ContextBundle, current: str) -> list[dict]:
    out = []
    if current != "why":
        out.append(_fu("WHY? Защо това решение?", "why", _payload(b)))
    if current != "explain":
        out.append(_fu("EXPLAIN — обясни setup-а", "explain", _payload(b)))
    if current != "analyze":
        out.append(_fu("ANALYZE — пълен анализ", "analyze", _payload(b)))
    topic = _chart_topic(b)
    out.append(_fu(f"TEACH ME: {_lesson_title(topic)}", "teach", _payload(b, topic=topic)))
    out.append(_fu("QUIZ ME върху тази графика", "quiz", _payload(b)))
    if b.chart is not None and current != "compare":
        htf = HIGHER_TF.get(b.chart.timeframe, "1d")
        out.append(_fu(f"COMPARE с {_tf(htf)}", "compare", _payload(b, compare_timeframe=htf)))
    return out[:5]


# --------------------------------------------------------------- generators
def _gen_analyze(b: ContextBundle, req: Request) -> Draft:
    sections = _standard(b, req)
    if _chart_ok(b):
        sections.append(("examples", _examples_lines(b)))
    return Draft(
        sections,
        extras={"examples": b.examples, "strategy": _strategy_extra(b), "overlay": _overlay(b)},
        follow_ups=_chart_follow_ups(b, "analyze"),
    )


def _draft_eval(b: ContextBundle, draft: dict) -> tuple[list[str], dict]:
    """Checks of the user's draft order against the chart and the rules. Returns (lines, normalised draft)."""
    a, c = b.analysis, b.chart.compact
    side = "long" if draft.get("side") in ("long", "buy") else "short"
    sign = 1 if side == "long" else -1
    entry, stop, target = draft.get("entry"), draft.get("stop"), draft.get("target")
    atr = (a.get("volatility") or {}).get("atr") or 0
    norm = {"side": side, "entry": entry, "stop": stop, "target": target}
    lines = [
        f"{side.upper()} {c['symbol']} @ {_f(b, entry)} · stop {_f(b, stop)} · target {_f(b, target)}"
        + (f" · qty {draft['qty']:g}" if draft.get("qty") else "")
    ]
    price = c.get("price")
    if price and entry and abs(entry - price) / price > 0.02:
        lines.append(
            f"Entry е на {abs(entry - price) / price * 100:.1f}% от текущата цена {_f(b, price)} — това е план за "
            "limit/stop поръчка, не пазарен вход."
        )
    d = None
    if stop is None:
        lines.append("✗ Няма stop loss — няма дефинирана invalidation и загубата няма граница.")
    elif (stop - entry) * sign >= 0:
        lines.append(
            f"✗ Stop-ът е от грешната страна на входа (за {side.upper()} трябва да е {'под' if sign > 0 else 'над'} entry)."
        )
    else:
        d = abs(entry - stop)
        d_atr = d / atr if atr else None
        lines.append(
            f"Разстояние до stop: {_f(b, d)}"
            + (f" ({d_atr:.2f} ATR" if d_atr is not None else " (")
            + f", {d / entry * 100:.2f}% от entry)."
        )
        if d_atr is not None:
            if d_atr < 0.5:
                lines.append("✗ Stop-ът е по-тесен от 0.5 ATR — обичайният шум на свещите често го удря.")
            elif d_atr > 3:
                lines.append(
                    "✗ Stop-ът е по-широк от 3 ATR — позицията трябва да е по-малка, за да остане рискът същият."
                )
            else:
                lines.append("✓ Разстоянието до stop е в разумен диапазон спрямо волатилността (0.5–3 ATR).")
        levels = [x["price"] for x in (a.get("support") if side == "long" else a.get("resistance")) or []]
        near = [p for p in levels if (entry - p) * sign > 0]
        if near:
            lvl = max(near) if side == "long" else min(near)
            beyond = (lvl - stop) * sign > 0
            word = "support" if side == "long" else "resistance"
            lines.append(
                f"✓ Stop-ът е {'под' if side == 'long' else 'над'} {word} {_f(b, lvl)} — зад нивото, а не в него."
                if beyond
                else f"✗ Stop-ът е {'над' if side == 'long' else 'под'} най-близкия {word} {_f(b, lvl)} — нормален тест на "
                "нивото може да те извади."
            )
    if target is not None:
        if (target - entry) * sign <= 0:
            lines.append("✗ Target-ът е от грешната страна на входа.")
        elif d:
            rr = abs(target - entry) / d
            min_rr = b.rules.min_reward_risk
            lines.append(f"{'✓' if rr >= min_rr else '✗'} R:R {rr:.2f} (минимум по правилата ти {min_rr:g}).")
            blockers = [x["price"] for x in (a.get("resistance") if side == "long" else a.get("support")) or []]
            between = [p for p in blockers if (p - entry) * sign > 0 and (target - p) * sign > 0]
            if between:
                lines.append(
                    f"Между входа и целта има ниво {_f(b, between[0])} — цената може да реагира там преди целта."
                )
    else:
        lines.append("✗ Няма target — изходът не е планиран предварително.")
    ema20 = (c.get("ind") or {}).get("ema20")
    if ema20 and atr and entry:
        dist = (entry - ema20) / atr * sign
        if dist > 1.5:
            lines.append(f"✗ Входът е {dist:.1f} ATR от EMA 20 в посоката на сделката — това е 'chasing'.")
    reg = c.get("regime")
    if (reg == "TRENDING_DOWN" and side == "long") or (reg == "TRENDING_UP" and side == "short"):
        lines.append(f"✗ {side.upper()} срещу режим {reg} — търговията срещу тренда изисква по-силна причина.")
    v = b.view
    if v and v.get("available"):
        want = "POSSIBLE LONG SETUP" if side == "long" else "POSSIBLE SHORT SETUP"
        if v["result"] == want:
            lines.append(f"✓ Съвпада със стратегията '{_strategy_name(b)}' ({v['result']}).")
        elif v["result"] == RESULT_NONE:
            lines.append(
                f"Стратегията '{_strategy_name(b)}' в момента е NO SETUP — черновата не следва нейните правила."
            )
        else:
            lines.append(f"✗ Стратегията '{_strategy_name(b)}' показва обратната посока ({v['result']}).")
    if d:
        sizing = _sizing_line(b, d)
        if sizing:
            lines.append(sizing)
    norm["risk_per_unit"] = round(d, _pp(b)) if d else None
    return lines, norm


def _gen_explain(b: ContextBundle, req: Request) -> Draft:
    if not _chart_ok(b):
        return Draft(_no_data_sections(b), follow_ups=[])
    sections = _standard(b, req, obs_limit=5)
    norm = None
    if req.draft:
        lines, norm = _draft_eval(b, req.draft)
        sections.insert(0, ("draft", lines))
        sec = dict(sections)
        side = norm["side"].upper()
        sec["scenario"] = [
            f"Твоята идея: {side} от {_f(b, norm['entry'])}"
            + (f" с цел {_f(b, norm['target'])}" if norm.get("target") else "")
            + ". Тя предполага, че цената ще се движи в твоя полза преди да стигне stop-а — това е хипотеза, не факт.",
            *sec["scenario"],
        ]
        if norm.get("stop") is not None:
            sec["invalidation"] = [
                f"Твоята invalidation: {_f(b, norm['stop'])}. Ако цената стигне там, идеята е грешна — излизаш по план.",
                *sec["invalidation"],
            ]
        else:
            sec["invalidation"] = [
                "Черновата няма stop — без invalidation няма план. Определи го ПРЕДИ входа.",
                *sec["invalidation"],
            ]
        if norm.get("risk_per_unit"):
            sizing = _sizing_line(b, norm["risk_per_unit"])
            if sizing:
                sec["risk"] = [sizing, *[x for x in sec["risk"] if not x.startswith("Position sizing")]]
        sections = [(k, sec[k]) for k, _ in sections]
    follow = _chart_follow_ups(b, "explain")
    if req.draft:
        follow.insert(1, _fu("TEACH ME: Stop-loss placement", "teach", _payload(b, topic="stop-loss-placement")))
    return Draft(
        sections,
        extras={"strategy": _strategy_extra(b), "overlay": _overlay(b, norm)},
        follow_ups=follow[:5],
        llm_extra={"draft": norm} if norm else {},
    )


def _gen_why(b: ContextBundle, req: Request) -> Draft:
    sections = _standard(b, req, obs_limit=5)
    if _chart_ok(b):
        a = b.analysis
        why = [f"{p['stage']}: {p['detail']}" for p in a.get("pipeline") or []]
        why += list(a.get("teach_me_why") or [])[:6]
        v = b.view
        if v and v.get("available"):
            why += [f"Стратегия: {w}" for w in v["why"][1:]]
        sections.insert(0, ("why", why[:MAX_LINES]))
        sections.append(("examples", _examples_lines(b)))
    return Draft(
        sections,
        extras={"examples": b.examples, "strategy": _strategy_extra(b), "overlay": _overlay(b)},
        follow_ups=_chart_follow_ups(b, "why"),
    )


def _next_lesson(slug: str, completed: set[str]) -> dict | None:
    order = [lesson["slug"] for m in MODULES for lesson in m["lessons"]]
    if slug not in order:
        return None
    after = order[order.index(slug) + 1 :]
    nxt = next((s for s in after if s not in completed), after[0] if after else None)
    if nxt is None:
        return None
    lesson = LESSONS_BY_SLUG[nxt]
    return {"slug": nxt, "title": lesson["title"], "href": lesson_href(nxt), "module": lesson.get("module")}


def _pick_lesson(b: ContextBundle, req: Request) -> tuple[dict, str]:
    if req.topic and req.topic in LESSONS_BY_SLUG:
        return LESSONS_BY_SLUG[req.topic], "избраната тема"
    if req.question:
        found = glossary.lookup(req.question)
        if found:
            return LESSONS_BY_SLUG.get(found["slug"], found), "темата от въпроса ти"
    weak = ((b.context.get("learning") or {}).get("weak")) or []
    for w in weak:
        mod = next((m for m in MODULES if m["key"] == w["module"]), None)
        if mod:
            slug = next(
                (lesson["slug"] for lesson in mod["lessons"] if lesson["slug"] not in b.completed_lessons), None
            )
            if slug:
                return LESSONS_BY_SLUG[slug], f"слабата ти зона ({w['title']})"
    slug = _chart_topic(b)
    return LESSONS_BY_SLUG[slug], "текущата графика"


def _gen_teach(b: ContextBundle, req: Request) -> Draft:
    lesson, why_chosen = _pick_lesson(b, req)
    slug = lesson["slug"]
    body = [f"{lesson['title']} — {lesson['summary']}", f"(Избрано според {why_chosen}.)"]
    body += list(lesson.get("key_points") or [])[:4]
    for s in (lesson.get("sections") or [])[:3]:
        if s.get("body"):
            body.append(f"{s['heading']}: {s['body'][0]}")
    if lesson.get("common_mistakes"):
        body.append(f"Честа грешка: {lesson['common_mistakes'][0]}")
    sections: list[tuple[str, list[str]]] = [("lesson", body)]
    if _chart_ok(b):
        a, c = b.analysis, b.chart.compact
        example = [f"Пример от {c['symbol']} {_tf(c['tf'])} (последна затворена свещ {_utc(c.get('time'))}):"]
        example.append(_contextual_note(slug, a))
        example.append(
            f"Режим {c.get('regime')}; структура {c['structure'].get('high') or '—'} + {c['structure'].get('low') or '—'}; "
            f"RSI {c['ind'].get('rsi')}; ATR {c['ind'].get('atr_pct')}% от цената."
        )
        sections.append(("example", example))
    else:
        sections.append(("example", [_no_data(b)]))
    nxt = _next_lesson(slug, b.completed_lessons)
    this = {"slug": slug, "title": lesson["title"], "href": lesson_href(slug), "module": lesson.get("module")}
    if slug not in b.completed_lessons:
        nl = [f"Прочети целия урок: {lesson['title']} → {lesson_href(slug)}"]
        if nxt:
            nl.append(f"После: {nxt['title']} → {nxt['href']}")
    else:
        nl = [f"Следващ урок: {nxt['title']} → {nxt['href']}"] if nxt else ["Завършил си този модул — направи quiz-а."]
    sections.append(("next_lesson", nl))
    follow = [_fu("QUIZ ME — провери разбирането", "quiz", _payload(b))]
    if nxt:
        follow.append(_fu(f"TEACH ME: {nxt['title']}", "teach", _payload(b, topic=nxt["slug"])))
    if _chart_ok(b):
        follow.append(_fu("ANALYZE — приложи го върху графиката", "analyze", _payload(b)))
    return Draft(
        sections,
        extras={"lesson": this, "next_lesson": nxt, "overlay": _overlay(b)},
        follow_ups=follow,
        llm_extra={
            "lesson": {
                "title": lesson["title"],
                "summary": lesson["summary"],
                "key_points": lesson.get("key_points", [])[:5],
            }
        },
    )


def _gen_review_trade(b: ContextBundle, req: Request) -> Draft:
    rev = b.position_review
    if rev is None:
        sections = [
            ("what_happened", ["Още нямаш затворена paper сделка за преглед."]),
            ("did_well", ["Няма сделка за оценка — направи първата си paper сделка с stop loss и target."]),
            ("did_poorly", ["Няма данни за грешки."]),
            (
                "main_lesson",
                ["Добрият процес започва с план: entry, stop (invalidation), target и риск в рамките на правилото ти."],
            ),
        ]
        return Draft(
            sections,
            follow_ups=[_fu("TEACH ME: Risk per trade", "teach", {"topic": "risk-per-trade"})],
            title="REVIEW TRADE",
        )
    pos = b.position or {}
    what = [rev["what_happened"], f"Вход: {rev['entry']}", f"Изход: {rev['exit']}"]
    what.append(f"Резултат: {rev['result']} · process score {rev['process_score']}/100 (оценка {rev['grade']}).")
    ctx = (pos.get("meta") or {}).get("entry_context") or {}
    if ctx.get("decision") or ctx.get("regime"):
        what.append(f"При входа: решение на анализа {ctx.get('decision') or '—'}, режим {ctx.get('regime') or '—'}.")
    trade_ids = {t.get("id") for t in b.position_trades}
    for e in b.journal_entries:
        if e.get("trade_id") and e["trade_id"] in trade_ids:
            parts = [
                f"setup '{e['setup']}'" if e.get("setup") else None,
                f"емоция '{e['emotion']}'" if e.get("emotion") else None,
            ]
            parts = [p for p in parts if p]
            if parts:
                what.append("От дневника: " + ", ".join(parts) + ".")
            break
    did_well = list(rev.get("did_well") or []) or [
        "Няма отчетена силна страна на процеса — следващия път започни с ясен план (stop + target + риск)."
    ]
    did_poorly = list(rev.get("did_poorly") or []) or [
        "Няма открити процесни грешки. Резултатът сам по себе си не е мярка за качеството на решението."
    ]
    main = [rev["main_lesson"]] + [f"Урок: {_lesson_title(s)} → {lesson_href(s)}" for s in rev.get("lessons") or []]
    follow = [
        _fu(
            f"TEACH ME: {_lesson_title(s)}",
            "teach",
            {"symbol": pos.get("symbol"), "timeframe": (pos.get("meta") or {}).get("timeframe") or "1h", "topic": s},
        )
        for s in (rev.get("lessons") or [])[:2]
    ]
    follow.append(_fu("QUIZ ME", "quiz", {}))
    review = {k: rev.get(k) for k in ("position_id", "symbol", "side", "result", "process_score", "grade", "lessons")}
    for k in ("net_pnl", "r_multiple", "risk_pct", "planned_rr"):
        review[k] = round(rev[k], 2) if rev.get(k) is not None else None
    return Draft(
        [("what_happened", what), ("did_well", did_well), ("did_poorly", did_poorly), ("main_lesson", main)],
        extras={"review": review},
        follow_ups=follow,
        llm_extra={"trade_review": rev},
        title=f"REVIEW TRADE · {rev['symbol']} {str(rev['side']).upper()}",
    )


def _of_heuristic(defn, n: int | None, warnings: list[dict]) -> tuple[str, list[str]]:
    params, conds = defn.numeric_parameters(), defn.condition_count()
    reasons = [f"{params} числови параметъра и {conds} условия."]
    if n is None:
        return "UNKNOWN", reasons + [
            "Без backtest рискът от overfitting не може да се оцени — няма сделки за проверка."
        ]
    risk = "LOW"
    if n < 30:
        risk = "HIGH"
        reasons.append(f"Само {n} сделки — под 30 резултатът е статистически ненадежден.")
    elif n < 100:
        risk = "MEDIUM"
        reasons.append(f"{n} сделки — ограничена извадка.")
    bump = {"LOW": "MEDIUM", "MEDIUM": "HIGH", "HIGH": "HIGH"}
    codes = {w.get("code") for w in warnings}
    if "overfitting" in codes:  # small parameter changes flip the result
        risk = "HIGH"
    elif "out_of_sample" in codes:
        risk = bump[risk]
    reasons += [w.get("text", "") for w in warnings if w.get("code") in ("overfitting", "out_of_sample")][:2]
    if conds >= 5 and n < 100:
        risk = bump[risk]
        reasons.append(f"{conds} условия при само {n} сделки — много правила върху малко данни.")
    return risk, reasons


def _gen_review_strategy(b: ContextBundle, req: Request) -> Draft:
    defn, info = b.strategy_def, b.strategy_info or {}
    name = info.get("name") or "Strategy"
    bt = b.backtest if (b.backtest is not None and b.backtest.status == "done") else None
    m = (bt.metrics or {}) if bt else {}
    v = (bt.validation or {}) if bt else {}
    warnings = [w for w in v.get("warnings") or [] if isinstance(w, dict)]
    n = m.get("total_trades") if bt else None
    stop_txt = next((line[5:].strip() for line in describe(defn) if line.startswith("STOP:")), "")
    tp_txt = next((line[12:].strip() for line in describe(defn) if line.startswith("TAKE PROFIT:")), "")

    strengths: list[str] = [f"Има ясно дефиниран stop ({stop_txt}) — всяка сделка има invalidation."]
    weaknesses: list[str] = []
    if defn.take_profit.type != "none":
        strengths.append(f"Изходът е планиран предварително (take profit: {tp_txt}).")
    else:
        weaknesses.append("Няма фиксирана цел (take profit) — изходът зависи само от stop/exit правила.")
    if defn.regime_filter:
        strengths.append(f"Regime filter ({', '.join(defn.regime_filter)}) — стратегията не търгува във всеки пазар.")
    else:
        weaknesses.append("Няма regime filter — ще търгува и в режими, в които логиката ѝ може да не работи.")
    conds = defn.condition_count()
    entry_conds = sum(len(x.conditions) for x in (defn.entry_long, defn.entry_short) if x)
    if 2 <= entry_conds <= 4 * (1 + bool(defn.entry_long and defn.entry_short)):
        strengths.append(f"Правилата за вход са малко на брой ({entry_conds} условия) — по-нисък риск от напасване.")
    if entry_conds == 1:
        weaknesses.append("Само едно условие за вход — филтърът е слаб и ще генерира много шум.")
    if defn.risk_per_trade_pct <= 1:
        strengths.append(f"Риск {defn.risk_per_trade_pct:g}% на сделка — в рамките на дисциплинирано правило.")
    elif defn.risk_per_trade_pct > 2:
        weaknesses.append(
            f"Риск {defn.risk_per_trade_pct:g}% на сделка е висок — серия загуби би довела до голям drawdown."
        )
    if defn.entry_long and defn.entry_short:
        strengths.append("Има правила и за LONG, и за SHORT — може да се оценява в двете посоки.")

    if bt:
        wr, pf, exp_r, dd = m.get("win_rate"), m.get("profit_factor"), m.get("expectancy_r"), m.get("max_drawdown_pct")
        summary = (
            f"Backtest #{bt.id} ({bt.symbol} {_tf(bt.timeframe)}): {n} сделки"
            + (f", win rate {wr:.1f}%" if wr is not None else "")
            + (f", profit factor {'∞' if pf >= 1e8 else f'{pf:.2f}'}" if pf is not None else "")
            + (f", expectancy {exp_r:+.2f}R" if exp_r is not None else "")
            + (f", max drawdown {dd:.1f}%" if dd is not None else "")
            + "."
        )
        if n and n >= 100:
            strengths.append(f"{summary} Извадката е приемлива за първоначална оценка.")
        else:
            weaknesses.append(summary)
        if exp_r is not None and exp_r > 0 and not any(w.get("severity") == "high" for w in warnings):
            strengths.append(
                "Положителен expectancy на тази извадка без сериозни червени флагове — това не доказва реално предимство."
            )
        elif exp_r is not None and exp_r <= 0:
            weaknesses.append(
                f"Expectancy {exp_r:+.2f}R на тази извадка — правилата не показват предимство в този период."
            )
        for w in sorted(warnings, key=lambda w: 0 if w.get("severity") == "high" else 1)[:4]:
            weaknesses.append(w.get("text", ""))
        by_regime = [r for r in v.get("results_by_regime") or [] if (r.get("trades") or 0) >= 3]
        if by_regime:
            worst = min(by_regime, key=lambda r: r.get("net_pnl") or 0)
            best = max(by_regime, key=lambda r: r.get("net_pnl") or 0)
            if (worst.get("net_pnl") or 0) < 0:
                weaknesses.append(
                    f"Най-слаб режим: {worst['regime']} ({worst['trades']} сделки, P/L {worst['net_pnl']:+,.2f})."
                )
            if (best.get("net_pnl") or 0) > 0 and best is not worst:
                strengths.append(
                    f"Най-добър режим: {best['regime']} ({best['trades']} сделки, P/L {best['net_pnl']:+,.2f})."
                )
    else:
        weaknesses.append("Няма завършен backtest — без него не знаем как правилата са се държали исторически.")

    of = v.get("overfitting") if isinstance(v.get("overfitting"), dict) else None
    if of and of.get("risk"):
        overfit = [f"OVERFITTING RISK: {of['risk']} (score {of.get('score', 0)}/100). {of.get('text', '')}".strip()]
        overfit += list(of.get("reasons") or [])[:4]
    else:
        risk, reasons = _of_heuristic(defn, n, warnings)
        overfit = [f"OVERFITTING RISK: {risk} (оценка по правилата и backtest-а)."] + reasons
    overfit.append(f"Сложност: {defn.numeric_parameters()} числови параметъра, {conds} условия общо.")
    wf = v.get("walk_forward") if isinstance(v.get("walk_forward"), dict) else None
    if wf and wf.get("text"):
        overfit.append(f"Walk-forward: {wf['text']}")

    sid = info.get("id")
    sym = b.chart.symbol if b.chart is not None else (bt.symbol if bt else info.get("symbol") or "BTC/USDT")
    tf = b.chart.timeframe if b.chart is not None else (bt.timeframe if bt else info.get("timeframe") or "1h")
    nxt: list[str] = []
    if not bt:
        nxt.append(
            f"Пусни backtest на {sym} {_tf(tf)} за поне 1–2 години история → /backtesting"
            + (f"?strategy_id={sid}" if sid else "")
        )
    else:
        if n is not None and n < 100:
            nxt.append("Удължи периода или тествай на още 2–3 инструмента, за да стигнеш поне 100 сделки.")
        codes = {w.get("code") for w in warnings}
        if "out_of_sample" in codes or not v.get("out_of_sample"):
            nxt.append("Направи out-of-sample проверка: тествай фиксираните правила на период, който не си гледал.")
        if "regime_bias" in codes:
            nxt.append("Тествай отделно в друг пазарен режим — резултатът сега е доминиран от един режим.")
        if "slippage" in codes or "costs" in codes:
            nxt.append("Повтори backtest-а с по-високи такси/slippage — разходите променят резултата.")
    nxt.append("Forward test: пусни paper bot с тази стратегия и сравни поведението след 30+ сделки → /bots")
    v_now = b.view
    if v_now and v_now.get("available"):
        nxt.append(f"Днес на {v_now['symbol']} {_tf(v_now['timeframe'])}: {v_now['result']} (виж STRATEGY VIEW).")
    ex = b.examples or {}
    if ex.get("available") and ex.get("count") and ex.get("basis") == "strategy":
        nxt.append(
            f"Исторически сигнали на правилата: {ex['count']}, +1R първо в {ex['plus_first_pct']}% — past examples, not a forecast."
        )
    nxt.append(PAST_PERFORMANCE)

    sections = [
        ("rules", describe(defn)),
        ("strengths", strengths),
        (
            "weaknesses",
            weaknesses or ["Няма очевидни слабости в правилата — следващата стъпка е проверка на нови данни."],
        ),
        ("overfitting", overfit),
        ("next_test", nxt),
    ]
    follow = [
        _fu("TEACH ME: Overfitting", "teach", {"symbol": sym, "timeframe": tf, "topic": "overfitting"}),
        _fu("TEACH ME: Sample size", "teach", {"symbol": sym, "timeframe": tf, "topic": "sample-size"}),
        _fu("WHY? — какво казва стратегията сега", "why", {"symbol": sym, "timeframe": tf, "strategy_id": sid}),
    ]
    return Draft(
        sections,
        extras={
            "strategy": _strategy_extra(b),
            "backtest": {"id": bt.id, "symbol": bt.symbol, "timeframe": bt.timeframe} if bt else None,
            "examples": b.examples,
        },
        follow_ups=follow,
        llm_extra={
            "backtest_validation": {
                k: v.get(k) for k in ("headline", "robustness", "warnings", "overfitting", "sample_size")
            }
        }
        if bt
        else {},
        title=f"REVIEW STRATEGY · {name}",
    )


def _gen_quiz(b: ContextBundle, req: Request) -> Draft:
    chart = b.chart.compact if _chart_ok(b) else None
    quiz = build_quiz(b.progress, chart, rng=req.rng)
    src = quiz["sources"]
    intro = [f"{len(quiz['questions'])} въпроса: {src['academy']} от академията и {src['chart']} от текущата графика."]
    if chart is None and b.chart is not None:
        intro.append(_no_data(b) + " — затова въпросите са само от академията.")
    for f in quiz["focus"][:3]:
        intro.append(f"Фокус: {f['title']} ({f['reason']}).")
    intro.append("Избери отговор, за да видиш обяснението. Целта е разбиране, не точки.")
    weak = ((b.context.get("learning") or {}).get("weak")) or []
    follow = [_fu("QUIZ ME — нови въпроси", "quiz", _payload(b))]
    if weak:
        mod = next((m for m in MODULES if m["key"] == weak[0]["module"]), None)
        if mod and mod["lessons"]:
            slug = mod["lessons"][0]["slug"]
            follow.append(_fu(f"TEACH ME: {_lesson_title(slug)}", "teach", _payload(b, topic=slug)))
    return Draft([("quiz", intro)], extras={"quiz": quiz}, follow_ups=follow)


def _side_desc(cd) -> dict:
    """Comparison cells for one chart."""
    if cd is None or not cd.available:
        na = "DATA NOT AVAILABLE"
        return {
            k: na
            for k in ("regime", "structure", "volatility", "momentum", "support", "resistance", "strategy", "decision")
        }
    c, a = cd.compact, cd.analysis
    pp = cd.spec.price_precision
    price = c.get("price") or 0
    atr = (a.get("volatility") or {}).get("atr") or 0

    def dist(levels: list, word: str) -> str:
        if not levels or not price:
            return f"няма ясен {word}"
        lvl = levels[0][0]
        d_atr = f"{abs(price - lvl) / atr:.1f} ATR" if atr else "—"
        return f"{lvl:,.{pp}f} ({abs(price - lvl) / price * 100:.2f}%, {d_atr})"

    v = cd.view or {}
    cond = v.get("conditions") or {}
    fit = v.get("result") or "—"
    if v.get("available"):
        parts = []
        for side, key in (("LONG", "long"), ("SHORT", "short")):
            rows = cond.get(key) or []
            if rows:
                parts.append(f"{side} {sum(1 for r in rows if r['passed'])}/{len(rows)}")
        rf = v.get("regime_filter") or {}
        fit = f"{v['result']} ({', '.join(parts)}; regime filter {'OK' if rf.get('passed') else 'BLOCKED'})"
    st = c.get("structure") or {}
    return {
        "regime": c.get("regime") or "—",
        "structure": f"{st.get('high') or '—'} + {st.get('low') or '—'} ({st.get('trend')})",
        "volatility": f"{c.get('volatility')} · ATR {c['ind'].get('atr_pct')}% (ранг {c.get('atr_rank')})",
        "momentum": f"{c.get('momentum')} · RSI {c['ind'].get('rsi')}",
        "support": dist(c.get("support") or [], "support"),
        "resistance": dist(c.get("resistance") or [], "resistance"),
        "strategy": fit,
        "decision": (c.get("signal") or {}).get("decision") or "—",
    }


_COMPARE_ROWS = (
    ("regime", "Режим"),
    ("structure", "Структура"),
    ("volatility", "Волатилност"),
    ("momentum", "Momentum"),
    ("support", "Разстояние до support"),
    ("resistance", "Разстояние до resistance"),
    ("strategy", "Strategy fit"),
    ("decision", "Signal engine"),
)


def _gen_compare(b: ContextBundle, req: Request) -> Draft:
    left, right = b.chart, b.compare
    lname = f"{left.symbol} {_tf(left.timeframe)}" if left else "—"
    rname = f"{right.symbol} {_tf(right.timeframe)}" if right else "—"
    L, R = _side_desc(left), _side_desc(right)
    rows = [
        {"key": k, "label": label, "left": L[k], "right": R[k], "different": L[k] != R[k]} for k, label in _COMPARE_ROWS
    ]
    comparison = {
        "left": {
            "symbol": left.symbol if left else None,
            "timeframe": left.timeframe if left else None,
            "label": lname,
            "available": bool(left and left.available),
        },
        "right": {
            "symbol": right.symbol if right else None,
            "timeframe": right.timeframe if right else None,
            "label": rname,
            "available": bool(right and right.available),
        },
        "rows": rows,
        "note": COMPARE_NOTE,
    }
    table = [f"{r['label']}: {lname} — {r['left']} | {rname} — {r['right']}" for r in rows]
    both = bool(left and left.available and right and right.available)
    if not (left and left.available):
        sections = _no_data_sections(b)
    else:
        std = dict(_standard(b, req, obs_limit=3))
        if right is not None and right.available:
            ca, cr = left.compact, right.compact
            std["observation"] = [
                f"{lname}: цена {_f(b, ca.get('price'))}, режим {ca.get('regime')}, структура "
                f"{ca['structure'].get('high') or '—'} + {ca['structure'].get('low') or '—'}, RSI {ca['ind'].get('rsi')}, "
                f"ATR {ca['ind'].get('atr_pct')}% (последна затворена свещ {_utc(ca.get('time'))}).",
                f"{rname}: цена {fmt_price(cr.get('price'), right.spec.price_precision)}, режим {cr.get('regime')}, "
                f"структура {cr['structure'].get('high') or '—'} + {cr['structure'].get('low') or '—'}, "
                f"RSI {cr['ind'].get('rsi')}, ATR {cr['ind'].get('atr_pct')}% (последна затворена свещ {_utc(cr.get('time'))}).",
            ]
            std["rules"] = [
                f"{lname} · Strategy fit: {L['strategy']}",
                f"{rname} · Strategy fit: {R['strategy']}",
                *std["rules"][-2:],
            ]
            std["scenario"] = [
                f"{lname}: signal engine {L['decision']}; стратегия {L['strategy']}.",
                f"{rname}: signal engine {R['decision']}; стратегия {R['strategy']}.",
                "Една и съща стратегия може да показва различен резултат на различни пазари/timeframe-ове — "
                "правилата се проверяват независимо за всяка графика.",
                SETUP_DISCLAIMER,
            ]
            sup_r = (right.analysis.get("support") or [{}])[0].get("price")
            res_r = (right.analysis.get("resistance") or [{}])[0].get("price")
            std["invalidation"] = [
                *std["invalidation"][:2],
                f"{rname}: ключови нива support {fmt_price(sup_r, right.spec.price_precision)} / resistance "
                f"{fmt_price(res_r, right.spec.price_precision)}.",
            ]
            atr_l, atr_r = ca["ind"].get("atr_pct"), cr["ind"].get("atr_pct")
            risk = list(std["risk"][:1])
            if atr_l and atr_r:
                hi, lo = (lname, rname) if atr_l > atr_r else (rname, lname)
                ratio = max(atr_l, atr_r) / min(atr_l, atr_r)
                risk.append(
                    f"ATR% на {hi} е {ratio:.1f}× този на {lo} — при еднакъв риск в пари позицията в {hi} трябва да е "
                    f"около {ratio:.1f}× по-малка."
                )
            risk.append(LEVERAGE_NOTE)
            std["risk"] = risk
            std["alternative"] = [
                "Режимите се сменят: сравнението е моментна снимка към последните затворени свещи.",
                *std["alternative"][-1:],
            ]
        else:
            std["observation"].append(
                f"{rname}: DATA NOT AVAILABLE — {right.reason if right else 'няма втори инструмент'}."
            )
        sections = [(k, std[k]) for k in STANDARD]
    sections.insert(0, ("comparison", table))
    diffs = [r["label"] for r in rows if r["different"]]
    if both:
        conclusion = [
            f"Основни разлики между {lname} и {rname}: "
            + (", ".join(diffs) if diffs else "няма съществени разлики")
            + ".",
            COMPARE_NOTE,
        ]
        if L["regime"] != R["regime"]:
            conclusion.insert(
                1,
                f"Различен режим ({L['regime']} срещу {R['regime']}) означава, че една и съща стратегия може да се държи различно.",
            )
    else:
        conclusion = ["Сравнението не е пълно — за едната страна няма данни (DATA NOT AVAILABLE).", COMPARE_NOTE]
    sections.append(("conclusion", conclusion))
    follow = []
    if right is not None:
        follow.append(_fu(f"ANALYZE {rname}", "analyze", {"symbol": right.symbol, "timeframe": right.timeframe}))
    follow.append(_fu(f"WHY? {lname}", "why", _payload(b)))
    follow.append(_fu("TEACH ME: Market regimes", "teach", _payload(b, topic="market-regimes")))
    return Draft(
        sections,
        extras={"comparison": comparison, "strategy": _strategy_extra(b), "overlay": _overlay(b)},
        follow_ups=follow,
        title=f"COMPARE · {lname} vs {rname}",
    )


GENERATORS = {
    "explain": _gen_explain,
    "analyze": _gen_analyze,
    "teach": _gen_teach,
    "review_trade": _gen_review_trade,
    "review_strategy": _gen_review_strategy,
    "quiz": _gen_quiz,
    "why": _gen_why,
    "compare": _gen_compare,
}


# ---------------------------------------------------------------------- LLM
def parse_llm_sections(text: str, keys: list[str]) -> dict[str, list[str]]:
    """Parse the LLM's JSON answer → {key: [lines]} for the requested keys. Raises ValueError if unusable."""
    t = (text or "").strip()
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("LLM answer is not JSON")
    data = json.loads(t[start : end + 1])
    secs = data.get("sections", data) if isinstance(data, dict) else None
    if isinstance(secs, list):
        secs = {s.get("key"): s.get("body") for s in secs if isinstance(s, dict)}
    if not isinstance(secs, dict):
        raise ValueError("LLM answer has no sections")
    out: dict[str, list[str]] = {}
    for k in keys:
        val = secs.get(k)
        if isinstance(val, str):
            val = val.split("\n")
        if isinstance(val, list):
            lines = [re.sub(r"^\s*[-•*]\s*", "", str(x)).strip()[:600] for x in val if str(x).strip()]
            if lines:
                out[k] = lines[:8]
    if not out:
        raise ValueError("LLM answer has none of the requested sections")
    return out


def _ask_llm(llm: LLMProvider, md: ModeDef, b: ContextBundle, d: Draft, req: Request) -> dict[str, list[str]]:
    keys = [k for k, _ in d.sections if k not in DETERMINISTIC]
    if not keys:
        return {}
    guide = "\n".join(f"- {k}: {TEACHER_V2_SECTION_GUIDE.get(k, k)}" for k in keys)
    level = (
        "Потребителят е начинаещ: прости думи, кратко обяснение на термините."
        if b.user_mode == "beginner"
        else "Потребителят е напреднал: сбито, с повече метрики."
    )
    system = (
        f"{TEACHER_V2_SYSTEM}\n{TEACHER_V2_MODE_PROMPTS[md.key]}\n{level}\n"
        f"Ключове за този отговор (точно тези): {', '.join(keys)}\n{guide}\n"
    )
    dump = lambda x, n: json.dumps(x, ensure_ascii=False, default=str)[:n]  # noqa: E731
    content = ""
    if req.question:
        content += f"<question>{req.question[:2000]}</question>\n"
    content += f"<context>{dump(llm_payload(b.context), 9000)}</context>\n"
    for tag, data in d.llm_extra.items():
        content += f"<{tag}>{dump(data, 6000)}</{tag}>\n"
    content += f"<engine_draft>{dump(dict(d.sections), 9000)}</engine_draft>\n"
    content += 'Върни само JSON обекта {"sections": {...}}.'
    text = llm.complete(system, [{"role": "user", "content": content}], max_tokens=LLM_MAX_TOKENS)
    return parse_llm_sections(text, keys)


# ------------------------------------------------------------- grounding
_NUMBER = re.compile(r"(?<![\w.])[-+−]?\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> list[tuple[float, bool]]:
    """Numbers in `text` as (value, needs_grounding). Small integers (periods, counts, '2R', RSI 70…) are not
    checked; prices, levels and any decimal value are."""
    out = []
    for m in _NUMBER.finditer(text):
        raw = m.group(0).replace(",", "").replace("−", "-").lstrip("+")
        try:
            v = float(raw)
        except ValueError:
            continue
        out.append((v, "." in raw or abs(v) >= 100))
    return out


def grounding_corpus(*parts) -> list[float]:
    text = " ".join(p if isinstance(p, str) else json.dumps(p, ensure_ascii=False, default=str) for p in parts)
    return sorted({abs(v) for v, _ in _numbers(text)})


def ungrounded_numbers(lines: list[str], corpus: list[float]) -> list[float]:
    """Numbers in `lines` that do not appear (±0.2%, sign ignored) anywhere in the engine's data."""
    bad = []
    for line in lines:
        for v, check in _numbers(line):
            if not check:
                continue
            x = abs(v)
            tol = max(x * 0.002, 1e-9)
            i = bisect.bisect_left(corpus, x - tol)
            if not (i < len(corpus) and corpus[i] <= x + tol):
                bad.append(v)
    return bad


# --------------------------------------------------------------------- run
def _clean_extra(value, removed: list[str]):
    """Sanitize every string inside an extras structure (quiz texts, comparison cells…)."""
    if isinstance(value, str):
        clean, rem = sanitize_lines([value])
        removed.extend(rem)
        return clean[0] if clean else ""
    if isinstance(value, list):
        return [_clean_extra(v, removed) for v in value]
    if isinstance(value, dict):
        return {k: _clean_extra(v, removed) for k, v in value.items()}
    return value


def run_mode(
    mode: str,
    b: ContextBundle,
    *,
    llm: LLMProvider | None = None,
    question: str | None = None,
    draft: dict | None = None,
    topic: str | None = None,
    rng: random.Random | None = None,
) -> dict:
    md = MODES[mode]
    req = Request(
        question=(question or "").strip()[:2000] or None,
        draft=draft,
        topic=topic,
        rng=rng or random.Random(),
    )
    d = GENERATORS[mode](b, req)
    offline = {k: list(v) for k, v in d.sections}
    sections = dict(offline)
    for k in md.sections:  # guarantee every required key
        sections.setdefault(k, ["—"])

    provider, fallback = "offline", False
    rejected: list[str] = []
    if llm is not None and any(k not in DETERMINISTIC for k in sections):
        try:
            got = _ask_llm(llm, md, b, d, req)
            corpus = grounding_corpus(llm_payload(b.context), offline, d.llm_extra, d.extras, req.question or "")
            for k, lines in got.items():
                if k not in sections or k in DETERMINISTIC:
                    continue
                bad = ungrounded_numbers(lines, corpus)
                if bad:  # never show numbers the engine did not compute → keep the offline section
                    log.warning("teacher %s: LLM section %s has ungrounded numbers %s", mode, k, bad[:5])
                    rejected.append(k)
                    continue
                sections[k] = lines
            provider = getattr(llm, "name", "llm") or "llm"
        except Exception as exc:  # noqa: BLE001 - any LLM problem (error, refusal, bad JSON) → offline answer
            log.warning("teacher %s: LLM failed, using the offline answer: %s", mode, exc)
            sections = {k: (offline.get(k) or v) for k, v in sections.items()}
            fallback = True

    removed: list[str] = []
    out_sections = []
    for k, lines in sections.items():
        clean, rem = sanitize_lines(lines)
        removed += rem
        if not clean and offline.get(k):
            clean, rem2 = sanitize_lines(offline[k])
            removed += rem2
        out_sections.append({"key": k, "title": TITLES.get(k, k.upper()), "body": clean or ["—"]})

    follow_ups = []
    for f in d.follow_ups:
        label, rem = sanitize_lines([f["label"]])
        removed += rem
        if label:
            follow_ups.append({**f, "label": label[0]})
    extras = _clean_extra({k: v for k, v in d.extras.items()}, removed)

    disclaimer = STANDARD_DISCLAIMER
    if md.setup_disclaimer:
        disclaimer = f"{SETUP_DISCLAIMER} {STANDARD_DISCLAIMER}"
    if mode == "review_strategy":
        disclaimer = f"{disclaimer} {PAST_PERFORMANCE}"
    chart = b.chart
    title = d.title or (f"{md.label} · {chart.symbol} {_tf(chart.timeframe)}" if chart is not None else md.label)
    return {
        "mode": mode,
        "title": title,
        "symbol": chart.symbol if chart is not None else None,
        "timeframe": chart.timeframe if chart is not None else None,
        "sections": out_sections,
        "follow_ups": follow_ups,
        "context_used": b.context.get("context_used", []),
        "provider": provider,
        "provider_label": "OFFLINE" if provider == "offline" else ("Claude" if provider == "anthropic" else provider),
        "fallback": fallback,
        "llm_rejected_sections": rejected,
        "disclaimer": disclaimer,
        "safety_removed": removed,
        "safety_note": SAFETY_NOTE if removed else None,
        "data_available": chart.available if chart is not None else None,
        "generated_ts": int(time.time()),
        **extras,
    }


def render_text(answer: dict) -> str:
    """Plain-text rendering (stored as the assistant message of the teacher session)."""
    parts = [answer.get("title", "")]
    for s in answer.get("sections") or []:
        parts.append("")
        parts.append(s["title"])
        parts += [f"- {line}" for line in s["body"]]
    quiz = answer.get("quiz")
    if quiz:
        for i, q in enumerate(quiz.get("questions") or [], 1):
            parts.append(f"{i}. {q['question']}")
    if answer.get("disclaimer"):
        parts += ["", answer["disclaimer"]]
    return "\n".join(parts).strip()
