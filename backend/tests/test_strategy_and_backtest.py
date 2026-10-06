"""Strategy engine, backtesting engine and validation."""

import pytest
from pydantic import ValidationError

from app.backtesting.engine import BacktestSettings, run_backtest
from app.backtesting.validation import PAST_PERFORMANCE, validate
from app.market.base import Candle
from app.market.catalog import get_asset
from app.market.demo import DemoMarketDataProvider
from app.strategies.rules import IndicatorCache, StrategyDefinition, evaluate, stop_distance, target_distance
from app.strategies.templates import TEMPLATES

NOW = 1_780_000_000  # fixed "now" → fully reproducible demo data


def candles(symbol="BTC/USDT", tf="1h", n=1500):
    p = DemoMarketDataProvider(clock=lambda: NOW)
    return p.get_candles(get_asset(symbol), tf, limit=n, now=NOW, include_partial=False)


def _val(v):
    return {"kind": "value", "value": v}


def _price(f="close"):
    return {"kind": "price", "field": f}


def test_templates_are_valid():
    for t in TEMPLATES:
        d = StrategyDefinition(**t["definition"])
        assert d.condition_count() >= 1


def test_definition_validation():
    with pytest.raises(ValidationError):
        StrategyDefinition()  # no entry rules
    with pytest.raises(ValidationError):
        StrategyDefinition(
            entry_long={"conditions": [{"left": {"kind": "indicator", "name": "magic"}, "op": ">", "right": _val(1)}]}
        )
    with pytest.raises(ValidationError):
        StrategyDefinition(
            entry_long={
                "conditions": [
                    {"left": {"kind": "indicator", "name": "rsi", "params": {"period": 0}}, "op": ">", "right": _val(1)}
                ]
            }
        )


def test_crosses_and_logic():
    data = [Candle(i * 60, v, v, v, v, 1) for i, v in enumerate([1, 1, 1, 3, 3])]
    cache = IndicatorCache(data)
    d = StrategyDefinition(
        entry_long={"logic": "all", "conditions": [{"left": _price(), "op": "crosses_above", "right": _val(2)}]},
        entry_short={
            "logic": "any",
            "conditions": [
                {"left": _price(), "op": "<", "right": _val(0)},
                {"left": _price(), "op": ">", "right": _val(2.5)},
            ],
        },
    )
    assert evaluate(d, cache, 3)["entry_long"]["passed"] is True
    assert evaluate(d, cache, 4)["entry_long"]["passed"] is False  # cross happens once
    assert evaluate(d, cache, 4)["entry_short"]["passed"] is True  # OR logic
    assert evaluate(d, cache, 2)["entry_short"]["passed"] is False


def test_operand_multiplier_and_shift():
    data = [Candle(i * 60, 10, 10, 10, 10 + i, 100 + i) for i in range(30)]
    d = StrategyDefinition(
        entry_long={
            "conditions": [
                {"left": _price("close"), "op": ">", "right": {"kind": "price", "field": "close", "shift": 1}},
                {
                    "left": _price("volume"),
                    "op": "<",
                    "right": {"kind": "indicator", "name": "volume_sma", "params": {"period": 5}, "mult": 2},
                },
            ]
        }
    )
    ev = evaluate(d, IndicatorCache(data), 20)["entry_long"]
    assert ev["passed"] is True and len(ev["conditions"]) == 2


def test_stop_and_target_distance():
    data = candles(n=300)
    cache = IndicatorCache(data)
    d = StrategyDefinition(
        entry_long={"conditions": [{"left": _price(), "op": ">", "right": _val(0)}]},
        stop={"type": "atr", "value": 2},
        take_profit={"type": "r_multiple", "value": 3},
    )
    sd = stop_distance(d, cache, 250, "buy")
    atr = cache.indicator("atr", {"period": 14})[250]
    assert sd == pytest.approx(atr * 2)
    assert target_distance(d, cache, 250, sd) == pytest.approx(sd * 3)
    pct = StrategyDefinition(entry_long=d.entry_long, stop={"type": "percent", "value": 1})
    assert stop_distance(pct, cache, 250, "buy") == pytest.approx(data[250].close * 0.01)
    swing = StrategyDefinition(entry_long=d.entry_long, stop={"type": "swing", "value": 1, "lookback": 10})
    assert stop_distance(swing, cache, 250, "buy") > 0


def test_backtest_is_deterministic_and_consistent():
    data = candles()
    d = StrategyDefinition(**TEMPLATES[1]["definition"])
    r1 = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    r2 = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    assert r1["metrics"] == r2["metrics"]
    m = r1["metrics"]
    assert m["total_trades"] == m["winning_trades"] + m["losing_trades"]
    assert m["final_equity"] == pytest.approx(10_000 + sum(t["net_pnl"] for t in r1["trades"]), abs=0.05)
    assert m["max_drawdown_pct"] >= 0


def test_backtest_has_no_lookahead():
    """Entries happen at the OPEN of the bar after the signal."""
    data = candles(n=800)
    d = StrategyDefinition(**TEMPLATES[3]["definition"])
    res = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(slippage_bps=0, spread_enabled=False), "1h")
    opens = {c.ts: c.open for c in data}
    assert res["trades"], "template should trade on this sample"
    for t in res["trades"]:
        assert t["entry_ts"] in opens
        assert t["entry_price"] == pytest.approx(opens[t["entry_ts"]], rel=1e-9)


def test_costs_reduce_results():
    data = candles()
    d = StrategyDefinition(**TEMPLATES[4]["definition"])
    spec = get_asset("BTC/USDT")
    free = run_backtest(data, spec, d, BacktestSettings(fees_enabled=False, slippage_bps=0, spread_enabled=False), "1h")
    costly = run_backtest(data, spec, d, BacktestSettings(fee_bps=10, slippage_bps=5), "1h")
    assert costly["metrics"]["fees_total"] > 0
    assert free["metrics"]["fees_total"] == 0
    assert costly["metrics"]["net_pnl"] < free["metrics"]["net_pnl"]


def test_risk_per_trade_limits_losses():
    data = candles()
    d = StrategyDefinition(**TEMPLATES[1]["definition"])
    res = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(risk_per_trade_pct=1), "1h")
    for t in res["trades"]:
        if t["exit_reason"] == "stop_loss" and t["r_multiple"] is not None:
            assert t["r_multiple"] > -2.5  # ~1R plus costs; never a blow-up


def test_validation_never_claims_profitability():
    data = candles(n=2000)
    d = StrategyDefinition(**TEMPLATES[1]["definition"])
    s = BacktestSettings()
    res = run_backtest(data, get_asset("BTC/USDT"), d, s, "1h")
    v = validate(data, get_asset("BTC/USDT"), d, s, "1h", res)
    assert v["disclaimer"] == PAST_PERFORMANCE
    text = (v["headline"] + v["robustness"]).lower()
    assert "is profitable" not in text and "е печеливша" not in text
    assert v["sample_size"]["verdict"] in ("insufficient", "limited", "adequate")
    assert v["out_of_sample"] is not None
    assert v["sensitivity"]
    assert sum(v["regime_distribution"].values()) == pytest.approx(100, abs=0.5)
    assert "stress_test" in v and v["costs"]["fees"] >= 0


def test_small_sample_warning():
    data = candles(n=600)
    d = StrategyDefinition(**TEMPLATES[0]["definition"])  # rare signals
    s = BacktestSettings()
    res = run_backtest(data, get_asset("BTC/USDT"), d, s, "1h")
    v = validate(data, get_asset("BTC/USDT"), d, s, "1h", res)
    assert any(w["code"] == "sample_size" for w in v["warnings"])
