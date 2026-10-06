"""Learning path LEVEL 0–10 — levels, unlock rule, lesson routes and skill scoring.

The academy is a path, not a list of texts. Each level groups one academy module (app.academy.content) plus the
practice labs that belong to it:

    L0 Market Basics → L1 Charts & Candlesticks → L2 Technical Analysis → L3 Indicators → L4 Price Action →
    L5 Risk Management → L6 Leverage & Margin → L7 Strategies → L8 Backtesting → L9 Trading Psychology →
    L10 Advanced Market Analysis

Everything in this module is pure (no DB): app.services.learning_service feeds it the user's progress.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from app.academy.content import LESSONS_BY_SLUG, MODULES, MODULES_BY_KEY

# --------------------------------------------------------------------------------------------- levels
UNLOCK_ALWAYS = "always"
UNLOCK_PREVIOUS = "previous_quiz_or_progress"


def _lab(href: str, title: str, description: str) -> dict:
    return {"href": href, "title": title, "description": description}


LEVELS: list[dict] = [
    {
        "level": 0,
        "key": "market-basics",
        "title": "Market Basics",
        "title_bg": "Основи на пазара",
        "goal": "Да разбереш какво е пазар, как се изпълняват поръчките и какво струва всяка сделка.",
        "modules": ["level0"],
        "labs": [],
    },
    {
        "level": 1,
        "key": "charts-candlesticks",
        "title": "Charts & Candlesticks",
        "title_bg": "Графики и японски свещи",
        "goal": "Да четеш всяка свещ — тяло, горна и долна сянка — и да виждаш какво се е случило вътре в периода.",
        "modules": ["charts"],
        "labs": [
            _lab("/learn/candlesticks", "Candlestick Lab", "Галерия от свещни модели и практика с реални графики."),
        ],
    },
    {
        "level": 2,
        "key": "technical-analysis",
        "title": "Technical Analysis",
        "title_bg": "Технически анализ",
        "goal": "Да разпознаваш тренд, support, resistance и пазарна структура (HH, HL, LH, LL).",
        "modules": ["technical"],
        "labs": [
            _lab(
                "/learn/market-structure",
                "Market Structure Lab",
                "Маркирай HH, HL, LH, LL, пробиви и fakeout-и върху реална графика и получи проверка.",
            ),
        ],
    },
    {
        "level": 3,
        "key": "indicators",
        "title": "Indicators",
        "title_bg": "Индикатори",
        "goal": "Да знаеш какво измерва всеки индикатор, как се изчислява и кога заблуждава.",
        "modules": ["indicators"],
        "labs": [
            _lab("/charts", "Charts: индикатори", "Добави EMA, RSI, MACD или ATR върху графиката и сравни."),
        ],
    },
    {
        "level": 4,
        "key": "price-action",
        "title": "Price Action",
        "title_bg": "Price action",
        "goal": "Да превръщаш структурата и свещите в ясни сценарии с вход, invalidation и цел.",
        "modules": ["price_action"],
        "labs": [
            _lab(
                "/ai?mode=analyze",
                "AI Teacher: анализ на графика",
                "Анализирай графика по схемата OBSERVATION → RULES → SCENARIO → INVALIDATION → RISK.",
            ),
        ],
    },
    {
        "level": 5,
        "key": "risk-management",
        "title": "Risk Management",
        "title_bg": "Управление на риска",
        "goal": "Да изчисляваш риска и размера на позицията преди всяка сделка, а не след нея.",
        "modules": ["risk"],
        "labs": [
            _lab("/risk", "Risk Manager", "Калкулатор на позицията и личните ти правила за риск."),
        ],
    },
    {
        "level": 6,
        "key": "leverage-margin",
        "title": "Leverage & Margin",
        "title_bg": "Leverage и margin",
        "goal": "Да разбираш margin, margin level и ликвидацията — и защо по-високият leverage увеличава риска, "
        "без да подобрява стратегията.",
        "modules": ["leverage"],
        "labs": [
            _lab("/learn/leverage", "Leverage Lab", "Симулирай leverage върху $10,000 виртуална сметка."),
            _lab("/simulator", "Trade Simulator", "What-if сметка: размер, margin, R:R и ликвидация без поръчка."),
        ],
    },
    {
        "level": 7,
        "key": "strategies",
        "title": "Strategies",
        "title_bg": "Стратегии",
        "goal": "Да описваш стратегия с ясни, измерими правила за вход, изход и риск.",
        "modules": ["strategy"],
        "labs": [
            _lab(
                "/strategies", "Strategy Builder", "Сглоби правила IF / AND / THEN и виж rule-based хипотетичния setup."
            ),
        ],
    },
    {
        "level": 8,
        "key": "backtesting",
        "title": "Backtesting",
        "title_bg": "Backtesting",
        "goal": "Да тестваш правила върху историята честно — с разходи, достатъчно сделки и out-of-sample проверка.",
        "modules": ["backtesting"],
        "labs": [
            _lab("/backtesting", "Backtesting Lab", "Тест с такси, slippage, validation и out-of-sample."),
        ],
    },
    {
        "level": 9,
        "key": "psychology",
        "title": "Trading Psychology",
        "title_bg": "Психология на търговията",
        "goal": "Да разпознаваш FOMO, revenge trading и другите поведенчески грешки в собствените си сделки.",
        "modules": ["psychology"],
        "labs": [
            _lab("/journal", "Trading Journal", "Записвай причина, емоция и урок след всяка сделка."),
        ],
    },
    {
        "level": 10,
        "key": "advanced-analysis",
        "title": "Advanced Market Analysis",
        "title_bg": "Напреднал пазарен анализ",
        "goal": "Да изграждаш цялостен анализ — timeframes, режим, волатилност, корелация и event risk — с план и "
        "алтернативен сценарий.",
        "modules": ["advanced"],
        "labs": [
            _lab("/replay", "Replay", "Взимай решения свещ по свещ върху история, без да знаеш продължението."),
            _lab("/markets", "Markets", "Приложи чеклиста върху различни класове активи."),
        ],
    },
]

for _i, _lvl in enumerate(LEVELS):
    _lvl["unlock"] = (
        {"rule": UNLOCK_ALWAYS, "after_module": None, "text": "Винаги отключено — започни оттук."}
        if _i == 0
        else {
            "rule": UNLOCK_PREVIOUS,
            "after_module": LEVELS[_i - 1]["modules"][-1],
            "text": f"Отключва се с quiz от LEVEL {_i - 1} (≥ 70%) или когато започнеш урок от това ниво.",
        }
    )

LEVELS_BY_NUMBER: dict[int, dict] = {lvl["level"]: lvl for lvl in LEVELS}
LEVELS_BY_KEY: dict[str, dict] = {lvl["key"]: lvl for lvl in LEVELS}
LEVEL_OF_MODULE: dict[str, int] = {m: lvl["level"] for lvl in LEVELS for m in lvl["modules"]}

# The module order before V2 (8 modules). Users who unlocked a module under the old chained rule keep it.
LEGACY_MODULE_ORDER: tuple[str, ...] = (
    "level0",
    "charts",
    "technical",
    "indicators",
    "price_action",
    "risk",
    "psychology",
    "strategy",
)

MODULE_ORDER: tuple[str, ...] = tuple(m["key"] for m in MODULES)


def unlocked_modules(completed_slugs: Iterable[str], passed_modules: Iterable[str]) -> dict[str, bool]:
    """Unlock state of every module (in MODULES order).

    A module is unlocked when ANY of these holds:
      1. it is the first module (LEVEL 0);
      2. the previous module in the V2 order has a passed quiz (≥ PASS_SCORE);
      3. the user has completed at least one lesson of it;
      4. legacy: it was unlocked under the pre-V2 rule — every earlier module of LEGACY_MODULE_ORDER passed.
    Rule 4 (with rule 3) guarantees that nobody loses access because of the V2 re-ordering.
    """
    done = set(completed_slugs)
    passed = set(passed_modules)
    touched = {LESSONS_BY_SLUG[s]["module"] for s in done if s in LESSONS_BY_SLUG}
    legacy: set[str] = set()
    chain = True
    for key in LEGACY_MODULE_ORDER:
        if chain:
            legacy.add(key)
        chain = chain and key in passed
    out: dict[str, bool] = {}
    for i, key in enumerate(MODULE_ORDER):
        out[key] = i == 0 or MODULE_ORDER[i - 1] in passed or key in touched or key in legacy
    return out


# ------------------------------------------------------------------------------------- lesson routes
# Lessons live at /learn/<slug>. These static routes are owned by labs/quiz pages (S3b and the quiz page) and
# would shadow a lesson with the same slug, so such lessons are served under an alias route instead. The
# canonical slug keeps working everywhere in the API (progress rows, quiz keys, glossary links).
RESERVED_LEARN_ROUTES: frozenset[str] = frozenset({"candlesticks", "market-structure", "leverage", "quiz"})
LESSON_ROUTE_ALIASES: dict[str, str] = {
    "leverage": "leverage-basics",
    "market-structure": "market-structure-basics",
}
_ROUTE_TO_SLUG: dict[str, str] = {route: slug for slug, route in LESSON_ROUTE_ALIASES.items()}


def lesson_route(slug: str) -> str:
    return LESSON_ROUTE_ALIASES.get(slug, slug)


def lesson_href(slug: str) -> str:
    return f"/learn/{lesson_route(slug)}"


def quiz_href(module_key: str) -> str:
    return f"/learn/quiz/{module_key}"


def resolve_lesson_slug(slug_or_route: str) -> str | None:
    """Canonical lesson slug for a slug or an alias route (None when unknown)."""
    if slug_or_route in LESSONS_BY_SLUG:
        return slug_or_route
    return _ROUTE_TO_SLUG.get(slug_or_route)


# ---------------------------------------------------------------------------------------- next step
def next_step(statuses: Mapping[int, str], completed_slugs: Iterable[str], passed_modules: Iterable[str]) -> dict:
    """The 'Continue' target, walking the path in order and skipping completed levels:
    first unfinished lesson of the level → that module's quiz → next level. When everything is completed the
    learner keeps practising in Replay (type 'lab'). `statuses` maps level number → computed status."""
    done = set(completed_slugs)
    passed = set(passed_modules)
    for lvl in LEVELS:
        if statuses.get(lvl["level"]) == "completed":
            continue
        for key in lvl["modules"]:
            m = MODULES_BY_KEY[key]
            for lesson in m["lessons"]:
                if lesson["slug"] not in done:
                    return {
                        "type": "lesson",
                        "href": lesson_href(lesson["slug"]),
                        "title": lesson["title"],
                        "level": lvl["level"],
                        "slug": lesson["slug"],
                        "module": key,
                    }
            if key not in passed:
                return {
                    "type": "quiz",
                    "href": quiz_href(key),
                    "title": f"Quiz: {m['title']}",
                    "level": lvl["level"],
                    "slug": None,
                    "module": key,
                }
    return {
        "type": "lab",
        "href": "/replay",
        "title": "Replay — упражнявай анализа свещ по свещ",
        "level": LEVELS[-1]["level"],
        "slug": None,
        "module": None,
    }


# --------------------------------------------------------------------------------------------- skills
SKILLS: list[dict] = [
    {
        "key": "candles",
        "title": "Candlesticks",
        "title_bg": "Японски свещи",
        "modules": ["charts"],
        "href": "/learn/candlesticks",
    },
    {
        "key": "structure",
        "title": "Market structure",
        "title_bg": "Пазарна структура",
        "modules": ["technical", "price_action"],
        "href": "/learn/market-structure",
    },
    {
        "key": "indicators",
        "title": "Indicators",
        "title_bg": "Индикатори",
        "modules": ["indicators"],
        "href": "/charts",
    },
    {
        "key": "risk",
        "title": "Risk management",
        "title_bg": "Управление на риска",
        "modules": ["risk"],
        "href": "/risk",
    },
    {
        "key": "leverage",
        "title": "Leverage & margin",
        "title_bg": "Leverage и margin",
        "modules": ["leverage"],
        "href": "/learn/leverage",
    },
    {"key": "strategy", "title": "Strategy", "title_bg": "Стратегии", "modules": ["strategy"], "href": "/replay"},
    {
        "key": "backtesting",
        "title": "Backtesting",
        "title_bg": "Backtesting",
        "modules": ["backtesting"],
        "href": "/backtesting",
    },
    {
        "key": "psychology",
        "title": "Psychology",
        "title_bg": "Психология",
        "modules": ["psychology"],
        "href": "/journal",
    },
]
SKILLS_BY_KEY: dict[str, dict] = {s["key"]: s for s in SKILLS}

# Weights of the skill formula (documented in skill_score).
KNOWLEDGE_LESSONS_WEIGHT = 0.6
KNOWLEDGE_QUIZ_WEIGHT = 0.4
PRACTICE_WEIGHT = 0.4


def skill_score(
    skill: Mapping,
    completed_slugs: Iterable[str],
    best_quiz: Mapping[str, float],
    practice: list[dict] | None = None,
) -> dict:
    """Skill score 0–100.

    knowledge = 0.6 × lessons_pct + 0.4 × quiz_pct, where
      lessons_pct = completed lessons / all lessons of the skill's modules × 100,
      quiz_pct    = mean over the skill's modules of the BEST quiz score × 100 (0 for a module never attempted).
    practice    = mean of the behaviour/lab evidence that exists for this skill (each 0–100), e.g. risk discipline
                  for 'risk', Market Structure Lab attempts for 'structure', replay score for 'strategy'.
    score       = knowledge                                   when there is no practice evidence,
                  0.6 × knowledge + 0.4 × practice            otherwise.
    `best_quiz` maps module key → best score as a fraction 0–1; `practice` items are {key, label, score}.
    """
    done = set(completed_slugs)
    slugs = [lesson["slug"] for key in skill["modules"] for lesson in MODULES_BY_KEY[key]["lessons"]]
    completed = sum(1 for s in slugs if s in done)
    lessons_pct = completed / len(slugs) * 100 if slugs else 0.0
    quiz_pct = sum(float(best_quiz.get(k) or 0.0) for k in skill["modules"]) / len(skill["modules"]) * 100
    attempted = [k for k in skill["modules"] if k in best_quiz]
    knowledge = KNOWLEDGE_LESSONS_WEIGHT * lessons_pct + KNOWLEDGE_QUIZ_WEIGHT * quiz_pct
    evidence = [p for p in (practice or []) if p.get("score") is not None]
    practice_avg = sum(_clamp(p["score"]) for p in evidence) / len(evidence) if evidence else None
    score = knowledge if practice_avg is None else (1 - PRACTICE_WEIGHT) * knowledge + PRACTICE_WEIGHT * practice_avg
    parts = [f"Уроци {completed}/{len(slugs)}"]
    parts.append(f"quiz {round(quiz_pct)}%" if attempted else "quiz —")
    parts.extend(f"{p['label']} {round(_clamp(p['score']))}/100" for p in evidence)
    return {
        "key": skill["key"],
        "title": skill["title"],
        "title_bg": skill["title_bg"],
        "score": round(_clamp(score)),
        "basis": " · ".join(parts),
        "href": skill["href"],
        "inputs": {
            "lessons_completed": completed,
            "lessons_total": len(slugs),
            "lessons_pct": round(lessons_pct, 1),
            "quiz_pct": round(quiz_pct, 1) if attempted else None,
            "practice": [
                {"key": p["key"], "label": p["label"], "score": round(_clamp(p["score"]), 1)} for p in evidence
            ],
            "practice_avg": round(practice_avg, 1) if practice_avg is not None else None,
        },
    }


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, float(v)))
