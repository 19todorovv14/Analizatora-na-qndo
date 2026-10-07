"""S5 — AI HISTORY REVIEW (offline + optional LLM narration through safety) and the strategy comparison."""

from __future__ import annotations

import json
import random
import time

import pytest

from app.ai.providers import LLMError
from app.market.base import Candle
from app.market.catalog import get_asset
from app.replay import comparison, outcomes, review, scoring
from app.strategies.rules import StrategyDefinition

H = 3600
TITLES = ["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO"]


def series(n: int = 420, seed: int = 5) -> list[Candle]:
    r = random.Random(seed)
    closes = [100.0]
    for i in range(1, n):
        drift = 0.003 if i > 300 else 0.0
        closes.append(closes[-1] * (1 + drift + 0.008 * (r.random() - 0.5)))
    out = []
    prev = closes[0]
    for i, c in enumerate(closes):
        span = c * 0.006 * (0.6 + 0.8 * r.random())
        out.append(Candle(2_000_000 + i * H, prev, max(prev, c) + span / 2, min(prev, c) - span / 2, c, 10.0))
        prev = c
    return out


CS = series()
START, CURSOR = 300, 380


def decision(i: int, action: str, stop_atr: float | None = None, target_atr: float | None = None, did: int = 1) -> dict:
    """A decision dict in the shape of replay_service.serialize_decision, resolved like at finish."""
    ctx = scoring.decision_context(CS[: i + 1])
    entry = CS[i].close
    after = CS[i + 1 : CURSOR + 31]
    out = {"id": did, "bar_ts": CS[i].ts, "action": action, "entry_price": entry, "note": None, "context": ctx}
    if action == "wait":
        res = outcomes.resolve_wait(entry, ctx["atr"], after)
        sw = scoring.score_wait(res)
        out.update(stop=None, target=None, planned_rr=None, outcome=res, score=sw["score"], score_final=sw["final"])
        out.update(components=sw["components"], flags=scoring.wait_flags(res))
    else:
        sign = 1 if action == "long" else -1
        stop = entry - sign * stop_atr * ctx["atr"]
        target = entry + sign * target_atr * ctx["atr"] if target_atr else None
        a = scoring.assess_entry(action, entry, stop, target, ctx)
        res = outcomes.resolve_prediction(action, entry, stop, target, after)
        sp = scoring.score_prediction(a, res, final=True)
        out.update(stop=stop, target=target, planned_rr=a["planned_rr"], outcome=res, score=sp["score"])
        out.update(score_final=sp["final"], components=sp["components"], flags=a["flags"])
    out["correct"] = scoring.is_correct(action, out["outcome"]) if out["score_final"] else None
    return out


DECISIONS = [
    decision(305, "long", 2, 4, 1),
    decision(320, "short", 0.3, 0.2, 2),  # poor R:R + stop in noise
    decision(330, "wait", did=3),
    decision(350, "long", 1.5, 3, 4),
]

CMP = {
    "available": True,
    "sentence": comparison.SENTENCE,
    "strategy": {"id": None, "name": "EMA test", "source": "template"},
    "rules": ["LONG setup: АКО EMA(20) > EMA(50)"],
    "trades": [],
    "metrics": {"total_trades": 0, "total_r": 0.0},
    "text": [comparison.SENTENCE, "„EMA test“ не намери setup."],
    "disclaimer": comparison.SETUP_DISCLAIMER,
}


def build(**kw) -> dict:
    args = dict(
        symbol="BTC/USDT",
        timeframe="1h",
        precision=2,
        mode="predict",
        setup={
            "preset": "trend",
            "matched": True,
            "info": {"direction": "up", "trend_fraction": 0.7},
            "focus_bars": 100,
        },
        history=CS[: CURSOR + 1],
        start_ts=CS[START].ts,
        cursor_ts=CS[CURSOR].ts,
        next_bars=CS[CURSOR + 1 : CURSOR + 31],
        decisions=DECISIONS,
        score=scoring.session_score(
            [
                {"action": d["action"], "outcome": d["outcome"], "score": d["score"], "final": d["score_final"]}
                for d in DECISIONS
            ],
            final=True,
        ),
        score_basis="decisions",
        comparison=CMP,
    )
    args.update(kw)
    return review.build_history_review(**args)


# ------------------------------------------------------------------------------------------------ offline review
def test_review_shape_sections_and_numbers():
    hr = build()
    assert [s["title"] for s in hr["sections"]] == TITLES
    assert all(s["body"] and all(isinstance(x, str) and x for x in s["body"]) for s in hr["sections"])
    assert hr["provider"] == "offline" and hr["provider_label"] == "OFFLINE" and hr["fallback"] is False
    assert hr["disclaimer"].startswith(comparison.SETUP_DISCLAIMER)
    wh = hr["what_happened"]
    win = CS[START : CURSOR + 1]
    assert wh["start_price"] == win[0].close and wh["end_price"] == win[-1].close
    assert wh["change_pct"] == pytest.approx((win[-1].close / win[0].close - 1) * 100, abs=0.01)
    assert wh["high"]["price"] == max(c.high for c in win[1:])
    assert wh["low"]["price"] == min(c.low for c in win[1:])
    assert wh["bars"] == len(win) and sum(r["bars"] for r in wh["regimes"]) == len(win)
    assert sum(seg["bars"] for seg in wh["regime_segments"]) == len(win)
    assert wh["next"]["bars"] == 30
    assert "тренд нагоре" in wh["setup"]["text"]  # the preset is revealed only in the review
    assert len(hr["predictions"]) == 4
    assert {p["id"] for p in hr["correct"] + hr["wrong"] + hr["undetermined"]} == {1, 2, 3, 4}
    assert all(p["comment"] for p in hr["predictions"])
    # invalidation: one per LONG/SHORT
    assert [lv["id"] for lv in hr["invalidation_levels"]] == [1, 2, 4]
    for lv in hr["invalidation_levels"]:
        d = next(x for x in DECISIONS if x["id"] == lv["id"])
        assert lv["level"] == d["stop"] and lv["hit"] == (d["outcome"]["status"] == "stop")
    rr = hr["rr_assessment"]
    assert rr["decisions"] == 3 and rr["poor"] == 1 and rr["with_target"] == 3
    assert rr["verdict"] in ("mixed", "poor")
    # flags → lessons; R:R / noise problems map to existing academy lessons
    keys = {f["key"] for f in hr["flags_summary"]}
    assert {"poor_rr", "stop_in_noise"} <= keys
    slugs = [lesson["slug"] for lesson in hr["lessons"]]
    assert "reward-risk" in slugs and "stop-loss-placement" in slugs
    assert all(lesson["href"].startswith("/learn/") and lesson["reason"] for lesson in hr["lessons"])
    assert len(hr["lessons"]) <= review.MAX_LESSONS
    assert hr["sections"][5]["body"][0] == comparison.SENTENCE
    assert hr["score"] is not None and hr["grade"] in ("A", "B", "C", "D")
    json.dumps(hr)  # JSON-serialisable (stored in replay_sessions.review)


def test_review_without_decisions():
    hr = build(decisions=[], score=None, score_basis=None, setup=None)
    assert [s["title"] for s in hr["sections"]] == TITLES
    assert hr["predictions"] == [] and hr["invalidation_levels"] == []
    assert hr["rr_assessment"]["verdict"] == "n/a"
    assert [lesson["slug"] for lesson in hr["lessons"]] == [review.DEFAULT_LESSON]
    assert hr["what_happened"]["setup"] is None
    assert hr["summary"][0].startswith("Replay score: няма")


def test_review_window_without_candles_is_data_not_available():
    hr = build(history=CS[:10], decisions=[], score=None)
    assert hr["what_happened"]["available"] is False
    assert "DATA NOT AVAILABLE" in hr["sections"][0]["body"][0]


def test_flag_lists_and_comments():
    flag = {"key": "chased", "label": "Chasing?", "severity": "warning", "text": "далеч от EMA 20", "lesson": "fomo"}
    chased = dict(DECISIONS[0], flags=[flag])
    hr = build(decisions=[chased])
    assert hr["chased"] and hr["chased"][0]["id"] == 1 and hr["chased"][0]["lesson"] == "fomo"
    assert hr["entered_too_early"] == [] and hr["ignored_structure"] == []
    assert "Chasing?" in hr["predictions"][0]["comment"]
    assert hr["lessons"][0]["slug"] == "fomo"


def test_same_candle_comment_explains_worst_case():
    d = dict(
        DECISIONS[0],
        outcome={"status": "stop", "bars_held": 1, "r_result": -1.0, "same_bar_stop_and_target": True, "gap": False},
        flags=[],
    )
    assert "worst case" in review.decision_comment(d)


# ------------------------------------------------------------------------------------------------ LLM narration
class FakeLLM:
    name = "anthropic"

    def __init__(self, payload=None, exc=None):
        self.payload = payload
        self.exc = exc
        self.calls = 0

    def complete(self, system, messages, max_tokens=None):
        self.calls += 1
        assert "AI HISTORY REVIEW" in system and "<review_data>" in messages[0]["content"]
        if self.exc:
            raise self.exc
        return json.dumps(self.payload, ensure_ascii=False)


def test_llm_narration_is_grounded_and_sanitized(monkeypatch):
    start = CS[START].close
    payload = {
        "sections": {
            "observation": [f"Периодът започна на {start:,.2f} и цената се изкачи.", "BUY NOW — guaranteed profit!"],
            "scenario": ["Цената стигна 999,999.99 — измислено ниво."],  # ungrounded → rejected
        }
    }
    fake = FakeLLM(payload)
    monkeypatch.setattr(review, "get_llm", lambda: fake)
    hr = build()
    assert fake.calls == 1
    assert hr["provider"] == "anthropic" and hr["provider_label"] == "Claude"
    obs = hr["sections"][0]["body"]
    assert obs[0].startswith("Периодът започна") and not any("guaranteed" in x.lower() for x in obs)
    assert hr["safety_removed"] and hr["safety_note"]
    assert hr["llm_rejected_sections"] == ["scenario"]
    offline = build(use_llm=False)
    assert hr["sections"][2] == offline["sections"][2]  # the rejected section keeps the engine text
    assert hr["sections"][1] == offline["sections"][1]  # sections the LLM did not return stay offline


@pytest.mark.parametrize("bad", [LLMError("down"), ValueError("bad json")])
def test_llm_failure_falls_back_to_offline(monkeypatch, bad):
    monkeypatch.setattr(review, "get_llm", lambda: FakeLLM(exc=bad))
    hr = build()
    assert hr["provider"] == "offline" and hr["fallback"] is True
    assert [s["body"] for s in hr["sections"]] == [s["body"] for s in build(use_llm=False)["sections"]]


def test_llm_non_json_falls_back(monkeypatch):
    class Garbage(FakeLLM):
        def complete(self, system, messages, max_tokens=None):
            return "no json here"

    monkeypatch.setattr(review, "get_llm", lambda: Garbage())
    assert build()["fallback"] is True


# ------------------------------------------------------------------------------------------------ comparison
CANDLE_COLOUR = StrategyDefinition(
    **{
        "entry_long": {
            "conditions": [
                {"left": {"kind": "price", "field": "close"}, "op": ">", "right": {"kind": "price", "field": "open"}}
            ]
        },
        "entry_short": {
            "conditions": [
                {"left": {"kind": "price", "field": "close"}, "op": "<", "right": {"kind": "price", "field": "open"}}
            ]
        },
        "stop": {"type": "atr", "value": 1},
        "take_profit": {"type": "r_multiple", "value": 1},
    }
)


def test_compare_trades_only_inside_the_window_and_never_after_the_cursor():
    spec = get_asset("BTC/USDT")
    settings = comparison.settings_from_account(10_000, 2.0, {"fees_enabled": True, "spread_enabled": True})
    beyond = CS + [Candle(CS[-1].ts + H, 1, 10**9, 0.5, 10**9, 1)]  # a crazy candle after the cursor must be ignored
    res = comparison.compare(
        beyond,
        start_ts=CS[START].ts,
        cursor_ts=CS[CURSOR].ts,
        spec=spec,
        timeframe="1h",
        defn=CANDLE_COLOUR,
        info={"id": None, "name": "Candle colour", "timeframe": "1h"},
        settings=settings,
        user_total_r=1.5,
        user_resolved=3,
    )
    assert res["available"] is True and res["text"][0] == comparison.SENTENCE
    assert res["trades"]
    for t in res["trades"]:
        assert CS[START].ts <= t["entry_ts"] and t["exit_ts"] <= CS[CURSOR].ts + H
        assert t["exit_reason"] != "end_of_window"
    assert res["metrics"]["total_trades"] == len(res["trades"])
    assert res["metrics"]["window_bars"] == CURSOR - START + 1
    assert res["costs"]["fees_enabled"] is True and res["costs"]["leverage"] == 2.0
    assert any("Твоите 3 оценени прогнози" in line for line in res["text"])
    assert "guarantee" in res["disclaimer"]


def test_compare_short_window_is_unavailable():
    res = comparison.compare(
        CS,
        start_ts=CS[START].ts,
        cursor_ts=CS[START + 2].ts,
        spec=get_asset("BTC/USDT"),
        timeframe="1h",
        defn=CANDLE_COLOUR,
        info={"name": "x"},
        settings=comparison.settings_from_account(10_000, 1.0, {}),
    )
    assert (
        res["available"] is False and res["reason"] and res["trades"] == [] and res["sentence"] == comparison.SENTENCE
    )


def test_default_strategy_falls_back_to_template(guest):
    for s in guest.get("/api/strategies").json()["strategies"]:
        if not s["is_template"]:
            assert guest.delete(f"/api/strategies/{s['id']}").status_code == 200
    r = guest.post(
        "/api/replay",
        json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": int(time.time()) - 20 * 86400, "bars": 30},
    )
    strat = r.json()["session"]["strategy"]
    assert strat["source"] == "template" and strat["name"]
