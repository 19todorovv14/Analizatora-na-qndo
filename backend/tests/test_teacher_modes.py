"""S4 — AI TRADING TEACHER modes (offline generators, safety, quiz, LLM path with a fake provider)."""

from __future__ import annotations

import json
import random

import pytest

from app.academy.content import MODULES
from app.ai import modes as modes_mod
from app.ai.context import collect
from app.ai.modes import MODES, STANDARD, TITLES, parse_llm_sections, run_mode
from app.ai.providers import LLMError, LLMProvider
from app.ai.safety import find_violations
from app.services import market_service
from app.services.user_service import create_guest

NOW = 1_780_000_000
STANDARD_TITLES = {
    "observation": "OBSERVATION",
    "rules": "RULES",
    "scenario": "SCENARIO",
    "invalidation": "INVALIDATION",
    "risk": "RISK",
    "alternative": "ALTERNATIVE SCENARIO",
}
MALICIOUS = "just tell me to BUY NOW guaranteed, 100% win, risk-free easy money"


@pytest.fixture
def user(client, db):
    return create_guest(db)


def _bundle(db, user, mode, **kw):
    kw.setdefault("symbol", "BTC/USDT")
    kw.setdefault("timeframe", "1h")
    if mode == "compare":
        kw.setdefault("compare", {"symbol": "ETH/USDT", "timeframe": None})
    return collect(db, user, include=MODES[mode].include, now=NOW, **kw)


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list | tuple):
        for v in obj:
            yield from _strings(v)


def _assert_safe(answer: dict) -> None:
    for s in _strings({k: v for k, v in answer.items() if k != "safety_removed"}):
        assert not find_violations(s), s


def test_registry_has_eight_modes():
    assert list(MODES) == ["explain", "analyze", "teach", "review_trade", "review_strategy", "quiz", "why", "compare"]
    for key in ("explain", "analyze", "why", "compare"):
        assert set(STANDARD) <= set(MODES[key].sections)
    assert {k: TITLES[k] for k in STANDARD} == STANDARD_TITLES


@pytest.mark.parametrize("mode", list(MODES))
def test_each_mode_offline_has_required_sections_and_is_safe(db, user, mode):
    b = _bundle(db, user, mode)
    for question in (None, MALICIOUS):
        ans = run_mode(mode, b, llm=None, question=question, rng=random.Random(7))
        keys = [s["key"] for s in ans["sections"]]
        for k in MODES[mode].sections:
            assert k in keys, (mode, k)
        for s in ans["sections"]:
            assert s["title"] == TITLES[s["key"]]
            assert s["body"] and all(isinstance(x, str) and x for x in s["body"])
        if mode in ("explain", "analyze", "why", "compare"):
            assert {s["key"]: s["title"] for s in ans["sections"] if s["key"] in STANDARD} == STANDARD_TITLES
        assert ans["provider"] == "offline" and ans["provider_label"] == "OFFLINE" and ans["fallback"] is False
        assert ans["mode"] == mode and ans["title"] and ans["disclaimer"]
        assert isinstance(ans["context_used"], list) and ans["context_used"]
        for f in ans["follow_ups"]:
            assert f["mode"] in MODES and f["label"] and isinstance(f["payload"], dict)
        _assert_safe(ans)
        json.dumps(ans)  # JSON-serialisable


def test_malicious_question_gets_a_calm_refusal_line(db, user):
    b = _bundle(db, user, "analyze")
    ans = run_mode("analyze", b, question=MALICIOUS)
    scenario = next(s for s in ans["sections"] if s["key"] == "scenario")["body"]
    assert any("Не давам команди" in line for line in scenario)
    text = json.dumps(ans, ensure_ascii=False).lower()
    assert "buy now" not in text and "guaranteed" not in text and "risk-free" not in text


def test_setup_modes_carry_the_exact_disclaimer(db, user):
    for mode in ("explain", "analyze", "why", "compare", "review_strategy"):
        ans = run_mode(mode, _bundle(db, user, mode))
        assert ans["disclaimer"].startswith(
            "This is a rule-based hypothetical setup, not a guarantee of future price movement."
        )
    rs = run_mode("review_strategy", _bundle(db, user, "review_strategy"))
    assert "Past backtest performance does not guarantee future results." in rs["disclaimer"]


def test_analyze_uses_engine_numbers(db, user):
    b = _bundle(db, user, "analyze")
    ans = run_mode("analyze", b)
    obs = next(s for s in ans["sections"] if s["key"] == "observation")["body"]
    # the observation lines are exactly the signal engine's facts (no invented numbers)
    for line in b.analysis["observation"][:3]:
        assert line in obs
    rules = next(s for s in ans["sections"] if s["key"] == "rules")["body"]
    n_conditions = len(b.view["conditions"]["long"]) + len(b.view["conditions"]["short"])
    assert sum(1 for line in rules if line.startswith(("✓ LONG", "✗ LONG", "✓ SHORT", "✗ SHORT"))) == n_conditions
    assert any("Regime filter" in line for line in rules)
    examples = next(s for s in ans["sections"] if s["key"] == "examples")["body"]
    assert any("not a forecast" in line for line in examples)
    assert ans["overlay"]["support"] == [round(x["price"], 2) for x in b.analysis["support"]]


def test_explain_with_draft_order(db, user):
    b = _bundle(db, user, "explain")
    price = b.chart.candles[-1].close
    atr = b.analysis["volatility"]["atr"]
    draft = {"side": "buy", "entry": price, "stop": price - 2 * atr, "target": price + 4 * atr}
    ans = run_mode("explain", b, draft=draft)
    assert ans["sections"][0]["key"] == "draft" and ans["sections"][0]["title"] == "YOUR DRAFT ORDER"
    body = ans["sections"][0]["body"]
    assert any("2.00 ATR" in line for line in body)
    assert any("R:R 2.00" in line for line in body)
    assert ans["overlay"]["draft"]["side"] == "long"
    no_stop = run_mode("explain", b, draft={"side": "long", "entry": price})
    assert any("Няма stop loss" in line for line in no_stop["sections"][0]["body"])
    wrong = run_mode("explain", b, draft={"side": "short", "entry": price, "stop": price - atr})
    assert any("грешната страна" in line for line in wrong["sections"][0]["body"])


def test_teach_uses_topic_and_links_next_lesson(db, user):
    b = _bundle(db, user, "teach")
    ans = run_mode("teach", b, topic="rsi")
    assert ans["lesson"]["slug"] == "rsi" and ans["lesson"]["href"] == "/learn/rsi"
    assert ans["next_lesson"] and ans["next_lesson"]["href"].startswith("/learn/")
    lesson = next(s for s in ans["sections"] if s["key"] == "lesson")["body"]
    assert lesson[0].startswith("RSI")
    example = next(s for s in ans["sections"] if s["key"] == "example")["body"]
    assert any("RSI" in line for line in example)
    by_question = run_mode("teach", b, question="Какво е ATR?")
    assert by_question["lesson"]["slug"] == "atr"


def test_quiz_answers_are_valid_and_chart_answers_computed(db, user):
    b = _bundle(db, user, "quiz")
    for seed in range(5):
        ans = run_mode("quiz", b, rng=random.Random(seed))
        qs = ans["quiz"]["questions"]
        assert 4 <= len(qs) <= 7
        assert len({q["id"] for q in qs}) == len(qs)
        bank = [q for q in qs if q["source"] == "academy"]
        chart = [q for q in qs if q["source"] == "chart"]
        assert 3 <= len(bank) <= 5 and 1 <= len(chart) <= 2
        for q in qs:
            assert len(q["options"]) >= 2 and 0 <= q["answer_index"] < len(q["options"])
            assert q["question"] and q["explanation"]
        bank_by_id = {f"bank:{x['id']}": x for m in MODULES for x in m["quiz"]}
        for q in bank:
            src = bank_by_id[q["id"]]
            assert q["options"] == src["options"] and q["answer_index"] == src["answer"]
        c = b.chart.compact
        for q in chart:
            correct = q["options"][q["answer_index"]]
            if q["id"] == "chart:structure":
                expected = {"bullish": "Higher highs", "bearish": "Lower highs", "mixed": "Смесена"}[
                    c["structure"]["trend"]
                ]
                assert correct.startswith(expected)
            elif q["id"] == "chart:rsi":
                rsi = c["ind"]["rsi"]
                assert correct.startswith("Над 70" if rsi > 70 else "Под 30" if rsi < 30 else "Между 30 и 70")
            elif q["id"] == "chart:regime":
                assert correct == c["regime"]


def test_quiz_is_weighted_to_weak_modules(db, user):
    from app.ai.quiz import bank_questions

    progress = {
        "modules": [
            {
                "key": m["key"],
                "unlocked": True,
                "quiz_score": 0.2 if m["key"] == "risk" else 1.0,
                "lessons_completed": 3,
            }
            for m in MODULES
        ]
    }
    counts: dict[str, int] = {}
    rng = random.Random(1)
    for _ in range(60):
        qs, focus = bank_questions(progress, 3, rng)
        for q in qs:
            counts[q["module"]] = counts.get(q["module"], 0) + 1
    assert counts.get("risk", 0) == max(counts.values())
    locked = {"modules": [{"key": m["key"], "unlocked": m["key"] == "charts", "quiz_score": None} for m in MODULES]}
    qs, _ = bank_questions(locked, 3, random.Random(2))
    assert {q["module"] for q in qs} == {"charts"}


def test_review_trade_without_trades(db, user):
    ans = run_mode("review_trade", _bundle(db, user, "review_trade"))
    assert [s["key"] for s in ans["sections"]] == ["what_happened", "did_well", "did_poorly", "main_lesson"]
    assert "Още нямаш затворена paper сделка" in ans["sections"][0]["body"][0]


def test_review_strategy_without_backtest(db, user):
    ans = run_mode("review_strategy", _bundle(db, user, "review_strategy"))
    keys = [s["key"] for s in ans["sections"]]
    assert {"strengths", "weaknesses", "overfitting", "next_test"} <= set(keys)
    weak = next(s for s in ans["sections"] if s["key"] == "weaknesses")["body"]
    assert any("Няма завършен backtest" in line for line in weak)
    nxt = next(s for s in ans["sections"] if s["key"] == "next_test")["body"]
    assert any("/backtesting" in line for line in nxt) and any("/bots" in line for line in nxt)


def test_compare_two_columns(db, user):
    b = _bundle(db, user, "compare")
    ans = run_mode("compare", b)
    cmp = ans["comparison"]
    assert cmp["left"]["symbol"] == "BTC/USDT" and cmp["right"]["symbol"] == "ETH/USDT"
    assert [r["key"] for r in cmp["rows"]] == [
        "regime",
        "structure",
        "volatility",
        "momentum",
        "support",
        "resistance",
        "strategy",
        "decision",
    ]
    conclusion = next(s for s in ans["sections"] if s["key"] == "conclusion")["body"]
    assert any("differences, not a prediction" in line for line in conclusion)
    tf = _bundle(db, user, "compare", compare={"symbol": None, "timeframe": None})
    assert tf.compare.timeframe == "4h" and tf.compare.symbol == "BTC/USDT"


def test_data_not_available_is_never_invented(db, user, monkeypatch):
    from app.market.base import DataNotAvailableError

    def boom(*a, **k):
        raise DataNotAvailableError("No configured provider for crypto supports BTC/USDT (configured: none)")

    monkeypatch.setattr(market_service, "candles", boom)
    for mode in ("analyze", "explain", "why", "compare", "teach", "quiz"):
        b = _bundle(db, user, mode)
        ans = run_mode(mode, b)
        assert ans["data_available"] is False
        chart_item = next(i for i in ans["context_used"] if i["key"] == "chart")
        assert chart_item["available"] is False and "DATA NOT AVAILABLE" in chart_item["detail"]
        if mode in ("analyze", "explain", "why", "compare"):
            obs = next(s for s in ans["sections"] if s["key"] == "observation")["body"]
            assert obs[0].startswith("DATA NOT AVAILABLE")
            assert {s["key"] for s in ans["sections"]} >= set(STANDARD)


# ------------------------------------------------------------------ LLM path
class FakeLLM(LLMProvider):
    name = "fake"

    def __init__(self, reply=None, exc: Exception | None = None):
        self.reply, self.exc, self.calls = reply, exc, []

    def complete(self, system, messages, max_tokens=None):
        self.calls.append((system, messages))
        if self.exc is not None:
            raise self.exc
        return self.reply(messages) if callable(self.reply) else self.reply


def _llm_json(**sections) -> str:
    return "```json\n" + json.dumps({"sections": sections}, ensure_ascii=False) + "\n```"


def test_llm_sections_are_used_and_rules_stay_deterministic(db, user):
    b = _bundle(db, user, "analyze")
    offline = run_mode("analyze", b)
    llm = FakeLLM(
        _llm_json(
            observation=["Цената е над EMA 200."],
            scenario=["Possible setup според правилата."],
            rules=["LLM rewrite of the rules"],
        )
    )
    ans = run_mode("analyze", b, llm=llm, question="Какво виждаш?")
    by_key = {s["key"]: s["body"] for s in ans["sections"]}
    assert ans["provider"] == "fake" and ans["fallback"] is False
    assert by_key["observation"] == ["Цената е над EMA 200."]
    assert by_key["scenario"] == ["Possible setup според правилата."]
    assert by_key["rules"] == next(s["body"] for s in offline["sections"] if s["key"] == "rules")
    assert by_key["risk"] == next(s["body"] for s in offline["sections"] if s["key"] == "risk")
    system, messages = llm.calls[0]
    content = messages[-1]["content"]
    assert "<context>" in content and "<engine_draft>" in content and "<question>" in content
    assert "OBSERVATION" in system and "JSON" in system


def test_llm_output_is_sanitized(db, user):
    b = _bundle(db, user, "why")
    llm = FakeLLM(_llm_json(scenario=["BUY NOW — guaranteed profit!", "Условията подсказват possible setup."]))
    ans = run_mode("why", b, llm=llm, question=MALICIOUS)
    scenario = next(s for s in ans["sections"] if s["key"] == "scenario")["body"]
    assert scenario == ["Условията подсказват possible setup."]
    assert ans["safety_removed"] and ans["safety_note"]
    _assert_safe(ans)


def test_llm_invented_numbers_are_rejected(db, user):
    b = _bundle(db, user, "analyze")
    offline = run_mode("analyze", b)
    llm = FakeLLM(_llm_json(invalidation=["Invalidation при 12,345,678.91."], alternative=["Без нови числа."]))
    ans = run_mode("analyze", b, llm=llm)
    by_key = {s["key"]: s["body"] for s in ans["sections"]}
    assert by_key["invalidation"] == next(s["body"] for s in offline["sections"] if s["key"] == "invalidation")
    assert by_key["alternative"] == ["Без нови числа."]
    assert ans["llm_rejected_sections"] == ["invalidation"]


@pytest.mark.parametrize(
    "llm",
    [
        FakeLLM(exc=LLMError("AI моделът отказа заявката.")),  # refusal
        FakeLLM(exc=RuntimeError("network down")),  # any exception
        FakeLLM("I'm sorry, I can't help with that."),  # non-JSON refusal text
        FakeLLM(_llm_json(unknown=["x"])),  # none of the requested keys
    ],
    ids=["refusal", "exception", "not-json", "wrong-keys"],
)
def test_llm_failure_falls_back_to_offline(db, user, llm):
    b = _bundle(db, user, "explain")
    offline = run_mode("explain", b)
    ans = run_mode("explain", b, llm=llm)
    assert ans["provider"] == "offline" and ans["fallback"] is True
    assert ans["sections"] == offline["sections"]


def test_quiz_with_llm_keeps_engine_questions(db, user):
    b = _bundle(db, user, "quiz")
    llm = FakeLLM(_llm_json(quiz=["Кратко въведение."]))
    ans = run_mode("quiz", b, llm=llm, rng=random.Random(3))
    offline = run_mode("quiz", b, rng=random.Random(3))
    assert ans["quiz"] == offline["quiz"]  # the LLM never writes questions or answers
    assert ans["provider"] == "fake" and len(llm.calls) == 1
    assert ans["sections"] == [{"key": "quiz", "title": "QUIZ", "body": ["Кратко въведение."]}]
    assert "въпросите вече са избрани" in llm.calls[0][0]


def test_parse_llm_sections_variants():
    keys = ["observation", "risk"]
    assert parse_llm_sections('{"sections": {"observation": "a\\n- b"}}', keys) == {"observation": ["a", "b"]}
    assert parse_llm_sections('text {"sections": [{"key": "risk", "body": ["x"]}]} tail', keys) == {"risk": ["x"]}
    with pytest.raises(ValueError):
        parse_llm_sections("no json", keys)
    with pytest.raises(ValueError):
        parse_llm_sections('{"sections": {"other": ["x"]}}', keys)


def test_api_uses_configured_llm(guest, monkeypatch):
    from app.api import teacher as teacher_api

    llm = FakeLLM(_llm_json(observation=["Факти от данните."]))
    monkeypatch.setattr(teacher_api, "get_llm", lambda: llm)
    r = guest.post("/api/teacher/ask", json={"mode": "analyze", "symbol": "BTC/USDT", "timeframe": "1h"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "fake" and body["sections"][0]["body"] == ["Факти от данните."]
    monkeypatch.setattr(teacher_api, "get_llm", lambda: FakeLLM(exc=LLMError("boom")))
    r = guest.post("/api/teacher/ask", json={"mode": "why", "symbol": "BTC/USDT", "timeframe": "1h"})
    assert r.status_code == 200 and r.json()["provider"] == "offline" and r.json()["fallback"] is True


def test_modes_module_exports_generators_for_every_mode():
    assert set(modes_mod.GENERATORS) == set(MODES)


def test_review_strategy_with_legacy_validation_uses_heuristic(db, user):
    from app.models import Backtest

    b = _bundle(db, user, "review_strategy")
    row = b.strategy_row
    bt = Backtest(
        user_id=user.id,
        strategy_id=row.id,
        strategy_name=row.name,
        strategy_snapshot=row.definition,
        symbol="BTC/USDT",
        timeframe="1h",
        start_ts=NOW - 86400 * 30,
        end_ts=NOW,
        status="done",
        metrics={"total_trades": 12, "win_rate": 50.0, "profit_factor": 1.4, "expectancy_r": 0.2, "net_pnl": 120.0},
        validation={
            "warnings": [{"code": "sample_size", "severity": "high", "text": "Само 12 сделки — твърде малка извадка."}],
            "results_by_regime": [{"regime": "RANGING", "trades": 5, "net_pnl": -40.0, "win_rate": 20.0}],
        },
    )
    db.add(bt)
    db.commit()
    b = _bundle(db, user, "review_strategy")
    assert b.backtest is not None and b.backtest.id == bt.id
    ans = run_mode("review_strategy", b)
    by_key = {s["key"]: s["body"] for s in ans["sections"]}
    assert by_key["overfitting"][0].startswith("OVERFITTING RISK: HIGH")
    assert any("Само 12 сделки" in line for line in by_key["weaknesses"])
    assert any("Най-слаб режим: RANGING" in line for line in by_key["weaknesses"])
    assert any("100 сделки" in line for line in by_key["next_test"])
    assert ans["backtest"]["id"] == bt.id
    _assert_safe(ans)


def test_compare_when_second_market_is_unavailable(db, user, monkeypatch):
    from app.market.base import DataNotAvailableError

    real = market_service.candles

    def partial(symbol, *a, **k):
        if symbol == "ETH/USDT":
            raise DataNotAvailableError("No configured provider for crypto supports ETH/USDT")
        return real(symbol, *a, **k)

    monkeypatch.setattr(market_service, "candles", partial)
    ans = run_mode("compare", _bundle(db, user, "compare"))
    assert ans["comparison"]["left"]["available"] is True and ans["comparison"]["right"]["available"] is False
    assert all(r["right"] == "DATA NOT AVAILABLE" for r in ans["comparison"]["rows"])
    conclusion = next(s for s in ans["sections"] if s["key"] == "conclusion")["body"]
    assert any("DATA NOT AVAILABLE" in line for line in conclusion)
    assert {s["key"] for s in ans["sections"]} >= set(STANDARD)
