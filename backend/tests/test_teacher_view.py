"""S4 — STRATEGY VIEW ("What would the strategy do?") and historical examples."""

from __future__ import annotations

import pytest

from app import indicators as ind
from app.ai.examples import NOT_A_FORECAST, historical_examples
from app.analysis.regime import classify, regime_series
from app.market.catalog import get_asset
from app.market.demo import DemoMarketDataProvider
from app.market.timeframes import tf_seconds
from app.strategies.rules import StrategyDefinition
from app.strategies.templates import TEMPLATES, TEMPLATES_BY_KEY
from app.strategies.view import (
    RESULT_LONG,
    RESULT_NONE,
    RESULT_SHORT,
    SETUP_DISCLAIMER,
    strategy_view,
)

NOW = 1_780_000_000
EXACT_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement."


def _candles(symbol="BTC/USDT", tf="1h", limit=400):
    spec = get_asset(symbol)
    rows = DemoMarketDataProvider(clock=lambda: NOW).get_candles(spec, tf, limit=limit, now=NOW, include_partial=False)
    return rows, spec


def _always(side: str = "long", regime_filter=None, stop=None, tp=None) -> dict:
    """A strategy whose single entry condition is always true (close > 0)."""
    block = {
        "logic": "all",
        "conditions": [
            {"left": {"kind": "price", "field": "close"}, "op": ">", "right": {"kind": "value", "value": 0}}
        ],
    }
    d = {
        f"entry_{side}": block,
        "stop": stop or {"type": "atr", "value": 2, "atr_period": 14},
        "take_profit": tp or {"type": "r_multiple", "value": 2},
    }
    if regime_filter is not None:
        d["regime_filter"] = regime_filter
    return d


def test_disclaimer_is_exact():
    assert SETUP_DISCLAIMER == EXACT_DISCLAIMER


@pytest.mark.parametrize("tpl", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_view_shape_for_every_template(tpl):
    rows, spec = _candles()
    v = strategy_view(rows, tpl["definition"], spec, "1h", info={"name": tpl["name"]})
    assert v["available"] is True
    assert v["disclaimer"] == EXACT_DISCLAIMER
    assert v["result"] in (RESULT_LONG, RESULT_SHORT, RESULT_NONE)
    assert v["time"] == rows[-1].ts and v["price"] == pytest.approx(rows[-1].close, abs=10**-spec.price_precision)
    for key in ("regime", "structure", "momentum", "volatility", "support", "resistance", "why", "regime_filter"):
        assert key in v
    defn = StrategyDefinition(**tpl["definition"])
    for side, block in (("long", defn.entry_long), ("short", defn.entry_short)):
        conds = v["conditions"][side]
        assert len(conds) == (len(block.conditions) if block else 0)
        for c in conds:
            assert set(c) >= {"label", "passed", "left_value", "right_value", "explanation"}
            assert isinstance(c["passed"], bool) and c["label"] and c["explanation"]
            assert ("→ изпълнено" in c["explanation"]) == c["passed"]
    assert v["why"] and v["why"][0].startswith("Оценката е върху последната ЗАТВОРЕНА свещ")
    assert v["strategy"]["name"] == tpl["name"] and v["strategy"]["summary"]


def test_condition_values_match_indicators():
    rows, spec = _candles()
    tpl = TEMPLATES_BY_KEY["rsi_ema200_volume"]
    v = strategy_view(rows, tpl["definition"], spec, "1h")
    rsi = ind.rsi([c.close for c in rows], 14)[-1]
    ema200 = ind.ema([c.close for c in rows], 200)[-1]
    first, second = v["conditions"]["long"][:2]
    assert first["left_value"] == pytest.approx(rsi, abs=1e-3) and first["right_value"] == 30
    assert first["passed"] == (rsi < 30)
    assert second["left_value"] == pytest.approx(rows[-1].close, abs=0.01)
    assert second["right_value"] == pytest.approx(ema200, abs=0.01)
    assert second["passed"] == (rows[-1].close > ema200)


def test_setup_and_risk_plan_from_strategy_rules():
    rows, spec = _candles()
    v = strategy_view(rows, _always("long"), spec, "1h")
    assert v["result"] == RESULT_LONG and v["long_passed"] and not v["short_passed"]
    plan = v["risk_plan"]
    atr = ind.atr([c.high for c in rows], [c.low for c in rows], [c.close for c in rows], 14)[-1]
    entry = rows[-1].close
    assert plan["side"] == "long"
    assert plan["entry"] == pytest.approx(entry, abs=0.01)
    assert plan["stop"] == pytest.approx(entry - 2 * atr, abs=0.01)
    assert plan["target"] == pytest.approx(entry + 4 * atr, abs=0.01)
    assert plan["rr"] == pytest.approx(2.0, abs=0.01)
    assert plan["stop_atr"] == pytest.approx(2.0, abs=0.01)
    short = strategy_view(rows, _always("short", tp={"type": "none", "value": 1}), spec, "1h")
    assert short["result"] == RESULT_SHORT
    assert short["risk_plan"]["stop"] > short["risk_plan"]["entry"]
    assert short["risk_plan"]["target"] is None and short["risk_plan"]["rr"] is None


def test_regime_filter_is_applied():
    rows, spec = _candles()
    actual = classify(rows)["regime"]
    other = "RANGING" if actual != "RANGING" else "TRENDING_UP"
    blocked = strategy_view(rows, _always("long", regime_filter=[other]), spec, "1h")
    assert blocked["long_passed"] is True  # the conditions pass …
    assert blocked["regime_filter"] == {"required": [other], "actual": actual, "passed": False}
    assert blocked["result"] == RESULT_NONE  # … but the regime filter blocks the setup
    assert blocked["risk_plan"] is None
    assert any("regime filter" in w.lower() and "NO SETUP" in w for w in blocked["why"])
    allowed = strategy_view(rows, _always("long", regime_filter=[actual]), spec, "1h")
    assert allowed["regime_filter"]["passed"] is True and allowed["result"] == RESULT_LONG


def test_conflicting_sides_give_no_setup():
    rows, spec = _candles()
    both = _always("long")
    both["entry_short"] = both["entry_long"]
    v = strategy_view(rows, both, spec, "1h")
    assert v["long_passed"] and v["short_passed"] and v["result"] == RESULT_NONE
    assert any("конфликт" in w for w in v["why"])


def test_only_given_closed_candles_are_used():
    rows, spec = _candles()
    v1 = strategy_view(rows[:-1], TEMPLATES[1]["definition"], spec, "1h")
    assert v1["time"] == rows[-2].ts  # the view never looks past the last candle it was given
    assert v1["time"] + tf_seconds("1h") <= NOW


def test_insufficient_history():
    rows, spec = _candles(limit=30)
    v = strategy_view(rows, TEMPLATES[0]["definition"], spec, "1h")
    assert v["available"] is False and v["result"] == RESULT_NONE
    assert v["disclaimer"] == EXACT_DISCLAIMER
    assert v["conditions"] == {"long": [], "short": []}


def test_structure_operands_are_explained():
    """DSL v2 operands (S6) are evaluated through the public rules API and explained."""
    tpl = TEMPLATES_BY_KEY.get("trend_momentum_structure")
    if tpl is None:
        pytest.skip("structure template not available")
    rows, spec = _candles()
    v = strategy_view(rows, tpl["definition"], spec, "1h")
    labels = [c["label"] for c in v["conditions"]["long"]]
    assert any("Higher High" in label for label in labels)
    hh = next(c for c in v["conditions"]["long"] if "Higher High" in c["label"])
    assert "текущо" in hh["explanation"]


# ---------------------------------------------------------- historical examples
def test_historical_examples_strategy_basis():
    rows, spec = _candles(limit=1000)
    ex = historical_examples(rows, spec, strategy=StrategyDefinition(**_always("long")), strategy_name="always")
    assert ex["available"] and ex["basis"] == "strategy"
    assert "not a forecast" in ex["note"] and "not a forecast" in ex["summary"]
    assert ex["count"] > 50 and ex["long"] == ex["count"] and ex["short"] == 0
    assert ex["plus_first_pct"] + ex["minus_first_pct"] + ex["neither_pct"] in (99, 100, 101)
    assert ex["p25_move_atr"] <= ex["median_move_atr"] <= ex["p75_move_atr"]
    # non-overlapping: at most one example per horizon window
    assert ex["count"] <= ex["bars_scanned"] // ex["horizon"] + 1


def test_historical_examples_analog_basis_and_wording():
    rows, spec = _candles(limit=1000)
    ex = historical_examples(rows, spec)
    assert ex["available"] and ex["basis"] == "analog"
    assert ex["regime"] == regime_series(rows)[-1]
    lo, hi = ex["rsi_band"]
    rsi_now = ind.rsi([c.close for c in rows], 14)[-1]
    assert lo <= rsi_now < hi
    assert NOT_A_FORECAST in ex["summary"] and "not a forecast" in ex["summary"]
    assert "long" not in ex  # analog examples have no trade direction


def test_historical_examples_regime_filter_and_short_history():
    rows, spec = _candles(limit=1000)
    actual = classify(rows)["regime"]
    impossible = [r for r in ("TRENDING_UP", "TRENDING_DOWN", "RANGING") if r != actual][:1]
    regimes = regime_series(rows)
    defn = StrategyDefinition(**_always("long", regime_filter=impossible))
    ex = historical_examples(rows, spec, strategy=defn)
    expected_max = sum(1 for r in regimes[50 : len(rows) - 10] if r in impossible)
    assert ex["count"] <= expected_max
    short = historical_examples(rows[:50], spec)
    assert short["available"] is False and "not a forecast" in short["note"]
