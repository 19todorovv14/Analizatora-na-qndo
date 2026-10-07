"""S2 — quote-currency → USD conversion in the paper engine (app.paper_engine.fx + PaperBroker).

The account is kept in USD: USD/JPY P/L is booked as JPY P/L / price, EUR/GBP P/L through GBP/USD, fees and
margin likewise. Cross rates come from real catalog instruments (never invented); without a rate an order is
rejected with an explicit reason.
"""

from __future__ import annotations

import pytest

from app.market import catalog
from app.market.base import DataNotAvailableError
from app.market.catalog import ASSETS_BY_SYMBOL, SPECS
from app.paper_engine import fx
from app.paper_engine.broker import PaperBroker
from app.paper_engine.fx import (
    CROSS,
    FIXED,
    IDENTITY,
    INVERSE,
    ConversionUnavailableError,
    MarketRateSource,
    QuoteConverter,
    StaticRates,
    conversion_method,
    conversion_route,
    split_currency,
    timeframe_for,
)
from app.paper_engine.models import AccountState, Bar, ExecutionConfig
from app.services import market_service

T0 = 1_780_000_000 - 1_780_000_000 % 3600  # an hour boundary in the past of the demo clock
NOW = T0 + 30 * 86400


def frictionless(**overrides) -> ExecutionConfig:
    base = dict(
        fees_enabled=False,
        spread_enabled=False,
        slippage_enabled=False,
        latency_enabled=False,
        partial_fills_enabled=False,
    )
    base.update(overrides)
    return ExecutionConfig(**base)


def broker(cash=10_000.0, lev=2.0, convert=None, **cfg) -> PaperBroker:
    return PaperBroker(AccountState(cash=cash, leverage=lev), SPECS, frictionless(**cfg), seed=3, convert=convert)


# ------------------------------------------------------------------ conversion rules
def test_conversion_method_per_instrument():
    method = {s: conversion_method(ASSETS_BY_SYMBOL[s]) for s in ("BTC/USDT", "EUR/USD", "AAPL", "XAU/USD")}
    assert set(method.values()) == {IDENTITY}
    assert conversion_method(ASSETS_BY_SYMBOL["USD/JPY"]) == INVERSE
    assert conversion_method(ASSETS_BY_SYMBOL["USD/CHF"]) == INVERSE
    for cross in ("EUR/GBP", "EUR/JPY", "ETH/BTC", "BTC/EUR"):
        assert conversion_method(ASSETS_BY_SYMBOL[cross]) == CROSS


def test_split_currency_and_sub_units():
    assert split_currency("GBp") == ("GBP", 0.01)
    assert split_currency("jpy") == ("JPY", 1.0)
    assert split_currency(None) == ("USD", 1.0)
    cents = catalog.spec_from_item(
        {
            "symbol": "ZZCENT",
            "asset_class": "commodity",
            "price_precision": 2,
            "qty_step": 1,
            "min_qty": 1,
            "max_leverage": 5,
            "spread_bps": 2,
            "currency": "USc",
        },
        curated=False,
    )
    assert conversion_method(cents) == FIXED
    assert QuoteConverter({"ZZCENT": cents}, rates=None)("ZZCENT", NOW, 250.0) == pytest.approx(0.01)


def test_conversion_routes_use_real_catalog_instruments():
    assert conversion_route("GBP").symbol == "GBP/USD" and conversion_route("GBP").invert is False
    jpy = conversion_route("JPY")
    assert (jpy.symbol, jpy.invert) == ("USD/JPY", True)
    assert conversion_route("EUR").symbol == "EUR/USD"
    assert conversion_route("XYZ") is None  # never invented
    # an unavailable route instrument is skipped
    assert conversion_route("GBP", available=lambda spec: spec.symbol != "GBP/USD") is None


def test_static_rates_table():
    rates = StaticRates({"gbp": 1.25, "ZAc": 0.0005})
    assert rates("GBP", NOW) == 1.25 and rates("gbp", NOW, 3600) == 1.25
    assert rates("ZAR", NOW) == pytest.approx(0.05)  # stored per major unit
    assert rates("CHF", NOW) is None
    # a sub-unit quote converts through its major currency: 1 GBp = 0.01 GBP
    assert QuoteConverter(SPECS, rates=rates).currency_rate("GBp", NOW) == pytest.approx(0.0125)


def test_quote_converter_static_rates():
    conv = QuoteConverter(SPECS, rates={"GBP": 1.25, "JPY": 0.0067})
    assert conv.is_identity("BTC/USDT") and conv("BTC/USDT", NOW, 100.0) == 1.0
    assert conv("EUR/GBP", NOW, 0.85) == pytest.approx(1.25)
    assert conv("EUR/JPY", NOW, 160.0) == pytest.approx(0.0067)
    assert conv("USD/JPY", NOW, 150.0) == pytest.approx(1 / 150)  # inverse: 1 / its own price
    assert conv.is_price_dependent("USD/JPY") and not conv.is_price_dependent("EUR/GBP")
    with pytest.raises(ConversionUnavailableError):
        conv("USD/JPY", NOW, None)
    with pytest.raises(ConversionUnavailableError):
        conv("EUR/CHF", NOW, 0.93)  # CHF not in the static table
    info = conv.describe("EUR/GBP")
    assert info["method"] == CROSS and info["route"]["symbol"] == "GBP/USD"
    assert info["quote_currency"] == "GBP" and info["account_currency"] == "USD"
    assert conv.describe("USD/JPY")["route"] == {"currency": "JPY", "symbol": "USD/JPY", "invert": True}
    assert issubclass(ConversionUnavailableError, DataNotAvailableError)


def test_timeframe_for_bar_resolution():
    assert timeframe_for(60) == "1m"
    assert timeframe_for(0) == "1m"
    assert timeframe_for(3600) == "1h"
    assert timeframe_for(7200) == "1h"
    assert timeframe_for(86400) == "1d"


# ------------------------------------------------------------- market-backed rate source
def test_market_rate_source_live_uses_ticker_of_the_route():
    src = MarketRateSource(now=NOW)
    gbp = src("GBP", NOW, 60)
    assert gbp == pytest.approx(market_service.ticker("GBP/USD", now=NOW).price)
    jpy = src("JPY", NOW, 60)
    assert jpy == pytest.approx(1 / market_service.ticker("USD/JPY", now=NOW).price)
    assert src.route("JPY").symbol == "USD/JPY"


def test_market_rate_source_history_has_no_lookahead():
    fx.clear_rate_cache()
    src = MarketRateSource(now=NOW)
    ts = T0 + 1800  # in the middle of an hour
    rate = src("GBP", ts, 3600)
    closed = market_service.candles(
        "GBP/USD", "1h", start=T0 - 5 * 3600, end=T0, limit=0, now=NOW, include_partial=False
    )
    usable = [c for c in closed if c.ts + 3600 <= ts]
    assert rate == pytest.approx(usable[-1].close)  # the candle that closed at T0 — not the one containing ts


def test_market_rate_source_caches_history_chunks(monkeypatch):
    fx.clear_rate_cache()
    calls = []
    real = market_service.candles

    def counting(*args, **kwargs):
        calls.append(args[:2])
        return real(*args, **kwargs)

    monkeypatch.setattr(market_service, "candles", counting)
    src = MarketRateSource(now=NOW)
    a = src("GBP", T0 + 120, 60)
    b = src("GBP", T0 + 180, 60)
    assert a > 0 and b > 0
    assert len(calls) == 1  # one 500-bar chunk serves both bars
    # a second source (next request) reuses the shared cache of complete chunks
    MarketRateSource(now=NOW)("GBP", T0 + 240, 60)
    assert len(calls) == 1


def test_market_rate_source_without_route_raises():
    with pytest.raises(ConversionUnavailableError):
        MarketRateSource(now=NOW)("XYZ", NOW, 60)


# ----------------------------------------------------------------- broker bookkeeping
def test_usd_jpy_long_pnl_is_booked_in_usd():
    b = broker()
    b.set_mark("USD/JPY", 150.0, NOW)
    o = b.place_order(symbol="USD/JPY", side="buy", qty=100_000, ts=NOW, leverage=30, stop_loss=149.0)
    assert o.status == "filled", o.reject_reason
    pos = b.open_positions()[0]
    # USD/JPY notional in USD equals the USD quantity
    assert b.position_margin(pos) == pytest.approx(100_000 / 30)
    assert b.position_notional(pos) == pytest.approx(100_000)
    b.set_mark("USD/JPY", 151.5, NOW + 60)
    assert b.position_upnl_quote(pos) == pytest.approx(150_000)  # JPY
    assert b.position_upnl(pos) == pytest.approx(150_000 / 151.5)  # USD
    b.close_position(pos.id, ts=NOW + 60)
    t = b.new_trades[-1]
    assert t.gross_pnl == pytest.approx(150_000 / 151.5)
    assert b.s.cash == pytest.approx(10_000 + 150_000 / 151.5)
    assert t.meta["quote_currency"] == "JPY"
    assert t.meta["fx_rate"] == pytest.approx(1 / 151.5)
    assert t.meta["gross_pnl_quote"] == pytest.approx(150_000)
    assert t.risk_amount == pytest.approx(1.0 * 100_000 / 151.5)
    assert t.r_multiple == pytest.approx(1.5)  # price distances: +1.5 vs a 1.0 stop distance


def test_usd_jpy_short_pnl_in_usd():
    b = broker()
    b.set_mark("USD/JPY", 150.0, NOW)
    b.place_order(symbol="USD/JPY", side="sell", qty=100_000, ts=NOW, leverage=30)
    pos = b.open_positions()[0]
    b.set_mark("USD/JPY", 148.5, NOW + 60)
    assert b.position_upnl(pos) == pytest.approx(150_000 / 148.5)
    b.close_position(pos.id, ts=NOW + 60)
    assert b.s.cash == pytest.approx(10_000 + 150_000 / 148.5)


def test_eur_gbp_pnl_fees_and_margin_via_gbp_usd():
    b = broker(convert=QuoteConverter(SPECS, rates={"GBP": 1.25}), fees_enabled=True)
    fee_rate = ASSETS_BY_SYMBOL["EUR/GBP"].taker_fee
    b.set_mark("EUR/GBP", 0.85, NOW)
    o = b.place_order(symbol="EUR/GBP", side="buy", qty=10_000, ts=NOW)
    assert o.status == "filled"
    entry_fee = 10_000 * 0.85 * fee_rate * 1.25
    assert o.fees == pytest.approx(entry_fee)
    pos = b.open_positions()[0]
    assert pos.leverage == 2.0  # account default
    assert pos.meta["fx_entry"] == pytest.approx(1.25)
    assert b.snapshot()["used_margin"] == pytest.approx(10_000 * 0.85 * 1.25 / 2)
    b.set_mark("EUR/GBP", 0.86, NOW + 60)
    assert b.position_upnl(pos) == pytest.approx(100 * 1.25)
    b.close_position(pos.id, ts=NOW + 60)
    t = b.new_trades[-1]
    assert t.gross_pnl == pytest.approx(125.0)
    assert t.fees == pytest.approx(entry_fee + 10_000 * 0.86 * fee_rate * 1.25)
    assert b.s.cash == pytest.approx(10_000 + t.net_pnl)
    assert b.s.fees_paid == pytest.approx(t.fees)


def test_cross_pnl_uses_the_rate_at_the_exit_time_margin_the_entry_rate():
    rates = {NOW: 1.25, NOW + 60: 1.30}
    conv = QuoteConverter(SPECS, rates=lambda ccy, ts, res: rates.get(ts) if ccy == "GBP" else None)
    b = broker(convert=conv)
    b.set_mark("EUR/GBP", 0.85, NOW)
    b.place_order(symbol="EUR/GBP", side="buy", qty=10_000, ts=NOW)
    pos = b.open_positions()[0]
    b.set_mark("EUR/GBP", 0.86, NOW + 60)
    snap = b.snapshot()
    assert snap["used_margin"] == pytest.approx(10_000 * 0.85 * 1.25 / 2)  # fixed at entry
    assert snap["unrealized_pnl"] == pytest.approx(100 * 1.30)
    assert snap["exposure"] == pytest.approx(10_000 * 0.86 * 1.30)
    b.close_position(pos.id, ts=NOW + 60)
    assert b.new_trades[-1].gross_pnl == pytest.approx(130.0)


def test_missing_cross_rate_rejects_the_order_with_a_reason():
    b = broker(convert=QuoteConverter(SPECS, rates=None))
    b.set_mark("EUR/GBP", 0.85, NOW)
    o = b.place_order(symbol="EUR/GBP", side="buy", qty=10_000, ts=NOW)
    assert o.status == "rejected"
    assert "превалутиране" in o.reject_reason
    assert not b.open_positions()
    # strict callers (previews) get the DATA_NOT_AVAILABLE error itself
    with pytest.raises(ConversionUnavailableError):
        b.order_estimate(symbol="EUR/GBP", side="buy", qty=10_000, entry=0.85, ts=NOW)


def test_lost_rate_falls_back_to_the_last_known_rate_for_open_positions():
    state = {"rate": 1.25}
    conv = QuoteConverter(SPECS, rates=lambda ccy, ts, res: state["rate"])
    b = broker(convert=conv)
    b.set_mark("EUR/GBP", 0.85, NOW)
    b.place_order(symbol="EUR/GBP", side="buy", qty=10_000, ts=NOW)
    state["rate"] = None  # the conversion instrument stops delivering data
    b.set_mark("EUR/GBP", 0.86, NOW + 60)
    assert b.snapshot()["unrealized_pnl"] == pytest.approx(100 * 1.25)


def test_usd_jpy_liquidation_price_is_exact():
    b = broker(cash=10_000, lev=2)
    b.set_mark("USD/JPY", 150.0, NOW)
    b.place_order(symbol="USD/JPY", side="buy", qty=300_000, ts=NOW, leverage=30)
    pos = b.open_positions()[0]
    liq = b.liquidation_price(pos)
    assert liq is not None and liq < 150.0
    b.set_mark("USD/JPY", liq, NOW + 60)
    snap = b.snapshot()
    assert snap["equity"] / snap["used_margin"] == pytest.approx(b.cfg.stop_out_level, rel=1e-6)


def test_default_converter_uses_candle_closes_at_bar_time_for_replay_and_backtests():
    """A PaperBroker built without a converter (backtests, replay) converts cross P/L with the conversion
    instrument's candle close at the bar time (no look-ahead)."""
    fx.clear_rate_cache()
    bars = market_service.candles(
        "EUR/GBP", "1h", start=T0, end=T0 + 10 * 3600, limit=0, now=NOW, include_partial=False
    )
    b = PaperBroker(AccountState(cash=10_000, leverage=2), SPECS, frictionless(), seed=1)
    first = bars[0]
    b.set_mark("EUR/GBP", first.close)
    b.last_bar["EUR/GBP"] = Bar(first.ts, first.open, first.high, first.low, first.close, first.volume, 3600)
    b.place_order(
        symbol="EUR/GBP", side="buy", qty=10_000, ts=first.ts + 3600, fill_mode="next_bar", active_from_ts=bars[1].ts
    )
    for c in bars[1:]:
        b.process_bar("EUR/GBP", Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, 3600))
    exit_ts = bars[-1].ts + 3600
    b.close_position(b.open_positions()[0].id, ts=exit_ts)
    t = b.new_trades[-1]
    gbp = market_service.candles("GBP/USD", "1h", start=T0, end=exit_ts, limit=0, now=NOW, include_partial=False)
    expected = [c for c in gbp if c.ts + 3600 <= exit_ts][-1].close
    assert t.meta["fx_rate"] == pytest.approx(expected)
    assert t.gross_pnl == pytest.approx(t.meta["gross_pnl_quote"] * expected)


# --------------------------------------------------------------------------- API
def test_api_usd_jpy_trade_in_usd(guest):
    price = guest.get("/api/market/ticker", params={"symbol": "USD/JPY"}).json()["price"]
    order = {"symbol": "USD/JPY", "side": "buy", "qty": 10_000, "leverage": 20, "stop_loss": round(price * 0.99, 3)}
    prev = guest.post("/api/paper/orders/preview", json=order).json()
    assert prev["currency"] == "USD" and prev["quote_currency"] == "JPY"
    assert prev["conversion"]["method"] == "inverse" and prev["conversion"]["available"] is True
    assert prev["notional"] == pytest.approx(10_000, rel=1e-9)  # USD quantity
    assert prev["margin_required"] == pytest.approx(500, rel=1e-9)
    assert prev["plan"]["currency"] == "USD"
    loss_usd = prev["plan"]["potential_loss"]
    assert loss_usd == pytest.approx(prev["plan"]["quote"]["potential_loss"] / order["stop_loss"])
    assert prev["plan"]["risk_pct"] == pytest.approx(loss_usd / 10_000 * 100, rel=1e-3)
    placed = guest.post("/api/paper/orders", json=order).json()
    assert placed["order"]["status"] == "filled"
    pos = placed["view"]["positions"][0]
    assert pos["margin"] == pytest.approx(500)
    assert pos["quote_currency"] == "JPY" and pos["currency"] == "USD"
    assert pos["unrealized_pnl"] == pytest.approx(pos["unrealized_pnl_quote"] * pos["fx_rate"], rel=1e-9)
    closed = guest.post(f"/api/paper/positions/{pos['id']}/close", json={}).json()["view"]
    trade = guest.get("/api/paper/trades").json()["trades"][0]
    assert trade["meta"]["quote_currency"] == "JPY"
    assert trade["gross_pnl"] == pytest.approx(trade["meta"]["gross_pnl_quote"] * trade["meta"]["fx_rate"])
    assert closed["balance"] == pytest.approx(10_000 + trade["net_pnl"])


def test_api_eur_gbp_preview_converts_through_gbp_usd(guest):
    gbp_usd = guest.get("/api/market/ticker", params={"symbol": "GBP/USD"}).json()["price"]
    prev = guest.post("/api/paper/orders/preview", json={"symbol": "EUR/GBP", "side": "buy", "qty": 10_000}).json()
    assert prev["conversion"]["method"] == "cross"
    assert prev["conversion"]["route"] == {"currency": "GBP", "symbol": "GBP/USD", "invert": False}
    assert prev["fx_rate"] == pytest.approx(gbp_usd, rel=5e-3)
    assert prev["notional"] == pytest.approx(prev["notional_quote"] * prev["fx_rate"])
    assert prev["fee_estimate"] == pytest.approx(prev["notional"] * ASSETS_BY_SYMBOL["EUR/GBP"].taker_fee)


def test_partial_fills_keep_the_usd_margin_of_every_fill():
    b = broker(cash=1_000_000, partial_fills_enabled=True, participation_rate=0.25)
    b.set_mark("USD/JPY", 150.0, NOW)
    b.last_bar["USD/JPY"] = Bar(NOW - 60, 150.0, 150.01, 149.99, 150.0, 400_000, 60)
    o = b.place_order(symbol="USD/JPY", side="buy", qty=200_000, ts=NOW, leverage=10)
    assert o.status == "partially_filled" and o.filled_qty == pytest.approx(100_000)
    b.process_bar("USD/JPY", Bar(NOW, 152.0, 152.5, 151.8, 152.2, 1_000_000, 60))
    assert o.status == "filled"
    pos = b.open_positions()[0]
    assert 150.0 < pos.entry_price < 152.0
    # USD/JPY: the notional in USD is the USD quantity, whatever the fill prices were
    assert b.position_margin(pos) == pytest.approx(200_000 / 10)
