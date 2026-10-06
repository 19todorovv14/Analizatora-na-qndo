"""All academy modules in learning-path order (LEVEL 0–10, see app.academy.levels).

Unlock rule (app.academy.levels.unlocked_modules): a module is unlocked when it is level 0, when the previous
module's quiz is passed (≥ PASS_SCORE), when the user has completed any lesson in it, or when it was unlocked
under the legacy 8-module order (users keep what they already had).
"""

from app.academy.content import (
    advanced,
    backtesting,
    charts,
    indicators,
    level0,
    leverage,
    price_action,
    psychology,
    risk,
    strategy,
    technical,
)

PASS_SCORE = 0.7

MODULES: list[dict] = [
    level0.MODULE,  # LEVEL 0  Market Basics
    charts.MODULE,  # LEVEL 1  Charts & Candlesticks
    technical.MODULE,  # LEVEL 2  Technical Analysis
    indicators.MODULE,  # LEVEL 3  Indicators
    price_action.MODULE,  # LEVEL 4  Price Action
    risk.MODULE,  # LEVEL 5  Risk Management
    leverage.MODULE,  # LEVEL 6  Leverage & Margin (new in V2)
    strategy.MODULE,  # LEVEL 7  Strategies
    backtesting.MODULE,  # LEVEL 8  Backtesting (new in V2)
    psychology.MODULE,  # LEVEL 9  Trading Psychology
    advanced.MODULE,  # LEVEL 10 Advanced Market Analysis (new in V2)
]

MODULES_BY_KEY = {m["key"]: m for m in MODULES}
LESSONS_BY_SLUG = {lesson["slug"]: {**lesson, "module": m["key"]} for m in MODULES for lesson in m["lessons"]}


def module_of(slug: str) -> str | None:
    lesson = LESSONS_BY_SLUG.get(slug)
    return lesson["module"] if lesson else None
