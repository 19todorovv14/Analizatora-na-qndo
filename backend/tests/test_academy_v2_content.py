"""S3a — academy content for the LEVEL 0–10 learning path: levels, new modules, candle lessons, safety of the text."""

from __future__ import annotations

import re

import pytest

from app.academy import levels as lv
from app.academy.content import LESSONS_BY_SLUG, MODULES, MODULES_BY_KEY
from app.academy.scenarios import SCENARIOS
from app.ai.glossary import lookup
from app.ai.safety import find_violations

EXPECTED_ORDER = [
    "level0",
    "charts",
    "technical",
    "indicators",
    "price_action",
    "risk",
    "leverage",
    "strategy",
    "backtesting",
    "psychology",
    "advanced",
]
LEGACY_SLUGS_SAMPLE = ["candlestick", "leverage", "margin", "liquidation", "market-structure", "what-is-backtesting"]
VISUALS = {
    "orderbook",
    "asset_table",
    "order_types",
    "leverage",
    "fees",
    "candle",
    "live_chart",
    "timeframes",
    "scenario",
    "indicator",
    "risk_calc",
    "drawdown",
    "expectancy",
    "reflection",
    "strategy_flow",
}

# "use 20x", "use 10x leverage", "recommended leverage", Bulgarian equivalents ("използвай 10x", "препоръчителен
# leverage") — the academy never recommends a leverage value.
LEVERAGE_ADVICE = re.compile(
    r"\b(?:use|using|try|pick|choose)\s+(?:a\s+)?\d+\s*(?:x|:1)\b"
    r"|recommended\s+leverage|best\s+leverage|optimal\s+leverage|ideal\s+leverage|safe\s+leverage"
    r"|(?:използвай|ползвай|избери|пробвай|сложи)\s+(?:leverage\s+)?\d+\s*(?:x|:1)"
    r"|препоръч\w*\s+leverage|оптимал\w*\s+leverage|идеал\w*\s+leverage|безопас\w*\s+leverage"
    r"|leverage\s+(?:от\s+)?\d+\s*(?:x|:1)\s+е\s+(?:препоръч\w*|оптимал\w*|безопас\w*|идеал\w*)",
    re.IGNORECASE,
)


def _texts(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _texts(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _texts(v)


# ------------------------------------------------------------------------------------------- levels
def test_levels_cover_every_module_exactly_once_in_order():
    assert [lvl["level"] for lvl in lv.LEVELS] == list(range(11))
    flat = [m for lvl in lv.LEVELS for m in lvl["modules"]]
    assert flat == [m["key"] for m in MODULES] == EXPECTED_ORDER
    assert len(set(flat)) == len(flat)
    assert set(lv.LEVEL_OF_MODULE) == set(MODULES_BY_KEY)


def test_level_definitions_are_complete():
    titles = [lvl["title"] for lvl in lv.LEVELS]
    assert titles == [
        "Market Basics",
        "Charts & Candlesticks",
        "Technical Analysis",
        "Indicators",
        "Price Action",
        "Risk Management",
        "Leverage & Margin",
        "Strategies",
        "Backtesting",
        "Trading Psychology",
        "Advanced Market Analysis",
    ]
    keys = [lvl["key"] for lvl in lv.LEVELS]
    assert len(set(keys)) == len(keys)
    for lvl in lv.LEVELS:
        assert lvl["title_bg"] and lvl["goal"].endswith(".") and lvl["goal"].count(".") == 1, lvl["key"]
        assert set(lvl["unlock"]) == {"rule", "after_module", "text"}
        for lab in lvl["labs"]:
            assert lab["href"].startswith("/") and lab["title"] and lab["description"]
    assert lv.LEVELS[0]["unlock"]["rule"] == lv.UNLOCK_ALWAYS
    for prev, lvl in zip(lv.LEVELS, lv.LEVELS[1:], strict=False):
        assert lvl["unlock"] == {**lvl["unlock"], "rule": lv.UNLOCK_PREVIOUS, "after_module": prev["modules"][-1]}


def test_level_labs_match_the_spec():
    labs = {lvl["level"]: [lab["href"] for lab in lvl["labs"]] for lvl in lv.LEVELS}
    assert "/learn/candlesticks" in labs[1]
    assert "/learn/market-structure" in labs[2]
    assert {"/learn/leverage", "/simulator"} <= set(labs[6])
    assert "/strategies" in labs[7]
    assert "/backtesting" in labs[8]
    assert "/journal" in labs[9]
    assert {"/replay", "/markets"} <= set(labs[10])


# ------------------------------------------------------------------------------------------ modules
@pytest.mark.parametrize(("key", "min_lessons"), [("leverage", 8), ("backtesting", 7), ("advanced", 7)])
def test_new_modules_have_enough_lessons_and_a_quiz(key, min_lessons):
    m = MODULES_BY_KEY[key]
    assert len(m["lessons"]) >= min_lessons
    assert 8 <= len(m["quiz"]) <= 10
    assert m["title"] and m["category"] and m["description"]
    for lesson in m["lessons"]:
        assert len(lesson["body"]) >= 4, lesson["slug"]
        assert len(lesson["key_points"]) >= 3, lesson["slug"]
        assert lesson["visual"] and lesson["visual"]["type"] in VISUALS, lesson["slug"]
        assert lesson["keywords"], lesson["slug"]
    for question in m["quiz"]:
        assert 0 <= question["answer"] < len(question["options"]) and question["explanation"]


def test_all_lessons_are_well_formed_and_unique():
    slugs = [lesson["slug"] for m in MODULES for lesson in m["lessons"]]
    assert len(slugs) == len(set(slugs)) == len(LESSONS_BY_SLUG)
    assert len(slugs) >= 87 + 8 + 7 + 7 + 3
    quiz_ids = [q["id"] for m in MODULES for q in m["quiz"]]
    assert len(quiz_ids) == len(set(quiz_ids))
    for m in MODULES:
        for lesson in m["lessons"]:
            assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", lesson["slug"]), lesson["slug"]
            assert lesson["title"] and lesson["summary"] and lesson["key_points"]
            visual = lesson["visual"]
            if visual:
                assert visual["type"] in VISUALS, lesson["slug"]
                if visual["type"] == "scenario":
                    assert visual["scenario"] in SCENARIOS
    for slug in LEGACY_SLUGS_SAMPLE:  # existing slugs keep working
        assert slug in LESSONS_BY_SLUG


def test_candle_lessons_cover_body_wicks_and_the_drill_down():
    charts = [lesson["slug"] for lesson in MODULES_BY_KEY["charts"]["lessons"]]
    for slug in ("candlestick", "body", "wick", "upper-wick", "lower-wick", "inside-the-candle"):
        assert slug in charts
        assert LESSONS_BY_SLUG[slug]["visual"]["type"] == "candle"
    assert LESSONS_BY_SLUG["upper-wick"]["visual"]["highlight"] == "upper_wick"
    assert LESSONS_BY_SLUG["lower-wick"]["visual"]["highlight"] == "lower_wick"
    inside = LESSONS_BY_SLUG["inside-the-candle"]["visual"]
    assert inside["drilldown"] is True and inside["live"] == {"symbol": "BTC/USDT", "timeframe": "1h"}
    assert inside["candles"]  # synthetic fallback when market data is unavailable
    builder = LESSONS_BY_SLUG["candlestick"]["visual"]
    assert builder["builder"] is True and builder["drilldown"] is True  # walkthrough: "Candle builder" stays
    # every candle visual is a valid OHLC candle
    for lesson in MODULES_BY_KEY["charts"]["lessons"]:
        if lesson["visual"]["type"] == "candle":
            for o, h, low, c in lesson["visual"]["candles"]:
                assert low <= min(o, c) <= max(o, c) <= h, lesson["slug"]
    text = " ".join(_texts(LESSONS_BY_SLUG["upper-wick"]))
    assert "High − max(Open, Close)" in text
    assert "min(Open, Close) − Low" in " ".join(_texts(LESSONS_BY_SLUG["lower-wick"]))


def test_labs_are_linked_from_lesson_text():
    lev = " ".join(_texts(MODULES_BY_KEY["leverage"]))
    assert "/learn/leverage" in lev and "/simulator" in lev


# --------------------------------------------------------------------------------------- safety
def test_no_forbidden_phrases_in_any_lesson_or_quiz():
    hits = []
    for m in MODULES:
        for text in _texts(m):
            v = find_violations(text)
            if v:
                hits.append((m["key"], v, text[:90]))
    assert hits == []


def test_no_leverage_recommendation_anywhere():
    for bad in (
        "Use 20x for this setup.",
        "use 10x leverage",
        "Recommended leverage: 5x",
        "Използвай 10x при пробив.",
        "препоръчителен leverage е 3x",
    ):
        assert LEVERAGE_ADVICE.search(bad), bad
    hits = [(m["key"], t[:90]) for m in MODULES for t in _texts(m) if LEVERAGE_ADVICE.search(t)]
    assert hits == []


def test_leverage_module_uses_the_standard_warning_and_virtual_examples():
    m = MODULES_BY_KEY["leverage"]
    text = " ".join(_texts(m))
    assert text.count("Higher leverage magnifies exposure and liquidation risk.") >= 3
    assert "$10,000" in text and "виртуал" in text
    slugs = {lesson["slug"] for lesson in m["lessons"]}
    assert {
        "initial-margin",
        "maintenance-margin",
        "liquidation-stop-out",
        "leverage-liquidation-distance",
        "leverage-does-not-improve-strategy",
        "funding-overnight-costs",
        "leverage-stop-sizing",
        "retail-leverage-caps",
    } <= slugs
    caps = " ".join(_texts(LESSONS_BY_SLUG["retail-leverage-caps"]))
    for cap in ("30:1", "20:1", "10:1", "5:1", "2:1"):
        assert cap in caps


def test_backtesting_and_advanced_modules_cover_their_topics():
    bt = " ".join(_texts(MODULES_BY_KEY["backtesting"])).lower()
    for topic in (
        "lookahead",
        "slippage",
        "spread",
        "sample size",
        "in-sample",
        "out-of-sample",
        "walk-forward",
        "overfitting",
        "режим",
        "drawdown",
        "past performance does not guarantee future results",
    ):
        assert topic in bt, topic
    adv = " ".join(_texts(MODULES_BY_KEY["advanced"]))
    for topic in ("timeframe", "режим", "ATR", "Корелация", "сесии", "gap", "календар", "earnings"):
        assert topic.lower() in adv.lower(), topic
    checklist = " ".join(_texts(LESSONS_BY_SLUG["analysis-checklist"]))
    positions = [
        checklist.index(w) for w in ("OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO")
    ]
    assert positions == sorted(positions)


# ---------------------------------------------------------------------------------- lesson routes
def test_lesson_routes_never_collide_with_lab_pages():
    routes = [lv.lesson_route(slug) for slug in LESSONS_BY_SLUG]
    assert len(routes) == len(set(routes))
    assert not set(routes) & lv.RESERVED_LEARN_ROUTES
    assert not set(lv.LESSON_ROUTE_ALIASES.values()) & set(LESSONS_BY_SLUG)
    assert lv.lesson_href("leverage") == "/learn/leverage-basics"
    assert lv.lesson_href("market-structure") == "/learn/market-structure-basics"
    assert lv.lesson_href("candlestick") == "/learn/candlestick"
    assert lv.resolve_lesson_slug("leverage-basics") == "leverage"
    assert lv.resolve_lesson_slug("leverage") == "leverage"
    assert lv.resolve_lesson_slug("nope") is None


# -------------------------------------------------------------------------------------- glossary
def test_glossary_lookup_keeps_core_terms_and_learns_new_ones():
    for question, slug in (
        ("Какво е RSI?", "rsi"),
        ("what is ATR", "atr"),
        ("какво означава breakout", "breakout"),
        ("what is leverage", "leverage"),
        ("какво е margin", "margin"),
        ("what is liquidation", "liquidation"),
        ("what is a wick", "wick"),
        ("what is a candlestick", "candlestick"),
        ("what is maintenance margin", "maintenance-margin"),
        ("what is lookahead bias", "lookahead-bias"),
        ("what is walk-forward", "walk-forward"),
        ("какво е funding rate", "funding-overnight-costs"),
        ("what is an upper wick", "upper-wick"),
    ):
        assert lookup(question)["slug"] == slug, question
