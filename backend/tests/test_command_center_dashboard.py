"""S7 — GET /api/dashboard v2 (TRADING COMMAND CENTER): v1 keys kept, market overview from the S1 snapshot engine
(top mover per asset class + movers across classes), watchlist first 20 + total, account margin fields, learning
summary from /learn/dashboard, AI insights v2, bots with the coach headline, risk exposure breakdown."""

from __future__ import annotations

import pytest

from app.market.base import DataNotAvailableError
from app.market.catalog import ASSETS, CORE_SYMBOLS, get_asset
from app.market.overview import ENGINE
from app.models import Bot, PaperTrade, User, WatchlistItem
from app.services import market_service, paper_service, stats_service

V1_KEYS = ("market_overview", "watchlist", "open_positions", "recent_trades", "learning", "bots",
           "strategy_performance", "risk", "ai_insights")
WATCH_ROW_KEYS = ("symbol", "name", "asset_class", "price", "change_24h_pct", "volume_24h", "volatility_pct", "trend",
                  "regime", "source", "precision")
SMALL_UNIVERSE = ("BTC/USDT", "ETH/USDT", "AAPL", "SPY", "EUR/USD", "USD/JPY", "SPX", "XAU/USD")


def _user(db, client) -> User:
    db.expire_all()
    return db.get(User, client.get("/api/auth/me").json()["id"])


@pytest.fixture
def small_universe(monkeypatch):
    """Rank a small deterministic universe and let the dashboard compute every missing snapshot."""
    specs = [get_asset(s) for s in SMALL_UNIVERSE]
    monkeypatch.setattr(stats_service, "ASSETS", specs)
    monkeypatch.setattr(stats_service, "DASHBOARD_LIST_SECONDS", 60.0)
    return specs


def test_dashboard_keeps_v1_keys_and_adds_v2(guest, small_universe):
    d = guest.get("/api/dashboard").json()
    for k in V1_KEYS + ("user", "account", "tour_done"):
        assert k in d
    for k in ("market", "watchlist_total", "watchlist_limit", "next_actions", "as_of"):
        assert k in d
    assert d["user"]["app_mode"] == "learn" and d["user"]["explain_mode"] is True
    acc = d["account"]
    for k in ("balance", "equity", "unrealized_pnl", "realized_pnl", "day_pnl", "free_margin", "max_drawdown_pct",
              "used_margin", "available_margin", "margin_level", "margin_level_pct", "exposure", "exposure_pct",
              "currency", "open_positions", "initial_balance"):
        assert k in acc
    assert acc["used_margin"] == 0 and acc["margin_level"] is None and acc["available_margin"] == acc["equity"]


def test_market_overview_is_the_top_mover_of_every_class(guest, small_universe):
    d = guest.get("/api/dashboard").json()
    quotes = {s.symbol: ENGINE.cached(s) for s in small_universe}
    rows = d["market_overview"]
    classes = [r["asset_class"] for r in rows]
    assert classes == [c for c in stats_service.CLASS_ORDER if c in classes] and len(set(classes)) == len(classes)
    assert set(classes) == {"crypto", "stock", "etf", "forex", "index", "commodity"}
    for r in rows:
        members = [s for s in small_universe if s.asset_class == r["asset_class"]]
        best = max(members, key=lambda s: abs(quotes[s.symbol]["change_24h_pct"]))
        assert r["symbol"] == best.symbol
        for k in WATCH_ROW_KEYS:
            assert k in r
        q = quotes[r["symbol"]]
        assert r["price"] == q["price"] and r["change_24h_pct"] == q["change_24h_pct"] and r["available"] is True
        assert r["href"] == f"/markets/{r['slug']}" and r["source"]["status"] == "demo"
    m = d["market"]
    assert m["coverage"]["ranked"] == len(SMALL_UNIVERSE) and m["coverage"]["missing"] == 0 and m["note"] is None
    gainers = m["movers"]["gainers"]
    assert all(g["quote"]["change_24h_pct"] > 0 for g in gainers)
    assert [g["quote"]["change_24h_pct"] for g in gainers] == sorted((g["quote"]["change_24h_pct"] for g in gainers),
                                                                     reverse=True)
    assert all(x["quote"]["change_24h_pct"] < 0 for x in m["movers"]["losers"])
    assert len(m["movers"]["most_volume"]) == 5 and {"symbol", "slug", "quote", "source"} <= set(gainers[0])
    tiles = {c["asset_class"]: c for c in m["classes"]}
    assert list(tiles) == list(stats_service.CLASS_ORDER)
    crypto = tiles["crypto"]
    assert crypto["available"] and crypto["ranked"] == 2 and crypto["label"] == "Крипто"
    assert crypto["advancers"] + crypto["decliners"] <= 2 and crypto["top_mover"]["symbol"] in ("BTC/USDT", "ETH/USDT")


def test_market_block_reports_unavailable_classes(guest, monkeypatch):
    monkeypatch.setattr(stats_service, "ASSETS", [get_asset("BTC/USDT")])
    monkeypatch.setattr(stats_service, "DASHBOARD_LIST_SECONDS", 60.0)
    d = guest.get("/api/dashboard").json()
    tiles = {c["asset_class"]: c for c in d["market"]["classes"]}
    assert tiles["crypto"]["available"] is True
    stock = tiles["stock"]
    assert stock["available"] is False and stock["top_mover"] is None and stock["reason"] and stock["code"]
    assert [r["symbol"] for r in d["market_overview"]] == ["BTC/USDT"]


def test_watchlist_first_20_plus_total_and_unknown_rows(guest, db, small_universe):
    user = _user(db, guest)
    existing = {w.symbol for w in db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id)}
    extra = [s.symbol for s in ASSETS if s.symbol not in existing][:20]
    db.add(WatchlistItem(user_id=user.id, symbol="OLD/COIN", position=-1))
    for i, sym in enumerate(extra):
        db.add(WatchlistItem(user_id=user.id, symbol=sym, position=100 + i))
    db.commit()
    total = len(existing) + len(extra) + 1
    d = guest.get("/api/dashboard").json()
    assert d["watchlist_total"] == total and d["watchlist_limit"] == 20 and len(d["watchlist"]) == 20
    first = d["watchlist"][0]
    assert first["symbol"] == "OLD/COIN" and first["code"] == "UNKNOWN_INSTRUMENT" and first["error"]
    ok = [r for r in d["watchlist"][1:] if r["available"]]
    assert ok and all(r["price"] is not None for r in ok)
    for r in d["watchlist"][1:]:
        for k in WATCH_ROW_KEYS:
            assert k in r


def test_learning_summary_matches_learn_dashboard(guest, small_universe):
    d = guest.get("/api/dashboard").json()["learning"]
    ld = guest.get("/api/learn/dashboard").json()
    for k in ("xp", "level", "categories", "lessons_completed", "lessons_total", "next_module"):
        assert k in d  # v1
    for k in ("current_level", "next", "xp_level", "xp_progress", "quiz_avg_score", "replay_score", "risk_discipline",
              "weakest_skill", "strongest_skill", "levels_completed", "levels_total"):
        assert d[k] == ld[k]
    assert d["recommendations"] == ld["recommendations"][:3]


def test_ai_insights_v2_for_a_new_user(guest, small_universe):
    d = guest.get("/api/dashboard").json()
    ins = d["ai_insights"]
    for i in ins:
        for k in ("kind", "title", "text", "lesson", "why", "href", "available"):
            assert k in i
    market = next(i for i in ins if i["kind"] == "market")
    assert market["symbol"] == d["watchlist"][0]["symbol"] and market["timeframe"] == "4h"
    assert market["available"] and market["regime"] in stats_service.REGIME_INSIGHTS
    assert market["action"]["href"].startswith("/markets/") and market["href"].startswith("/learn/")
    keys = [i["key"] for i in ins if i["kind"] == "next_step"]
    assert keys == ["learning", "first_trade"]
    nxt = next(i for i in ins if i["key"] == "learning")
    assert nxt["href"] == d["learning"]["next"]["href"]
    actions = [a["key"] for a in d["next_actions"]]
    assert actions[:3] == ["learn", "first_trade", "replay"]
    for text in (i["why"] for i in ins):
        assert "guarantee" not in text.lower() and "BUY NOW" not in text


def test_ai_insights_lead_with_behaviour_findings(guest, db, small_universe):
    user = _user(db, guest)
    acc = paper_service.get_manual_account(db, user)
    for i in range(2):
        db.add(PaperTrade(
            id=f"{user.id}w{i}", account_id=acc.id, position_id=f"{user.id}w{i}", symbol="BTC/USDT", side="long",
            qty=1.0, entry_price=100.0, exit_price=90.0, stop_price=95.0, target_price=110.0, gross_pnl=-10.0,
            fees=0.0, net_pnl=-10.0, risk_amount=5.0, r_multiple=-2.0, exit_reason="stop_loss",
            opened_ts=1_790_000_000 + i * 86400, closed_ts=1_790_003_600 + i * 86400,
            meta={"stop_widened": True, "risk_pct": 0.5, "timeframe": "1h"},
        ))
    db.commit()
    d = guest.get("/api/dashboard").json()
    first = d["ai_insights"][0]
    assert first["kind"] == "behavior" and first["key"] == "moving_stops" and first["severity"] == "high"
    assert first["href"] == "/learn/stop-loss-placement" and first["action"]["href"] == first["href"]
    assert first["why"] and first["count"] == 2
    assert "first_trade" not in [i["key"] for i in d["ai_insights"]]
    assert {"key": "journal", "label": "Запиши сделките в журнала", "href": "/journal",
            "reason": "2 затворени сделки без запис в журнала."} in d["next_actions"]


def test_regime_insight_data_not_available(guest, monkeypatch, small_universe):
    def boom(*_a, **_k):
        raise DataNotAvailableError("no provider for this instrument")

    monkeypatch.setattr(market_service, "regime_snapshot", boom)
    d = guest.get("/api/dashboard").json()
    market = next(i for i in d["ai_insights"] if i["kind"] == "market")
    assert market["available"] is False and "DATA NOT AVAILABLE" in market["title"] and market["regime"] is None


def test_bots_carry_the_coach_headline(guest, db, small_universe):
    user = _user(db, guest)
    acc = paper_service.create_account(db, user, kind="bot", name="bot acc")
    db.add(Bot(user_id=user.id, name="Coach bot", symbol="BTC/USDT", timeframe="1h", strategy_snapshot={}, config={},
               status="STOPPED", paper_account_id=acc.id,
               runtime={"stats": {"setups_generated": 10, "all_conditions_met": 4, "entries": 2}}))
    db.commit()
    (b,) = guest.get("/api/dashboard").json()["bots"]
    assert b["coach_headline"] == "10 setups → 4 с изпълнени условия → 2 сделки"
    assert b["setups_generated"] == 10 and b["entries"] == 2 and b["href"] == f"/bots/{b['id']}"
    for k in ("id", "name", "symbol", "timeframe", "status", "regime", "last_signal"):
        assert k in b


def test_risk_exposure_breakdown(guest, small_universe):
    price = guest.get("/api/market/ticker?symbol=BTC/USDT").json()["price"]
    placed = guest.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.01,
                                                   "stop_loss": round(price * 0.97, 2)})
    assert placed.status_code == 200
    for risk in (guest.get("/api/dashboard").json()["risk"], guest.get("/api/risk/status").json()):
        ex = risk["exposure_breakdown"]
        (row,) = ex["by_symbol"]
        assert row["symbol"] == "BTC/USDT" and row["side"] == "long" and row["notional"] > 0
        assert row["pct_of_equity"] == pytest.approx(row["notional"] / risk["equity"] * 100)
        assert ex["by_class"][0]["asset_class"] == "crypto" and ex["by_class"][0]["label"] == "Крипто"
        assert risk["status"] in ("OK", "WARNING", "LIMIT") and risk["max_exposure_pct"] > 0
    acc = guest.get("/api/dashboard").json()["account"]
    assert acc["used_margin"] > 0 and acc["margin_level"] is not None and acc["open_positions"] == 1


def test_dashboard_symbols_are_real_catalog_instruments():
    assert set(SMALL_UNIVERSE) <= {s.symbol for s in ASSETS} and "BTC/USDT" in CORE_SYMBOLS
