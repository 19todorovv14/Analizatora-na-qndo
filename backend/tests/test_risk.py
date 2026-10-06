import pytest

from app.market.catalog import get_asset
from app.risk.engine import (
    UNUSUALLY_LARGE_MESSAGE,
    RiskRules,
    evaluate_trade,
    max_drawdown,
    position_size,
    risk_of_ruin_table,
    trade_plan,
)


def test_position_size_formula():
    r = position_size(balance=10_000, risk_pct=1, entry=100, stop=98)
    assert r["risk_amount"] == pytest.approx(100)
    assert r["qty"] == pytest.approx(50)
    assert r["potential_loss"] == pytest.approx(100)
    assert r["stop_distance_pct"] == pytest.approx(2)


def test_position_size_short_and_fees():
    no_fee = position_size(balance=10_000, risk_pct=1, entry=100, stop=102)
    with_fee = position_size(balance=10_000, risk_pct=1, entry=100, stop=102, fee_rate=0.001)
    assert with_fee["qty"] < no_fee["qty"]
    assert with_fee["potential_loss"] == pytest.approx(100, rel=1e-6)


def test_position_size_respects_step_and_margin():
    btc = get_asset("BTC/USDT")
    r = position_size(balance=1_000, risk_pct=5, entry=100_000, stop=99_990, spec=btc, leverage=2)
    # raw size would be 5 BTC; margin allows ~0.0196 BTC
    assert r["qty"] <= 1_000 * 2 / 100_000
    assert r["notes"]
    assert round(r["qty"] / btc.qty_step, 6) == int(round(r["qty"] / btc.qty_step))


def test_position_size_validation():
    with pytest.raises(ValueError):
        position_size(balance=1000, risk_pct=1, entry=100, stop=100)
    with pytest.raises(ValueError):
        position_size(balance=1000, risk_pct=0, entry=100, stop=99)


def test_trade_plan_reward_risk():
    p = trade_plan(side="buy", entry=100, stop=95, take_profit=115, qty=10, balance=10_000)
    assert p["reward_risk"] == pytest.approx(3)
    assert p["potential_loss"] == pytest.approx(50)
    assert p["potential_profit"] == pytest.approx(150)
    assert p["risk_pct"] == pytest.approx(0.5)
    s = trade_plan(side="sell", entry=100, stop=104, take_profit=92, qty=5, balance=10_000)
    assert s["potential_loss"] == pytest.approx(20)
    assert s["potential_profit"] == pytest.approx(40)


def _eval(plan, has_stop=True, **kw):
    base = dict(
        rules=RiskRules(),
        equity=10_000,
        plan=plan,
        has_stop=has_stop,
        open_positions=0,
        exposure=0,
        new_notional=1_000,
        day_pnl=0,
    )
    base.update(kw)
    return {f.kind: f for f in evaluate_trade(**base)}


def test_unusually_large_risk_warning_text():
    plan = trade_plan(side="buy", entry=100, stop=90, take_profit=130, qty=80, balance=10_000)  # 8% risk
    f = _eval(plan)
    assert "oversized" in f and f["oversized"].severity == "high"
    assert UNUSUALLY_LARGE_MESSAGE in f["oversized"].message


def test_rule_findings():
    plan = trade_plan(side="buy", entry=100, stop=98, take_profit=101, qty=100, balance=10_000)  # 2% risk, rr 0.5
    f = _eval(plan, has_stop=True, open_positions=3, exposure=29_000, new_notional=10_000, day_pnl=-400)
    assert f["oversized"].severity == "warn"
    assert "poor_rr" in f and "max_positions" in f and "exposure" in f and "daily_loss" in f
    f2 = _eval(trade_plan(side="buy", entry=100, stop=None, take_profit=None, qty=1, balance=10_000), has_stop=False)
    assert f2["no_stop"].message == "You entered without a defined invalidation point."


def test_rules_roundtrip_ignores_unknown():
    r = RiskRules.from_dict({"max_risk_per_trade_pct": 0.5, "evil": 1})
    assert r.max_risk_per_trade_pct == 0.5
    assert "evil" not in r.to_dict()


def test_max_drawdown():
    abs_dd, pct = max_drawdown([100, 120, 90, 130, 117])
    assert abs_dd == pytest.approx(30)
    assert pct == pytest.approx(25)
    assert max_drawdown([]) == (0.0, 0.0)


def test_risk_of_ruin_table():
    t = {row["losses"]: row for row in risk_of_ruin_table(10)}
    assert t[5]["remaining_pct"] == pytest.approx(59.049)
    assert t[5]["needed_gain_to_recover_pct"] == pytest.approx(100 / 0.59049 - 100)


def test_metrics_are_json_safe_without_losses():
    import json

    from app.backtesting.metrics import INFINITE_PF, trade_metrics

    m = trade_metrics([{"net_pnl": 10.0, "fees": 1.0, "r_multiple": 1.0, "opened_ts": 0, "closed_ts": 60}], None, 1000)
    assert m["profit_factor"] == INFINITE_PF
    json.dumps(m, allow_nan=False)
