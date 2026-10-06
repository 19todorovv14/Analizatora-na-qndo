"""S6 — backtest metrics v2, walk-forward windows, overfitting assessment, validation v2 and the backtest API."""

from __future__ import annotations

import time

import pytest

from app.backtesting.engine import BacktestSettings, run_backtest
from app.backtesting.metrics import (
    INFINITE_PF,
    drawdown_curve,
    drawdown_series,
    max_drawdown_duration,
    sharpe_like,
    streaks,
    trade_metrics,
)
from app.backtesting.validation import (
    PAST_PERFORMANCE,
    WALK_FORWARD_METHOD,
    overfitting_assessment,
    validate,
    walk_forward,
)
from app.market.catalog import get_asset
from app.market.demo import DemoMarketDataProvider
from app.strategies.rules import StrategyDefinition
from app.strategies.templates import TEMPLATES, TEMPLATES_BY_KEY

NOW = 1_780_000_000
DAY = 86400


def demo(symbol="BTC/USDT", tf="1h", n=1500):
    p = DemoMarketDataProvider(clock=lambda: NOW)
    return p.get_candles(get_asset(symbol), tf, limit=n, now=NOW, include_partial=False)


def _t(net, r, opened, closed, side="long"):
    return {"net_pnl": net, "r_multiple": r, "fees": 1.0, "opened_ts": opened, "closed_ts": closed, "side": side}


# ------------------------------------------------------------------ metrics on a crafted trade list
CRAFTED = [
    _t(100, 1.0, 0, DAY),
    _t(50, 0.5, DAY, 2 * DAY),
    _t(-40, -0.4, 2 * DAY, 3 * DAY, "short"),
    _t(-60, -0.6, 3 * DAY, 4 * DAY),
    _t(-30, -0.3, 4 * DAY, 5 * DAY),
    _t(200, 2.0, 5 * DAY, 6 * DAY, "short"),
    _t(10, 0.1, 6 * DAY, 7 * DAY),
    _t(0, 0.0, 7 * DAY, 8 * DAY),  # break-even counts as a loss (net <= 0), as in v1
]


def test_streaks_best_worst_and_r_stats():
    m = trade_metrics(CRAFTED, None, 1000.0)
    assert (m["longest_win_streak"], m["longest_loss_streak"]) == (2, 3)
    assert m["max_consecutive_losses"] == m["longest_loss_streak"]  # v1 key kept
    assert m["best_trade"] == {
        "pnl": 200,
        "r": 2.0,
        "entry_ts": 5 * DAY,
        "exit_ts": 6 * DAY,
        "side": "short",
        "exit_reason": None,
    }
    assert m["worst_trade"]["pnl"] == -60 and m["worst_trade"]["r"] == -0.6 and m["worst_trade"]["side"] == "long"
    assert m["avg_win_r"] == pytest.approx((1.0 + 0.5 + 2.0 + 0.1) / 4)
    assert m["avg_loss_r"] == pytest.approx((-0.4 - 0.6 - 0.3 + 0.0) / 4)
    assert m["avg_win_r"] == m["average_win_r"] and m["avg_loss_r"] == m["average_loss_r"]
    assert m["average_r"] == pytest.approx(sum(t["r_multiple"] for t in CRAFTED) / 8)
    assert m["expectancy"] == pytest.approx(230 / 8)
    assert m["trades_per_month"] == pytest.approx(8 / (8 * DAY / (30.44 * DAY)))
    assert m["exposure_pct"] is None  # only known per bar (backtest engine)
    # equity 1000 → 1100 → 1150 → 1110 → 1050 → 1020 → 1220 ...: peak 1150, trough 1020
    assert m["max_drawdown_pct"] == pytest.approx((1150 - 1020) / 1150 * 100)
    assert m["max_drawdown_duration_bars"] == 3


def test_metrics_on_empty_and_streak_helpers():
    m = trade_metrics([], None, 1000.0)
    assert m["best_trade"] is None and m["worst_trade"] is None
    assert (m["longest_win_streak"], m["longest_loss_streak"]) == (0, 0)
    assert m["trades_per_month"] is None
    assert streaks([1, 1, 1, -1, 2]) == (3, 1)
    assert streaks([-1, 0, -2, 5]) == (1, 3)


def test_drawdown_helpers():
    vals = [100, 110, 99, 104.5, 120, 90, 90, 125]
    dd = drawdown_series(vals)
    assert dd[0] == 0 and dd[1] == 0 and dd[2] == pytest.approx(-10.0) and dd[4] == 0
    assert min(dd) == pytest.approx(-25.0) and dd[-1] == 0
    curve = drawdown_curve([[i * 60, v] for i, v in enumerate(vals)])
    assert [p[0] for p in curve] == [i * 60 for i in range(len(vals))]
    assert curve[5][1] == -25.0
    assert all(p[1] <= 0 for p in curve)
    assert max_drawdown_duration(vals) == 2  # bars 5–6 below the 120 peak (bars 2–3 below 110 also 2)
    assert max_drawdown_duration([100, 90, 80, 70]) == 3  # never recovers → counts to the end
    assert max_drawdown_duration([]) == 0


def test_sharpe_like():
    ts = [i * 3600 for i in range(200)]
    flat = [100.0] * 200
    assert sharpe_like(flat, ts) is None  # no variance
    rising = [100 * (1.001**i) * (1 + (0.0005 if i % 2 else -0.0005)) for i in range(200)]
    assert sharpe_like(rising, ts) > 3
    assert sharpe_like([100, 101], [0, 60]) is None


# ------------------------------------------------------------------ engine v2 outputs
def test_engine_drawdown_curve_and_v2_metrics():
    data = demo(n=2000)
    d = StrategyDefinition(**TEMPLATES[1]["definition"])
    r = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    eq, dd = r["equity_curve"], r["drawdown_curve"]
    assert len(dd) == len(eq) <= 600
    assert [p[0] for p in dd] == [p[0] for p in eq]  # same downsampling → synced time axes
    m = r["metrics"]
    # the full-resolution drawdown reaches -max_drawdown_pct; downsampled points never go deeper
    assert min(p[1] for p in dd) >= -m["max_drawdown_pct"] - 1e-3  # curve values are rounded to 0.001
    assert m["max_drawdown_duration_bars"] > 0
    assert 0 < m["exposure_pct"] <= 100
    assert m["exposure_pct"] == pytest.approx(m["time_in_market_pct"], abs=5)
    period = data[-1].ts + 3600 - data[m["warmup_bars"]].ts
    assert m["trades_per_month"] == pytest.approx(m["total_trades"] / (period / (30.44 * DAY)))
    assert m["test_bars"] == len(data) - m["warmup_bars"]
    assert m["sharpe_like"] is not None
    for k in ("best_trade", "worst_trade", "longest_win_streak", "longest_loss_streak", "avg_win_r", "avg_loss_r"):
        assert k in m
    assert m["best_trade"]["pnl"] == max(t["net_pnl"] for t in r["trades"])
    assert m["worst_trade"]["pnl"] == min(t["net_pnl"] for t in r["trades"])


def test_engine_segments_partition_trades_into_windows():
    data = demo(n=2000)
    d = StrategyDefinition(**TEMPLATES_BY_KEY["trend_momentum_structure"]["definition"])
    spec = get_asset("BTC/USDT")
    plain = run_backtest(data, spec, d, BacktestSettings(), "1h")
    warm = plain["metrics"]["warmup_bars"]
    size = (len(data) - warm) // 4
    segs = [warm + size, warm + 2 * size, warm + 3 * size]
    res = run_backtest(data, spec, d, BacktestSettings(), "1h", segments=segs)
    windows = res["windows"]
    assert [w["index"] for w in windows] == [1, 2, 3, 4]
    assert sum(w["trades"] for w in windows) == len(res["trades"])
    assert sum(w["bars"] for w in windows) == len(data) - warm
    for w in windows:
        assert w["start_ts"] < w["end_ts"]
        inside = [t for t in res["trades"] if w["start_ts"] <= t["entry_ts"] < w["end_ts"]]
        assert len(inside) == w["trades"]
        assert all(t["exit_ts"] <= w["end_ts"] for t in inside)  # nothing straddles a window end
        assert w["profitable"] == (w["trades"] > 0 and w["net_pnl"] > 0)
    for a, b in zip(windows, windows[1:], strict=False):
        assert a["end_ts"] == b["start_ts"] and a["end_equity"] == b["start_equity"]
    ends = {w["end_ts"] for w in windows[:-1]}
    assert all(t["exit_ts"] in ends for t in res["trades"] if t["exit_reason"] == "end_of_window")
    assert all(t["exit_reason"] != "end_of_window" for t in plain["trades"])
    assert "windows" not in plain


def test_engine_max_open_positions_above_one_uses_free_margin():
    always = {
        "entry_long": {"conditions": [{"left": {"kind": "price", "field": "close"}, "op": ">", "right": {"kind": "value", "value": 0}}]},
        "stop": {"type": "atr", "value": 3},
        "take_profit": {"type": "r_multiple", "value": 3},
    }  # fmt: skip
    data = demo(n=800)
    d = StrategyDefinition(**always)
    res = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(max_open_positions=3), "1h")
    events = sorted([(t["entry_ts"], 1) for t in res["trades"]] + [(t["exit_ts"], -1) for t in res["trades"]])
    cur = peak = 0
    for _, delta in events:
        cur += delta
        peak = max(peak, cur)
    assert peak == 3
    assert res["metrics"]["signals"] == len(res["trades"])  # every signal became a trade (no margin rejections)


# ------------------------------------------------------------------ overfitting assessment
def _defn(n_conditions=1, periods=True):
    conds = []
    for i in range(n_conditions):
        ind = (
            {"kind": "indicator", "name": "rsi", "params": {"period": 10 + i}}
            if periods
            else {"kind": "price", "field": "close"}
        )
        conds.append({"left": ind, "op": ">", "right": {"kind": "value", "value": 40 + i}})
    return StrategyDefinition(entry_long={"conditions": conds})


def _m(**kw):
    base = {"total_trades": 150, "net_pnl": 500.0, "profit_factor": 1.4, "win_rate": 48.0, "sharpe_like": 1.1,
            "expectancy_r": 0.15}  # fmt: skip
    return {**base, **kw}


def _sens(signs, exp=0.15):
    return [{"variant": f"v{i}", "net_pnl": 100.0 * s, "expectancy_r": exp * s} for i, s in enumerate(signs)]


def test_overfitting_low_for_simple_robust_result():
    o = overfitting_assessment(_defn(1), _m(), (0.2, 0.15), _sens([1] * 8), {"verdict": "consistent"})
    assert o["risk"] == "LOW" and o["score"] < 30
    assert o["reasons"] and o["disclaimer"] == PAST_PERFORMANCE
    assert o["inputs"]["parameters"] == 4 and o["inputs"]["conditions"] == 1


def test_overfitting_high_on_tiny_sample():
    o = overfitting_assessment(_defn(1), _m(total_trades=12), (0.2, 0.15), _sens([1] * 8))
    assert o["risk"] == "HIGH" and o["score"] >= 60
    assert any(f["key"] == "sample_size" for f in o["factors"])
    assert any("12 сделки" in r for r in o["reasons"])


def test_overfitting_high_with_many_params_and_extremes():
    d = _defn(8)  # 8 conditions × (period + threshold) + stop/target = 18 params
    o = overfitting_assessment(
        d,
        _m(total_trades=120, profit_factor=INFINITE_PF, win_rate=92.0, sharpe_like=4.2),
        (0.8, -0.1),
        _sens([1, -1, -1, 1, -1, 1, -1, 1], exp=0.9),
        {"verdict": "inconsistent"},
    )
    keys = {f["key"] for f in o["factors"]}
    assert {"parameters", "trades_per_parameter", "extreme_profit_factor", "extreme_win_rate", "extreme_sharpe"} <= keys
    assert {"out_of_sample", "sensitivity", "walk_forward"} <= keys
    assert o["risk"] == "HIGH" and o["score"] == 100
    assert any("∞" in r for r in o["reasons"])


def test_overfitting_more_params_means_higher_score():
    scores = [
        overfitting_assessment(_defn(n), _m(total_trades=400), (0.2, 0.18), _sens([1] * 8))["score"] for n in (1, 4, 7)
    ]
    assert scores[0] < scores[1] < scores[2]


# ------------------------------------------------------------------ walk-forward + validation v2
def test_walk_forward_windows_and_verdict():
    data = demo(n=2000)
    d = StrategyDefinition(**TEMPLATES[3]["definition"])
    wf = walk_forward(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    assert wf["method"] == WALK_FORWARD_METHOD == "walk-forward evaluation of fixed rules"
    assert wf["available"] is True and wf["k"] == 4 and len(wf["windows"]) == 4
    assert wf["verdict"] in ("consistent", "inconsistent", "insufficient")
    assert wf["profitable_windows"] == sum(1 for w in wf["windows"] if w["profitable"])
    assert wf["profitable_fraction"] == pytest.approx(wf["profitable_windows"] / 4)
    assert wf["disclaimer"] == PAST_PERFORMANCE and wf["text"]
    starts = [w["start_ts"] for w in wf["windows"]]
    assert starts == sorted(starts)


def test_walk_forward_fewer_windows_for_short_periods():
    data = demo(n=300)  # warm-up 75 → 225 test bars → 4 windows of 56
    d = StrategyDefinition(**TEMPLATES[3]["definition"])
    wf = walk_forward(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    assert wf["k"] == 4
    wf3 = walk_forward(demo(n=220), get_asset("BTC/USDT"), d, BacktestSettings(), "1h")  # 165 test bars → 3
    assert wf3["k"] == 3
    short = walk_forward(demo(n=120), get_asset("BTC/USDT"), d, BacktestSettings(), "1h")  # 90 test bars
    assert short["available"] is False and short["verdict"] == "insufficient" and short["windows"] == []


def test_validation_v2_structure():
    data = demo(n=2000)
    d = StrategyDefinition(**TEMPLATES_BY_KEY["trend_momentum_structure"]["definition"])
    s = BacktestSettings()
    res = run_backtest(data, get_asset("BTC/USDT"), d, s, "1h")
    v = validate(data, get_asset("BTC/USDT"), d, s, "1h", res)
    assert v["disclaimer"] == PAST_PERFORMANCE
    of = v["overfitting"]
    assert of["risk"] in ("LOW", "MEDIUM", "HIGH") and 0 <= of["score"] <= 100 and of["reasons"]
    assert v["walk_forward"]["k"] == 4
    oos = v["out_of_sample"]
    assert {"in_sample", "out_of_sample", "split_ts", "comparison", "degradation"} <= set(oos)
    rows = {r["key"]: r for r in oos["comparison"]}
    assert rows["total_trades"]["in_sample"] == oos["in_sample"]["total_trades"]
    assert rows["expectancy_r"]["out_of_sample"] == oos["out_of_sample"]["expectancy_r"]
    assert oos["degradation"]["verdict"] in ("reversed", "much_weaker", "weaker", "similar_or_better", "n/a")
    assert oos["in_sample_period"]["end_ts"] < oos["out_of_sample_period"]["start_ts"]
    # the structure conditions are boolean → no threshold variants for them; stop/target variants remain
    assert all("условие 3" not in s["variant"] for s in v["sensitivity"])


def test_regime_filter_is_applied_in_validation_runs():
    d = StrategyDefinition(
        **{
            **TEMPLATES[3]["definition"],
            "regime_filter": ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY"],
        }
    )
    data = demo(n=2000)
    res = run_backtest(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h")
    assert res["metrics"]["total_trades"] > 0
    v = validate(data, get_asset("BTC/USDT"), d, BacktestSettings(), "1h", res)
    # before v2 the stress / sensitivity / OOS runs skipped regimes and therefore never traded with a filter
    assert v["stress_test"]["total_trades"] > 0
    assert sum(w["trades"] for w in v["walk_forward"]["windows"]) > 0


# ------------------------------------------------------------------ API
def test_backtest_api_v2_fields(guest):
    strategies = guest.get("/api/strategies").json()["strategies"]
    tpl = next(s for s in strategies if s["template_key"] == "trend_momentum_structure")
    assert tpl["is_template"] and tpl["name"].startswith("Trend + momentum + structure")
    assert all(s["template_key"] is None for s in strategies if not s["is_template"])
    now = int(time.time())
    bt = guest.post(
        "/api/backtests",
        json={
            "strategy_id": tpl["id"],
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "start_ts": now - 90 * DAY,
            "end_ts": now,
            "max_open_positions": 2,
        },
    )
    assert bt.status_code == 200, bt.text
    assert bt.json()["settings"]["max_open_positions"] == 2
    detail = guest.get(f"/api/backtests/{bt.json()['id']}").json()
    assert detail["status"] == "done", detail.get("error")
    assert len(detail["drawdown_curve"]) == len(detail["equity_curve"])
    assert [p[0] for p in detail["drawdown_curve"]] == [p[0] for p in detail["equity_curve"]]
    assert "drawdown_curve" not in detail["metrics"]
    for k in (
        "max_drawdown_pct",
        "max_drawdown_duration_bars",
        "best_trade",
        "worst_trade",
        "longest_win_streak",
        "longest_loss_streak",
        "average_r",
        "expectancy",
        "avg_win_r",
        "avg_loss_r",
        "exposure_pct",
        "trades_per_month",
    ):
        assert k in detail["metrics"], k
    v = detail["validation"]
    assert v["disclaimer"] == PAST_PERFORMANCE
    assert v["overfitting"]["risk"] in ("LOW", "MEDIUM", "HIGH")
    assert v["walk_forward"]["method"] == WALK_FORWARD_METHOD
    listed = guest.get("/api/backtests").json()["backtests"]
    assert listed and "drawdown_curve" not in listed[0]["metrics"]
    bad = guest.post(
        "/api/backtests",
        json={"strategy_id": tpl["id"], "symbol": "BTC/USDT", "timeframe": "1h", "start_ts": now - DAY, "end_ts": now,
              "max_open_positions": 0},
    )  # fmt: skip
    assert bad.status_code == 422
