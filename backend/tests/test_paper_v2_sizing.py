"""S2 — risk-based sizing in USD for every quote currency, order/position fields for the terminal UI
(effective order leverage, mark availability), the order-panel market status and the request-time anchor of
quote-currency conversion."""

from __future__ import annotations

import pytest

from app.market.base import MarketDataError
from app.market.catalog import ASSETS_BY_SYMBOL, SPECS
from app.models import User
from app.paper_engine.broker import PaperBroker
from app.paper_engine.fx import ConversionUnavailableError, MarketRateSource, QuoteConverter
from app.paper_engine.models import AccountState, ExecutionConfig
from app.services import market_service, paper_service

NOW = 1_780_000_000


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


def make(cash=10_000.0, lev=2.0, convert=None, **cfg) -> PaperBroker:
    return PaperBroker(AccountState(cash=cash, leverage=lev), SPECS, frictionless(**cfg), seed=9, convert=convert)


# --------------------------------------------------------------------------- engine
def test_risk_per_unit_usd_quoted_matches_price_distance_plus_fees():
    b = make()
    assert b.risk_per_unit("EUR/USD", side="buy", entry=1.10, stop=1.09, ts=NOW) == pytest.approx(0.01)
    assert b.risk_per_unit("EUR/USD", side="short", entry=1.10, stop=1.11, ts=NOW) == pytest.approx(0.01)
    fee = ASSETS_BY_SYMBOL["BTC/USDT"].taker_fee
    fb = make(fees_enabled=True)
    per = fb.risk_per_unit("BTC/USDT", side="buy", entry=100_000, stop=98_000, ts=NOW)
    assert per == pytest.approx(2_000 + 100_000 * fee + 98_000 * fee)
    assert fb.risk_per_unit("BTC/USDT", side="buy", entry=100_000, stop=98_000, ts=NOW, include_fees=False) == 2_000


@pytest.mark.parametrize(("side", "stop"), [("buy", 1.11), ("sell", 1.09), ("buy", 1.10)])
def test_stop_on_the_wrong_side_gives_no_risk_and_no_size(side, stop):
    b = make()
    assert b.risk_per_unit("EUR/USD", side=side, entry=1.10, stop=stop, ts=NOW) is None
    assert b.qty_for_risk("EUR/USD", side=side, entry=1.10, stop=stop, risk_amount=100, ts=NOW) == 0.0


def test_risk_per_unit_usd_jpy_is_converted_at_the_stop():
    b = make()
    per = b.risk_per_unit("USD/JPY", side="buy", entry=150.0, stop=149.0, ts=NOW)
    assert per == pytest.approx(1.0 / 149.0)  # 1 JPY per unit, worth 1/149 USD when the stop is hit


def test_risk_per_unit_cross_uses_the_conversion_instrument():
    b = make(convert=QuoteConverter(SPECS, rates={"GBP": 1.25}))
    per = b.risk_per_unit("EUR/GBP", side="sell", entry=0.85, stop=0.86, ts=NOW)
    assert per == pytest.approx(0.01 * 1.25)


def test_qty_for_risk_keeps_the_usd_risk_whatever_the_quote_currency():
    """1% of a 10k account (100 USD) at the stop — USD/JPY sized in USD, not in JPY."""
    b = make(lev=30)
    b.set_mark("USD/JPY", 150.0, NOW)
    qty = b.qty_for_risk("USD/JPY", side="buy", entry=150.0, stop=149.0, risk_amount=100, ts=NOW)
    step = ASSETS_BY_SYMBOL["USD/JPY"].qty_step
    assert qty == pytest.approx(int(100 * 149.0 / step) * step)
    assert qty * (1 / 149.0) <= 100 + 1e-9
    o = b.place_order(symbol="USD/JPY", side="buy", qty=qty, ts=NOW, stop_loss=149.0, leverage=30)
    assert o.status == "filled", o.reject_reason
    b.set_mark("USD/JPY", 149.0, NOW + 60)
    b.close_position(b.open_positions()[0].id, ts=NOW + 60)
    loss = -b.new_trades[-1].net_pnl
    assert loss == pytest.approx(100, rel=0.01) and loss <= 100 + 1e-6


def test_qty_for_risk_is_capped_by_free_margin():
    b = make(lev=2)
    b.set_mark("EUR/USD", 1.10, NOW)
    # a 0.0001 stop distance would allow 10M units for 1,000 USD — the margin allows ~18k at 2x
    uncapped = b.qty_for_risk(
        "EUR/USD", side="buy", entry=1.10, stop=1.0999, risk_amount=1_000, ts=NOW, cap_by_margin=False
    )
    capped = b.qty_for_risk("EUR/USD", side="buy", entry=1.10, stop=1.0999, risk_amount=1_000, ts=NOW)
    assert uncapped == pytest.approx(10_000_000, rel=1e-6)
    assert capped == b.max_qty("EUR/USD", entry=1.10, ts=NOW) == pytest.approx(18_100, abs=100)
    with_lev = b.qty_for_risk("EUR/USD", side="buy", entry=1.10, stop=1.0999, risk_amount=1_000, leverage=30, ts=NOW)
    assert with_lev == b.max_qty("EUR/USD", entry=1.10, leverage=30, ts=NOW) > capped
    assert b.qty_for_risk("EUR/USD", side="buy", entry=1.10, stop=1.09, risk_amount=0, ts=NOW) == 0.0


def test_qty_for_risk_without_a_conversion_rate_raises():
    b = make(convert=QuoteConverter(SPECS, rates=None))
    b.set_mark("EUR/GBP", 0.85, NOW)
    with pytest.raises(ConversionUnavailableError):
        b.qty_for_risk("EUR/GBP", side="buy", entry=0.85, stop=0.84, risk_amount=100, ts=NOW)


# ------------------------------------------------------------------------ service
def _user(db, guest) -> User:
    return db.get(User, guest.get("/api/auth/me").json()["id"])


def test_load_broker_anchors_conversion_at_the_request_time(db, guest):
    acc = paper_service.get_manual_account(db, _user(db, guest))
    broker = paper_service.load_broker(db, acc, now=NOW)
    assert broker.clock == NOW
    assert isinstance(broker.convert, QuoteConverter)
    assert isinstance(broker.convert.rates, MarketRateSource) and broker.convert.rates.now == NOW
    # without a time (replay, bots) the wall clock is used
    assert paper_service.load_broker(db, acc).convert.rates.now is None


# --------------------------------------------------------------------------- API
def test_api_preview_sizing_is_capped_by_margin(guest):
    price = guest.get("/api/market/ticker", params={"symbol": "EUR/USD"}).json()["price"]
    tight = round(price - 0.0002, 5)
    p = guest.post(
        "/api/paper/orders/preview",
        json={"symbol": "EUR/USD", "side": "buy", "qty": 1_000, "stop_loss": tight, "risk_pct": 5},
    ).json()
    s = p["sizing"]
    assert s["qty_for_risk"] > s["max_qty"]
    assert s["capped_by_margin"] is True
    assert s["qty_for_risk_capped"] == s["max_qty"]
    assert s["below_min_qty"] is False
    wide = guest.post(
        "/api/paper/orders/preview",
        json={"symbol": "EUR/USD", "side": "buy", "qty": 1_000, "stop_loss": round(price * 0.98, 5), "risk_pct": 0.5},
    ).json()["sizing"]
    assert wide["capped_by_margin"] is False and wide["qty_for_risk_capped"] == wide["qty_for_risk"]
    tiny = guest.post(
        "/api/paper/orders/preview",
        json={"symbol": "EUR/USD", "side": "buy", "qty": 1_000, "stop_loss": round(price * 0.5, 5), "risk_pct": 0.1},
    ).json()["sizing"]
    assert tiny["below_min_qty"] is True
    plain = guest.post("/api/paper/orders/preview", json={"symbol": "EUR/USD", "side": "buy", "qty": 1_000}).json()
    assert plain["sizing"]["qty_for_risk"] is None and plain["sizing"]["qty_for_risk_capped"] is None
    assert plain["sizing"]["capped_by_margin"] is False and plain["sizing"]["below_min_qty"] is False


def test_api_orders_report_their_effective_leverage(guest):
    price = guest.get("/api/market/ticker", params={"symbol": "EUR/USD"}).json()["price"]
    limit = {"symbol": "EUR/USD", "side": "buy", "type": "limit", "price": round(price * 0.95, 5), "qty": 1_000}
    default = guest.post("/api/paper/orders", json=limit).json()["order"]
    assert default["leverage"] is None and default["effective_leverage"] == 2
    own = guest.post("/api/paper/orders", json={**limit, "leverage": 12}).json()["order"]
    assert own["leverage"] == 12 and own["effective_leverage"] == 12
    btc = guest.get("/api/market/ticker", params={"symbol": "BTC/USDT"}).json()["price"]
    guest.patch("/api/paper/account", json={"leverage": 10})
    capped = guest.post(
        "/api/paper/orders",
        json={"symbol": "BTC/USDT", "side": "buy", "type": "limit", "price": round(btc * 0.9, 2), "qty": 0.01},
    ).json()["order"]
    assert capped["effective_leverage"] == 2  # account default 10x, capped by BTC/USDT's 2x
    orders = {o["id"]: o for o in guest.get("/api/paper/account").json()["orders"]}
    assert orders[default["id"]]["effective_leverage"] == 10  # the account default changed meanwhile
    assert orders[own["id"]]["effective_leverage"] == 12
    assert orders[capped["id"]]["effective_leverage"] == 2


def test_api_position_mark_availability(guest, monkeypatch):
    guest.post("/api/paper/orders", json={"symbol": "EUR/USD", "side": "buy", "qty": 1_000})
    pos = guest.get("/api/paper/account").json()["positions"][0]
    assert pos["mark_available"] is True and isinstance(pos["mark_ts"], int)

    def down(*args, **kwargs):
        raise MarketDataError("provider down")

    monkeypatch.setattr(market_service, "ticker", down)
    monkeypatch.setattr(market_service, "candles", down)
    stale = guest.get("/api/paper/account").json()["positions"][0]
    assert stale["mark_available"] is False and stale["mark_ts"] is None
    assert stale["mark_price"] == stale["entry_price"]  # documented fallback; the UI shows DATA NOT AVAILABLE


def test_api_instrument_reports_the_market_status(guest):
    info = guest.get("/api/paper/instrument", params={"symbol": "AAPL"}).json()
    ms = info["market_status"]
    assert ms["status"] in ("open", "closed", "break")
    assert {"label", "session", "session_name", "timezone", "next_change_ts", "note"} <= set(ms)
    crypto = guest.get("/api/paper/instrument", params={"symbol": "BTC/USDT"}).json()["market_status"]
    assert crypto["status"] == "open" and crypto["session"] == "24x7"
