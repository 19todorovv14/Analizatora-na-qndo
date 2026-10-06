"""Glossary built from the academy lessons (single source of truth for definitions)."""

from __future__ import annotations

import re
from functools import lru_cache

from app.academy.content import LESSONS_BY_SLUG


@lru_cache
def _index() -> list[tuple[str, list[str], str, dict]]:
    out = []
    for slug, lesson in LESSONS_BY_SLUG.items():
        keys = [k.lower() for k in lesson.get("keywords", [])]
        title_key = lesson["title"].lower().split("—")[0].split("(")[0].strip()
        out.append((slug, sorted(set(keys), key=len, reverse=True), title_key, lesson))
    return out


def lookup(question: str) -> dict | None:
    text = " " + re.sub(r"[^\w%:/\-' ]+", " ", question.lower()) + " "
    best, best_score = None, 0.0
    for _slug, keys, title_key, lesson in _index():
        score = 0.0
        for k in keys:
            if not k:
                continue
            if re.search(rf"(?<![\w]){re.escape(k)}(?![\w])", text):
                score += 1 + len(k) / 10
        if title_key and re.search(rf"(?<![\w]){re.escape(title_key)}(?![\w])", text):
            score += 2  # the lesson that is *about* this term wins ties
        if score > best_score:
            best, best_score = lesson, score
    return best if best_score > 0 else None


def definition(lesson: dict) -> str:
    lines = [f"**{lesson['title']}** — {lesson['summary']}"]
    if lesson.get("sections"):
        for s in lesson["sections"][:4]:
            lines.append(f"- {s['heading']}: {s['body'][0]}")
    else:
        lines += [f"- {p}" for p in lesson["key_points"]]
    if lesson.get("common_mistakes"):
        lines.append(f"Честа грешка: {lesson['common_mistakes'][0]}")
    lines.append(f"📘 Урок: /learn/{lesson['slug']}")
    return "\n".join(lines)
