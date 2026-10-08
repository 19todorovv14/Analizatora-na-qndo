"""S3b — Market Structure Lab checker (app.academy.structure_lab) on crafted series: reference swings + HH/HL/LH/LL
labels, structure verdict, breakout/retest/fakeout rules, per-mark verdicts with tolerance, missed swings, score,
difficulty classification and signed exercise tokens."""

from __future__ import annotations

import base64
import json

import pytest

from app.academy import patterns as P
from app.academy import structure_lab as S
from app.market.base import Candle

T0 = 1_700_000_000
H = 3600


def candles_from(rows):
    return [Candle(T0 + i * H, o, h, lo, c, 1.0) for i, (o, h, lo, c) in enumerate(rows)]


def zigzag(points, wick=0.2, pivot_wick=0.6):
    """Closes interpolated linearly between turning points [(bar, price)]; turning bars get a longer wick so they are
    the unique extreme of their neighbourhood (→ confirmed pivots with PIVOT = 5 when legs are ≥ 6 bars)."""
    closes = []
    for (i0, p0), (i1, p1) in zip(points, points[1:]):
        for k in range(i0, i1):
            closes.append(p0 + (p1 - p0) * (k - i0) / (i1 - i0))
    closes.append(points[-1][1])
    turning = {i: ("high" if (0 < n < len(points) - 1 and p > points[n - 1][1]) else "low")
               for n, (i, p) in enumerate(points) if 0 < n < len(points) - 1}  # fmt: skip
    rows, prev = [], closes[0]
    for i, c in enumerate(closes):
        o = prev
        h, lo = max(o, c) + wick, min(o, c) - wick
        if turning.get(i) == "high":
            h = c + pivot_wick
        elif turning.get(i) == "low":
            lo = c - pivot_wick
        rows.append((o, h, lo, c))
        prev = c
    return candles_from(rows)


UP_POINTS = [(0, 100), (8, 110), (16, 104), (24, 116), (32, 108), (40, 122), (48, 113), (56, 128), (64, 118),
             (72, 134), (80, 124), (88, 130)]  # fmt: skip
DOWN_POINTS = [(i, 230 - p) for i, p in UP_POINTS]
RANGE_POINTS = [(0, 100), (8, 110), (16, 101), (24, 109), (32, 100.5), (40, 111), (48, 99), (56, 108), (64, 102),
                (72, 110.5), (80, 100), (88, 102)]  # fmt: skip


def swing_at(ref, index):
    return next(s for s in ref.swings if s.index == index)


def mark(c, label, price=None, kind="high"):
    return {
        "time": c.ts,
        "price": price if price is not None else (c.high if kind == "high" else c.low),
        "label": label,
    }


# ------------------------------------------------------------------------------------ reference answer
def test_uptrend_reference_swings_labels_and_structure():
    cs = zigzag(UP_POINTS)
    ref = S.analyze(cs)
    highs = [(s.index, s.price, s.label) for s in ref.swings if s.kind == "high"]
    lows = [(s.index, s.price, s.label) for s in ref.swings if s.kind == "low"]
    assert highs == [(8, 110.6, None), (24, 116.6, "HH"), (40, 122.6, "HH"), (56, 128.6, "HH"), (72, 134.6, "HH")]
    assert lows == [(16, 103.4, None), (32, 107.4, "HL"), (48, 112.4, "HL"), (64, 117.4, "HL"), (80, 123.4, "HL")]
    assert swing_at(ref, 24).prev_price == 110.6  # labelled against the previous swing of the same type
    assert ref.structure["expected"] == "uptrend" and ref.structure["up_share"] == 1.0
    assert ref.tol == pytest.approx(S.MATCH_ATR * S.window_atr(cs))


def test_downtrend_and_range_structure():
    down = S.analyze(zigzag(DOWN_POINTS))
    assert {s.label for s in down.swings if s.label} == {"LH", "LL"}
    assert down.structure["expected"] == "downtrend"
    rng = S.analyze(zigzag(RANGE_POINTS))
    assert rng.structure["expected"] == "range"
    assert {"HH", "LH"} <= {s.label for s in rng.swings if s.kind == "high" and s.label}


# --------------------------------------------------------------------------------------------- grading
def test_marks_get_correct_incorrect_and_not_a_swing_verdicts_with_concrete_explanations():
    cs = zigzag(UP_POINTS)
    ref = S.analyze(cs)
    marks = [
        mark(cs[24], "HH"),  # correct
        mark(cs[32], "HL", kind="low"),  # correct
        mark(cs[40], "LH"),  # wrong label
        mark(cs[50], "HL", kind="low"),  # 2 bars after the swing low at 48, at its price → within tolerance
        mark(cs[60], "HH"),  # no swing there
        mark(cs[8], "HH"),  # the first swing high is the anchor (not scored)
    ]
    marks[3]["price"] = swing_at(ref, 48).price
    g = S.grade(cs, ref, marks, "uptrend", precision=2)
    v = [(r["verdict"], r["expected_label"]) for r in g["marks"]]
    assert v == [("CORRECT", "HH"), ("CORRECT", "HL"), ("INCORRECT", "HH"), ("CORRECT", "HL"), ("NOT A SWING", None),
                 ("REFERENCE", None)]  # fmt: skip
    assert g["marks"][0]["explanation"] == "Това е Higher High, защото върхът 116.60 е над предходния връх 110.60."
    assert g["marks"][1]["explanation"] == "Това е Higher Low, защото дъното 107.40 е над предходното дъно 103.40."
    assert g["marks"][2]["explanation"].startswith("Не е LH.") and "Higher High" in g["marks"][2]["explanation"]
    assert g["marks"][0]["matched_swing"] == {"time": cs[24].ts, "price": 116.6, "kind": "high", "label": "HH"}
    assert g["marks"][4]["matched_swing"] is None and "Тук няма потвърден swing high" in g["marks"][4]["explanation"]
    assert g["marks"][5]["scored"] is False
    missed = {(m["time"], m["label"]) for m in g["missed"]}
    assert missed == {(cs[56].ts, "HH"), (cs[64].ts, "HL"), (cs[72].ts, "HH"), (cs[80].ts, "HL")}
    assert all(m["explanation"].startswith("Това е") for m in g["missed"])
    assert g["structure"]["correct"] is True and g["structure"]["expected"] == "uptrend"
    assert g["structure"]["explanation"].startswith("Вярно — uptrend.")
    # score = 60 % swings + 25 % structure + 15 % events
    s_part = (3 - 0.5 * 2) / 8
    types_present = g["counts"]["event_types_present"]
    e_part = 0.0 if types_present else 1.0
    assert g["components"]["swings"] == pytest.approx(round(s_part * 100, 1))
    assert g["score"] == round(100 * (0.6 * s_part + 0.25 + 0.15 * e_part))
    assert "Резултат" in g["summary"] and f"{g['score']}/100" in g["summary"]


def test_lower_high_explanation_names_both_prices():
    cs = zigzag(DOWN_POINTS)
    ref = S.analyze(cs)
    lh = next(s for s in ref.swings if s.label == "LH")
    g = S.grade(cs, ref, [{"time": lh.time, "price": lh.price, "label": "LH"}], "downtrend", precision=1)
    assert g["marks"][0]["verdict"] == "CORRECT"
    assert g["marks"][0]["explanation"] == (
        f"Това е Lower High, защото върхът {lh.price:.1f} е под предходния връх {lh.prev_price:.1f}."
    )


def test_tolerance_is_two_bars_and_a_fraction_of_atr():
    cs = zigzag(UP_POINTS)
    ref = S.analyze(cs)
    sw = swing_at(ref, 24)
    ok = [{"time": cs[26].ts, "price": sw.price, "label": "HH"}, {"time": cs[22].ts, "price": sw.price, "label": "HH"}]
    assert [r["verdict"] for r in S.grade(cs, ref, ok[:1], None)["marks"]] == ["CORRECT"]
    assert [r["verdict"] for r in S.grade(cs, ref, ok[1:], None)["marks"]] == ["CORRECT"]
    far_bar = S.grade(cs, ref, [{"time": cs[27].ts, "price": sw.price, "label": "HH"}], None)
    assert far_bar["marks"][0]["verdict"] == "NOT A SWING"
    far_price = S.grade(cs, ref, [{"time": sw.time, "price": sw.price + 1.5 * ref.tol, "label": "HH"}], None)
    assert far_price["marks"][0]["verdict"] == "NOT A SWING"
    near_price = S.grade(cs, ref, [{"time": sw.time, "price": sw.price - 0.9 * ref.tol, "label": "HH"}], None)
    assert near_price["marks"][0]["verdict"] == "CORRECT"


def test_duplicate_marks_wrong_kind_and_marks_outside_the_window():
    cs = zigzag(UP_POINTS)
    ref = S.analyze(cs)
    hh = swing_at(ref, 24)
    hl = swing_at(ref, 32)
    marks = [
        {"time": hh.time, "price": hh.price, "label": "HH"},
        {"time": hh.time, "price": hh.price, "label": "HH"},  # the same swing again
        {"time": hl.time, "price": hl.price, "label": "HH"},  # a swing LOW marked as a high label
        {"time": cs[-1].ts + 50 * H, "price": 130, "label": "HH"},  # outside the window
        {"time": cs[86].ts, "price": cs[86].high, "label": "HH"},  # the last PIVOT bars cannot be confirmed
    ]
    g = S.grade(cs, ref, marks, "range")
    assert [r["verdict"] for r in g["marks"]] == ["CORRECT", "INCORRECT", "INCORRECT", "NOT A SWING", "NOT A SWING"]
    assert "вече е маркиран" in g["marks"][1]["explanation"]
    assert "swing low (дъно), не връх" in g["marks"][2]["explanation"] and g["marks"][2]["expected_label"] == "HL"
    assert "извън прозореца" in g["marks"][3]["explanation"]
    assert f"последните {S.PIVOT} свещи" in g["marks"][4]["explanation"]
    assert g["structure"]["correct"] is False and g["structure"]["explanation"].startswith("Не е range")


def test_perfect_answer_scores_100_and_nothing_is_missed():
    for pts, structure in ((UP_POINTS, "uptrend"), (DOWN_POINTS, "downtrend"), (RANGE_POINTS, "range")):
        cs = zigzag(pts)
        ref = S.analyze(cs)
        marks = [{"time": s.time, "price": s.price, "label": s.label} for s in ref.swings if s.label]
        marks += [{"time": e.time, "price": e.price, "label": e.type} for e in ref.events if not e.undetermined]
        g = S.grade(cs, ref, marks, structure)
        assert g["score"] == 100, (structure, g["summary"])
        assert g["missed"] == [] and g["missed_events"] == []
        assert all(r["verdict"] == "CORRECT" for r in g["marks"])
    empty = S.grade(cs, ref, [], None)
    assert empty["score"] == 0 or empty["counts"]["event_types_present"] == []
    assert empty["structure"]["answer"] is None and empty["structure"]["explanation"].startswith("Не избра")


# ---------------------------------------------------------------------------------------------- events
def _base_rows():
    """Rise to a swing high (bar 5, High 105.6), fall to a swing low (bar 10, Low 99.8), drift up to 102 (bar 15)."""
    rows, prev = [], 99.0
    for c in (100, 101, 102, 103, 104):
        rows.append((prev, max(prev, c) + 0.2, min(prev, c) - 0.2, c))
        prev = c
    rows.append((104, 105.6, 103.8, 105))
    prev = 105
    for c in (104, 103, 102, 101, 100):
        rows.append((prev, max(prev, c) + 0.2, min(prev, c) - 0.2, c))
        prev = c
    for c in (100.5, 101, 101.5, 102):
        rows.append((prev, max(prev, c) + 0.2, min(prev, c) - 0.2, c))
        prev = c
    return rows, prev


def _with(rows, tail):
    prev = rows[-1][3]
    out = list(rows)
    for item in tail:
        if len(item) == 4:
            out.append(item)
            prev = item[3]
        else:
            (c,) = item
            out.append((prev, max(prev, c) + 0.2, min(prev, c) - 0.2, c))
            prev = c
    return candles_from(out)


def _events_at(cs, level=105.6):
    ref = S.analyze(cs)
    assert any(s.index == 5 and s.price == level for s in ref.swings)
    return ref, [(e.type, e.index, e.undetermined) for e in ref.events if e.price == level]


def test_fakeout_close_back_inside_within_three_bars():
    rows, _ = _base_rows()
    cs = _with(rows, [(104,), (106,), (105,), (104.5,), (104,), (103.5,), (103,), (102.5,), (102,)])
    ref, events = _events_at(cs)
    assert events == [("FAKEOUT", 16, False)]
    fk = next(e for e in ref.events if e.type == "FAKEOUT")
    assert fk.direction == "up" and fk.end_index == 17
    g = S.grade(cs, ref, [{"time": cs[16].ts, "price": 105.6, "label": "FAKEOUT"},
                          {"time": cs[16].ts, "price": 105.6, "label": "BREAKOUT"}], "range")  # fmt: skip
    assert [r["verdict"] for r in g["marks"]] == ["CORRECT", "INCORRECT"]
    assert g["marks"][0]["explanation"].startswith("Fakeout: свещта затваря над swing high 105.60")


def test_breakout_then_retest_of_the_level():
    rows, _ = _base_rows()
    tail = [(104,), (104, 107.0, 103.8, 106.8), (106.8, 107.7, 106.6, 107.5), (107.5, 108.2, 107.3, 108),
            (108, 108.2, 105.5, 106.2), (107,), (108,), (109,), (110,), (111,), (112,)]  # fmt: skip
    cs = _with(rows, tail)
    ref, events = _events_at(cs)
    assert events == [("BREAKOUT", 16, False), ("RETEST", 19, False)]
    marks = [
        {"time": cs[16].ts, "price": 105.6, "label": "BREAKOUT"},
        {"time": cs[19].ts, "price": cs[19].low, "label": "RETEST"},
        {"time": cs[16].ts, "price": 105.6, "label": "FAKEOUT"},  # the break held → not a fakeout
        {"time": cs[12].ts, "price": cs[12].close, "label": "BREAKOUT"},  # nothing happened there
    ]
    g = S.grade(cs, ref, marks, "uptrend")
    assert [r["verdict"] for r in g["marks"]] == ["CORRECT", "CORRECT", "INCORRECT", "INCORRECT"]
    assert g["marks"][2]["expected_label"] == "BREAKOUT" and g["marks"][2]["explanation"].startswith("Не е FAKEOUT.")
    assert g["marks"][3]["explanation"].startswith("Тук няма BREAKOUT")
    assert "BREAKOUT" in g["counts"]["event_types_found"] and "RETEST" in g["counts"]["event_types_found"]


def test_break_at_the_end_of_the_window_accepts_breakout_or_fakeout():
    rows, _ = _base_rows()
    cs = _with(rows, [(104,), (106,), (106.5,)])
    ref, events = _events_at(cs)
    assert events == [("BREAKOUT", 16, True)]
    for label in ("BREAKOUT", "FAKEOUT"):
        g = S.grade(cs, ref, [{"time": cs[16].ts, "price": 105.6, "label": label}], None)
        assert g["marks"][0]["verdict"] == "CORRECT"
    g = S.grade(cs, ref, [], None)
    assert g["missed_events"] == []  # an undetermined break is never counted as missed


# ------------------------------------------------------------------------------------------ difficulty
def test_clean_trend_window_is_easy_and_a_range_with_a_fakeout_is_hard():
    up = zigzag(UP_POINTS)
    assert S.classify_window(up, S.analyze(up)) == "easy"
    rng = zigzag(RANGE_POINTS)
    ref = S.analyze(rng)
    assert ref.structure["expected"] == "range"
    assert [(e.type, e.index) for e in ref.events if e.type == "FAKEOUT"] == [
        ("FAKEOUT", 39),
        ("FAKEOUT", 48),
        ("FAKEOUT", 71),
    ]
    assert S.classify_window(rng, ref) == "hard"  # range, |net move| ≤ 35 % of the range, a judged fakeout
    no_fake = S.Reference(ref.swings, [e for e in ref.events if e.type != "FAKEOUT"], ref.atr, ref.tol, ref.structure)
    assert S.classify_window(rng, no_fake) == "medium"
    fake = S.RefEvent("FAKEOUT", 50, rng[50].ts, 111.6, "up", rng[40].ts, 51, rng[51].ts, 112.0)
    forced = S.Reference(ref.swings, [fake], ref.atr, ref.tol, ref.structure)
    assert S.classify_window(rng, forced) == "hard"
    few = S.analyze(up[:30])
    assert S.classify_window(up[:30], few) is None  # fewer than 4 labelled swings


# ---------------------------------------------------------------------------------------------- tokens
def test_exercise_token_tamper_expiry_and_kind_are_rejected():
    payload = {"k": "sl", "s": "BTC/USDT", "tf": "1h", "a": T0, "b": T0 + 99 * H, "nb": 100, "d": "easy",
               "n": "abc", "exp": 2_000_000_000}  # fmt: skip
    token = P.sign_lab_token(payload)
    assert S.read_exercise_token(token, now=1_900_000_000)["s"] == "BTC/USDT"
    body, mac = token.rsplit(".", 1)
    raw = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    raw["a"] = T0 - 500 * H  # move the window
    moved = base64.urlsafe_b64encode(json.dumps(raw, separators=(",", ":"), sort_keys=True).encode()).decode()
    for bad in (moved.rstrip("=") + "." + mac, body + "." + mac[::-1], token + "x", "", "a.b.c"):
        with pytest.raises(S.StructureTokenError):
            S.read_exercise_token(bad, now=1_900_000_000)
    with pytest.raises(S.StructureTokenError):
        S.read_exercise_token(token, now=2_000_000_001)  # expired
    practice_kind = P.sign_lab_token({**payload, "k": "cl"})
    with pytest.raises(S.StructureTokenError):
        S.read_exercise_token(practice_kind, now=1_900_000_000)


# ------------------------------------------------------------------------------------ optional LLM polish
class _FakeLLM:
    def __init__(self, text=None, error=False):
        self.text, self.error = text, error

    def complete(self, system, messages, max_tokens=None):
        from app.ai.providers import LLMError

        assert "Запази ВСИЧКИ числа" in system and messages[0]["role"] == "user"
        if self.error:
            raise LLMError("down")
        return self.text


def test_optional_llm_polish_is_safety_filtered_and_keeps_every_number(monkeypatch):
    import app.ai.providers as providers

    summary = "Резултат 72/100. Swing-ове: 5 верни от 8. Структура: вярно — uptrend."
    good = "Получи 72/100: 5 от 8 swing-а са верни, а структурата uptrend е разпозната."
    cases = [
        (_FakeLLM(good), good),
        (_FakeLLM("Получи 70/100: 5 от 8 swing-а са верни."), None),  # a number changed → dropped
        (_FakeLLM("Резултат 72/100, 5 от 8, uptrend. Купи веднага, печалбата е гарантирана."), None),  # unsafe
        (_FakeLLM(error=True), None),
        (None, None),  # offline (default): deterministic text only
    ]
    for llm, expected in cases:
        monkeypatch.setattr(providers, "get_llm", lambda llm=llm: llm)
        assert S._polish(summary) == expected
