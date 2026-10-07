"""S2 — per-order leverage in the paper engine and the order preview.

1 ≤ L ≤ the instrument's max_leverage; without one the account default min(account leverage, instrument max) is
used (the old behaviour). The position keeps its leverage, margin = notional / L, and the cross-margin liquidation
price reflects the margin the position blocks.
"""

from __future__ import annotations

import pytest

from app.market.catalog import SPECS
from app.models import User
from app.paper_engine.broker import PaperBroker
from app.paper_engine.models import AccountState, Bar, ExecutionConfig
from app.services import paper_service

NOW = 1_780_000_000
SYM = "EUR/USD"  # max leverage 30, USD-quoted (no conversion)


def make(cash=10_000.0, lev=2.0, **cfg) -> PaperBroker:
    base = dict(
        fees_enabled=False,
        spread_enabled=False,
        slippage_enabled=False,
        latency_enabled=False,
        partial_fills_enabled=False,
    )
    base.update(cfg)
    b = PaperBroker(AccountState(cash=cash, leverage=lev), SPECS, ExecutionConfig(**base), seed=5)
    b.set_mark(SYM, 1.10, NOW)
    return b


def bar(ts, o, h, low, c):
    return Bar(ts, o, h, low, c, 1e9, 60)


# ----------------------------------------------------------------------- engine
def test_default_leverage_is_the_account_leverage_capped_by_the_instrument():
    b = make(lev=2)
    b.place_order(symbol=SYM, side="buy", qty=10_000, ts=NOW)
    pos = b.open_positions()[0]
    assert pos.leverage == 2.0
    assert b.position_margin(pos) == pytest.approx(11_000 / 2)
    b.set_mark("BTC/USDT", 100_000, NOW)
    big = make(lev=10)
    big.set_mark("BTC/USDT", 100_000, NOW)
    big.place_order(symbol="BTC/USDT", side="buy", qty=0.01, ts=NOW)
    assert big.open_positions()[0].leverage == 2.0  # BTC/USDT max is 2x


def test_per_order_leverage_sets_position_margin():
    b = make()
    rejected = b.place_order(symbol=SYM, side="buy", qty=100_000, ts=NOW)  # 110k notional at 2x needs 55k
    assert rejected.status == "rejected" and "margin" in rejected.reject_reason
    o = b.place_order(symbol=SYM, side="buy", qty=100_000, ts=NOW, leverage=20)
    assert o.status == "filled", o.reject_reason
    assert o.meta["leverage"] == 20.0
    pos = b.open_positions()[0]
    assert pos.leverage == 20.0
    assert "leverage" not in pos.meta  # kept on the position itself
    assert b.position_margin(pos) == pytest.approx(110_000 / 20)
    snap = b.snapshot()
    assert snap["used_margin"] == pytest.approx(5_500)
    assert snap["available_margin"] == snap["free_margin"] == pytest.approx(snap["equity"] - 5_500)
    assert snap["maintenance_margin"] == pytest.approx(0.5 * 5_500)
    assert snap["effective_leverage"] == pytest.approx(110_000 / snap["equity"])
    # a following order without leverage uses the account default again
    b.place_order(symbol=SYM, side="sell", qty=2_000, ts=NOW)
    assert sorted(p.leverage for p in b.open_positions()) == [2.0, 20.0]
    b.close_position(pos.id, ts=NOW + 60)
    assert b.new_trades[-1].meta["leverage"] == 20.0


@pytest.mark.parametrize(("symbol", "lev"), [(SYM, 31), (SYM, 0.5), ("BTC/USDT", 3)])
def test_leverage_outside_the_allowed_range_is_rejected(symbol, lev):
    b = make()
    b.set_mark("BTC/USDT", 100_000, NOW)
    o = b.place_order(symbol=symbol, side="buy", qty=b.specs[symbol].min_qty, ts=NOW, leverage=lev)
    assert o.status == "rejected"
    assert "Leverage" in o.reject_reason and "позволен" in o.reject_reason
    assert not b.open_positions()


def test_leverage_at_the_instrument_max_is_accepted():
    b = make()
    b.set_mark("BTC/USDT", 100_000, NOW)
    assert b.place_order(symbol="BTC/USDT", side="buy", qty=0.01, ts=NOW, leverage=2).status == "filled"
    assert b.place_order(symbol=SYM, side="buy", qty=1_000, ts=NOW, leverage=30).status == "filled"


def test_resting_and_next_bar_orders_keep_their_leverage():
    b = make()
    limit = b.place_order(symbol=SYM, side="buy", type="limit", price=1.09, qty=100_000, ts=NOW, leverage=20)
    assert limit.status == "open"
    nxt = b.place_order(
        symbol=SYM, side="sell", qty=50_000, ts=NOW, fill_mode="next_bar", active_from_ts=NOW + 60, leverage=25
    )
    assert nxt.status == "pending"
    b.process_bar(SYM, bar(NOW + 60, 1.10, 1.101, 1.085, 1.095))
    assert limit.status == "filled" and nxt.status == "filled"
    levs = {p.side: p.leverage for p in b.open_positions()}
    assert levs == {"long": 20.0, "short": 25.0}


def test_liquidation_price_reflects_the_position_margin():
    """Cross margin: liquidation when equity = stop_out × used margin. For the same size, the leverage changes the
    blocked margin and therefore the liquidation price."""
    prices = {}
    for lev in (10, 30):
        b = make()
        b.place_order(symbol=SYM, side="buy", qty=50_000, ts=NOW, leverage=lev)
        pos = b.open_positions()[0]
        used = 55_000 / lev
        expected = 1.10 - (10_000 - 0.5 * used) / 50_000
        prices[lev] = b.liquidation_price(pos)
        assert prices[lev] == pytest.approx(expected)
    assert prices[10] != pytest.approx(prices[30])


def test_higher_leverage_allows_bigger_positions_with_closer_liquidation():
    distances = {}
    for lev in (5, 30):
        b = make()
        qty = b.max_qty(SYM, entry=1.10, leverage=lev, ts=NOW)
        assert qty == pytest.approx(10_000 * lev / 1.10, rel=5e-3)  # rounded down to the 100-unit step
        assert b.place_order(symbol=SYM, side="buy", qty=qty, ts=NOW, leverage=lev).status == "filled"
        liq = b.liquidation_price(b.open_positions()[0])
        distances[lev] = (1.10 - liq) / 1.10
    # a position using the whole account: distance ≈ (1 − stop_out) / L
    assert distances[5] == pytest.approx(0.5 / 5, rel=0.01)
    assert distances[30] == pytest.approx(0.5 / 30, rel=0.01)


def test_stop_out_happens_at_the_liquidation_price():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=200_000, ts=NOW, leverage=30)
    liq = b.liquidation_price(b.open_positions()[0])
    b.process_bar(SYM, bar(NOW + 60, 1.10, 1.10, liq + 0.0005, liq + 0.001))
    assert b.open_positions()  # closed just above the liquidation price → still open
    b.process_bar(SYM, bar(NOW + 120, liq + 0.001, liq + 0.001, liq - 0.002, liq - 0.001))
    assert not b.open_positions()
    assert b.new_trades[-1].exit_reason == "liquidation"
    assert any(e.type == "margin_call" for e in b.events)


def test_order_estimate_matches_the_filled_position():
    b = make()
    est = b.order_estimate(symbol=SYM, side="buy", qty=100_000, entry=1.10, leverage=20, ts=NOW)
    assert est["leverage"] == 20 and est["max_leverage"] == 30
    assert est["margin_required"] == pytest.approx(5_500)
    assert est["maintenance_margin"] == pytest.approx(0.5 * 5_500)
    assert est["margin_level_after"] == pytest.approx(10_000 / 5_500)
    assert est["fx_rate"] == 1.0 and est["notional"] == pytest.approx(110_000)
    b.place_order(symbol=SYM, side="buy", qty=100_000, ts=NOW, leverage=20)
    pos = b.open_positions()[0]
    assert est["liquidation_estimate"] == pytest.approx(b.liquidation_price(pos))
    assert est["liquidation_distance_pct"] == pytest.approx((1.10 - est["liquidation_estimate"]) / 1.10 * 100)


def test_order_estimate_includes_costs_and_existing_positions():
    b = make(fees_enabled=True, spread_enabled=True)
    b.place_order(symbol=SYM, side="buy", qty=50_000, ts=NOW, leverage=10)
    snap = b.snapshot()
    est = b.order_estimate(symbol=SYM, side="sell", qty=20_000, entry=1.10, leverage=5, ts=NOW)
    assert est["used_margin_after"] == pytest.approx(snap["used_margin"] + 22_000 / 5)
    assert est["fee_estimate"] == pytest.approx(22_000 * b.specs[SYM].taker_fee)
    assert est["spread_cost"] > 0
    assert est["equity_after"] == pytest.approx(snap["equity"] - est["fee_estimate"] - est["spread_cost"])
    assert est["effective_leverage_after"] == pytest.approx((snap["exposure"] + 22_000) / est["equity_after"])


# -------------------------------------------------------------------------- API
def test_api_preview_with_leverage(guest):
    prev = guest.post("/api/paper/orders/preview", json={"symbol": SYM, "side": "buy", "qty": 10_000, "leverage": 10})
    assert prev.status_code == 200
    p = prev.json()
    for key in ("leverage", "max_leverage", "margin_required", "liquidation_estimate", "maintenance_margin"):
        assert key in p
    assert "margin_level_after" in p
    assert p["leverage"] == 10 and p["leverage_source"] == "order"
    assert p["max_leverage"] == 30 and p["default_leverage"] == 2
    assert p["margin_required"] == pytest.approx(p["notional"] / 10)
    assert p["maintenance_margin"] == pytest.approx(0.5 * p["used_margin_after"])
    assert p["margin_level_after"] == pytest.approx(p["equity_after"] / p["used_margin_after"])
    assert p["leverage_warning"] == "Higher leverage magnifies exposure and liquidation risk."
    assert p["sizing"]["max_qty"] > 10_000
    default = guest.post("/api/paper/orders/preview", json={"symbol": SYM, "side": "buy", "qty": 10_000}).json()
    assert default["leverage"] == 2 and default["leverage_source"] == "account"
    assert default["margin_required"] == pytest.approx(default["notional"] / 2)


def test_api_leverage_validation(guest):
    order = {"symbol": "BTC/USDT", "side": "buy", "qty": 0.01, "leverage": 5}
    r = guest.post("/api/paper/orders/preview", json=order)
    assert r.status_code == 400 and "2x" in r.json()["detail"]
    assert guest.post("/api/paper/orders", json=order).status_code == 400
    assert guest.post("/api/paper/orders/preview", json={**order, "leverage": 0.5}).status_code == 422
    assert not guest.get("/api/paper/account").json()["positions"]


def test_api_place_with_leverage_persists_on_the_position(guest):
    order = {"symbol": SYM, "side": "buy", "qty": 100_000, "leverage": 20}
    prev = guest.post("/api/paper/orders/preview", json=order).json()
    placed = guest.post("/api/paper/orders", json=order).json()
    assert placed["order"]["status"] == "filled", placed["order"]["reject_reason"]
    assert placed["order"]["leverage"] == 20
    view = guest.get("/api/paper/account").json()  # reloaded from the database
    pos = view["positions"][0]
    assert pos["leverage"] == 20 and pos["max_leverage"] == 30
    assert pos["margin"] == pytest.approx(pos["qty"] * pos["entry_price"] / 20)
    assert view["used_margin"] == pytest.approx(pos["margin"])
    assert pos["liquidation_price"] == pytest.approx(prev["liquidation_estimate"], rel=2e-3)
    assert pos["maintenance_margin"] == pytest.approx(0.5 * pos["margin"])
    # without leverage the account default (2x) still applies
    small = guest.post("/api/paper/orders", json={"symbol": SYM, "side": "sell", "qty": 1_000}).json()
    assert small["order"]["leverage"] is None
    assert sorted(p["leverage"] for p in small["view"]["positions"]) == [2, 20]


def test_api_preview_flags_liquidation_before_the_stop(guest):
    price = guest.get("/api/market/ticker", params={"symbol": SYM}).json()["price"]
    order = {"symbol": SYM, "side": "buy", "qty": 250_000, "leverage": 30, "stop_loss": round(price * 0.95, 5)}
    p = guest.post("/api/paper/orders/preview", json=order).json()
    assert p["liquidation_estimate"] > order["stop_loss"]
    kinds = {f["kind"]: f for f in p["findings"]}
    assert kinds["liquidation_before_stop"]["severity"] == "high"
    safe = guest.post(
        "/api/paper/orders/preview", json={**order, "qty": 10_000, "stop_loss": round(price * 0.99, 5)}
    ).json()
    assert all(f["kind"] != "liquidation_before_stop" for f in safe["findings"])


def test_api_preview_risk_based_sizing(guest):
    price = guest.get("/api/market/ticker", params={"symbol": SYM}).json()["price"]
    stop = round(price * 0.99, 5)
    p = guest.post(
        "/api/paper/orders/preview",
        json={"symbol": SYM, "side": "buy", "qty": 1_000, "stop_loss": stop, "risk_pct": 1},
    ).json()
    sizing = p["sizing"]
    equity = p["equity_after"] + p["fee_estimate"] + p["spread_cost"]  # equity before the order
    assert sizing["risk_pct"] == 1
    assert sizing["risk_amount"] == pytest.approx(equity * 0.01)
    assert sizing["per_unit_risk"] == pytest.approx(p["plan"]["potential_loss"] / 1_000)
    qty = sizing["qty_for_risk"]
    assert qty and qty % 100 == 0
    assert qty * sizing["per_unit_risk"] <= sizing["risk_amount"] + 1e-9
    assert (qty + 100) * sizing["per_unit_risk"] > sizing["risk_amount"]


def test_api_pending_limit_order_keeps_its_leverage(guest, db):
    price = guest.get("/api/market/ticker", params={"symbol": SYM}).json()["price"]
    order = {
        "symbol": SYM,
        "side": "buy",
        "type": "limit",
        "price": round(price * 0.9, 5),
        "qty": 10_000,
        "leverage": 15,
    }
    placed = guest.post("/api/paper/orders", json=order).json()
    assert placed["order"]["status"] == "open" and placed["order"]["leverage"] == 15
    assert guest.get("/api/paper/account").json()["orders"][0]["leverage"] == 15
    me = guest.get("/api/auth/me").json()
    acc = paper_service.get_manual_account(db, db.get(User, me["id"]))
    broker = paper_service.load_broker(db, acc)  # restored from the database
    pending = next(iter(broker.s.orders.values()))
    assert broker.order_leverage(pending) == 15
