"""S5 — Historical Replay V2 API: decisions, predict mode, live scoring, AI history review, stats."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import PaperOrder, PaperTrade, ReplayDecision, ReplaySession
from app.replay.comparison import SENTENCE, SETUP_DISCLAIMER
from app.services import market_service

H = 3600
SECTION_TITLES = ["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK", "ALTERNATIVE SCENARIO"]


def _start(guest, **extra) -> dict:
    body = {"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": int(time.time()) - 40 * 86400, "bars": 150, **extra}
    r = guest.post("/api/replay", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _last(state: dict) -> dict:
    return state["candles"][-1]


def _atr(state: dict, n: int = 14) -> float:
    cs = state["candles"][-n:]
    return sum(c["high"] - c["low"] for c in cs) / len(cs)


# ------------------------------------------------------------------------------------------------ create / state
def test_create_predict_session_state_shape(guest):
    s = _start(guest, mode="predict")
    sess = s["session"]
    for k in ("id", "symbol", "timeframe", "start_ts", "cursor_ts", "end_ts", "status", "remaining"):
        assert k in sess  # legacy keys kept
    assert sess["mode"] == "predict" and s["mode"] == "predict"
    assert s["precision"] == sess["precision"] == 2
    assert s["source"]["id"] == "demo" and s["source"]["status"] == "demo"
    assert s["score"] == {"value": None, "grade": None, "scored": 0, "pending": 0}
    assert s["decisions"] == [] and s["current_decision"] is None
    assert s["decisions_summary"]["total"] == 0
    assert s["can_trade"] is False
    assert sess["strategy"] is not None and sess["strategy"]["name"]
    assert sess["preset"] is None
    assert max(c["time"] for c in s["candles"]) == sess["cursor_ts"]


def test_requires_auth(client):
    anon = TestClient(app)
    assert anon.get("/api/replay/stats").status_code == 401
    assert anon.post("/api/replay/1/decision", json={"action": "wait"}).status_code in (401, 403)


# ------------------------------------------------------------------------------------------------ decisions
def test_decision_validation(guest):
    s = _start(guest, mode="predict")
    sid = s["session"]["id"]
    price = _last(s)["close"]
    bad = [
        {"action": "long"},  # stop required
        {"action": "long", "stop": price * 1.01},  # stop above entry
        {"action": "long", "stop": price * 0.99, "target": price * 0.98},  # target below entry
        {"action": "short", "stop": price * 0.99},  # stop below entry
        {"action": "short", "stop": price * 1.01, "target": price * 1.02},  # target above entry
    ]
    for body in bad:
        r = guest.post(f"/api/replay/{sid}/decision", json=body)
        assert r.status_code == 400, body
        assert r.json()["detail"]
    assert guest.post(f"/api/replay/{sid}/decision", json={"action": "hold"}).status_code == 422
    assert guest.post(f"/api/replay/{sid}/decision", json={"action": "long", "stop": -1}).status_code == 422
    r = guest.post(
        f"/api/replay/{sid}/decision",
        json={"action": "long", "stop": price * 0.99, "target": price * 1.02, "note": "pullback to EMA"},
    )
    assert r.status_code == 200, r.text
    d = r.json()["decision"]
    assert d["action"] == "long" and d["entry_price"] == price and d["bar_ts"] == s["session"]["cursor_ts"]
    assert abs(d["planned_rr"] - 2.0) < 1e-6
    assert d["note"] == "pullback to EMA"
    assert d["outcome"]["status"] == "open" and d["score_final"] is False and d["correct"] is None
    assert 0 <= d["score"] <= 100 and d["entry_score"] == d["score"]
    assert {"rr", "stop", "entry", "regime"} <= set(d["components"])
    assert all({"key", "label", "severity", "text", "lesson"} <= set(f) for f in d["flags"])
    assert r.json()["current_decision"]["id"] == d["id"]
    # WAIT needs nothing (stop/target are ignored)
    w = guest.post(f"/api/replay/{sid}/decision", json={"action": "wait", "stop": 1, "target": 2})
    assert w.status_code == 200 and w.json()["decision"]["stop"] is None


def test_one_decision_per_bar_replaces_and_preview_records_nothing(guest, db):
    s = _start(guest, mode="predict")
    sid = s["session"]["id"]
    price = _last(s)["close"]
    pv = guest.post(f"/api/replay/{sid}/decision", json={"action": "long", "stop": price * 0.99, "preview": True})
    assert pv.status_code == 200 and pv.json()["preview"] is True and pv.json()["decision"]["id"] is None
    assert db.scalar(select(func.count()).select_from(ReplayDecision).where(ReplayDecision.session_id == sid)) == 0
    first = guest.post(f"/api/replay/{sid}/decision", json={"action": "long", "stop": price * 0.99}).json()
    assert first["replaced"] is False
    second = guest.post(f"/api/replay/{sid}/decision", json={"action": "short", "stop": price * 1.01}).json()
    assert second["replaced"] is True
    assert len(second["decisions"]) == 1 and second["decisions"][0]["action"] == "short"
    guest.post(f"/api/replay/{sid}/step", json={"n": 1})
    third = guest.post(f"/api/replay/{sid}/decision", json={"action": "wait"}).json()
    assert third["replaced"] is False and len(third["decisions"]) == 2
    assert third["decisions_summary"]["short"] == 1 and third["decisions_summary"]["wait"] == 1


def test_predict_mode_places_no_orders(guest, db):
    s = _start(guest, mode="predict")
    sid = s["session"]["id"]
    price = _last(s)["close"]
    r = guest.post(f"/api/replay/{sid}/order", json={"side": "buy", "qty": 0.01})
    assert r.status_code == 400 and "Predict" in r.json()["detail"]
    r = guest.post(f"/api/replay/{sid}/decision", json={"action": "long", "stop": price * 0.99, "place_order": True})
    assert r.status_code == 400
    ok = guest.post(
        f"/api/replay/{sid}/decision", json={"action": "long", "stop": price * 0.99, "target": price * 1.02}
    )
    assert ok.status_code == 200 and ok.json()["order"] is None and ok.json()["decision"]["order_id"] is None
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 20}).json()
    assert st["account"]["orders"] == [] and st["account"]["positions"] == []
    fin = guest.post(f"/api/replay/{sid}/finish").json()
    assert fin["metrics"]["total_trades"] == 0 and fin["reviews"] == []
    acc_id = db.get(ReplaySession, sid).account_id
    assert db.scalar(select(func.count()).select_from(PaperOrder).where(PaperOrder.account_id == acc_id)) == 0
    assert db.scalar(select(func.count()).select_from(PaperTrade).where(PaperTrade.account_id == acc_id)) == 0
    assert fin["history_review"]["mode"] == "predict"


def test_trade_mode_decision_can_place_a_paper_order(guest):
    s = _start(guest)  # mode defaults to 'trade'
    sid = s["session"]["id"]
    assert s["mode"] == "trade" and s["can_trade"] is True
    price = _last(s)["close"]
    r = guest.post(
        f"/api/replay/{sid}/decision",
        json={"action": "long", "stop": price * 0.98, "target": price * 1.04, "place_order": True, "risk_pct": 1},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["order"]["status"] == "pending" and j["order"]["side"] == "buy" and j["order"]["qty"] > 0
    # sized by risk: ~1% of the 10,000 virtual balance to the stop (fees included) — never more
    assert j["order"]["qty"] * abs(price - price * 0.98) <= 10_000 * 0.01 * 1.02
    assert j["order"]["stop_loss"] == price * 0.98 and j["order"]["take_profit"] == price * 1.04
    assert j["decision"]["order_id"] == j["order"]["id"]
    assert isinstance(j["findings"], list)
    # a new decision at the same bar replaces the old one and cancels its still-pending order
    r = guest.post(
        f"/api/replay/{sid}/decision",
        json={"action": "short", "stop": price * 1.02, "target": price * 0.96, "place_order": True, "qty": 0.01},
    )
    j = r.json()
    assert j["replaced"] is True and j["order"]["side"] == "sell"
    assert [(o["side"], o["status"]) for o in j["account"]["orders"]] == [("sell", "pending")]
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 1}).json()
    assert [p["side"] for p in st["account"]["positions"]] == ["short"]
    # WAIT never places an order, even with the flag
    w = guest.post(f"/api/replay/{sid}/decision", json={"action": "wait", "place_order": True}).json()
    assert w["order"] is None


def test_step_resolves_predictions_on_revealed_candles_only(guest):
    s = _start(guest, mode="predict")
    sid = s["session"]["id"]
    price = _last(s)["close"]
    atr = _atr(s)
    d = guest.post(
        f"/api/replay/{sid}/decision",
        json={"action": "long", "stop": price - 0.4 * atr, "target": price + 0.4 * atr},
    ).json()["decision"]
    resolved_seen = []
    st = None
    for _ in range(40):
        st = guest.post(f"/api/replay/{sid}/step", json={"n": 1}).json()
        resolved_seen += st["resolved"]
        cur = next(x for x in st["decisions"] if x["id"] == d["id"])
        if cur["score_final"]:
            break
    assert cur["score_final"] is True
    assert cur["outcome"]["status"] in ("target", "stop")
    assert cur["outcome"]["exit_ts"] <= st["session"]["cursor_ts"]  # resolved on revealed candles only
    assert cur["outcome"]["bars_held"] >= 1
    assert cur["correct"] is (cur["outcome"]["status"] == "target")
    assert any(x["id"] == d["id"] for x in resolved_seen)
    assert "direction" in cur["components"]
    assert st["score"]["value"] == st["session"]["score"] == cur["score"]
    assert st["score"]["grade"] in ("A", "B", "C", "D")


def test_wait_is_evaluated_after_ten_bars(guest):
    s = _start(guest, mode="predict")
    sid = s["session"]["id"]
    d = guest.post(f"/api/replay/{sid}/decision", json={"action": "wait"}).json()["decision"]
    assert d["outcome"]["status"] == "open" and d["outcome"]["right_to_wait"] is None
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 10}).json()
    w = next(x for x in st["decisions"] if x["id"] == d["id"])
    assert w["outcome"]["status"] == "resolved" and isinstance(w["outcome"]["right_to_wait"], bool)
    assert w["outcome"]["explanation"]
    assert w["score"] in (100.0, 30.0) and w["correct"] is w["outcome"]["right_to_wait"]


def test_indicators_are_computed_without_lookahead(guest):
    s = _start(guest, mode="predict")
    sid = s["session"]["id"]
    a = guest.get(f"/api/replay/{sid}?indicators=ema:20,rsi:14").json()
    assert set(a["indicators"]) == {"ema_20", "rsi_14"}
    ema_a = {p["time"]: p["value"] for p in a["indicators"]["ema_20"]["series"]["value"]}
    assert max(ema_a) == a["session"]["cursor_ts"]
    assert min(ema_a) == a["candles"][0]["time"]  # warm-up history makes the first visible point available
    b = guest.post(f"/api/replay/{sid}/step?indicators=ema:20", json={"n": 5}).json()
    ema_b = {p["time"]: p["value"] for p in b["indicators"]["ema_20"]["series"]["value"]}
    assert max(ema_b) == b["session"]["cursor_ts"]
    for t, v in ema_a.items():  # revealing new candles never changes past values
        assert abs(ema_b[t] - v) < 1e-9
    assert guest.get(f"/api/replay/{sid}?indicators=foo:3").status_code == 400
    assert "indicators" not in guest.get(f"/api/replay/{sid}").json()


# ------------------------------------------------------------------------------------------------ finish / review
def test_finish_history_review_with_strategy_comparison(guest, db):
    strat = guest.post(
        "/api/strategies",
        json={
            "name": "Candle color (test)",
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "definition": {
                "entry_long": {
                    "logic": "all",
                    "conditions": [
                        {
                            "left": {"kind": "price", "field": "close"},
                            "op": ">",
                            "right": {"kind": "price", "field": "open"},
                        }
                    ],
                },
                "entry_short": {
                    "logic": "all",
                    "conditions": [
                        {
                            "left": {"kind": "price", "field": "close"},
                            "op": "<",
                            "right": {"kind": "price", "field": "open"},
                        }
                    ],
                },
                "stop": {"type": "atr", "value": 1},
                "take_profit": {"type": "r_multiple", "value": 1},
            },
        },
    )
    assert strat.status_code == 200, strat.text
    sid_strategy = strat.json()["id"]
    s = _start(guest, mode="predict", strategy_id=sid_strategy)
    sid = s["session"]["id"]
    assert s["session"]["strategy"]["id"] == sid_strategy and s["session"]["strategy"]["source"] == "selected"
    assert guest.get(f"/api/replay/{sid}/review").status_code == 404  # not finished yet
    for i in range(6):
        st = guest.post(f"/api/replay/{sid}/step", json={"n": 8}).json()
        price, atr = _last(st)["close"], _atr(st)
        if i % 3 == 0:
            body = {"action": "long", "stop": price - 1.5 * atr, "target": price + 3 * atr}
        elif i % 3 == 1:
            body = {"action": "short", "stop": price + 1.5 * atr, "target": price - 3 * atr}
        else:
            body = {"action": "wait"}
        assert guest.post(f"/api/replay/{sid}/decision", json=body).status_code == 200
    guest.post(f"/api/replay/{sid}/step", json={"n": 30})
    fin = guest.post(f"/api/replay/{sid}/finish")
    assert fin.status_code == 200, fin.text
    f = fin.json()
    for k in ("metrics", "reviews", "summary", "what_happened_next", "history_review"):  # legacy keys + new one
        assert k in f
    assert f["session"]["status"] == "finished"
    hr = f["history_review"]
    for k in (
        "what_happened",
        "predictions",
        "correct",
        "wrong",
        "entered_too_early",
        "chased",
        "ignored_structure",
        "rr_assessment",
        "invalidation_levels",
        "strategy_comparison",
        "lessons",
        "score",
        "sections",
        "provider",
        "disclaimer",
    ):
        assert k in hr, k
    assert [sec["title"] for sec in hr["sections"]] == SECTION_TITLES
    assert all(sec["body"] for sec in hr["sections"])
    assert hr["provider"] == "offline" and hr["fallback"] is False
    assert SETUP_DISCLAIMER in hr["disclaimer"]
    assert len(hr["predictions"]) == 6
    assert len(hr["correct"]) + len(hr["wrong"]) + len(hr["undetermined"]) == 6
    assert all(p["comment"] for p in hr["predictions"])
    assert len(hr["invalidation_levels"]) == 4  # one per LONG/SHORT
    assert all(lv["level"] == lv["stop"] for lv in hr["invalidation_levels"])
    wh = hr["what_happened"]
    assert wh["available"] and wh["start_ts"] == f["session"]["start_ts"] and wh["end_ts"] == f["session"]["cursor_ts"]
    assert wh["regimes"] and wh["regime_start"] and wh["text"]
    assert wh["next"]["bars"] == len(f["what_happened_next"]) == 30
    cmp = hr["strategy_comparison"]
    assert cmp["available"] is True and cmp["sentence"] == SENTENCE and cmp["text"][0] == SENTENCE
    assert cmp["strategy"]["id"] == sid_strategy
    assert cmp["trades"], "a candle-colour strategy trades in every window"
    start, cursor = f["session"]["start_ts"], f["session"]["cursor_ts"]
    for t in cmp["trades"]:
        assert start <= t["entry_ts"] <= cursor + H
        assert {"side", "entry_price", "exit_price", "r_multiple", "exit_reason", "net_pnl"} <= set(t)
    assert cmp["metrics"]["total_trades"] == len(cmp["trades"])
    assert cmp["costs"]["fees_enabled"] is True
    assert any(SENTENCE in line for line in hr["sections"][5]["body"])
    for lesson in hr["lessons"]:
        assert {"slug", "title", "reason", "href"} <= set(lesson) and lesson["href"].startswith("/learn/")
    assert hr["score"] is not None and 0 <= hr["score"] <= 100
    # stored on the session (score 0–100 for the learning dashboard)
    db.expire_all()
    row = db.get(ReplaySession, sid)
    assert row.status == "finished" and row.score == hr["score"]
    assert row.review["history_review"]["score"] == hr["score"]
    # GET review re-opens it with the fully revealed chart
    rv = guest.get(f"/api/replay/{sid}/review")
    assert rv.status_code == 200
    rj = rv.json()
    assert rj["history_review"]["score"] == hr["score"] and len(rj["what_happened_next"]) == 30
    assert max(c["time"] for c in rj["candles"]) == f["session"]["cursor_ts"]
    assert len(rj["decisions"]) == 6
    # a finished session takes no more decisions
    assert guest.post(f"/api/replay/{sid}/decision", json={"action": "wait"}).status_code == 400


def test_legacy_trade_flow_still_works_and_scores_from_trades(guest):
    s = _start(guest, bars=50)
    sid = s["session"]["id"]
    price = _last(s)["close"]
    o = guest.post(
        f"/api/replay/{sid}/order",
        json={"side": "buy", "qty": 0.01, "stop_loss": round(price * 0.97, 2), "take_profit": round(price * 1.03, 2)},
    ).json()
    assert o["order"]["status"] == "pending"
    guest.post(f"/api/replay/{sid}/step", json={"n": 5})
    fin = guest.post(f"/api/replay/{sid}/finish").json()
    assert fin["reviews"] and fin["what_happened_next"] and fin["summary"]
    hr = fin["history_review"]
    assert hr["score_basis"] == "trades" and hr["score"] == fin["reviews"][0]["process_score"]
    assert hr["predictions"] == []


def test_strategy_must_be_accessible(guest):
    r = guest.post(
        "/api/replay",
        json={
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "start_ts": int(time.time()) - 10 * 86400,
            "strategy_id": 999999,
        },
    )
    assert r.status_code == 404


def test_list_and_stats(guest):
    a = _start(guest, mode="predict")
    sid = a["session"]["id"]
    price = _last(a)["close"]
    atr = _atr(a)
    guest.post(
        f"/api/replay/{sid}/decision", json={"action": "long", "stop": price - 0.3 * atr, "target": price + 0.2 * atr}
    )
    guest.post(f"/api/replay/{sid}/step", json={"n": 20})
    guest.post(f"/api/replay/{sid}/finish")
    _start(guest)  # an active one
    stats = guest.get("/api/replay/stats")
    assert stats.status_code == 200
    st = stats.json()
    assert st["sessions"] == 2 and st["finished"] == 1 and st["active"] == 1
    assert st["decisions"] == 1
    for k in ("avg_score", "best_score", "last_scores", "common_flags", "correct", "wrong", "accuracy_pct"):
        assert k in st
    assert st["last_scores"] and st["last_scores"][0]["id"] == sid
    assert st["avg_score"] == st["best_score"] == st["last_scores"][0]["score"]
    flag_keys = {f["key"] for f in st["common_flags"]}
    assert "poor_rr" in flag_keys or "stop_in_noise" in flag_keys
    assert all(f["href"] and f["count"] >= 1 for f in st["common_flags"])
    lst = guest.get("/api/replay").json()["sessions"]
    assert [x["id"] for x in lst][-1] == sid
    row = next(x for x in lst if x["id"] == sid)
    assert row["mode"] == "predict" and row["decisions"] == 1 and row["has_review"] is True
    for k in ("id", "symbol", "timeframe", "start_ts", "cursor_ts", "status"):  # legacy list keys
        assert k in row


def test_step_moves_through_market_closed_gaps(guest, monkeypatch):
    s = _start(guest, mode="predict", bars=40)
    sid = s["session"]["id"]
    cur = s["session"]["cursor_ts"]
    real = market_service.candles
    gap = (cur + 1, cur + 6 * H)  # the next 6 candles do not exist (market closed)

    def gapped(*a, **k):
        return [c for c in real(*a, **k) if not (gap[0] <= c.ts <= gap[1])]

    monkeypatch.setattr(market_service, "candles", gapped)
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 2}).json()
    assert st["session"]["cursor_ts"] == cur + 2 * H  # time moves on although no candle was revealed
    assert max(c["time"] for c in st["candles"]) == cur
    d = guest.post(f"/api/replay/{sid}/decision", json={"action": "wait"}).json()["decision"]
    assert d["bar_ts"] == cur  # the decision belongs to the last real candle
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 10}).json()
    assert st["session"]["cursor_ts"] == cur + 12 * H
    assert max(c["time"] for c in st["candles"]) == cur + 12 * H
    assert not any(gap[0] <= c["time"] <= gap[1] for c in st["candles"])
