"""S7 — GET /api/stats/performance (v2): curves, breakdowns, monthly returns, R histogram, confidence notes,
best/worst trades, streaks; scopes manual / bots / all."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.journal import performance as perf
from app.models import PaperTrade, Strategy, User
from app.psychology.patterns import build_positions
from app.services import paper_service

HOUR = 3600


def ts(y: int, m: int, d: int, h: int = 12) -> int:
    return int(datetime(y, m, d, h, tzinfo=UTC).timestamp())


def row(pid: str, opened: int, net: float, *, risk: float | None = 10.0, symbol: str = "BTC/USDT", side: str = "long",
        tf: str = "1h", setup: str | None = None, hold: int = HOUR, slice_no: int = 0, meta: dict | None = None) -> dict:
    return {
        "id": f"{pid}-{slice_no}", "position_id": pid, "symbol": symbol, "side": side, "qty": 1.0,
        "entry_price": 100.0, "exit_price": 100.0 + net, "stop_price": 99.0 if risk else None, "target_price": None,
        "gross_pnl": net, "fees": 0.5, "net_pnl": net, "risk_amount": risk, "r_multiple": net / risk if risk else None,
        "exit_reason": "take_profit" if net > 0 else "stop_loss", "opened_ts": opened, "closed_ts": opened + hold,
        "meta": {"timeframe": tf, "setup": setup, **(meta or {})},
    }


ROWS = [
    row("a", ts(2026, 1, 5, 9), 30.0, setup="breakout"),  # Monday 09:00, +3R
    row("b", ts(2026, 1, 6, 9), 20.0, setup="breakout", tf="4h"),  # +2R
    row("c", ts(2026, 1, 7, 14), -10.0, symbol="EUR/USD", side="short"),  # −1R
    row("d", ts(2026, 3, 2, 14), -10.0, symbol="EUR/USD"),  # March (February empty)
    row("e", ts(2026, 3, 3, 14), -25.0, risk=None),  # no stop → no R
    row("f", ts(2026, 3, 4, 14), 5.0),  # +0.5R
]


def test_build_report_sections():
    positions = build_positions(ROWS)
    rep = perf.build_report(positions, reference_capital=1000.0, asset_class_of=lambda s: "crypto" if "USDT" in s else "forex")
    assert set(rep["breakdowns"]) == set(perf.BREAKDOWN_KEYS)
    s = rep["summary"]
    assert s["total_trades"] == 6 and s["net_pnl"] == pytest.approx(10.0) and s["return_pct"] == pytest.approx(1.0)
    assert s["winning_trades"] == 3 and s["payoff_ratio"] == pytest.approx((55 / 3) / 15)
    classes = {r["key"]: r for r in rep["breakdowns"]["asset_class"]}
    assert classes["forex"]["trades"] == 2 and classes["forex"]["label"] == "Forex" and classes["crypto"]["label"] == "Крипто"
    weekday = rep["breakdowns"]["weekday"]
    assert [r["key"] for r in weekday] == ["0", "1", "2"] and weekday[0]["label"] == "Понеделник"
    hours = rep["breakdowns"]["hour"]
    assert [r["label"] for r in hours] == ["09:00 UTC", "14:00 UTC"] and hours[1]["trades"] == 4
    setups = rep["breakdowns"]["setup"]
    assert setups[0]["key"] == "breakout" and setups[0]["net_pnl"] == 50.0 and setups[0]["enough_data"] is False
    assert setups[-1]["key"] == "unlabelled" and setups[-1]["label"] == "Без етикет"
    sides = {r["key"]: r["label"] for r in rep["breakdowns"]["side"]}
    assert sides == {"long": "LONG", "short": "SHORT"}
    tfs = {r["key"]: r["label"] for r in rep["breakdowns"]["timeframe"]}
    assert tfs == {"1h": "1H", "4h": "4H"}


def test_curves_monthly_and_r_distribution():
    positions = build_positions(ROWS)
    rep = perf.build_report(positions, reference_capital=1000.0, asset_class_of=lambda s: None)
    eq = rep["curves"]["equity"]
    assert eq[0] == [ROWS[0]["opened_ts"], 1000.0] and eq[-1][1] == pytest.approx(1010.0) and len(eq) == 7
    assert all(p[1] <= 0 for p in rep["curves"]["drawdown"])
    assert min(p[1] for p in rep["curves"]["drawdown"]) == pytest.approx((1005 - 1050) / 1050 * 100, abs=1e-3)
    assert rep["curves"]["pnl"][-1][1] == pytest.approx(10.0)
    (year,) = rep["monthly_returns"]
    assert year["year"] == 2026 and len(year["months"]) == 12 and year["months"][1] is None
    jan, mar = year["months"][0], year["months"][2]
    assert jan == {"month": 1, "pnl": 40.0, "return_pct": 4.0, "trades": 3}
    assert mar["pnl"] == -30.0 and mar["return_pct"] == pytest.approx(-30 / 1040 * 100, abs=0.01)
    assert year["pnl"] == 10.0 and year["return_pct"] == 1.0 and year["trades"] == 6
    dist = rep["r_distribution"]
    counts = {b["key"]: b["count"] for b in dist["buckets"]}
    assert counts["-1:-0.5"] == 2 and counts["0.5:1"] == 1 and counts["2:3"] == 1 and counts["3:inf"] == 1
    assert sum(counts.values()) == dist["with_r"] == 5 and dist["without_r"] == 1 and dist["note"]
    assert dist["buckets"][0]["label"] == "< -2R" and dist["buckets"][-1]["label"] == "≥ 3R"


def test_confidence_streaks_and_best_worst():
    positions = build_positions(ROWS)
    rep = perf.build_report(positions, reference_capital=1000.0, asset_class_of=lambda s: None)
    c = rep["confidence"]
    assert c["sample"] == {"positions": 6, "with_r": 5, "level": "very_small", "note": perf.sample_note(6)}
    lo, hi = c["win_rate"]["ci95"]
    assert c["win_rate"]["value"] == 50.0 and lo < 50 < hi
    assert c["expectancy_r"]["value"] == pytest.approx(0.7) and c["expectancy_r"]["n"] == 5
    lo_r, hi_r = c["expectancy_r"]["ci95"]
    assert lo_r < 0 < hi_r and "включва 0" in c["expectancy_r"]["note"] and "Малка извадка" in c["expectancy_r"]["note"]
    assert c["profit_factor"]["value"] == pytest.approx(55 / 45, abs=1e-3) and "малка извадка" in c["profit_factor"]["note"]
    assert rep["streaks"] == {"max_wins": 2, "max_losses": 3, "current": {"kind": "win", "length": 1}}
    assert [t["position_id"] for t in rep["best_trades"]] == ["a", "b", "f"]
    assert [t["position_id"] for t in rep["worst_trades"]] == ["e", "c", "d"] or [
        t["position_id"] for t in rep["worst_trades"]
    ] == ["e", "d", "c"]
    assert rep["worst_trades"][0]["r"] is None


def test_wilson_profit_factor_and_empty_report():
    assert perf.wilson(0, 0) is None
    assert perf.wilson(5, 10) == (23.7, 76.3)
    assert perf.profit_factor([10.0, 5.0]) == perf.INFINITE_PF and perf.profit_factor([]) is None
    empty = perf.build_report([], reference_capital=1000.0, asset_class_of=lambda s: None)
    assert empty["curves"] == {"equity": [], "drawdown": [], "pnl": []} and empty["monthly_returns"] == []
    assert empty["confidence"]["sample"]["level"] == "none" and empty["best_trades"] == []
    assert all(rows == [] for rows in empty["breakdowns"].values())
    assert empty["streaks"] == {"max_wins": 0, "max_losses": 0, "current": {"kind": None, "length": 0}}


def test_curve_downsampling_keeps_first_and_last():
    pts = [[i, float(i)] for i in range(5000)]
    out = perf.downsample_points(pts, 1000)
    assert len(out) <= 1001 and out[0] == [0, 0.0] and out[-1] == [4999, 4999.0]


# ------------------------------------------------------------------------------------------- API
def _user(db, client) -> User:
    db.expire_all()
    return db.get(User, client.get("/api/auth/me").json()["id"])


def test_performance_api_scopes(guest, db):
    user = _user(db, guest)
    manual = paper_service.get_manual_account(db, user)
    bot_acc = paper_service.create_account(db, user, kind="bot", name="Bot acc", balance=5000.0)
    strat = Strategy(user_id=user.id, name="Trend bot strategy", definition={})
    db.add(strat)
    db.commit()
    for r in ROWS:
        db.add(PaperTrade(**{**r, "id": f"{user.id}{r['id']}", "position_id": f"{user.id}{r['position_id']}"},
                          account_id=manual.id))
    bot_row = row("bot1", ts(2026, 2, 10), 40.0, meta={"source": "bot", "strategy_id": strat.id})
    db.add(PaperTrade(**{**bot_row, "id": f"{user.id}bot1-0", "position_id": f"{user.id}bot1"}, account_id=bot_acc.id))
    db.commit()

    rep = guest.get("/api/stats/performance").json()
    assert rep["version"] == 2 and rep["scope"] == "manual" and rep["scopes"] == ["manual", "bots", "all"]
    assert rep["positions"] == 6 and rep["trades"] == 6 and rep["enough_data"] is False and "10" in rep["message"]
    assert rep["reference_capital"] == manual.initial_balance and rep["currency"] == "USD"
    for k in ("summary", "confidence", "curves", "breakdowns", "monthly_returns", "r_distribution", "best_trades",
              "worst_trades", "streaks", "metrics", "equity_curve", "by_exit_reason", "breakdown_min_trades"):
        assert k in rep
    assert rep["by_exit_reason"] == {"take_profit": 3, "stop_loss": 3}
    assert rep["metrics"] == rep["summary"] and len(rep["equity_curve"]) == 6

    bots = guest.get("/api/stats/performance?scope=bots").json()
    assert bots["positions"] == 1 and bots["reference_capital"] == 5000.0
    assert bots["breakdowns"]["strategy"][0]["key"] == "Trend bot strategy"
    assert "ботовете" in bots["reference_capital_note"]
    both = guest.get("/api/stats/performance?scope=all").json()
    assert both["positions"] == 7 and both["reference_capital"] == manual.initial_balance + 5000.0
    assert guest.get("/api/stats/performance?scope=everything").status_code == 422


def test_performance_api_fresh_guest_and_journal_labels(guest, db):
    rep = guest.get("/api/stats/performance").json()
    assert rep["positions"] == 0 and rep["confidence"]["sample"]["level"] == "none"
    assert rep["curves"]["equity"] == [] and rep["best_trades"] == []
    user = _user(db, guest)
    acc = paper_service.get_manual_account(db, user)
    r = row("j1", ts(2026, 4, 1), 12.0)
    db.add(PaperTrade(**{**r, "id": f"{user.id}j1-0", "position_id": f"{user.id}j1"}, account_id=acc.id))
    db.commit()
    guest.post("/api/journal", json={"trade_id": f"{user.id}j1-0", "strategy": "Journal strat", "setup": "retest"})
    rep = guest.get("/api/stats/performance").json()
    assert rep["breakdowns"]["strategy"][0]["key"] == "Journal strat"
    assert rep["breakdowns"]["setup"][0]["key"] == "retest"
    assert guest.get("/api/stats/report").json()["metrics"]["total_trades"] == 1  # v1 report unchanged
