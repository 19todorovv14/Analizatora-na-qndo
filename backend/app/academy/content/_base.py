"""Helpers for authoring lessons.

Lesson body format (rendered by the frontend):
* each string in `body` is a paragraph; `**bold**` is supported;
* lines starting with "- " are bullet points.
`sections` (optional) is a list of {"heading", "body"} blocks — used e.g. by indicator lessons.
`visual` selects an interactive component on the frontend (see frontend/components/academy/visuals).
"""

from __future__ import annotations


def lesson(
    slug: str,
    title: str,
    summary: str,
    body: list[str],
    key_points: list[str],
    *,
    mistakes: list[str] | None = None,
    visual: dict | None = None,
    sections: list[dict] | None = None,
    keywords: list[str] | None = None,
    xp: int = 10,
) -> dict:
    return {
        "slug": slug,
        "title": title,
        "summary": summary,
        "body": body,
        "sections": sections or [],
        "key_points": key_points,
        "common_mistakes": mistakes or [],
        "visual": visual,
        "keywords": keywords or [],
        "xp": xp,
    }


def q(qid: str, question: str, options: list[str], answer: int, explanation: str) -> dict:
    return {"id": qid, "question": question, "options": options, "answer": answer, "explanation": explanation}


def sec(heading: str, *paragraphs: str) -> dict:
    return {"heading": heading, "body": list(paragraphs)}
