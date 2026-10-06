"""All academy modules in learning order. The next module unlocks after passing the
previous module's quiz (≥ 70%)."""

from app.academy.content import charts, indicators, level0, price_action, psychology, risk, strategy, technical

PASS_SCORE = 0.7

MODULES: list[dict] = [
    level0.MODULE,
    charts.MODULE,
    technical.MODULE,
    indicators.MODULE,
    price_action.MODULE,
    risk.MODULE,
    psychology.MODULE,
    strategy.MODULE,
]

MODULES_BY_KEY = {m["key"]: m for m in MODULES}
LESSONS_BY_SLUG = {lesson["slug"]: {**lesson, "module": m["key"]} for m in MODULES for lesson in m["lessons"]}


def module_of(slug: str) -> str | None:
    lesson = LESSONS_BY_SLUG.get(slug)
    return lesson["module"] if lesson else None
