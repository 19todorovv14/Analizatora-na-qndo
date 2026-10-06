"""Paper trading engine: orders, fills, spread, fees, slippage, stops, take profits,
partial fills, liquidation and accounting."""

import pytest

from app.market.catalog import ASSETS_BY_SYMBOL
from app.paper_engine.broker import PaperBroker
from app.paper_engine.models import AccountState, Bar, ExecutionConfig

SYM = "BTC/USDT"
BTC = ASSETS_BY_SYMBOL[SYM]
HS = 100_000 * BTC.spread_bps / 2 / 1e4  # half spread at 100k = 5


def make(cash=10_000.0, lev=2.0, seed=1, **cfg) -> PaperBroker:
    base = dict(slippage_enabled=False, latency_enabled=False, partial_fills_enabled=False)
    base.update(cfg)
    b = PaperBroker(AccountState(cash=cash, leverage=lev), ASSETS_BY_SYMBOL, ExecutionConfig(**base), seed=seed)
    b.set_mark(SYM, 100_000)
    return b


def bar(ts, o, h, low, c, v=1_000.0, d=60):
    return Bar(ts, o, h, low, c, v, d)


def test_market_buy_fills_at_ask_and_pays_taker_fee():
    b = make()
    o = b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0)
    assert o.status == "filled"
    assert o.avg_fill_price == pytest.approx(100_000 + HS)
    fee = 0.01 * (100_000 + HS) * BTC.taker_fee
    assert o.fees == pytest.approx(fee)
    assert b.s.cash == pytest.approx(10_000 - fee)
    pos = b.open_positions()[0]
    assert pos.side == "long" and pos.qty == pytest.approx(0.01)
    # immediately after entry the position is down by the spread (+ the entry fee is already paid)
    assert b.position_upnl(pos) == pytest.approx(-2 * HS * 0.01)


def test_market_sell_fills_at_bid():
    b = make()
    o = b.place_order(symbol=SYM, side="sell", qty=0.01, ts=0)
    assert o.avg_fill_price == pytest.approx(100_000 - HS)
    assert b.open_positions()[0].side == "short"


def test_spread_and_fees_can_be_disabled():
    b = make(spread_enabled=False, fees_enabled=False)
    o = b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0)
    assert o.avg_fill_price == pytest.approx(100_000)
    assert o.fees == 0
    assert b.s.cash == 10_000


def test_limit_order_rests_then_fills_at_limit_with_maker_fee():
    b = make()
    o = b.place_order(symbol=SYM, side="buy", type="limit", price=99_000, qty=0.01, ts=0)
    assert o.status == "open"
    b.process_bar(SYM, bar(60, 99_800, 99_900, 99_200, 99_500))  # does not reach 99_000 - hs
    assert o.status == "open"
    b.process_bar(SYM, bar(120, 99_500, 99_600, 98_900, 99_100))
    assert o.status == "filled"
    assert o.avg_fill_price == pytest.approx(99_000)
    assert o.fees == pytest.approx(0.01 * 99_000 * BTC.maker_fee)


def test_marketable_limit_executes_immediately_not_worse_than_limit():
    b = make()
    o = b.place_order(symbol=SYM, side="buy", type="limit", price=100_500, qty=0.01, ts=0)
    assert o.status == "filled"
    assert o.avg_fill_price <= 100_500


def test_stop_entry_gap_fills_at_open():
    b = make()
    o = b.place_order(symbol=SYM, side="buy", type="stop", price=101_000, qty=0.01, ts=0)
    assert o.status == "open"
    b.process_bar(SYM, bar(60, 101_500, 101_800, 101_400, 101_700))
    assert o.status == "filled"
    assert o.avg_fill_price == pytest.approx(101_500 + HS)  # gapped through the stop → worse than 101_000


def test_stop_loss_execution_and_r_multiple():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=99_000, take_profit=103_000)
    b.process_bar(SYM, bar(60, 99_900, 99_950, 98_500, 98_700))
    assert not b.open_positions()
    t = b.new_trades[-1]
    assert t.exit_reason == "stop_loss"
    assert t.exit_price == pytest.approx(99_000)
    risk = (100_000 + HS - 99_000) * 0.01
    assert t.risk_amount == pytest.approx(risk)
    assert t.r_multiple == pytest.approx(t.net_pnl / risk)
    assert t.r_multiple < -1  # fees make the loss slightly larger than 1R


def test_stop_loss_gap_gives_worse_fill():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=99_000)
    b.process_bar(SYM, bar(60, 97_000, 97_500, 96_800, 97_200))
    t = b.new_trades[-1]
    assert t.exit_reason == "stop_loss"
    gap_hs = 97_000 * BTC.spread_bps / 2 / 1e4  # spread is measured at the gapped open
    assert t.exit_price == pytest.approx(97_000 - gap_hs)
    assert t.r_multiple < -2.5


def test_take_profit_execution():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=99_000, take_profit=101_000)
    b.process_bar(SYM, bar(60, 100_100, 101_500, 100_050, 101_200))
    t = b.new_trades[-1]
    assert t.exit_reason == "take_profit"
    assert t.exit_price == pytest.approx(101_000)
    assert t.net_pnl > 0


def test_short_stop_and_target():
    b = make()
    b.place_order(symbol=SYM, side="sell", qty=0.01, ts=0, stop_loss=101_000, take_profit=98_000)
    b.process_bar(SYM, bar(60, 99_900, 99_950, 97_500, 97_900))
    t = b.new_trades[-1]
    assert t.exit_reason == "take_profit" and t.exit_price == pytest.approx(98_000)
    assert t.gross_pnl == pytest.approx((100_000 - HS - 98_000) * 0.01)


def test_worst_case_policy_assumes_stop_first():
    wide = bar(60, 100_000, 102_000, 98_000, 99_000)  # bearish: O→H→L→C, TP would be touched first
    b = make(intrabar_policy="worst_case")
    b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=99_000, take_profit=101_000)
    b.process_bar(SYM, wide)
    assert b.new_trades[-1].exit_reason == "stop_loss"
    p = make(intrabar_policy="path")
    p.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=99_000, take_profit=101_000)
    p.process_bar(SYM, wide)
    assert p.new_trades[-1].exit_reason == "take_profit"


def test_partial_fills_on_large_market_order():
    b = make(cash=1_000_000, partial_fills_enabled=True, participation_rate=0.25)
    b.last_bar[SYM] = bar(0, 100_000, 100_010, 99_990, 100_000, v=1.0)
    o = b.place_order(symbol=SYM, side="buy", qty=1.0, ts=0)
    assert o.status == "partially_filled"
    assert o.filled_qty == pytest.approx(0.25)
    b.process_bar(SYM, bar(60, 100_100, 100_200, 100_050, 100_150, v=4.0))
    assert o.status == "filled"
    pos = b.open_positions()[0]
    assert pos.qty == pytest.approx(1.0)
    assert 100_000 < pos.entry_price < 100_200  # weighted average of both fills


def test_partial_close_and_full_close():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.1, ts=0, stop_loss=95_000)
    pos = b.open_positions()[0]
    b.close_position(pos.id, ts=10, qty=0.04)
    assert pos.is_open and pos.qty == pytest.approx(0.06)
    assert b.new_trades[-1].exit_reason == "partial"
    b.close_position(pos.id, ts=20)
    assert not pos.is_open
    assert b.new_trades[-1].exit_reason == "manual"
    assert sum(t.qty for t in b.new_trades) == pytest.approx(0.1)


def test_move_stop_tracks_widening():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=99_000)
    pos = b.open_positions()[0]
    assert b.modify_position(pos.id, ts=5, stop_loss=98_000) is None
    assert pos.sl_history[-1]["widened"] is True
    assert any(e.type == "stop_moved" and e.data["widened"] for e in b.events)
    assert b.modify_position(pos.id, ts=6, stop_loss=99_500) is None
    assert pos.sl_history[-1]["widened"] is False
    assert "под текущата bid" in b.modify_position(pos.id, ts=7, stop_loss=100_500)
    b.close_position(pos.id, ts=8)
    assert b.new_trades[-1].meta["stop_widened"] is True


def test_liquidation_when_margin_level_falls_below_stop_out():
    b = make(cash=10_000, lev=2)
    o = b.place_order(symbol=SYM, side="buy", qty=0.19, ts=0)
    assert o.status == "filled"
    b.process_bar(SYM, bar(60, 99_000, 99_100, 69_000, 70_000))
    assert not b.open_positions()
    assert b.new_trades[-1].exit_reason == "liquidation"
    assert any(e.type == "margin_call" for e in b.events)


def test_rejections():
    b = make()
    big = b.place_order(symbol=SYM, side="buy", qty=1.0, ts=0)
    assert big.status == "rejected" and "margin" in big.reject_reason
    bad_sl = b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0, stop_loss=101_000)
    assert bad_sl.status == "rejected" and "ПОД" in bad_sl.reject_reason
    tiny = b.place_order(symbol=SYM, side="buy", qty=0.00001, ts=0)
    assert tiny.status == "rejected"
    no_price = b.place_order(symbol=SYM, side="buy", type="limit", qty=0.01, ts=0)
    assert no_price.status == "rejected"


@pytest.mark.parametrize("seed", range(10))
def test_slippage_is_always_adverse(seed):
    b = make(seed=seed, slippage_enabled=True, base_slippage_bps=2)
    buy = b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0)
    sell = b.place_order(symbol=SYM, side="sell", qty=0.01, ts=0)
    assert buy.avg_fill_price >= 100_000 + HS
    assert sell.avg_fill_price <= 100_000 - HS
    assert buy.slippage_cost > 0


def test_latency_is_deterministic_per_seed():
    a = make(seed=7, latency_enabled=True)
    b = make(seed=7, latency_enabled=True)
    pa = a.place_order(symbol=SYM, side="buy", qty=0.01, ts=0).avg_fill_price
    pb = b.place_order(symbol=SYM, side="buy", qty=0.01, ts=0).avg_fill_price
    assert pa == pb


def test_next_bar_order_with_offsets():
    b = make()
    o = b.place_order(
        symbol=SYM,
        side="buy",
        qty=0.01,
        ts=0,
        fill_mode="next_bar",
        active_from_ts=60,
        sl_offset=1_000,
        tp_offset=2_000,
    )
    assert o.status == "pending"
    b.process_bar(SYM, bar(60, 100_200, 100_300, 100_100, 100_250))
    pos = b.open_positions()[0]
    assert pos.entry_price == pytest.approx(100_200 + HS)
    assert pos.stop_loss == pytest.approx(round(pos.entry_price - 1_000, 2))
    assert pos.take_profit == pytest.approx(round(pos.entry_price + 2_000, 2))


def test_accounting_identity():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.02, ts=0, stop_loss=99_000, take_profit=101_000)
    b.place_order(symbol=SYM, side="sell", qty=0.01, ts=0, stop_loss=101_500)
    b.process_bar(SYM, bar(60, 100_000, 101_600, 99_950, 101_400))
    for p in b.open_positions():
        b.close_position(p.id, ts=200)
    assert not b.open_positions()
    assert b.s.cash == pytest.approx(10_000 + sum(t.net_pnl for t in b.new_trades))
    assert b.s.realized_pnl == pytest.approx(sum(t.net_pnl for t in b.new_trades))
    assert b.s.fees_paid == pytest.approx(sum(t.fees for t in b.new_trades))


def test_orders_not_active_before_their_time():
    b = make()
    o = b.place_order(symbol=SYM, side="buy", type="limit", price=99_000, qty=0.01, ts=0, active_from_ts=120)
    b.process_bar(SYM, bar(60, 99_500, 99_600, 98_000, 98_500))
    assert o.status == "open"  # this bar happened before the order existed → no lookahead


def test_snapshot_margin_values():
    b = make()
    b.place_order(symbol=SYM, side="buy", qty=0.05, ts=0)
    s = b.snapshot()
    assert s["used_margin"] == pytest.approx(0.05 * (100_000 + HS) / 2)
    assert s["free_margin"] == pytest.approx(s["equity"] - s["used_margin"])
    assert s["margin_level"] == pytest.approx(s["equity"] / s["used_margin"])
    # a small 2x position cannot be liquidated before price reaches zero
    assert b.liquidation_price(b.open_positions()[0]) is None
    big = make()
    big.place_order(symbol=SYM, side="buy", qty=0.19, ts=0)
    liq = big.liquidation_price(big.open_positions()[0])
    assert 60_000 < liq < 80_000
