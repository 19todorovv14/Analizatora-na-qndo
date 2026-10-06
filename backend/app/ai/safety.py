"""AI safety filter: removes promises of profit/certainty from every AI output.

Forbidden: "BUY NOW — guaranteed", "100% win", "Easy money", "Guaranteed profit",
"Risk-free" (and Bulgarian equivalents). Negated forms ("not guaranteed",
"не е гаранция") are allowed because they teach the opposite.
"""

from __future__ import annotations

import re

STANDARD_DISCLAIMER = "Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а."

_PATTERNS = [
    r"guarantee[ds]?",
    r"100\s?%\s*(?:win|profit|sure|certain|success|сигурн\w*|печалб\w*|успе\w*)",
    r"risk[\s-]?free",
    r"easy\s+money",
    r"(?:buy|sell)\s+now",
    r"can'?t\s+lose",
    r"sure\s+(?:thing|win|profit)",
    r"no[\s-]?lose",
    r"гарантира\w*",
    r"гаранти\w*",
    r"без\s+(?:никакъв\s+)?риск",
    r"лесни\s+пари",
    r"сигурна\s+печалба",
    r"сигурен\s+(?:успех|печалба)",
    r"(?:купи|продай|купувай|продавай)\s+(?:веднага|сега)",
    r"няма\s+как\s+да\s+загубиш",
]
_BANNED = re.compile("|".join(f"(?:{p})" for p in _PATTERNS), re.IGNORECASE)
_NEGATION = re.compile(
    r"(?:\bnot\b|\bno\b|\bnever\b|n't\b|\bwithout\b|\bне\b|\bняма\b|\bникога\b|\bнито\b|\bбез да\b)[^.!?\n]{0,30}$",
    re.IGNORECASE,
)
_SENTENCE = re.compile(r"[^.!?\n]+[.!?]?|\n")


def find_violations(text: str) -> list[str]:
    hits = []
    for m in _BANNED.finditer(text):
        before = text[max(0, m.start() - 40) : m.start()]
        if not _NEGATION.search(before):
            hits.append(m.group(0))
    return hits


SAFETY_NOTE = (
    "Safety filter: премахнато е изречение, което обещава сигурен резултат или дава команда за покупка/продажба. "
    "В trading-а няма гарантирани резултати."
)


def sanitize_lines(lines) -> tuple[list[str], list[str]]:
    """Sentence-level filter for structured output (lists of short lines).

    Same rules as `sanitize`, but no notice is appended to the text (the caller shows one
    `SAFETY_NOTE` for the whole answer) and lines that become empty are dropped.
    Returns (clean_lines, removed_phrases)."""
    removed: list[str] = []
    out: list[str] = []
    for line in lines or []:
        text = line if isinstance(line, str) else str(line)
        kept: list[str] = []
        for part in _SENTENCE.findall(text):
            hits = find_violations(part)
            if hits:
                removed.extend(hits)
                continue
            kept.append(part)
        clean = re.sub(r"\s{2,}", " ", "".join(kept)).strip()
        if clean:
            out.append(clean)
    return out, removed


def sanitize(text: str, *, add_disclaimer: bool = False) -> tuple[str, list[str]]:
    """Drop sentences that promise certainty. Returns (clean_text, removed_phrases)."""
    removed: list[str] = []
    out: list[str] = []
    for part in _SENTENCE.findall(text):
        hits = find_violations(part)
        if hits:
            removed.extend(hits)
            continue
        out.append(part)
    clean = "".join(out).strip()
    clean = re.sub(r"\n{3,}", "\n\n", clean)
    if removed:
        clean += "\n\n⚠️ Safety filter: премахнато е твърдение за гарантиран/безрисков резултат. В trading-а такова нещо няма."
    if add_disclaimer and STANDARD_DISCLAIMER not in clean:
        clean += f"\n\n{STANDARD_DISCLAIMER}"
    return clean, removed
