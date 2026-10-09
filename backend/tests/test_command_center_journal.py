"""S7 — Journal v2: new fields, auto-fill from the linked paper position, POST /journal/{id}/ai-review (trade review
for a closed position, reflection review otherwise), journal stats by strategy."""

from __future__ import annotations

import pytest

from app.journal import review as jr
from app.journal.stats import entries_by_strategy, journal_stats
from app.models import PaperPosition, PaperTrade, Strategy, User
from app.risk.engine import RiskRules
from app.services import paper_service

T0 = 1_790_000_000


def _user(db, client) -> User:
    db.expire_all()
    return db.get(User, client.get("/api/auth/me").json()["id"])


def _seed_position(db, user: User, *, pid: str, meta: dict | None = None, status: str = "closed") -> str:
    """A long BTC position closed in two slices: 1 @ 110 (+10) and 1 @ 95 (−5); stop 95 → risk 5 per unit."""
    acc = paper_service.get_manual_account(db, user)
    pid = f"{user.id}{pid}"
    meta = {"timeframe": "4h", "setup": "pullback", "risk_pct": 0.5, **(meta or {})}
    db.add(
        PaperPosition(
            id=pid, account_id=acc.id, symbol="BTC/USDT", side="long", qty=0.0 if status == "closed" else 1.0,
            initial_qty=2.0, entry_price=100.0, stop_loss=95.0, take_profit=110.0, initial_stop=95.0, leverage=1.0,
            fees=0.0, realized_pnl=5.0, mfe=12.0, mae=5.0, status=status,
            sl_history=[{"ts": T0, "sl": 95.0, "source": "entry"}], active_from_ts=T0, opened_ts=T0,
            closed_ts=T0 + 7200 if status == "closed" else None, meta=meta,
        )
    )
    slices = [(f"{pid}-a", 110.0, 10.0, "take_profit", T0 + 3600), (f"{pid}-b", 95.0, -5.0, "stop_loss", T0 + 7200)]
    for tid, exit_price, net, reason, closed in slices[: 2 if status == "closed" else 1]:
        db.add(
            PaperTrade(
                id=tid, account_id=acc.id, position_id=pid, symbol="BTC/USDT", side="long", qty=1.0,
                entry_price=100.0, exit_price=exit_price, stop_price=95.0, target_price=110.0, gross_pnl=net,
                fees=0.0, net_pnl=net, risk_amount=5.0, r_multiple=net / 5.0, exit_reason=reason, opened_ts=T0,
                closed_ts=closed, meta=meta,
            )
        )
    db.commit()
    return pid


# ------------------------------------------------------------------------------------------- pure helpers
def test_reflection_review_complete_entry_scores_well():
    entry = {
        "symbol": "EUR/USD", "side": "long", "entry": 1.1000, "stop": 1.0950, "target": 1.1100, "exit_price": 1.1080,
        "risk_amount": 50.0, "reason": "Pullback към EMA 20 в uptrend, bullish engulfing на затворена 1H свещ",
        "emotion": "calm", "confidence": 3, "result": 80.0, "lesson": "Изчаках затварянето на свещта — работи.",
        "mistakes": [],
    }
    r = jr.reflection_review(entry, RiskRules())
    assert r["kind"] == "reflection" and r["title"] == "JOURNAL REVIEW"
    assert r["planned_rr"] == pytest.approx(2.0) and r["r_multiple"] == pytest.approx(1.6)
    assert r["stop_valid"] is True and r["did_poorly"] == [] and r["process_score"] == 100 and r["grade"] == "A"
    assert r["lessons"] == [] and r["questions"] and r["disclaimer"]


def test_reflection_review_flags_missing_plan_and_maps_lessons():
    entry = {"symbol": "BTC/USDT", "side": "long", "entry": 100.0, "emotion": "FOMO",
             "mistakes": ["chased the entry", "custom thing"], "reason": "", "lesson": ""}
    r = jr.reflection_review(entry)
    assert r["did_poorly"][0].startswith("Няма stop loss")  # priority 1 first
    assert r["lessons"][:3] == ["stop-order", "what-is-a-strategy", "fomo"]
    assert [x["href"] for x in r["lesson_refs"]] == ["/learn/stop-order", "/learn/what-is-a-strategy", "/learn/fomo"]
    assert r["process_score"] == 0 and r["grade"] == "D"
    assert any("invalidation" in q for q in r["questions"])


def test_reflection_review_wrong_side_stop_low_rr_and_oversized_loss():
    wrong = jr.reflection_review({"side": "long", "entry": 100.0, "stop": 105.0, "target": 120.0})
    assert wrong["stop_valid"] is False and "грешната страна" in wrong["did_poorly"][0]
    assert wrong["planned_rr"] is None
    low = jr.reflection_review({"side": "short", "entry": 100.0, "stop": 102.0, "target": 99.0, "exit_price": 103.0,
                                "confidence": 5, "result": -30.0})
    assert low["planned_rr"] == pytest.approx(0.5) and low["r_multiple"] == pytest.approx(-1.5)
    text = " ".join(low["did_poorly"])
    assert "reward:risk само 0.50" in text and "-1.50R" in text and "5/5" in text
    assert jr.infer_side(None, 100.0, 95.0, None) == "long" and jr.infer_side("sell", None, None, None) == "short"


def test_entries_by_strategy_and_journal_stats_strategies():
    entries = [
        {"trade_id": "t1", "strategy": "EMA pullback", "result": 10.0, "r_multiple": 1.0, "mistakes": []},
        {"trade_id": None, "strategy": "EMA pullback", "result": -5.0, "r_multiple": -0.5, "mistakes": []},
        {"trade_id": None, "strategy": None, "result": None, "r_multiple": None, "mistakes": []},
    ]
    rows = entries_by_strategy(entries)
    assert rows[0] == {"key": "EMA pullback", "entries": 2, "with_result": 2, "net_result": 5.0, "win_rate": 50.0,
                       "average_r": 0.25}
    assert rows[1]["key"] == "unlabelled" and rows[1]["net_result"] is None
    trades = [
        {"id": "t1", "position_id": "p1", "net_pnl": 10.0, "r_multiple": 1.0, "opened_ts": 0, "closed_ts": 10, "meta": {}},
        {"id": "t2", "position_id": "p2", "net_pnl": -4.0, "r_multiple": -0.4, "opened_ts": 0, "closed_ts": 10,
         "meta": {}, "strategy": "Breakout bot"},
    ]
    js = journal_stats(entries, trades)
    keys = [r["key"] for r in js["strategies"]]
    assert keys == ["EMA pullback", "Breakout bot"]  # t1 takes the linked entry's strategy
    assert js["best_strategy"]["key"] == "EMA pullback" and js["worst_strategy"]["key"] == "Breakout bot"
    assert js["entries_by_strategy"] == rows


# ------------------------------------------------------------------------------------------- API
def test_journal_v2_fields_roundtrip_and_partial_put(guest):
    body = {"symbol": "ETH/USDT", "side": "short", "entry": 3000, "stop": 3060, "target": 2880, "exit_price": 2950,
            "strategy": "  Range fade ", "risk_amount": 60, "notes": "Спокоен вход", "reason": "Rejection от range high"}
    e = guest.post("/api/journal", json=body).json()
    assert e["exit_price"] == 2950 and e["strategy"] == "Range fade" and e["risk_amount"] == 60
    assert e["notes"] == "Спокоен вход" and e["ai_review"] is None
    # an older client's PUT without the v2 fields keeps them
    kept = guest.put(f"/api/journal/{e['id']}", json={"symbol": "ETH/USDT", "reason": "x"}).json()
    assert kept["strategy"] == "Range fade" and kept["notes"] == "Спокоен вход" and kept["exit_price"] == 2950
    cleared = guest.put(f"/api/journal/{e['id']}", json={"notes": None, "strategy": ""}).json()
    assert cleared["notes"] is None and cleared["strategy"] is None and cleared["risk_amount"] == 60
    listed = guest.get("/api/journal").json()["entries"][0]
    assert {"exit_price", "strategy", "risk_amount", "notes", "ai_review"} <= set(listed)
    assert guest.post("/api/journal", json={"exit_price": -1}).status_code == 422
    assert guest.post("/api/journal", json={"strategy": "x" * 101}).status_code == 422


def test_journal_autofills_from_the_linked_position(guest, db):
    user = _user(db, guest)
    sid = Strategy(user_id=user.id, name="EMA pullback v2", definition={})
    db.add(sid)
    db.commit()
    pid = _seed_position(db, user, pid="pos1", meta={"strategy_id": sid.id})
    e = guest.post("/api/journal", json={"trade_id": f"{pid}-a", "reason": "pullback"}).json()
    assert e["symbol"] == "BTC/USDT" and e["side"] == "long" and e["entry"] == 100.0 and e["stop"] == 95.0
    assert e["target"] == 110.0 and e["timeframe"] == "4h" and e["setup"] == "pullback"
    assert e["exit_price"] == pytest.approx(102.5)  # qty-weighted over both closed slices
    assert e["result"] == pytest.approx(5.0) and e["r_multiple"] == pytest.approx(0.5) and e["risk_amount"] == 10.0
    assert e["strategy"] == "EMA pullback v2"
    # typed values win; a position id is accepted as the link too
    typed = guest.post("/api/journal", json={"trade_id": pid, "strategy": "Mine", "exit_price": 101.0}).json()
    assert typed["strategy"] == "Mine" and typed["exit_price"] == 101.0 and typed["result"] == pytest.approx(5.0)
    stats = guest.get("/api/journal/stats").json()
    assert {"strategies", "best_strategy", "worst_strategy", "entries_by_strategy"} <= set(stats)
    assert stats["strategies"][0]["key"] in ("EMA pullback v2", "Mine")


def test_ai_review_for_a_closed_position_uses_the_trade_review(guest, db):
    user = _user(db, guest)
    pid = _seed_position(db, user, pid="pos2")
    e = guest.post("/api/journal", json={"trade_id": f"{pid}-b"}).json()
    out = guest.post(f"/api/journal/{e['id']}/ai-review")
    assert out.status_code == 200
    rv = out.json()["ai_review"]
    assert rv["kind"] == "trade" and rv["title"] == "TRADE REVIEW" and rv["provider"] == "offline"
    assert rv["entry_id"] == e["id"] and rv["generated_ts"] > 0
    assert rv["linked"] == {"position_id": pid, "symbol": "BTC/USDT", "side": "long", "result": 5.0,
                            "r_multiple": 0.5, "closed": True}
    assert rv["did_well"] and rv["process_score"] >= 0 and rv["grade"] in "ABCD"
    assert all(x["href"].startswith("/learn/") for x in rv["lesson_refs"])
    stored = next(x for x in guest.get("/api/journal").json()["entries"] if x["id"] == e["id"])
    assert stored["ai_review"]["kind"] == "trade"


def test_ai_review_reflection_for_unlinked_or_open_entries(guest, db):
    e = guest.post("/api/journal", json={"symbol": "EUR/USD", "side": "long", "entry": 1.1, "emotion": "FOMO"}).json()
    rv = guest.post(f"/api/journal/{e['id']}/ai-review").json()["ai_review"]
    assert rv["kind"] == "reflection" and rv["linked"] is None and "fomo" in rv["lessons"]
    user = _user(db, guest)
    pid = _seed_position(db, user, pid="pos3", status="open")
    linked = guest.post("/api/journal", json={"trade_id": f"{pid}-a"}).json()
    rv2 = guest.post(f"/api/journal/{linked['id']}/ai-review").json()["ai_review"]
    assert rv2["kind"] == "reflection" and rv2["linked"]["closed"] is False and "отворена" in rv2["note"]
    ghost = guest.post("/api/journal", json={"trade_id": "does-not-exist"}).json()
    rv3 = guest.post(f"/api/journal/{ghost['id']}/ai-review").json()["ai_review"]
    assert rv3["kind"] == "reflection" and "не е намерена" in rv3["note"]


def test_ai_review_is_private(guest, client):
    e = guest.post("/api/journal", json={"reason": "secret"}).json()
    other = type(guest)(guest.app)
    other.post("/api/auth/guest", headers={"x-ta-client": "web"})
    other.headers.update({"x-ta-client": "web"})
    assert other.post(f"/api/journal/{e['id']}/ai-review").status_code == 404
    assert guest.post("/api/journal/999999/ai-review").status_code == 404
