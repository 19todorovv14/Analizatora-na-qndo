"""S3b — Candlestick Lab: pattern cards, rule-based detection (app.analysis.candles), "find it on a real chart"
statistics and HMAC-signed practice rounds (app.academy.patterns)."""

from __future__ import annotations

import base64
import json
import random
import re

import pytest

from app.academy import patterns as P
from app.academy.levels import resolve_lesson_slug
from app.ai.safety import find_violations
from app.analysis import candles as C
from app.market.base import Candle

SPEC_KEYS = {
    "doji", "dragonfly_doji", "gravestone_doji", "hammer", "inverted_hammer", "shooting_star", "hanging_man",
    "bullish_engulfing", "bearish_engulfing", "morning_star", "evening_star", "inside_bar", "outside_bar",
    "bullish_marubozu", "bearish_marubozu", "spinning_top", "piercing_line", "dark_cloud_cover", "bullish_harami",
    "bearish_harami", "three_white_soldiers", "three_black_crows", "tweezer_top", "tweezer_bottom",
}  # fmt: skip
CARD_FIELDS = (
    "key", "name", "type", "bias", "candles", "looks_like", "means", "does_not_mean", "common_mistake",
    "context_rule", "confirmation", "practice_hint", "rule", "short", "disclaimer",
)  # fmt: skip
CYRILLIC = re.compile(r"[а-яА-Я]")


def bars(rows, start=1_700_000_000, step=3600):
    """(open, high, low, close) tuples → Candles."""
    return [Candle(start + i * step, o, h, lo, c, 1.0) for i, (o, h, lo, c) in enumerate(rows)]


DOWN = [(110, 110.4, 107.6, 108), (108, 108.4, 105.6, 106), (106, 106.4, 103.6, 104), (104, 104.4, 101.6, 102),
        (102, 102.4, 99.6, 100)]  # fmt: skip
UP = [(90, 92.4, 89.6, 92), (92, 94.4, 91.6, 94), (94, 96.4, 93.6, 96), (96, 98.4, 95.6, 98), (98, 100.4, 97.6, 100)]
HAMMER = (99.6, 100.35, 97.0, 100.2)


def keys_at_end(rows) -> set[str]:
    cs = bars(rows)
    return {h.key for h in C.patterns_at(cs, len(cs) - 1)}


# ---------------------------------------------------------------------------------------------- cards
def test_gallery_has_every_spec_pattern_with_complete_cards():
    g = P.gallery()
    assert g["count"] == len(g["patterns"]) >= 16
    assert {p["key"] for p in g["patterns"]} == SPEC_KEYS
    assert "не е сигнал" in g["disclaimer"]
    for p in g["patterns"]:
        for f in CARD_FIELDS:
            assert p[f] not in (None, "", []), (p["key"], f)
        assert p["type"] == {1: "single", 2: "double", 3: "triple"}[p["bars"]]
        assert p["bias"] in ("bullish", "bearish", "neutral", "context-dependent")
        assert 3 <= p["pattern_start"] <= 5, p["key"]  # 3–5 context candles before the pattern
        assert len(p["candles"]) == p["pattern_start"] + p["bars"]
        assert p["highlight"] == list(range(p["pattern_start"], len(p["candles"])))
        for c in p["candles"]:
            assert c["low"] <= min(c["open"], c["close"]) <= max(c["open"], c["close"]) <= c["high"]
        for f in P.TEXT_FIELDS:
            assert CYRILLIC.search(p[f]), (p["key"], f)
        text = " ".join(str(p[f]) for f in (*P.TEXT_FIELDS, "short", "rule", "disclaimer", "context_text"))
        assert find_violations(text) == [], p["key"]
        if p["lesson"]:
            assert resolve_lesson_slug(p["lesson"]) == p["lesson"]
            assert p["lesson_href"].startswith("/learn/")


def test_every_illustration_is_recognised_on_its_last_candle():
    for p in P.PATTERNS:
        assert p["key"] in P.detected_at_end(p["candles"]), p["key"]


def test_bias_matches_the_detector_definitions():
    assert P.PATTERNS_BY_KEY["hammer"]["bias"] == "bullish" and P.PATTERNS_BY_KEY["hammer"]["requires_trend"] == "down"
    assert P.PATTERNS_BY_KEY["hanging_man"]["requires_trend"] == "up"
    assert P.PATTERNS_BY_KEY["dragonfly_doji"]["bias"] == "context-dependent"
    assert P.PATTERNS_BY_KEY["three_white_soldiers"]["requires_trend"] == "down_or_flat"
    assert P.PATTERNS_BY_KEY["inside_bar"]["requires_trend"] == "any"


# ------------------------------------------------------------------------------------------ detection
def test_prior_trend_from_ema_slope():
    assert C.prior_trend(bars(DOWN), 5) == "down"
    assert C.prior_trend(bars(UP), 5) == "up"
    flat = [(100, 101, 99, 100.5), (100.5, 101, 99, 99.6), (99.6, 101, 99, 100.4), (100.4, 101, 99, 99.8)]
    assert C.prior_trend(bars(flat), 4) == "flat"
    assert C.prior_trend(bars(DOWN), 2) == "unknown"  # fewer than TREND_MIN_BARS before the pattern


def test_hammer_and_hanging_man_are_the_same_shape_in_opposite_context():
    assert {"hammer"} <= keys_at_end([*DOWN, HAMMER]) and "hanging_man" not in keys_at_end([*DOWN, HAMMER])
    shifted = tuple(x + 2 for x in HAMMER)  # the uptrend context ends at 100 too
    after_up = keys_at_end([*UP, shifted])
    assert "hanging_man" in after_up and "hammer" not in after_up
    assert keys_at_end([HAMMER]) == set()  # no context → trend-dependent patterns are not reported


def test_single_candle_numeric_rules():
    assert "doji" in keys_at_end([*DOWN[:3], (100, 101, 99, 100.1)])  # body 5 % of the range
    assert "doji" not in keys_at_end([*DOWN[:3], (100, 101, 99, 100.3)])  # body 15 %
    assert "dragonfly_doji" in keys_at_end([*DOWN, (99.9, 100.0, 97.9, 99.95)])
    assert "gravestone_doji" in keys_at_end([*UP, (100.1, 102.1, 100.0, 100.05)])
    assert "spinning_top" in keys_at_end([*UP, (100.2, 101.4, 99.4, 100.6)])
    # marubozu needs B ≥ 90 % of R AND ≥ 1.3 × the average body of the bars before it
    assert "bullish_marubozu" in keys_at_end([*DOWN, (100, 104.05, 99.95, 104)])
    assert "bullish_marubozu" not in keys_at_end([*DOWN, (100, 102.05, 99.95, 102)])  # body = the average
    assert keys_at_end([*DOWN[:3], (100, 100, 100, 100)]) == {"doji"}  # zero range


def test_two_and_three_candle_rules():
    assert "bullish_engulfing" in keys_at_end([*DOWN, (100, 100.7, 98.3, 98.6), (98.5, 100.6, 97.9, 100.4)])
    # body of the 2nd candle does not cover the 1st body → no engulfing
    assert "bullish_engulfing" not in keys_at_end([*DOWN, (100, 100.7, 98.3, 98.6), (98.7, 100.6, 97.9, 99.8)])
    ib = keys_at_end([*UP, (100, 102.5, 99.5, 102), (101.2, 102.3, 100.6, 102.2)])
    assert "inside_bar" in ib and "outside_bar" not in ib
    assert "outside_bar" in keys_at_end([*DOWN, (99.8, 100.4, 98.9, 99.3), (99.9, 100.9, 98.4, 98.7)])
    star = [*DOWN, (100, 100.2, 97.1, 97.4), (97.0, 97.4, 96.4, 96.9), (97.3, 99.4, 97.1, 99.2)]
    assert "morning_star" in keys_at_end(star)
    weak = [*star[:-1], (97.3, 98.4, 97.1, 98.2)]  # third candle closes below the middle of the first body
    assert "morning_star" not in keys_at_end(weak)
    soldiers = [*DOWN, (100, 101.3, 99.8, 101.1), (100.8, 102.5, 100.6, 102.3), (102, 103.7, 101.8, 103.5)]
    assert "three_white_soldiers" in keys_at_end(soldiers)


def test_piercing_line_on_a_24_7_market_without_a_gap():
    # 2nd candle opens exactly at the previous close (no gap, as crypto candles do) and closes above the middle
    rows = [*DOWN, (100, 100.2, 97.3, 97.5), (97.5, 99.3, 97.2, 99.1)]
    assert "piercing_line" in keys_at_end(rows)
    below_mid = [*DOWN, (100, 100.2, 97.3, 97.5), (97.5, 98.9, 97.2, 98.6)]  # middle of the body is 98.75
    assert "piercing_line" not in keys_at_end(below_mid)
    dark = [*UP, (100, 102.7, 99.8, 102.5), (102.5, 102.8, 100.7, 100.9)]
    assert "dark_cloud_cover" in keys_at_end(dark)


def _random_walk(n=400, seed=11):
    rng = random.Random(seed)
    out, price = [], 100.0
    for _ in range(n):
        o = price
        c = max(1.0, o * (1 + rng.gauss(0, 0.01)))
        h = max(o, c) * (1 + abs(rng.gauss(0, 0.004)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, 0.004)))
        out.append((o, h, lo, c))
        price = c
    return bars(out)


def test_detection_has_no_lookahead():
    cs = _random_walk()
    full = C.detect_patterns(cs)
    assert full, "the random walk should contain some patterns"
    for i in range(0, len(cs), 7):
        prefix_hits = {(h.key, h.index) for h in C.detect_patterns(cs[: i + 1])}
        assert prefix_hits == {(h.key, h.index) for h in full if h.index <= i}
    for h in full:
        assert h.start <= h.index and h.time == cs[h.index].ts


def test_pattern_flags_and_key_filter():
    cs = _random_walk(200)
    flags = C.pattern_flags(cs, ["doji", "morning_star"])
    assert flags["morning_star"][:2] == [None, None] and flags["morning_star"][2] in (0.0, 1.0)
    assert flags["doji"][0] in (0.0, 1.0)
    hits = {h.index for h in C.detect_patterns(cs, ["doji"])}
    assert {i for i, v in enumerate(flags["doji"]) if v == 1.0} == hits
    with pytest.raises(KeyError):
        C.detect_patterns(cs, ["nope"])


# --------------------------------------------------------------------------------------------- examples
def test_find_examples_reports_the_next_5_and_10_bars_in_atr():
    rows = [(112 + 0.1 * (i % 3), 112.6 + 0.1 * (i % 3), 111.4, 112 + 0.1 * ((i + 1) % 3)) for i in range(20)]
    rows += [*DOWN, HAMMER]  # hammer at index 25
    rows += [(100.2 + i, 101.4 + i, 99.9 + i, 101.2 + i) for i in range(12)]  # steady rise afterwards
    rows += [*DOWN[:3], HAMMER]  # a second hammer near the end (index 41) without 5 later bars
    cs = bars(rows)
    out = P.find_examples(cs, "hammer")
    ex = {e["index"]: e for e in out["examples"]}
    assert set(ex) >= {25, 41}
    first = ex[25]
    assert first["bars"] == 1 and first["prior_trend"] == "down"
    five, ten = first["next"]
    assert five["bars"] == 5 and five["close"] == pytest.approx(cs[30].close)
    assert five["move"] == pytest.approx(cs[30].close - cs[25].close)
    assert five["move_atr"] == pytest.approx((cs[30].close - cs[25].close) / first["atr"], abs=1e-3)
    assert five["direction"] == "up" and ten["direction"] == "up"
    assert ex[41]["next"] == [None, None]  # not enough later bars → no outcome (no lookahead past the data)
    stats = {s["bars"]: s for s in out["stats"]}
    assert stats[5]["n"] == stats[10]["n"] == sum(1 for e in out["examples"] if e["next"][0] is not None)
    assert stats[5]["pct_up"] + stats[5]["pct_down"] <= 100
    assert "Малка извадка" in out["sample_note"]
    assert out["examples"][0]["index"] == max(ex)  # most recent first


def test_find_examples_without_hits_explains_why():
    out = P.find_examples(_random_walk(60), "three_black_crows")
    if out["total_found"] == 0:
        assert "Няма случаи" in out["sample_note"]
        assert all(s["n"] == 0 and s["median_move_atr"] is None for s in out["stats"])


# ---------------------------------------------------------------------------------------------- practice
def _decode(token: str) -> dict:
    body = token.rsplit(".", 1)[0]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


def _correct(rnd) -> str:
    found = P.detected_at_end(rnd["candles"]) & {o["key"] for o in rnd["options"]}
    assert len(found) == 1, (found, rnd["options"])
    return found.pop()


def test_practice_rounds_are_signed_unambiguous_and_hide_the_answer():
    data = P.practice_rounds(10, seed=42, now=1_800_000_000)
    assert data["total"] == len(data["rounds"]) == 10 and data["module"] == "lab:candlesticks"
    assert data["expires_ts"] == 1_800_000_000 + P.PRACTICE_TTL
    answers = [_correct(r) for r in data["rounds"]]
    assert len(set(answers)) == 10  # 10 different patterns
    for r in data["rounds"]:
        keys = [o["key"] for o in r["options"]]
        assert len(keys) == len(set(keys)) == 4
        assert r["question"] == P.PRACTICE_QUESTION and len(r["candles"]) >= 5
        payload = _decode(r["token"])
        assert set(payload) == {"k", "s", "i", "t", "o", "n", "h", "exp"}  # the answer itself is not in the token
        assert payload["o"] == keys
    # the same seed gives the same set (deterministic), another seed a different one
    assert P.practice_rounds(10, seed=42, now=1_800_000_000)["rounds"][0]["token"] == data["rounds"][0]["token"]
    assert P.practice_rounds(10, seed=43, now=1_800_000_000)["set_id"] != data["set_id"]


def test_practice_variants_are_always_recognised():
    for seed in range(30):
        for r in P.practice_rounds(P.PRACTICE_MAX_ROUNDS, seed=seed)["rounds"]:
            _correct(r)


def test_grading_scores_every_round_of_the_set():
    now = 1_800_000_000
    data = P.practice_rounds(10, seed=7, now=now)
    rounds = data["rounds"]
    answers = [{"token": r["token"], "answer": _correct(r)} for r in rounds[:6]]
    wrong = next(o["key"] for o in rounds[6]["options"] if o["key"] != _correct(rounds[6]))
    answers.append({"token": rounds[6]["token"], "answer": wrong})
    g = P.grade_practice(answers, now=now + 10)
    assert g["correct"] == 6 and g["answered"] == 7 and g["total"] == 10  # 3 unanswered rounds count as wrong
    assert g["score"] == pytest.approx(0.6) and g["score_pct"] == 60 and g["passed"] is False
    bad = next(r for r in g["results"] if r["index"] == 6)
    assert bad["correct"] is False and bad["expected"] == _correct(rounds[6]) and bad["answer"] == wrong
    assert bad["explanation"].startswith("Не е ")
    good = next(r for r in g["results"] if r["index"] == 0)
    assert good["correct"] is True and good["explanation"].startswith("Вярно")


def test_tampered_foreign_duplicate_and_expired_tokens_are_rejected():
    now = 1_800_000_000
    a = P.practice_rounds(3, seed=1, now=now)
    b = P.practice_rounds(3, seed=2, now=now)
    r0 = a["rounds"][0]
    body, mac = r0["token"].rsplit(".", 1)
    payload = _decode(r0["token"])
    payload["h"] = "0" * 20
    forged = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()).decode()
    answers = [
        {"token": r0["token"], "answer": _correct(r0)},
        {"token": r0["token"], "answer": _correct(r0)},  # the same round twice
        {"token": forged.rstrip("=") + "." + mac, "answer": "doji"},  # payload changed, old MAC
        {"token": body + "." + ("0" * 32), "answer": "doji"},  # MAC changed
        {"token": b["rounds"][0]["token"], "answer": _correct(b["rounds"][0])},  # another set
        {"token": "garbage", "answer": "doji"},
    ]
    g = P.grade_practice(answers, now=now + 1)
    assert [r["valid"] for r in g["results"]] == [True, False, False, False, False, False]
    assert g["correct"] == 1 and g["total"] == 3
    with pytest.raises(P.PracticeError):
        P.grade_practice([{"token": r0["token"], "answer": "doji"}], now=now + P.PRACTICE_TTL + 1)  # expired
    with pytest.raises(P.PracticeError):
        P.grade_practice([{"token": "x.y", "answer": "doji"}])
