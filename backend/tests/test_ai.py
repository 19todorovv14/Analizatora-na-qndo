"""AI teacher, safety filter, trade review and coach."""

import pytest

from app.ai.coach import weekly_review
from app.ai.glossary import lookup
from app.ai.providers import LLMError, LLMProvider, get_llm
from app.ai.review import review_position
from app.ai.safety import find_violations, sanitize
from app.ai.teacher import chat, decision_panel, explain_analysis, offline_answer
from app.analysis.signal import analyze
from app.market.catalog import get_asset
from app.market.demo import DemoMarketDataProvider
from app.risk.engine import RiskRules

NOW = 1_780_000_000


@pytest.mark.parametrize(
    "text",
    [
        "BUY NOW — guaranteed",
        "100% win rate",
        "Easy money!",
        "Guaranteed profit",
        "This is risk-free",
        "Гарантирана печалба",
        "Купи веднага",
        "без риск",
        "лесни пари",
    ],
)
def test_safety_flags_forbidden_claims(text):
    assert find_violations(text)
    clean, removed = sanitize(f"Intro. {text}. Outro.")
    assert removed and text.lower() not in clean.lower()


@pytest.mark.parametrize(
    "text",
    [
        "Possible setup, not a guaranteed trade.",
        "Това не е гаранция за печалба.",
        "Past backtest performance does not guarantee future results.",
        "Confidence НЕ означава вероятност за печалба.",
    ],
)
def test_safety_allows_negations(text):
    assert find_violations(text) == []


def test_glossary_lookup():
    assert lookup("Какво е RSI?")["slug"] == "rsi"
    assert lookup("what is ATR")["slug"] == "atr"
    assert lookup("какво означава breakout")["slug"] == "breakout"
    assert lookup("asdfgh qwerty") is None


def _analysis():
    p = DemoMarketDataProvider(clock=lambda: NOW)
    spec = get_asset("BTC/USDT")
    rows = p.get_candles(spec, "1h", limit=400, now=NOW, include_partial=False)
    return analyze(rows, spec=spec, timeframe="1h")


def test_explanation_has_three_parts_and_panel():
    a = _analysis()
    text = explain_analysis(a, llm=None)["text"]
    for part in ("OBSERVATION", "ANALYSIS", "HYPOTHESIS", "CONFIDENCE"):
        assert part in text
    panel = decision_panel(a)
    for key in (
        "MARKET",
        "TIMEFRAME",
        "REGIME",
        "STRUCTURE",
        "MOMENTUM",
        "VOLATILITY",
        "SUPPORT",
        "RESISTANCE",
        "POSSIBLE SETUP",
        "INVALIDATION",
        "RISK",
        "REWARD",
        "DECISION",
        "CONFIDENCE",
    ):
        assert key in panel
    assert panel["DECISION"] in ("WAIT", "POSSIBLE LONG", "POSSIBLE SHORT", "NO TRADE")


def test_offline_chat_intents():
    a = _analysis()
    assert "Relative Strength" in offline_answer("Какво е RSI?", {"analysis": a})
    candle = offline_answer("Защо тази свещ е bearish?", {"analysis": a})
    assert "Open" in candle and "Close" in candle
    chart = offline_answer("Какво виждаш на графиката сега?", {"analysis": a})
    assert "OBSERVATION" in chart and "купи" not in chart.lower().replace("'купи'", "")
    assert "сделка" in offline_answer("Защо загубих този trade?", {})


class _FakeLLM(LLMProvider):
    name = "fake"

    def __init__(self, reply: str | None = None, fail: bool = False):
        self.reply = reply
        self.fail = fail
        self.calls = []

    def complete(self, system, messages, max_tokens=None):
        self.calls.append((system, messages))
        if self.fail:
            raise LLMError("boom")
        return self.reply


def test_llm_output_is_sanitized_and_grounded():
    llm = _FakeLLM("OBSERVATION: price above EMA. BUY NOW, guaranteed profit! HYPOTHESIS: possible setup.")
    res = chat("Какво виждаш?", context={"analysis": _analysis()}, history=[], llm=llm)
    assert res["provider"] == "fake"
    assert "guaranteed" not in res["answer"].lower()
    assert res["safety_removed"]
    system, messages = llm.calls[0]
    assert "OBSERVATION" in system and "<context>" in messages[-1]["content"]


def test_llm_failure_falls_back_to_offline():
    res = chat("Какво е spread?", context={}, history=[], llm=_FakeLLM(fail=True))
    assert res["provider"] == "offline" and "Spread" in res["answer"]


def test_offline_by_default():
    assert get_llm() is None


def _position(**kw):
    base = {
        "id": "p1",
        "symbol": "BTC/USDT",
        "side": "long",
        "entry_price": 100.0,
        "initial_stop": 95.0,
        "take_profit": 115.0,
        "initial_qty": 10.0,
        "opened_ts": 1000,
        "closed_ts": 5000,
        "sl_history": [],
        "mfe": 4.0,
        "mae": 5.0,
        "meta": {"risk_pct": 0.5},
    }
    base.update(kw)
    return base


def _trade(net, reason, exit_price=95.0, qty=10.0):
    return {
        "net_pnl": net,
        "gross_pnl": net + 1,
        "fees": 1.0,
        "qty": qty,
        "exit_price": exit_price,
        "exit_reason": reason,
        "closed_ts": 5000,
    }


def test_review_good_process_bad_outcome():
    r = review_position(_position(), [_trade(-51, "stop_loss")], rules=RiskRules())
    assert r["title"] == "TRADE REVIEW"
    assert any("respected your stop" in x for x in r["did_well"])
    assert "Good process" in r["main_lesson"]


def test_review_criticises_obvious_mistakes():
    r = review_position(
        _position(initial_stop=None, meta={"risk_pct": None}), [_trade(-80, "manual", 92)], rules=RiskRules()
    )
    assert r["main_lesson"].startswith("You entered without a defined invalidation point.")
    big = review_position(_position(meta={"risk_pct": 3.0}), [_trade(-300, "stop_loss")], rules=RiskRules())
    assert any("too large for the stop distance" in x for x in big["did_poorly"])
    moved = review_position(
        _position(sl_history=[{"sl": 95}, {"sl": 90, "widened": True}]),
        [_trade(-100, "stop_loss", 90)],
        rules=RiskRules(),
    )
    assert any("moved your stop further away" in x for x in moved["did_poorly"])
    early = review_position(_position(mfe=12.0), [_trade(15, "manual", 101.6)], rules=RiskRules())
    assert any("exited early" in x for x in early["did_poorly"])


def test_coach_weekly_review():
    progress = {
        "charts": {"completed": 16, "total": 16, "quiz_score": 0.95},
        "risk": {"completed": 2, "total": 8, "quiz_score": 0.5},
    }
    trades = [
        {"net_pnl": -180, "r_multiple": -1.8, "fees": 1, "opened_ts": 0, "closed_ts": 10, "stop_price": 1},
        {"net_pnl": -170, "r_multiple": -1.7, "fees": 1, "opened_ts": 0, "closed_ts": 10, "stop_price": 1},
        {"net_pnl": 120, "r_multiple": 1.2, "fees": 1, "opened_ts": 0, "closed_ts": 10, "stop_price": 1},
        {"net_pnl": 125, "r_multiple": 1.25, "fees": 1, "opened_ts": 0, "closed_ts": 10, "stop_price": 1},
    ]
    behavior = {
        "findings": [
            {
                "kind": "chasing",
                "title": "Chasing entries",
                "text": "2 входа далеч от EMA 20",
                "lesson": "fomo",
                "count": 2,
                "severity": "warn",
            }
        ],
        "discipline_score": 90,
    }
    r = weekly_review(
        progress=progress,
        week_trades=trades,
        all_trades=trades,
        behavior=behavior,
        journal_count=0,
        journal_emotions={},
        backtests=[],
        period={"from": 0, "to": 1},
    )
    joined = " ".join(r["summary"])
    assert "candlesticks well" in joined and "risk management is weak" in joined
    assert "average losing trade is 1.8R" in joined
    assert "biggest recurring mistake" in joined
    assert r["next_lessons"] and r["next_lessons"][0]["slug"] == "fomo"
