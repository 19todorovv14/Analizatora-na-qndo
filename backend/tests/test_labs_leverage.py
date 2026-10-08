"""S3b — Leverage Lab maths (app.risk.leverage): margin, cross-margin liquidation, isolated comparison, risk level,
scenarios, stop/target plan, curves — and consistency with the paper broker (same margin / stop-out model)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.market.catalog import SPECS
from app.paper_engine.broker import DEFAULT_DAILY_VOL, PaperBroker
from app.paper_engine.models import AccountState, ExecutionConfig
from app.risk import leverage as L

NOW = 1_780_000_000
SYM = "EUR/USD"  # USD-quoted: no FX conversion
SPECS_100X = {**SPECS, SYM: replace(SPECS[SYM], max_leverage=100)}  # the lab goes up to 100x


def broker(*, spread=False, fees=True, cash=10_000.0) -> PaperBroker:
    cfg = ExecutionConfig(
        fees_enabled=fees,
        spread_enabled=spread,
        slippage_enabled=False,
        latency_enabled=False,
        partial_fills_enabled=False,
    )
    b = PaperBroker(AccountState(cash=cash, leverage=1.0), SPECS_100X, cfg, seed=7)
    b.set_mark(SYM, 1.10, NOW)
    return b


# ------------------------------------------------------------------------------------------- basic maths
def test_maintenance_ratio_is_the_paper_brokers_stop_out_level():
    assert L.MAINTENANCE_RATIO == ExecutionConfig().stop_out_level == 0.5


@pytest.mark.parametrize("lev", L.LEVERAGE_SET)
def test_margin_is_notional_over_leverage(lev):
    r = L.simulate(leverage=lev, position_notional=2_000, entry_price=50)
    assert r["required_margin"] == pytest.approx(2_000 / lev)
    assert r["units"] == pytest.approx(40)
    assert r["maintenance_margin"] == pytest.approx(0.5 * 2_000 / lev)
    assert r["free_margin"] == pytest.approx(10_000 - 2_000 / lev)
    assert r["margin_level_pct"] == pytest.approx(10_000 / (2_000 / lev) * 100)
    assert r["effective_leverage"] == pytest.approx(0.2)
    assert r["basis"] == "notional" and r["margin_mode"] == "cross" and r["can_open"] is True


def test_default_is_the_users_example_2000_on_a_10000_virtual_account():
    r = L.simulate(leverage=5)
    assert r["equity"] == 10_000 and r["position_notional"] == 2_000 and r["required_margin"] == 400
    assert r["virtual_notice"] and "виртуална" in r["virtual_notice"]


def test_margin_basis_gives_notional_margin_times_leverage():
    r = L.simulate(leverage=20, margin=2_000)
    assert r["basis"] == "margin"
    assert r["position_notional"] == pytest.approx(40_000)
    assert r["required_margin"] == pytest.approx(2_000)
    assert r["effective_leverage"] == pytest.approx(4)


def test_100x_on_a_2000_position():
    long = L.simulate(leverage=100, position_notional=2_000, entry_price=100, side="long")
    assert long["required_margin"] == pytest.approx(20)
    assert long["maintenance_margin"] == pytest.approx(10)
    assert long["isolated_liquidation_distance_pct"] == pytest.approx(0.5)
    assert long["isolated_liquidation_price"] == pytest.approx(99.5)
    # cross margin: the whole $10,000 stands behind a $2,000 position → even price 0 does not stop it out
    assert long["liquidation_price"] is None and long["liquidation_reachable"] is False
    assert long["risk_level"] == "low" and long["isolated_risk_level"] == "extreme"
    short = L.simulate(leverage=100, position_notional=2_000, entry_price=100, side="short")
    # 100 + (10,000 − 10) / 20 units
    assert short["liquidation_price"] == pytest.approx(599.5)
    assert short["liquidation_distance_pct"] == pytest.approx(499.5)
    assert short["liquidation_move_pct"] == pytest.approx(499.5)


def test_same_margin_liquidation_distance_shrinks_with_leverage():
    dists = {}
    for lev in (5, 10, 20, 50, 100):
        r = L.simulate(leverage=lev, margin=2_000, entry_price=100)
        # slack = 10,000 − 0.5 × 2,000 = 9,000; units = 20 × L
        assert r["liquidation_price"] == pytest.approx(100 - 9_000 / (20 * lev))
        dists[lev] = r["liquidation_distance_pct"]
    assert dists == pytest.approx({5: 90.0, 10: 45.0, 20: 22.5, 50: 9.0, 100: 4.5})
    assert list(dists.values()) == sorted(dists.values(), reverse=True)
    iso = [L.isolated_liquidation_distance_pct(lev) for lev in L.LEVERAGE_SET]
    assert iso == pytest.approx([50, 25, 10, 5, 2.5, 1, 0.5])


def test_same_position_size_leverage_does_not_change_pnl():
    pnls = {
        lev: L.simulate(leverage=lev, position_notional=2_000, price_move_pct=-5)["pnl_at_move"]
        for lev in L.LEVERAGE_SET
    }
    assert list(pnls.values()) == pytest.approx([-100] * len(L.LEVERAGE_SET))


def test_small_move_has_a_large_effect_on_equity_with_more_leverage():
    out = {lev: L.simulate(leverage=lev, margin=2_000, price_move_pct=-5) for lev in (1, 5, 20)}
    assert [out[k]["pnl_at_move"] for k in (1, 5, 20)] == pytest.approx([-100, -500, -2_000])
    assert [out[k]["pnl_pct_of_equity"] for k in (1, 5, 20)] == pytest.approx([-1, -5, -20])
    assert out[20]["pnl_pct_of_margin"] == pytest.approx(-100)


def test_a_move_past_the_liquidation_price_is_stopped_out_there():
    r = L.simulate(leverage=20, margin=2_000, entry_price=100, price_move_pct=-30)
    assert r["liquidation_price"] == pytest.approx(77.5)
    assert r["liquidated_at_move"] is True and r["exit_price"] == pytest.approx(77.5)
    # 400 units × −22.5 = −9,000 → the account keeps exactly the maintenance margin
    assert r["pnl_at_move"] == pytest.approx(-9_000)
    assert r["equity_after"] == pytest.approx(1_000) == pytest.approx(r["maintenance_margin"])
    assert r["margin_level_at_move_pct"] is None
    assert any("ликвидирана" in n for n in r["notes"])
    before = L.simulate(leverage=20, margin=2_000, entry_price=100, price_move_pct=-22)
    assert before["liquidated_at_move"] is False
    assert before["margin_level_at_move_pct"] == pytest.approx((10_000 - 8_800) / 2_000 * 100)


def test_fees_reduce_the_buffer_and_the_pnl():
    r = L.simulate(leverage=10, margin=1_000, entry_price=100, fee_rate=0.001, price_move_pct=2)
    assert r["entry_fee"] == pytest.approx(10)
    assert r["free_margin"] == pytest.approx(10_000 - 10 - 1_000)
    # P/L = 100 units × 2 − 10 entry fee − 100 × 102 × 0.001 exit fee
    assert r["pnl_at_move"] == pytest.approx(200 - 10 - 10.2)
    assert r["liquidation_price"] == pytest.approx(100 - (10_000 - 10 - 500) / 100)
    assert r["round_trip_cost"] == pytest.approx(20)


def test_cannot_open_when_margin_and_fee_exceed_the_account():
    r = L.simulate(leverage=1, position_notional=20_000)
    assert r["can_open"] is False and "margin" in r["cannot_open_reason"]
    assert "не може да бъде отворена" in r["warning"]


def test_short_side_mirrors_long():
    r = L.simulate(leverage=10, margin=1_000, entry_price=100, side="short", price_move_pct=5)
    assert r["side"] == "short"
    assert r["pnl_at_move"] == pytest.approx(-500)
    assert r["liquidation_price"] == pytest.approx(100 + 9_500 / 100)
    assert L.simulate(leverage=10, margin=1_000, side="sell")["side"] == "short"


@pytest.mark.parametrize(
    ("distance", "vol", "level"),
    [
        (None, 2, "low"),
        (1.5, 2, "extreme"),
        (2, 2, "high"),
        (5.9, 2, "high"),
        (6, 2, "elevated"),
        (16, 2, "low"),
        (15.9, 2, "elevated"),
    ],
)
def test_risk_level_by_liquidation_distance_in_daily_moves(distance, vol, level):
    assert L.risk_level(distance, vol) == level


def test_risk_level_uses_the_assets_daily_volatility_or_the_brokers_default():
    r = L.simulate(leverage=100, margin=2_000, entry_price=100)  # liquidation 4.5 % away
    assert r["daily_vol_source"] == "default" and r["daily_vol_pct"] == pytest.approx(DEFAULT_DAILY_VOL * 100)
    assert r["risk_level"] == "high"  # 2.25 typical days
    calm = L.simulate(leverage=100, margin=2_000, entry_price=100, daily_vol_pct=0.5)
    assert calm["risk_level"] == "low" and calm["liquidation_distance_daily_moves"] == pytest.approx(9.0)
    wild = L.simulate(leverage=100, margin=2_000, entry_price=100, daily_vol_pct=6)
    assert wild["risk_level"] == "extreme" and "по-малко от едно типично дневно движение" in wild["warning"]


def test_warning_always_has_the_required_sentence_and_never_recommends_a_value():
    for lev in L.LEVERAGE_SET:
        for kw in ({"position_notional": 2_000}, {"margin": 2_000}):
            r = L.simulate(leverage=lev, price_move_pct=-3, **kw)
            assert r["warning"].startswith(L.LEVERAGE_WARNING)
            text = " ".join([r["warning"], *r["notes"]]).lower()
            for banned in ("препоръч", "recommend", "best leverage", "най-добър leverage", "безопас"):
                assert banned not in text


@pytest.mark.parametrize(
    "kwargs",
    [
        {"leverage": 0.5},
        {"leverage": 101},
        {"leverage": 5, "position_notional": 1_000, "margin": 100},
        {"leverage": 5, "side": "sideways"},
        {"leverage": 5, "price_move_pct": -100},
        {"leverage": 5, "equity": 0},
        {"leverage": 5, "spread_bps": 5_000},
        {"leverage": 5, "risk_pct": 1},  # risk sizing needs a stop
        {"leverage": 5, "stop_price": 101},  # a long's stop must be below the entry
        {"leverage": 5, "side": "short", "target_price": 101},
        {"leverage": 5, "scenario_moves": [-150]},
    ],
)
def test_invalid_inputs_raise(kwargs):
    with pytest.raises(L.LeverageInputError):
        L.simulate(**kwargs)


# ---------------------------------------------------------------------------- scenarios, plan, risk sizing
def test_scenario_table_for_plus_minus_1_2_5_10_percent():
    r = L.simulate(leverage=5, position_notional=10_000, entry_price=100)
    assert [s["move_pct"] for s in r["scenarios"]] == [-10, -5, -2, -1, 1, 2, 5, 10]
    by_move = {s["move_pct"]: s for s in r["scenarios"]}
    assert by_move[-10]["pnl"] == pytest.approx(-1_000) and by_move[10]["pnl"] == pytest.approx(1_000)
    assert by_move[2]["price"] == pytest.approx(102) and by_move[-1]["equity_after"] == pytest.approx(9_900)
    assert by_move[-5]["pnl_pct_of_margin"] == pytest.approx(-500 / 2_000 * 100)
    custom = L.simulate(leverage=50, margin=2_000, scenario_moves=[-10, 3])  # liquidation at −9 %
    assert [(s["move_pct"], s["liquidated"]) for s in custom["scenarios"]] == [(-10, True), (3, False)]


def test_plan_pnl_at_stop_and_target_matches_the_brokers_risk_per_unit():
    b = broker(fees=True)
    entry, stop, target = 1.10, 1.09, 1.13
    r = L.simulate(
        leverage=10,
        position_notional=11_000,
        entry_price=entry,
        stop_price=stop,
        target_price=target,
        fee_rate=SPECS[SYM].taker_fee,
    )
    plan = r["plan"]
    per_unit = b.risk_per_unit(SYM, side="buy", entry=entry, stop=stop)
    assert plan["pnl_at_stop"] == pytest.approx(-per_unit * 10_000)
    assert plan["risk_amount"] == pytest.approx(per_unit * 10_000)
    assert plan["risk_pct_of_equity"] == pytest.approx(per_unit * 10_000 / 10_000 * 100)
    assert plan["reward_risk"] == pytest.approx(3.0)
    fee = SPECS[SYM].taker_fee
    assert plan["pnl_at_target"] == pytest.approx(10_000 * 0.03 - 11_000 * fee - 10_000 * target * fee)
    assert plan["reward_risk_net"] == pytest.approx(plan["pnl_at_target"] / plan["risk_amount"])
    assert plan["liquidation_before_stop"] is False


def test_risk_sizing_matches_the_brokers_qty_for_risk():
    b = broker(fees=True)
    r = L.simulate(leverage=20, risk_pct=1, entry_price=1.10, stop_price=1.095, fee_rate=SPECS[SYM].taker_fee)
    assert r["basis"] == "risk" and r["risk_pct"] == 1
    qty = b.qty_for_risk(SYM, side="buy", entry=1.10, stop=1.095, risk_amount=100, leverage=20)
    assert qty == pytest.approx(r["units"], abs=SPECS[SYM].qty_step)  # broker rounds down to its qty step
    assert r["plan"]["risk_amount"] == pytest.approx(100)
    assert r["plan"]["risk_pct_of_equity"] == pytest.approx(1)
    # leverage does not change a risk-based size, only the margin it blocks
    r5 = L.simulate(leverage=5, risk_pct=1, entry_price=1.10, stop_price=1.095, fee_rate=SPECS[SYM].taker_fee)
    assert r5["units"] == pytest.approx(r["units"]) and r5["required_margin"] == pytest.approx(4 * r["required_margin"])


def test_stop_beyond_the_liquidation_price_is_flagged():
    r = L.simulate(leverage=100, margin=2_000, entry_price=100, stop_price=90)  # liquidation at 95.5
    plan = r["plan"]
    assert plan["liquidation_before_stop"] is True
    assert plan["pnl_at_stop"] == pytest.approx(-9_000)  # the stop-out at 95.5 comes first: 2,000 units × −4.5
    assert "ликвидацията ще дойде преди него" in r["warning"]


# ---------------------------------------------------------------------------------------------- curves
def test_curves_cover_minus_20_to_plus_20_for_every_leverage_with_liquidation_points():
    r = L.simulate_with_curves(leverage=5, margin=2_000)
    fam = r["curves"]
    assert fam["basis"] == "margin" and fam["margin"] == pytest.approx(2_000)
    assert fam["moves_pct"][0] == -20 and fam["moves_pct"][-1] == 20 and len(fam["moves_pct"]) == 41
    assert [s["leverage"] for s in fam["series"]] == [1, 2, 5, 10, 20, 50, 100]
    s50 = next(s for s in fam["series"] if s["leverage"] == 50)
    assert s50["position_notional"] == pytest.approx(100_000)
    assert s50["liquidation_move_pct"] == pytest.approx(-9)
    marked = [p for p in s50["points"] if p["at_liquidation"]]
    assert len(marked) == 1 and marked[0]["move_pct"] == pytest.approx(-9)
    assert all(p["liquidated"] for p in s50["points"] if p["move_pct"] <= -9)
    assert min(p["equity"] for p in s50["points"]) == pytest.approx(1_000)  # stop-out keeps the maintenance margin
    s100 = next(s for s in fam["series"] if s["leverage"] == 100)
    assert len(s100["points"]) == 42  # the −4.5 % liquidation point is inserted
    same = r["curves_same_notional"]
    assert same["basis"] == "notional" and same["position_notional"] == pytest.approx(10_000)
    eq_at_minus_5 = {
        s["leverage"]: next(p["equity"] for p in s["points"] if p["move_pct"] == -5) for s in same["series"]
    }
    assert list(eq_at_minus_5.values()) == pytest.approx([9_500] * len(L.LEVERAGE_SET))
    assert L.simulate_with_curves(leverage=5, include_curves=False)["curves"] is None


def test_guided_scenario_2000_at_1x_5x_20x():
    sc = L.scenario(stake=2_000, move_pct=-5)
    assert [s["leverage"] for s in sc["steps"]] == [1, 5, 20]
    assert [s["position_notional"] for s in sc["steps"]] == pytest.approx([2_000, 10_000, 40_000])
    assert [s["pnl_pct_of_equity"] for s in sc["steps"]] == pytest.approx([-1, -5, -20])
    assert "Целият margin е изгубен" in sc["steps"][2]["text"]
    assert sc["same_notional"]["pnl"] == pytest.approx(-100)
    assert L.LEVERAGE_WARNING in sc["takeaways"]


# ------------------------------------------------------------------ consistency with the paper broker
@pytest.mark.parametrize("lev", [2, 5, 10, 20, 50, 100])
@pytest.mark.parametrize("side", ["buy", "sell"])
def test_liquidation_price_equals_the_brokers_for_a_single_position(lev, side):
    b = broker(fees=True)
    qty = round(0.9 * 10_000 * lev / 1.10 / 100) * 100  # ~90 % of the account as margin → a reachable liquidation
    order = b.place_order(symbol=SYM, side=side, qty=qty, ts=NOW, leverage=lev)
    assert order.status == "filled", order.reject_reason
    pos = b.open_positions()[0]
    sim = L.simulate(
        leverage=lev,
        position_notional=qty * pos.entry_price,
        entry_price=pos.entry_price,
        side=side,
        fee_rate=SPECS[SYM].taker_fee,
    )
    snap = b.snapshot()
    assert sim["required_margin"] == pytest.approx(b.position_margin(pos))
    assert sim["free_margin"] == pytest.approx(snap["free_margin"])
    assert sim["maintenance_margin"] == pytest.approx(snap["maintenance_margin"])
    assert sim["margin_level_pct"] == pytest.approx(snap["margin_level"] * 100)
    assert sim["liquidation_price"] == pytest.approx(b.liquidation_price(pos), rel=1e-9)
    liq = sim["liquidation_price"]
    assert liq is not None and sim["liquidation_distance_pct"] < 50
    # the broker really stops out there: just before → still open, just past → liquidated
    b.set_mark(SYM, liq * (1 + pos.sign * 1e-6), NOW + 60)
    b.check_liquidation(NOW + 60)
    assert b.open_positions(), "stopped out before the simulated liquidation price"
    b.set_mark(SYM, liq * (1 - pos.sign * 1e-6), NOW + 120)
    b.check_liquidation(NOW + 120)
    assert not b.open_positions()
    assert b.new_trades[-1].exit_reason == "liquidation"


@pytest.mark.parametrize("lev", [1, 5, 30, 100])
@pytest.mark.parametrize("side", ["buy", "sell"])
def test_matches_the_brokers_order_estimate_with_spread_and_fees(lev, side):
    b = broker(spread=True, fees=True)
    q = b.quote(SYM)
    entry = q.ask if side == "buy" else q.bid
    qty = 100_000 if lev >= 30 else 5_000
    est = b.order_estimate(symbol=SYM, side=side, qty=qty, entry=entry, leverage=lev)
    spec = SPECS_100X[SYM]
    sim = L.simulate(
        leverage=lev,
        position_notional=qty * entry,
        entry_price=entry,
        side=side,
        fee_rate=spec.taker_fee,
        spread_bps=spec.spread_bps,
    )
    assert sim["mid_price"] == pytest.approx(1.10)
    assert sim["required_margin"] == pytest.approx(est["margin_required"])
    assert sim["entry_fee"] == pytest.approx(est["fee_estimate"])
    assert sim["spread_cost"] == pytest.approx(est["spread_cost"])
    assert sim["free_margin"] == pytest.approx(est["free_margin_after"])
    assert sim["margin_level_pct"] == pytest.approx(est["margin_level_after"] * 100)
    assert sim["maintenance_margin"] == pytest.approx(est["maintenance_margin"])
    assert sim["liquidation_price"] == pytest.approx(est["liquidation_estimate"], rel=1e-9)
    assert sim["liquidation_distance_pct"] == pytest.approx(est["liquidation_distance_pct"], rel=1e-7)
    # the free-margin check agrees with the broker's order validation
    order = b.place_order(symbol=SYM, side=side, qty=qty, ts=NOW, leverage=lev)
    assert (order.status == "filled") == sim["can_open"]
    if sim["can_open"]:
        # after the fill the broker marks at the mid: same stop-out level up to the spread re-evaluated at that mark
        assert b.liquidation_price(b.open_positions()[0]) == pytest.approx(sim["liquidation_price"], rel=1e-5)


def test_pnl_at_a_move_equals_the_brokers_realised_pnl():
    b = broker(spread=True, fees=True)
    spec = SPECS_100X[SYM]
    order = b.place_order(symbol=SYM, side="buy", qty=50_000, ts=NOW, leverage=20)
    pos = b.open_positions()[0]
    sim = L.simulate(
        leverage=20,
        position_notional=50_000 * pos.entry_price,
        entry_price=pos.entry_price,
        fee_rate=spec.taker_fee,
        spread_bps=spec.spread_bps,
        price_move_pct=2,
    )
    assert order.status == "filled"
    b.set_mark(SYM, sim["price_after_move"], NOW + 60)
    b.close_position(pos.id, ts=NOW + 60)
    trade = b.new_trades[-1]
    assert trade.exit_price == pytest.approx(sim["exit_price"], rel=1e-6)
    assert trade.net_pnl == pytest.approx(sim["pnl_at_move"], rel=1e-4)
