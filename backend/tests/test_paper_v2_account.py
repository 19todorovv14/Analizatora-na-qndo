"""S2 — paper account view additions, the order-panel instrument endpoint, trading instruments beyond the
original 15 (curated universe + provider-synced ones) and class-default volatility for synced instruments."""

from __future__ import annotations

import dataclasses
import math

import pytest

from app.exchange.registry import get_adapter
from app.market import catalog
from app.market.catalog import ASSETS_BY_SYMBOL, CORE_SYMBOLS, SPECS
from app.models import User
from app.paper_engine.broker import CLASS_DAILY_VOL, DEFAULT_DAILY_VOL, PaperBroker, effective_daily_vol
from app.paper_engine.models import AccountState, ExecutionConfig
from app.services import paper_service

NOW = 1_780_000_000


def _synced(symbol: str, asset_class: str = "crypto", demo: dict | None = None, **kw):
    item = {
        "symbol": symbol,
        "name": f"{symbol} test",
        "asset_class": asset_class,
        "price_precision": 4,
        "qty_step": 1,
        "min_qty": 1,
        "max_leverage": 2,
        "spread_bps": 5,
        "currency": "USDT",
        "providers": {"binance": symbol.replace("/", "")},
        **kw,
    }
    if demo:
        item["demo"] = demo
    return catalog.spec_from_item(item, curated=False, source="binance")


@pytest.fixture
def synced_demo():
    """A provider-synced instrument that the demo provider can serve (so the full API flow runs offline)."""
    spec = _synced("ZZPAPER/USDT", demo={"anchor_price": 2.5, "daily_vol": 0.05, "daily_volume_usd": 1e8})
    catalog.set_synced_assets([spec])
    yield spec
    catalog.clear_synced()


@pytest.fixture
def synced_no_data():
    spec = _synced("ZZNODATA/USDT")
    catalog.set_synced_assets([spec])
    yield spec
    catalog.clear_synced()


# ------------------------------------------------------------------- account view
def test_account_view_margin_fields(guest):
    flat = guest.get("/api/paper/account").json()
    assert flat["currency"] == "USD" and flat["account"]["currency"] == "USD"
    assert flat["available_margin"] == flat["free_margin"] == pytest.approx(10_000)
    assert flat["used_margin"] == 0 and flat["maintenance_margin"] == 0
    assert flat["margin_level"] is None and flat["margin_level_pct"] is None
    assert flat["stop_out_level"] == 0.5 and flat["margin_mode"] == "cross"
    assert flat["default_leverage"] == flat["account"]["leverage"] == 2

    guest.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.01})
    guest.post("/api/paper/orders", json={"symbol": "EUR/USD", "side": "sell", "qty": 20_000, "leverage": 10})
    view = guest.get("/api/paper/account").json()
    positions = view["positions"]
    assert len(positions) == 2
    assert view["used_margin"] == pytest.approx(sum(p["margin"] for p in positions))
    assert view["available_margin"] == pytest.approx(view["equity"] - view["used_margin"])
    assert view["maintenance_margin"] == pytest.approx(0.5 * view["used_margin"])
    assert view["margin_level"] == pytest.approx(view["equity"] / view["used_margin"])
    assert view["margin_level_pct"] == pytest.approx(view["margin_level"] * 100)
    assert view["effective_leverage"] == pytest.approx(view["exposure"] / view["equity"])
    for p in positions:
        assert p["margin"] == pytest.approx(p["qty"] * p["entry_price"] / p["leverage"])
        assert p["maintenance_margin"] == pytest.approx(0.5 * p["margin"])
        assert p["notional"] == pytest.approx(p["qty"] * p["mark_price"])
        assert p["fx_rate"] == 1.0 and p["currency"] == "USD" and p["margin_mode"] == "cross"
        assert "liquidation_price" in p and "liquidation_distance_pct" in p
        assert p["unrealized_pnl"] == pytest.approx(p["unrealized_pnl_quote"])
    by_symbol = {p["symbol"]: p for p in positions}
    assert by_symbol["BTC/USDT"]["quote_currency"] == "USDT" and by_symbol["BTC/USDT"]["leverage"] == 2
    assert by_symbol["EUR/USD"]["leverage"] == 10 and by_symbol["EUR/USD"]["max_leverage"] == 30


def test_exchange_adapter_balance_reports_margin(db, guest):
    guest.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.01})
    me = guest.get("/api/auth/me").json()
    user = db.get(User, me["id"])
    adapter = get_adapter("paper", db=db, user=user, account=paper_service.get_manual_account(db, user))
    bal = adapter.get_balance()
    assert bal["virtual"] is True
    assert bal["used_margin"] > 0
    assert bal["available_margin"] == pytest.approx(bal["free_margin"])


# --------------------------------------------------------------- instrument endpoint
def test_instrument_endpoint_for_the_order_panel(guest):
    info = guest.get("/api/paper/instrument", params={"symbol": "EUR/USD"}).json()
    assert info["symbol"] == "EUR/USD" and info["available"] is True
    assert info["max_leverage"] == 30 and info["default_leverage"] == 2 and info["account_leverage"] == 2
    assert info["min_qty"] == 1000 and info["qty_step"] == 100 and info["price_precision"] == 5
    assert info["bid"] < info["mid"] < info["ask"]
    assert info["spread"] == pytest.approx(info["ask"] - info["bid"])
    assert info["conversion"]["method"] == "identity" and info["conversion"]["rate"] == 1.0
    assert info["source"]["status"] == "demo"
    assert info["margin_mode"] == "cross" and info["stop_out_level"] == 0.5
    assert info["leverage_warning"] == "Higher leverage magnifies exposure and liquidation risk."
    btc = guest.get("/api/paper/instrument", params={"symbol": "BTC/USDT"}).json()
    assert btc["max_leverage"] == 2 and btc["default_leverage"] == 2
    jpy = guest.get("/api/paper/instrument", params={"symbol": "USD/JPY"}).json()
    assert jpy["quote_currency"] == "JPY" and jpy["conversion"]["method"] == "inverse"
    assert jpy["conversion"]["rate"] == pytest.approx(1 / jpy["mid"])
    assert guest.get("/api/paper/instrument", params={"symbol": "NOPE/USD"}).status_code == 404


def test_instrument_endpoint_reports_missing_data_instead_of_failing(guest, synced_no_data):
    info = guest.get("/api/paper/instrument", params={"symbol": synced_no_data.symbol}).json()
    assert info["available"] is False
    assert info["code"] == "DATA_NOT_AVAILABLE" and info["unavailable_reason"]
    assert info["bid"] is None and info["conversion"] is None
    assert info["daily_vol"] == CLASS_DAILY_VOL["crypto"] and info["daily_vol_source"] == "class_default"
    # trading it gives the explicit DATA_NOT_AVAILABLE error, never invented prices
    r = guest.post("/api/paper/orders/preview", json={"symbol": synced_no_data.symbol, "side": "buy", "qty": 1})
    assert r.status_code == 503 and r.json()["code"] == "DATA_NOT_AVAILABLE"


# ------------------------------------------------- instruments beyond the original 15
@pytest.mark.parametrize("symbol", ["AAPL", "SOL/USDT", "GBP/USD"])
def test_curated_universe_instruments_can_be_paper_traded(guest, symbol):
    spec = ASSETS_BY_SYMBOL[symbol]
    qty = spec.min_qty * 10
    placed = guest.post("/api/paper/orders", json={"symbol": symbol, "side": "buy", "qty": qty})
    assert placed.status_code == 200
    body = placed.json()
    assert body["order"]["status"] == "filled", body["order"]["reject_reason"]
    pos = next(p for p in body["view"]["positions"] if p["symbol"] == symbol)
    assert pos["qty"] == pytest.approx(qty)
    assert guest.post(f"/api/paper/positions/{pos['id']}/close", json={}).status_code == 200


@pytest.mark.parametrize("asset_class", ["stock", "etf", "crypto", "forex", "index", "commodity"])
def test_non_core_universe_instruments_are_tradable(guest, asset_class):
    extra = next(a for a in catalog.ASSETS if a.symbol not in CORE_SYMBOLS and a.asset_class == asset_class)
    placed = guest.post("/api/paper/orders", json={"symbol": extra.symbol, "side": "buy", "qty": extra.min_qty})
    assert placed.status_code == 200
    assert placed.json()["order"]["status"] == "filled", placed.json()["order"]["reject_reason"]


def test_synced_instrument_can_be_paper_traded(guest, synced_demo):
    sym = synced_demo.symbol
    prev = guest.post("/api/paper/orders/preview", json={"symbol": sym, "side": "buy", "qty": 100})
    assert prev.status_code == 200 and prev.json()["max_leverage"] == 2
    placed = guest.post("/api/paper/orders", json={"symbol": sym, "side": "buy", "qty": 100}).json()
    assert placed["order"]["status"] == "filled"
    pos = placed["view"]["positions"][0]
    assert pos["symbol"] == sym and pos["margin"] > 0
    view = guest.get("/api/paper/account").json()  # sync with the synced instrument's candles
    assert view["positions"][0]["symbol"] == sym
    closed = guest.post(f"/api/paper/positions/{pos['id']}/close", json={}).json()["view"]
    assert not closed["positions"]
    assert guest.get("/api/paper/trades").json()["trades"][0]["symbol"] == sym


# ---------------------------------------------------------- class-default volatility
def test_effective_daily_vol_uses_class_defaults():
    btc = ASSETS_BY_SYMBOL["BTC/USDT"]
    assert effective_daily_vol(btc) == btc.daily_vol
    for cls, vol in CLASS_DAILY_VOL.items():
        assert effective_daily_vol(dataclasses.replace(btc, asset_class=cls, daily_vol=0.0)) == vol
    assert effective_daily_vol(dataclasses.replace(btc, asset_class="bond", daily_vol=0.0)) == DEFAULT_DAILY_VOL
    assert effective_daily_vol(dataclasses.replace(btc, daily_vol=float("nan"))) == CLASS_DAILY_VOL["crypto"]
    assert CLASS_DAILY_VOL == {
        "crypto": 0.04,
        "stock": 0.02,
        "etf": 0.012,
        "forex": 0.006,
        "index": 0.012,
        "commodity": 0.02,
    }


def test_synced_instrument_without_volatility_gets_realistic_slippage():
    spec = _synced("ZZFLAT/USDT")  # synced: daily_vol = 0
    assert spec.daily_vol == 0
    catalog.set_synced_assets([spec])
    try:
        cfg = ExecutionConfig(latency_enabled=False, partial_fills_enabled=False, base_slippage_bps=0.5)
        b = PaperBroker(AccountState(cash=10_000, leverage=2), SPECS, cfg, seed=11)
        assert b._bar_range_frac(spec.symbol) == pytest.approx(0.04 / math.sqrt(1440) * 2.5)
        b.set_mark(spec.symbol, 2.0, NOW)
        fills = [b.place_order(symbol=spec.symbol, side="buy", qty=10, ts=NOW) for _ in range(8)]
        assert all(o.status == "filled" for o in fills)
        ask = 2.0 * (1 + spec.spread_bps / 2 / 1e4)
        # the volatility component makes slippage bigger than the 0.5 bps base for at least some fills
        assert any(o.avg_fill_price > round(ask * (1 + 0.5 / 1e4), 4) for o in fills)
        assert all(o.avg_fill_price >= round(ask, 4) for o in fills)
    finally:
        catalog.clear_synced()
