"""Wave-3 integration guards between the backend and the frontend sources."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.academy.levels import LESSON_ROUTE_ALIASES, lesson_href, resolve_lesson_slug

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
LESSONS_TS = FRONTEND / "lib" / "lessons.ts"


@pytest.mark.skipif(not LESSONS_TS.exists(), reason="frontend sources not present")
def test_frontend_lesson_aliases_mirror_backend():
    src = LESSONS_TS.read_text(encoding="utf-8")
    block = re.search(r"LESSON_ROUTE_ALIASES[^=]*=\s*\{(.*?)\}", src, re.S)
    assert block, "LESSON_ROUTE_ALIASES not found in frontend/lib/lessons.ts"
    pairs = dict(re.findall(r'"?([a-z0-9-]+)"?\s*:\s*"([a-z0-9-]+)"', block.group(1)))
    assert pairs == LESSON_ROUTE_ALIASES


def test_alias_routes_resolve_and_do_not_hit_lab_pages():
    labs = {"/learn/leverage", "/learn/market-structure", "/learn/candlesticks"}
    for slug, route in LESSON_ROUTE_ALIASES.items():
        assert resolve_lesson_slug(slug) == slug
        assert resolve_lesson_slug(route) == slug
        assert lesson_href(slug) == f"/learn/{route}"
        assert lesson_href(slug) not in labs


def test_lesson_detail_served_at_alias(client):
    client.post("/api/auth/guest")
    for slug, route in LESSON_ROUTE_ALIASES.items():
        r = client.get(f"/api/academy/lessons/{route}")
        assert r.status_code == 200, r.text
        assert r.json()["slug"] == slug


def test_backend_lesson_links_use_alias_routes():
    """AI teacher, glossary definitions and asset-page lessons link lessons through lesson_href (aliases)."""
    from app.academy.content import LESSONS_BY_SLUG
    from app.ai import glossary, modes
    from app.market.catalog import get_asset
    from app.services import markets_service

    assert "/learn/leverage-basics" in glossary.definition(LESSONS_BY_SLUG["leverage"])
    assert "/learn/leverage → " not in glossary.definition(LESSONS_BY_SLUG["leverage"])
    order = [lesson["slug"] for m in modes.MODULES for lesson in m["lessons"]]
    for slug, route in LESSON_ROUTE_ALIASES.items():
        prev = order[order.index(slug) - 1]
        nxt = modes._next_lesson(prev, set())
        assert nxt is not None and nxt["slug"] == slug and nxt["href"] == f"/learn/{route}"
    for symbol in ("BTC/USDT", "EUR/USD", "AAPL", "SPX", "XAU/USD"):
        for lesson in markets_service.lessons_for(get_asset(symbol)):
            assert lesson["href"] == lesson_href(lesson["slug"])


def test_no_raw_lesson_urls_in_backend():
    """Only app/academy/levels.py may build /learn/<slug> URLs (everything else calls lesson_href)."""
    app_dir = Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for py in app_dir.rglob("*.py"):
        if py.name == "levels.py" and py.parent.name == "academy":
            continue
        for n, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"/learn/\{", line):
                offenders.append(f"{py.relative_to(app_dir)}:{n}")
    assert offenders == []
