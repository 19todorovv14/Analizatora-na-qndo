"""Every Explain-mode glossary term in the frontend links to a lesson that exists in the academy."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.academy.levels import resolve_lesson_slug

GLOSSARY = Path(__file__).resolve().parents[2] / "frontend" / "lib" / "glossary.ts"


@pytest.mark.skipif(not GLOSSARY.exists(), reason="frontend sources not present")
def test_glossary_lesson_slugs_exist():
    slugs = re.findall(r'^\s+lesson:\s*"([^"]+)"', GLOSSARY.read_text(encoding="utf-8"), re.M)
    assert len(slugs) > 50
    missing = sorted({s for s in slugs if resolve_lesson_slug(s) is None})
    assert missing == []
