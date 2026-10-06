"""Instrument search over curated + synced instruments (in memory, no network, no database).

Query normalisation: lower case, trimmed, inner whitespace collapsed. Ticker comparisons use the
*ticker key* (additionally without "/", "-", "_" and spaces), so "eur/usd", "EUR-USD", "eurusd" and
"EUR USD" are the same query for symbols.

Scoring (the best matching rule wins)::

    exact ticker key of the symbol      100
    exact alias                          95   (alias text, or its ticker key)
    symbol prefix (ticker keys)          80
    alias prefix                         70
    name prefix                          65
    name word-prefix                     55   (the query starts at a word of the name)
    alias contains                       40
    name contains                        35

Tie-break: curated first, then popularity (ascending), then the shorter symbol, then the symbol.

Synced instruments score SYNCED_PENALTY (10) points less. Provider lists contain tickers that collide
with the aliases of popular curated instruments (e.g. the "BTC" and "ETH" ETFs, "SOL" and "DAX"
listings): without the penalty such an exact ticker hit (100) would push BTC/USDT (exact alias 95)
off the first place for "btc". With it, a synced exact symbol (90) still beats every curated prefix
or substring match.

Normalised keys are precomputed once per catalog generation (the curated index once per process, the
synced index whenever the synced registry changes), and a cheap substring pre-check skips
non-matching instruments, so a query over ~20k synced instruments takes a few milliseconds.
"""

from __future__ import annotations

import heapq
import re
import threading
from collections.abc import Iterable
from dataclasses import dataclass

from app.market import catalog
from app.market.base import AssetSpec

SCORE_EXACT_SYMBOL = 100
SCORE_EXACT_ALIAS = 95
SCORE_SYMBOL_PREFIX = 80
SCORE_ALIAS_PREFIX = 70
SCORE_NAME_PREFIX = 65
SCORE_NAME_WORD_PREFIX = 55
SCORE_ALIAS_CONTAINS = 40
SCORE_NAME_CONTAINS = 35
SYNCED_PENALTY = 10

MAX_QUERY_LEN = 64
SORTS = ("relevance", "popularity", "symbol", "name")

_TICKER_STRIP = str.maketrans("", "", "/-_ ")
_NON_WORD = re.compile(r"[^\w]+")
_SPACES = re.compile(r"\s+")


def normalize_query(text: str | None) -> str:
    """Lower case, trimmed, whitespace collapsed, at most MAX_QUERY_LEN characters."""
    return _SPACES.sub(" ", (text or "").strip().lower())[:MAX_QUERY_LEN].strip()


def ticker_key(text: str | None) -> str:
    """Ticker comparison key: normalised and without "/", "-", "_" and spaces ("BTC/USDT" → "btcusdt")."""
    return normalize_query(text).translate(_TICKER_STRIP)


def _spaced_words(text: str) -> str:
    """ " " + words separated by single spaces — `" " + query_words in it` is a word-prefix test."""
    return " " + " ".join(w for w in _NON_WORD.split(text) if w)


class _Entry:
    __slots__ = (
        "spec",
        "sym",
        "aliases",
        "alias_keys",
        "alias_set",
        "name",
        "name_words",
        "hay",
        "curated",
        "rank",
    )

    def __init__(self, spec: AssetSpec):
        self.spec = spec
        self.sym = ticker_key(spec.symbol)
        aliases = tuple(dict.fromkeys(a for a in (normalize_query(x) for x in spec.aliases) if a))
        self.aliases = aliases
        self.alias_keys = tuple(a.translate(_TICKER_STRIP) for a in aliases)
        self.alias_set = frozenset(aliases) | frozenset(k for k in self.alias_keys if k)
        self.name = normalize_query(spec.name)
        self.name_words = _spaced_words(self.name)
        # every searchable string in one haystack: one C-level substring test rejects most entries
        self.hay = "\x00".join((self.sym, *aliases, *self.alias_keys, self.name, self.name_words))
        self.curated = spec.curated
        self.rank = (0 if spec.curated else 1, spec.popularity, len(spec.symbol), spec.symbol)

    def score(self, q: str, qk: str, qwords: str) -> int:
        """Best rule score of this instrument for query `q` (ticker key `qk`, word form `qwords`); 0 = no match."""
        if q not in self.hay and (not qk or qk not in self.hay):
            return 0
        if qk and self.sym == qk:
            s = SCORE_EXACT_SYMBOL
        elif q in self.alias_set or (qk and qk in self.alias_set):
            s = SCORE_EXACT_ALIAS
        elif qk and self.sym.startswith(qk):
            s = SCORE_SYMBOL_PREFIX
        elif any(a.startswith(q) for a in self.aliases) or (qk and any(k.startswith(qk) for k in self.alias_keys)):
            s = SCORE_ALIAS_PREFIX
        elif self.name.startswith(q):
            s = SCORE_NAME_PREFIX
        elif qwords and qwords in self.name_words:
            s = SCORE_NAME_WORD_PREFIX
        elif any(q in a for a in self.aliases):
            s = SCORE_ALIAS_CONTAINS
        elif q in self.name:
            s = SCORE_NAME_CONTAINS
        else:
            return 0
        return s if self.curated else s - SYNCED_PENALTY


class _Index:
    def __init__(self, specs: Iterable[AssetSpec]):
        self.entries: list[_Entry] = [_Entry(s) for s in specs]
        self.by_class: dict[str, list[_Entry]] = {}
        for e in self.entries:
            self.by_class.setdefault(e.spec.asset_class, []).append(e)

    def scope(self, asset_class: str | None) -> list[_Entry]:
        if asset_class:
            return self.by_class.get(asset_class, [])
        return self.entries


_lock = threading.Lock()
_curated_index: _Index | None = None
_synced_index: tuple[int, _Index] | None = None


def _indexes() -> tuple[_Index, _Index]:
    global _curated_index, _synced_index
    generation, synced = catalog.synced_state()
    cur, syn = _curated_index, _synced_index
    if cur is not None and syn is not None and syn[0] == generation:
        return cur, syn[1]
    with _lock:
        if _curated_index is None:
            _curated_index = _Index(catalog.ASSETS)
        if _synced_index is None or _synced_index[0] != generation:
            _synced_index = (generation, _Index(synced))
        return _curated_index, _synced_index[1]


def warm() -> int:
    """Build the indexes now (e.g. in a background thread at startup). Returns the number of instruments."""
    cur, syn = _indexes()
    return len(cur.entries) + len(syn.entries)


@dataclass(frozen=True, slots=True)
class Match:
    spec: AssetSpec
    score: int  # 0 for an empty query

    @property
    def symbol(self) -> str:
        return self.spec.symbol


def _filters_ok(spec: AssetSpec, category: str | None, sector: str | None, source: str | None) -> bool:
    return (
        (not category or spec.category == category)
        and (not sector or spec.sector == sector)
        and (not source or spec.source == source)
    )


def _matches(
    q: str | None,
    *,
    asset_class: str | None = None,
    category: str | None = None,
    sector: str | None = None,
    source: str | None = None,
) -> list[tuple[int, _Entry]]:
    """Unsorted (score, entry) pairs of every instrument matching the query and filters."""
    cur, syn = _indexes()
    qn = normalize_query(q)
    qk = qn.translate(_TICKER_STRIP)
    out: list[tuple[int, _Entry]] = []
    if not qk:  # empty (or punctuation-only) query → everything in scope
        for index in (cur, syn):
            out.extend((0, e) for e in index.scope(asset_class) if _filters_ok(e.spec, category, sector, source))
        return out
    qwords = _spaced_words(qn)
    for index in (cur, syn):
        for e in index.scope(asset_class):
            s = e.score(qn, qk, qwords)
            if s and _filters_ok(e.spec, category, sector, source):
                out.append((s, e))
    return out


def _popular_interleaved(entries: list[_Entry], limit: int) -> list[_Entry]:
    """Most popular first, one instrument per asset class in turn (classes ordered by their top instrument)."""
    by_class: dict[str, list[_Entry]] = {}
    for e in sorted(entries, key=lambda e: e.rank):
        by_class.setdefault(e.spec.asset_class, []).append(e)
    queues = sorted(by_class.values(), key=lambda lst: lst[0].rank)
    out: list[_Entry] = []
    i = 0
    while len(out) < limit and queues:
        queues = [qq for qq in queues if len(qq) > i]
        for qq in queues:
            if len(out) >= limit:
                break
            out.append(qq[i])
        i += 1
    return out


def search_with_total(
    q: str | None,
    limit: int = 20,
    asset_class: str | None = None,
    category: str | None = None,
    *,
    sector: str | None = None,
    source: str | None = None,
) -> tuple[int, list[Match]]:
    """(total number of matches, best `limit` matches in ranking order).

    An empty query returns the most popular instruments (one per asset class in turn when no class
    filter is given).
    """
    limit = max(0, int(limit))
    pairs = _matches(q, asset_class=asset_class, category=category, sector=sector, source=source)
    if not ticker_key(q):
        entries = [e for _, e in pairs]
        if asset_class:
            top = heapq.nsmallest(limit, entries, key=lambda e: e.rank)
        else:
            top = _popular_interleaved(entries, limit)
        return len(pairs), [Match(e.spec, 0) for e in top]
    best = heapq.nsmallest(limit, pairs, key=lambda p: (-p[0], p[1].rank))
    return len(pairs), [Match(e.spec, s) for s, e in best]


def search(
    q: str | None,
    limit: int = 20,
    asset_class: str | None = None,
    category: str | None = None,
    *,
    sector: str | None = None,
    source: str | None = None,
) -> list[AssetSpec]:
    """Best `limit` instruments for `q` over curated + synced instruments (see module docstring)."""
    return [m.spec for m in search_with_total(q, limit, asset_class, category, sector=sector, source=source)[1]]


def browse(
    *,
    q: str | None = None,
    asset_class: str | None = None,
    category: str | None = None,
    sector: str | None = None,
    source: str | None = None,
    sort: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """Catalog page + facets for the Markets explorer.

    Facets are *disjunctive*: the counts of one facet apply every other filter but not its own (so the
    UI can show how many instruments switching that filter would give). Empty categories/sectors are
    not counted. `sort` = relevance (default with a query) | popularity (default without) | symbol | name.

    Returns {total, page, page_size, items: [AssetSpec], facets: {asset_class, category, sector}}.
    """
    if sort is not None and sort not in SORTS:
        raise ValueError(f"sort must be one of {', '.join(SORTS)}")
    has_query = bool(ticker_key(q))
    sort = sort or ("relevance" if has_query else "popularity")
    base = _matches(q, source=source)  # class/category/sector are applied below (facets need them separately)
    facets: dict[str, dict[str, int]] = {"asset_class": {}, "category": {}, "sector": {}}
    selected: list[tuple[int, _Entry]] = []
    for s, e in base:
        spec = e.spec
        class_ok = not asset_class or spec.asset_class == asset_class
        cat_ok = not category or spec.category == category
        sec_ok = not sector or spec.sector == sector
        if cat_ok and sec_ok:
            facets["asset_class"][spec.asset_class] = facets["asset_class"].get(spec.asset_class, 0) + 1
        if class_ok and sec_ok and spec.category:
            facets["category"][spec.category] = facets["category"].get(spec.category, 0) + 1
        if class_ok and cat_ok and spec.sector:
            facets["sector"][spec.sector] = facets["sector"].get(spec.sector, 0) + 1
        if class_ok and cat_ok and sec_ok:
            selected.append((s, e))
    if sort == "relevance":
        selected.sort(key=lambda p: (-p[0], p[1].rank))
    elif sort == "popularity":
        selected.sort(key=lambda p: p[1].rank)
    elif sort == "symbol":
        selected.sort(key=lambda p: (p[1].spec.symbol.upper(), p[1].rank))
    else:  # name
        selected.sort(key=lambda p: (p[1].name, p[1].rank))
    page = max(1, int(page))
    page_size = max(1, int(page_size))
    start = (page - 1) * page_size
    return {
        "total": len(selected),
        "page": page,
        "page_size": page_size,
        "sort": sort,
        "items": [e.spec for _, e in selected[start : start + page_size]],
        "facets": {k: dict(sorted(v.items(), key=lambda kv: (-kv[1], kv[0]))) for k, v in facets.items()},
    }
