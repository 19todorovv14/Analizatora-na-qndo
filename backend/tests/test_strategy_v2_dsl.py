"""S6 — Strategy DSL v2: structure operands, is_true/is_false, presets, the trend+structure template, meta API."""

from __future__ import annotations

import hashlib
import json

import pytest
from pydantic import ValidationError

from app.analysis.structure import find_swings, swing_state_series
from app.backtesting.engine import BacktestSettings, run_backtest
from app.backtesting.validation import validate
from app.market.base import Candle
from app.market.catalog import get_asset
from app.market.demo import DemoMarketDataProvider
from app.strategies import structure_ops
from app.strategies.rules import OPS, Condition, IndicatorCache, StrategyDefinition, describe, evaluate
from app.strategies.templates import PRESETS, PRESETS_BY_KEY, TEMPLATES, TEMPLATES_BY_KEY

NOW = 1_780_000_000


def demo(symbol="BTC/USDT", tf="1h", n=1500):
    p = DemoMarketDataProvider(clock=lambda: NOW)
    return p.get_candles(get_asset(symbol), tf, limit=n, now=NOW, include_partial=False)


def fp(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _struct(name, **params):
    return {"kind": "structure", "name": name, "params": params}


def _is(name, true=True, **params):
    return {"left": _struct(name, **params), "op": "is_true" if true else "is_false"}


# ------------------------------------------------------------------ v1 definitions are unchanged
# Fingerprints captured with the code BEFORE the v2 changes (commit db31bf4) — see the S6 report.
# trades/net_pnl/trades_fp/metrics_fp/validation_fp re-recorded after 690a5c8, which sizes backtest positions in USD
# via PaperBroker.qty_for_risk (exit fee at the stop price, entry fee in the margin cap): same trades, P/L within 0.06 %.
GOLDEN_V1 = {
    "BTC/USDT|1h|bb_mean_reversion": {
        "trades": 14,
        "net_pnl": -167.451757,
        "trades_fp": "ec832933d4668b42",
        "metrics_fp": "f3b29bfa908cc40c",
        "eval_fp": "955d2f66cd9596ca",
        "dump_fp": "7d4eec314732aaec",
    },  # noqa: E501
    "BTC/USDT|1h|breakout_volume": {
        "trades": 16,
        "net_pnl": -524.919855,
        "trades_fp": "0a949b74e086677c",
        "metrics_fp": "5c1ab7c90b0b3795",
        "eval_fp": "cea3732b33b7fa62",
        "dump_fp": "d50ddb73bdf927de",
    },  # noqa: E501
    "BTC/USDT|1h|ema_cross_trend": {
        "trades": 24,
        "net_pnl": -1298.465647,
        "trades_fp": "ed16f5b258ee48a3",
        "metrics_fp": "d0352e9766c259d6",
        "eval_fp": "d984298d6663bcdb",
        "dump_fp": "dfde249d13d6ac63",
        "validation_fp": "0e724f6b5f60f208",
    },  # noqa: E501
    "BTC/USDT|1h|macd_momentum": {
        "trades": 26,
        "net_pnl": -1179.955324,
        "trades_fp": "9ee6c7131f7d01ba",
        "metrics_fp": "7e4ac0ecc98d86dd",
        "eval_fp": "6da816b89f31d4e0",
        "dump_fp": "cd6c3e4037644e06",
        "validation_fp": "29927aba60aea6c2",
    },  # noqa: E501
    "BTC/USDT|1h|rsi_ema200_volume": {
        "trades": 0,
        "net_pnl": 0,
        "trades_fp": "4f53cda18c2baa0c",
        "metrics_fp": "a2065238966e82c8",
        "eval_fp": "07dc7599212608c8",
        "dump_fp": "b3695dc451b5ef0b",
    },  # noqa: E501
    "ETH/USDT|4h|bb_mean_reversion": {
        "trades": 7,
        "net_pnl": 1.014525,
        "trades_fp": "f763333791aedd02",
        "metrics_fp": "428f156279ae6ea6",
        "eval_fp": "db9fe7146cc699d2",
        "dump_fp": "7d4eec314732aaec",
    },  # noqa: E501
    "ETH/USDT|4h|breakout_volume": {
        "trades": 23,
        "net_pnl": 1782.281456,
        "trades_fp": "18243fc8bd47e525",
        "metrics_fp": "273824e559847ae9",
        "eval_fp": "5722d63d0fb1524f",
        "dump_fp": "d50ddb73bdf927de",
    },  # noqa: E501
    "ETH/USDT|4h|ema_cross_trend": {
        "trades": 4,
        "net_pnl": -335.009707,
        "trades_fp": "4303d6a1eb1274d9",
        "metrics_fp": "ed052971a6dde987",
        "eval_fp": "3dee8d2295b951dd",
        "dump_fp": "dfde249d13d6ac63",
    },  # noqa: E501
    "ETH/USDT|4h|macd_momentum": {
        "trades": 15,
        "net_pnl": -48.266621,
        "trades_fp": "fe44f17b58177bc6",
        "metrics_fp": "2822aba4098134d3",
        "eval_fp": "770002b912b8d125",
        "dump_fp": "cd6c3e4037644e06",
    },  # noqa: E501
    "ETH/USDT|4h|rsi_ema200_volume": {
        "trades": 0,
        "net_pnl": 0,
        "trades_fp": "4f53cda18c2baa0c",
        "metrics_fp": "a2065238966e82c8",
        "eval_fp": "f450a82f2ed004ee",
        "dump_fp": "b3695dc451b5ef0b",
    },  # noqa: E501
}
V1_METRIC_KEYS = (
    "total_trades", "winning_trades", "losing_trades", "win_rate", "net_pnl", "gross_profit", "gross_loss",
    "profit_factor", "average_r", "expectancy", "expectancy_r", "max_drawdown", "max_drawdown_pct", "fees_total",
    "max_consecutive_losses", "final_equity", "return_pct", "signals", "warmup_bars", "time_in_market_pct",
)  # fmt: skip
V1_VALIDATION_KEYS = (
    "headline", "robustness", "disclaimer", "sample_size", "regime_distribution", "results_by_regime", "costs",
    "stress_test", "sensitivity", "complexity", "warnings",
)  # fmt: skip
V1_SERIES = (("BTC/USDT", "1h", 1500), ("ETH/USDT", "4h", 1200))


@pytest.mark.parametrize(("symbol", "tf", "n"), V1_SERIES)
def test_v1_definitions_parse_and_evaluate_identically(symbol, tf, n):
    data = demo(symbol, tf, n)
    cache = IndicatorCache(data)
    for t in TEMPLATES[:5]:
        d = StrategyDefinition(**t["definition"])
        gold = GOLDEN_V1[f"{symbol}|{tf}|{t['key']}"]
        assert fp(d.model_dump()) == gold["dump_fp"], t["key"]
        evals = [evaluate(d, cache, i) for i in range(0, len(data), 7)]
        assert fp(evals) == gold["eval_fp"], t["key"]


@pytest.mark.parametrize(("symbol", "tf", "n"), V1_SERIES)
def test_v1_backtests_unchanged(symbol, tf, n):
    data = demo(symbol, tf, n)
    for t in TEMPLATES[:5]:
        d = StrategyDefinition(**t["definition"])
        gold = GOLDEN_V1[f"{symbol}|{tf}|{t['key']}"]
        r = run_backtest(data, get_asset(symbol), d, BacktestSettings(), tf)
        m = r["metrics"]
        assert len(r["trades"]) == gold["trades"], t["key"]
        assert round(m["net_pnl"], 6) == pytest.approx(gold["net_pnl"]), t["key"]
        assert fp(r["trades"]) == gold["trades_fp"], t["key"]
        assert fp({k: m.get(k) for k in V1_METRIC_KEYS}) == gold["metrics_fp"], t["key"]
        if "validation_fp" in gold:
            v = validate(data, get_asset(symbol), d, BacktestSettings(), tf, r)
            v1 = {k: v[k] for k in V1_VALIDATION_KEYS}
            v1["out_of_sample"] = {k: v["out_of_sample"][k] for k in ("in_sample", "out_of_sample", "split_ts")}
            assert fp(v1) == gold["validation_fp"], t["key"]


def test_template_order_is_stable():
    # code (user_service onboarding, tests) refers to the first five templates by position
    assert [t["key"] for t in TEMPLATES[:5]] == [
        "rsi_ema200_volume",
        "ema_cross_trend",
        "bb_mean_reversion",
        "breakout_volume",
        "macd_momentum",
    ]


# ------------------------------------------------------------------ structure operands
def test_structure_operand_validation_and_labels():
    c = Condition(**_is("higher_high"))
    assert c.label() == "Higher High"
    assert Condition(**_is("lower_low", true=False)).label() == "НЕ Lower Low"
    assert Condition(**_is("higher_low", left=5, right=2)).label() == "Higher Low (5/2)"
    with pytest.raises(ValidationError):
        Condition(**_is("magic_pattern"))
    with pytest.raises(ValidationError):
        Condition(**_is("hammer", left=3))  # candle patterns take no params
    with pytest.raises(ValidationError):
        Condition(**_is("higher_high", left=0))
    with pytest.raises(ValidationError):
        Condition(**_is("higher_high", left=2.5))
    with pytest.raises(ValidationError):
        Condition(**_is("higher_high", period=14))
    with pytest.raises(ValidationError):
        Condition(left={**_struct("higher_high"), "output": "upper"}, op="is_true")
    assert set(structure_ops.STRUCTURE_NAMES) == {
        "higher_high",
        "higher_low",
        "lower_high",
        "lower_low",
        "uptrend",
        "downtrend",
        "break_above_swing_high",
        "break_below_swing_low",
        "inside_bar",
        "bullish_engulfing",
        "bearish_engulfing",
        "hammer",
        "shooting_star",
    }


def test_boolean_operators_right_operand_optional():
    assert "is_true" in OPS and "is_false" in OPS
    c = Condition(**_is("uptrend"))
    # normalised: stored definitions always carry a `right` (placeholder value 0)
    assert c.right is not None and c.right.kind == "value" and c.right.value == 0
    dumped = c.model_dump()
    assert Condition(**dumped).model_dump() == dumped
    with pytest.raises(ValidationError):
        Condition(left={"kind": "price", "field": "close"}, op=">")  # comparison ops still need a right operand
    d = StrategyDefinition(entry_long={"conditions": [_is("higher_high"), _is("inside_bar", true=False)]})
    assert d.numeric_parameters() == 2  # stop + target only: no params, the placeholder right is not counted
    d2 = StrategyDefinition(entry_long={"conditions": [_is("higher_high", left=5, right=5)]})
    assert d2.numeric_parameters() == 4


def test_is_true_is_false_semantics():
    data = [Candle(i * 60, 10, 11, 9, 10, 1) for i in range(5)]
    cache = IndicatorCache(data)
    for value, t, f in ((1.0, True, False), (0.0, False, True), (-2.0, False, True), (0.5, True, False)):
        d = StrategyDefinition(
            entry_long={"conditions": [{"left": {"kind": "value", "value": value}, "op": "is_true"}]},
            entry_short={"conditions": [{"left": {"kind": "value", "value": value}, "op": "is_false"}]},
        )
        ev = evaluate(d, cache, 3)
        assert ev["entry_long"]["passed"] is t and ev["entry_short"]["passed"] is f
        assert ev["entry_long"]["conditions"][0]["right"] is None
    # unknown (warm-up) → neither true nor false
    d = StrategyDefinition(
        entry_long={"conditions": [_is("higher_high")]}, entry_short={"conditions": [_is("higher_high", true=False)]}
    )
    ev = evaluate(d, cache, 0)
    assert ev["entry_long"]["passed"] is False and ev["entry_short"]["passed"] is False


def _zigzag(highs_lows: list[tuple[float, float]]) -> list[Candle]:
    return [Candle(i * 3600, (h + lo) / 2, h, lo, (h + lo) / 2, 100) for i, (h, lo) in enumerate(highs_lows)]


def test_swing_flags_confirmed_with_delay():
    # pivot highs at 3 (h=10) and 9 (h=12 → HH); pivot lows at 6 (l=5) and 12 (l=6 → HL); left=right=2
    hl = [(8, 6), (9, 7), (9.5, 7.5), (10, 8), (9, 7), (8, 6), (7, 5), (8, 6), (10, 7), (12, 9), (11, 8), (9, 7),
          (8, 6), (9, 7), (10, 8), (11, 9), (14, 11), (12, 10), (11, 9)]  # fmt: skip
    candles = _zigzag(hl)
    swings = find_swings(candles, 2, 2)
    assert [(s.index, s.kind, s.label) for s in swings][:4] == [
        (3, "high", None),
        (6, "low", None),
        (9, "high", "HH"),
        (12, "low", "HL"),
    ]
    f = swing_state_series(candles, 2, 2)
    # HH is only known 2 bars after the pivot at bar 9
    assert f["higher_high"][10] is None and f["higher_high"][11] == 1.0
    assert f["lower_high"][11] == 0.0
    # HL confirmed at bar 14 → uptrend from 14 on (HH + HL), never before
    assert f["higher_low"][13] is None and f["higher_low"][14] == 1.0
    assert all(v != 1.0 for v in f["uptrend"][:14]) and f["uptrend"][14] == 1.0
    assert f["downtrend"][14] == 0.0
    # break above the last confirmed swing high (12 at bar 9): first close above it is bar 16 (close 12.5)
    closes = [c.close for c in candles]
    assert closes[15] < 12 < closes[16]
    assert f["break_above_swing_high"][16] == 1.0 and f["break_above_swing_high"][17] == 0.0


@pytest.mark.parametrize("name", structure_ops.STRUCTURE_NAMES)
def test_structure_operands_have_no_lookahead(name):
    data = demo("ETH/USDT", "1h", 900)
    full = IndicatorCache(data).structure(name, {})
    assert set(full) <= {None, 0.0, 1.0}
    for k in (120, 333, 500, 777):
        part = IndicatorCache(data[:k]).structure(name, {})
        assert part == full[:k], f"{name}: value changed when future bars were appended (k={k})"
    cond = _is(name)
    d = StrategyDefinition(entry_long={"conditions": [cond]})
    for k in (250, 600):
        assert evaluate(d, IndicatorCache(data[:k]), k - 1) == evaluate(d, IndicatorCache(data), k - 1)


def test_structure_flags_are_consistent():
    data = demo("BTC/USDT", "4h", 1200)
    c = IndicatorCache(data)
    hh, lh = c.structure("higher_high"), c.structure("lower_high")
    hl, ll = c.structure("higher_low"), c.structure("lower_low")
    up, down = c.structure("uptrend"), c.structure("downtrend")
    for i in range(len(data)):
        if hh[i] is not None:
            assert hh[i] + lh[i] == 1.0  # every labelled swing high is HH or LH
        if hl[i] is not None:
            assert hl[i] + ll[i] == 1.0
        if up[i] is not None:
            assert up[i] == (1.0 if hh[i] == 1.0 and hl[i] == 1.0 else 0.0)
            assert down[i] == (1.0 if lh[i] == 1.0 and ll[i] == 1.0 else 0.0)
    assert sum(1 for v in up if v) > 0 and sum(1 for v in down if v) > 0
    for name in ("bullish_engulfing", "hammer", "inside_bar", "break_above_swing_high"):
        assert sum(1 for v in c.structure(name) if v) > 0, name
    # bullish and bearish engulfing can never both be true on the same bar
    be, se = c.structure("bullish_engulfing"), c.structure("bearish_engulfing")
    assert not any(a == 1.0 and b == 1.0 for a, b in zip(be, se, strict=True))


def test_candle_patterns_on_crafted_bars():
    bars = [
        Candle(0, 10, 10.5, 8, 8.5, 1),  # bearish
        Candle(60, 8.3, 10.8, 8.2, 10.6, 1),  # bullish engulfing
        Candle(120, 10.5, 10.7, 9.0, 10.6, 1),  # hammer: long lower wick, tiny upper wick
        Candle(180, 10.2, 10.5, 9.5, 10.3, 1),  # inside bar of the hammer
    ]
    c = IndicatorCache(bars)
    assert c.structure("bullish_engulfing")[1] == 1.0
    assert c.structure("hammer")[2] == 1.0
    assert c.structure("inside_bar")[3] == 1.0 and c.structure("inside_bar")[1] == 0.0
    assert c.structure("inside_bar")[0] is None and c.structure("bullish_engulfing")[0] is None


def test_volume_vs_average_operand():
    data = [Candle(i * 60, 10, 10, 10, 10, 100) for i in range(25)] + [Candle(25 * 60, 10, 10, 10, 10, 500)]
    d = StrategyDefinition(entry_long={"conditions": [PRESETS_BY_KEY["volume_above_average"]["condition"]]})
    cache = IndicatorCache(data)
    assert evaluate(d, cache, 24)["entry_long"]["passed"] is False  # volume == average
    assert evaluate(d, cache, 25)["entry_long"]["passed"] is True
    assert evaluate(d, cache, 25)["entry_long"]["conditions"][0]["label"] == "Volume > VOLUME_SMA(20)"


def test_operand_type_alias_for_kind():
    cond = Condition(
        left={"type": "price", "field": "volume"},
        op=">",
        right={"type": "indicator", "name": "volume_sma", "params": {"period": 20}},
    )
    assert cond.left.kind == "price" and cond.right.kind == "indicator"
    assert "type" not in cond.model_dump()["left"]
    assert cond.model_dump() == Condition(**PRESETS_BY_KEY["volume_above_average"]["condition"]).model_dump()


def test_presets_are_valid_conditions():
    keys = {p["key"] for p in PRESETS}
    for required in (
        "price_above_ema200",
        "rsi_above_50",
        "higher_high",
        "volume_above_average",
        "ema20_cross_up_ema50",
    ):
        assert required in keys
    for p in PRESETS:
        assert p["group"] in ("trend", "momentum", "structure", "volume", "candle_pattern")
        assert p["side"] in ("long", "short", "both")
        Condition(**p["condition"])
    assert Condition(**PRESETS_BY_KEY["higher_high"]["condition"]).label() == "Higher High"


def test_trend_structure_template_matches_user_example():
    t = TEMPLATES_BY_KEY["trend_momentum_structure"]
    assert TEMPLATES[-1] is t
    d = StrategyDefinition(**t["definition"])
    labels = [c.label() for c in d.entry_long.conditions]
    assert labels == ["Close > EMA(200)", "RSI(14) > 50", "Higher High", "Volume > VOLUME_SMA(20)"]
    assert d.entry_long.logic == "all" and d.entry_short is None
    assert (d.stop.type, d.stop.value) == ("atr", 2) and (d.take_profit.type, d.take_profit.value) == ("r_multiple", 2)
    text = " ".join(describe(d))
    assert "Higher High" in text and "ATR(14) × 2" in text and "Risk × 2" in text
    data = demo(n=1500)
    res = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    assert res["trades"], "the user's example should produce trades on demo data"
    assert all(tr["side"] == "long" for tr in res["trades"])
    opens = {c.ts: c.open for c in data}
    assert all(tr["entry_ts"] in opens for tr in res["trades"])  # fills at the next bar's open


def test_describe_lists_regime_filter():
    d = StrategyDefinition(entry_long={"conditions": [_is("uptrend")]}, regime_filter=["TRENDING_UP"])
    assert describe(d)[-1] == "Режим филтър: само TRENDING_UP"


# ------------------------------------------------------------------ API
def test_meta_is_data_driven(client):
    r = client.get("/api/strategies/meta")
    assert r.status_code == 200
    m = r.json()
    for k in ("indicators", "operators", "price_fields", "templates"):  # v1 keys
        assert k in m
    assert {"is_true", "is_false"} <= set(m["operators"])
    assert {o["op"] for o in m["operator_info"]} == set(m["operators"])
    assert next(o for o in m["operator_info"] if o["op"] == "is_true")["needs_right"] is False
    names = {s["name"] for s in m["structures"]}
    assert names == set(structure_ops.STRUCTURE_NAMES)
    hh = next(s for s in m["structures"] if s["name"] == "higher_high")
    assert hh["group"] == "structure" and hh["params"] == {"left": 3, "right": 3}
    assert next(s for s in m["structures"] if s["name"] == "hammer")["params"] == {}
    assert {p["key"] for p in m["presets"]} >= {"higher_high", "volume_above_average", "price_above_ema200"}
    assert any(t["key"] == "trend_momentum_structure" for t in m["templates"])
    assert {k["label"] for k in m["operand_kinds"]} == {"Indicator", "Price", "Value", "Structure", "Candle pattern"}
    assert m["dsl_version"] == 2 and "TRENDING_UP" in m["regimes"]
    assert m["disclaimer"] == "This is a rule-based hypothetical setup, not a guarantee of future price movement."


def test_describe_endpoint(client):
    tpl = TEMPLATES_BY_KEY["trend_momentum_structure"]["definition"]
    r = client.post("/api/strategies/describe", json={"definition": tpl})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is True and body["conditions"] == 4
    assert any("Higher High" in line for line in body["summary"])
    bad = client.post("/api/strategies/describe", json={"definition": {"entry_long": {"conditions": [_is("nope")]}}})
    assert bad.status_code == 200 and bad.json()["valid"] is False and bad.json()["errors"]


def test_save_check_and_signal_with_structure(guest):
    definition = {
        "entry_long": {"logic": "all", "conditions": [_is("higher_high"), _is("inside_bar", true=False)]},
        "stop": {"type": "atr", "value": 2},
        "take_profit": {"type": "r_multiple", "value": 2},
        "regime_filter": ["TRENDING_UP", "RANGING"],
    }
    s = guest.post(
        "/api/strategies",
        json={"name": "HH structure", "symbol": "BTC/USDT", "timeframe": "1h", "definition": definition},
    )
    assert s.status_code == 200, s.text
    saved = s.json()
    assert saved["rules_count"] == 2
    assert saved["definition"]["entry_long"]["conditions"][0]["op"] == "is_true"
    assert saved["definition"]["entry_long"]["conditions"][0]["right"]["kind"] == "value"  # normalised
    sig = guest.get(f"/api/strategies/{saved['id']}/signal?symbol=BTC/USDT&timeframe=1h").json()
    assert sig["signal"] in ("LONG SETUP", "SHORT SETUP", "NO TRADE")
    conds = sig["evaluation"]["entry_long"]["conditions"]
    assert [c["label"] for c in conds] == ["Higher High", "НЕ Inside bar"]
    assert conds[0]["right"] is None and conds[0]["left"] in (0.0, 1.0)
    assert sig["regime"]["regime"] and sig["regime_filter"] == ["TRENDING_UP", "RANGING"]
    assert sig["regime_allowed"] in (True, False)
    chk = guest.post("/api/strategies/check", json={"definition": definition, "symbol": "ETH/USDT", "timeframe": "4h"})
    assert chk.status_code == 200 and chk.json()["evaluation"]["entry_long"]["active"] is True
    bad = guest.post("/api/strategies/check", json={"definition": {"entry_long": {"conditions": []}}})
    assert bad.status_code == 400
