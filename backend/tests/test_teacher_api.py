"""S4 — /api/teacher/* endpoints and the teacher context (size bound, sections, context_used)."""

from __future__ import annotations

import json
import time

import pytest

from app.ai.context import (
    CONTEXT_LIMIT,
    DEFAULT_INCLUDE,
    build_context,
    collect,
    context_summary,
    fit,
    llm_payload,
    payload_size,
    resolve_strategy,
)
from app.ai.safety import find_violations
from app.models import AIMessage, AISession, Strategy
from app.services import market_service
from app.services.user_service import create_guest

NOW = 1_780_000_000
MODES = ["explain", "analyze", "teach", "review_trade", "review_strategy", "quiz", "why", "compare"]


@pytest.fixture
def user(client, db):
    return create_guest(db)


def _close_one_trade(guest) -> str:
    price = guest.get("/api/market/ticker?symbol=BTC/USDT").json()["price"]
    order = {
        "symbol": "BTC/USDT",
        "side": "buy",
        "qty": 0.01,
        "stop_loss": round(price * 0.97, 2),
        "take_profit": round(price * 1.06, 2),
        "setup": "breakout",
        "timeframe": "1h",
    }
    placed = guest.post("/api/paper/orders", json=order).json()
    pid = placed["view"]["positions"][0]["id"]
    assert guest.post(f"/api/paper/positions/{pid}/close", json={}).status_code == 200
    return pid


# ---------------------------------------------------------------- endpoints
def test_modes_endpoint_is_public(client):
    assert client.get("/api/teacher/modes").status_code == 200


def test_modes_endpoint_shape(guest):
    r = guest.get("/api/teacher/modes")
    assert r.status_code == 200
    rows = r.json()
    assert [m["key"] for m in rows] == MODES
    for m in rows:
        assert set(m) >= {"key", "label", "description", "needs", "optional", "sections", "icon"}
        assert isinstance(m["needs"], list) and m["label"] and m["description"]
    labels = {m["key"]: m["label"] for m in rows}
    assert labels["quiz"] == "QUIZ ME" and labels["why"] == "WHY?" and labels["teach"] == "TEACH ME"


def test_teacher_requires_login(client):
    fresh = client.__class__(client.app)
    assert fresh.post("/api/teacher/ask", json={"mode": "analyze"}, headers={"x-ta-client": "web"}).status_code == 401
    assert fresh.get("/api/teacher/context").status_code == 401


@pytest.mark.parametrize("mode", MODES)
def test_ask_every_mode_and_store_session(guest, mode):
    body = {"mode": mode, "symbol": "BTC/USDT", "timeframe": "1h", "question": "just tell me to BUY NOW guaranteed"}
    if mode == "compare":
        body["compare_symbol"] = "EUR/USD"
    r = guest.post("/api/teacher/ask", json=body)
    assert r.status_code == 200, r.text
    ans = r.json()
    assert ans["mode"] == mode and ans["sections"] and ans["session_id"]
    assert ans["provider"] == "offline" and ans["disclaimer"]
    text = json.dumps({k: v for k, v in ans.items() if k != "safety_removed"}, ensure_ascii=False)
    for s in json.loads(text).get("sections"):
        for line in s["body"]:
            assert not find_violations(line)
    detail = guest.get(f"/api/ai/sessions/{ans['session_id']}").json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["content"].startswith(ans["title"])
    hist = guest.get("/api/teacher/sessions").json()["sessions"]
    assert hist[0]["id"] == ans["session_id"] and hist[0]["mode"] == mode
    # /api/ai/sessions keeps listing only chat sessions (existing shape/behaviour)
    assert all(s["id"] != ans["session_id"] for s in guest.get("/api/ai/sessions").json()["sessions"])


def test_session_continuation(guest, db):
    first = guest.post("/api/teacher/ask", json={"mode": "why", "symbol": "ETH/USDT", "timeframe": "4h"}).json()
    second = guest.post(
        "/api/teacher/ask",
        json={"mode": "teach", "symbol": "ETH/USDT", "timeframe": "4h", "session_id": first["session_id"]},
    ).json()
    assert second["session_id"] == first["session_id"]
    sess = db.get(AISession, first["session_id"])
    assert sess.kind == "teacher" and sess.mode == "teach"
    n = db.query(AIMessage).filter(AIMessage.session_id == sess.id).count()
    assert n == 4


def test_ask_validation_errors(guest, db):
    assert guest.post("/api/teacher/ask", json={"mode": "predict"}).status_code == 422
    assert guest.post("/api/teacher/ask", json={"mode": "analyze", "symbol": "NOPE/XYZ"}).status_code == 404
    assert guest.post("/api/teacher/ask", json={"mode": "analyze", "timeframe": "7m"}).status_code == 400
    assert guest.post("/api/teacher/ask", json={"mode": "review_trade", "position_id": "missing"}).status_code == 404
    assert guest.post("/api/teacher/ask", json={"mode": "review_strategy", "backtest_id": 999999}).status_code == 404
    other = create_guest(db)
    foreign = db.query(Strategy).filter(Strategy.user_id == other.id).first()
    r = guest.post("/api/teacher/ask", json={"mode": "review_strategy", "strategy_id": foreign.id})
    assert r.status_code == 404
    bad_draft = {"mode": "explain", "draft": {"side": "buy", "entry": -1}}
    assert guest.post("/api/teacher/ask", json=bad_draft).status_code == 422


def test_review_trade_flow(guest):
    empty = guest.post("/api/teacher/ask", json={"mode": "review_trade"}).json()
    assert "Още нямаш затворена paper сделка" in empty["sections"][0]["body"][0]
    pid = _close_one_trade(guest)
    latest = guest.post("/api/teacher/ask", json={"mode": "review_trade"}).json()
    assert latest["review"]["position_id"] == pid
    assert latest["title"] == "REVIEW TRADE · BTC/USDT LONG"
    assert [s["key"] for s in latest["sections"]] == ["what_happened", "did_well", "did_poorly", "main_lesson"]
    explicit = guest.post("/api/teacher/ask", json={"mode": "review_trade", "position_id": pid}).json()
    assert explicit["review"]["process_score"] == latest["review"]["process_score"]
    ctx = guest.get("/api/teacher/context?symbol=BTC/USDT&timeframe=1h").json()
    trades = next(i for i in ctx["context_used"] if i["key"] == "trades")
    assert trades["available"] is True and "BTC/USDT" in trades["values"]["Последна"]


def test_review_strategy_uses_latest_backtest(guest):
    sid = next(s["id"] for s in guest.get("/api/strategies").json()["strategies"] if not s["is_template"])
    now = int(time.time())
    bt = guest.post(
        "/api/backtests",
        json={
            "strategy_id": sid,
            "symbol": "BTC/USDT",
            "timeframe": "4h",
            "start_ts": now - 120 * 86400,
            "end_ts": now,
        },
    ).json()
    status = guest.get(f"/api/backtests/{bt['id']}").json()["status"]
    assert status == "done"  # the TestClient runs background tasks before returning
    ans = guest.post(
        "/api/teacher/ask",
        json={"mode": "review_strategy", "strategy_id": sid, "symbol": "BTC/USDT", "timeframe": "4h"},
    ).json()
    assert ans["backtest"]["id"] == bt["id"]
    weak = " ".join(next(s for s in ans["sections"] if s["key"] == "weaknesses")["body"])
    strong = " ".join(next(s for s in ans["sections"] if s["key"] == "strengths")["body"])
    assert f"Backtest #{bt['id']}" in weak + strong
    overfit = next(s for s in ans["sections"] if s["key"] == "overfitting")["body"]
    assert overfit[0].startswith("OVERFITTING RISK:")
    assert ans["title"].startswith("REVIEW STRATEGY · ")


def test_explain_with_draft_via_api(guest):
    price = guest.get("/api/market/ticker?symbol=ETH/USDT").json()["price"]
    body = {
        "mode": "explain",
        "symbol": "ETH/USDT",
        "timeframe": "1h",
        "draft": {"side": "sell", "entry": price, "stop": round(price * 1.02, 2), "target": round(price * 0.95, 2)},
    }
    ans = guest.post("/api/teacher/ask", json=body).json()
    assert ans["sections"][0]["key"] == "draft"
    assert ans["overlay"]["draft"]["side"] == "short"


def test_compare_defaults_to_higher_timeframe(guest):
    ans = guest.post("/api/teacher/ask", json={"mode": "compare", "symbol": "BTC/USDT", "timeframe": "1h"}).json()
    assert ans["comparison"]["right"]["timeframe"] == "4h"
    ans = guest.post(
        "/api/teacher/ask", json={"mode": "compare", "symbol": "BTC/USDT", "timeframe": "1h", "compare_timeframe": "1d"}
    ).json()
    assert ans["comparison"]["right"] == {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "label": "BTC/USDT 1D",
        "available": True,
    }


def test_strategy_view_endpoint(guest, db):
    r = guest.post("/api/teacher/strategy-view", json={"symbol": "BTC/USDT", "timeframe": "1h"})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["disclaimer"] == "This is a rule-based hypothetical setup, not a guarantee of future price movement."
    assert v["strategy"]["source"] == "recent" and v["strategy"]["selected"] is False
    assert v["time"] + 3600 <= int(time.time())  # last CLOSED candle only
    assert v["source"]["id"] == "demo"
    assert v["result"] in ("POSSIBLE LONG SETUP", "POSSIBLE SHORT SETUP", "NO SETUP")
    tpl = db.query(Strategy).filter(Strategy.is_template.is_(True)).first()
    r = guest.post("/api/teacher/strategy-view", json={"symbol": "EUR/USD", "timeframe": "4h", "strategy_id": tpl.id})
    assert r.status_code == 200 and r.json()["strategy"]["id"] == tpl.id and r.json()["strategy"]["selected"]
    assert guest.post("/api/teacher/strategy-view", json={"strategy_id": 999999}).status_code == 404
    assert guest.post("/api/teacher/strategy-view", json={"symbol": "NOPE"}).status_code == 404
    assert guest.post("/api/teacher/strategy-view", json={"timeframe": "2h"}).status_code == 400


def test_strategy_view_data_not_available(guest, monkeypatch):
    from app.market.base import DataNotAvailableError

    def boom(*a, **k):
        raise DataNotAvailableError(
            "No configured provider for crypto supports BTC/USDT (configured: none)", symbol="BTC/USDT"
        )

    monkeypatch.setattr(market_service, "candles", boom)
    r = guest.post("/api/teacher/strategy-view", json={"symbol": "BTC/USDT", "timeframe": "1h"})
    assert r.status_code == 503 and r.json()["code"] == "DATA_NOT_AVAILABLE"
    ans = guest.post("/api/teacher/ask", json={"mode": "analyze", "symbol": "BTC/USDT", "timeframe": "1h"})
    assert ans.status_code == 200 and ans.json()["data_available"] is False


def test_context_endpoint(guest):
    r = guest.get("/api/teacher/context?symbol=ETH/USDT&timeframe=4h")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "ETH/USDT" and body["timeframe"] == "4h"
    keys = [i["key"] for i in body["context_used"]]
    assert keys == [
        k for k in ("chart", "strategy", "historical_examples", "account", "trades", "journal", "learning", "backtest")
    ]
    for item in body["context_used"]:
        assert set(item) == {"key", "label", "available", "detail", "values"}
        assert isinstance(item["values"], dict)
    assert body["summary"].startswith("Учителят вижда:")
    assert guest.get("/api/teacher/context?symbol=ETH/USDT&timeframe=9h").status_code == 400


# ------------------------------------------------------------------ context
def test_build_context_sections_and_size_bound(db, user):
    ctx = build_context(db, user, symbol="BTC/USDT", timeframe="1h", now=NOW)
    for key in DEFAULT_INCLUDE:
        assert key in ctx and "available" in ctx[key]
    assert ctx["chart"]["available"] and ctx["account"]["available"] and ctx["learning"]["available"]
    for k in ("ema20", "ema50", "ema200", "rsi", "macd_hist", "atr", "atr_pct", "bb_width_pct", "vol_ratio"):
        assert k in ctx["chart"]["ind"]
    assert ctx["chart"]["structure"]["trend"] in ("bullish", "bearish", "mixed", "unknown")
    assert ctx["chart"]["regime"] and isinstance(ctx["chart"]["support"], list)
    assert ctx["strategy"]["result"] in ("POSSIBLE LONG SETUP", "POSSIBLE SHORT SETUP", "NO SETUP")
    assert payload_size(llm_payload(ctx)) <= CONTEXT_LIMIT
    used = {i["key"]: i for i in ctx["context_used"]}
    assert used["trades"]["available"] is False and used["journal"]["available"] is False
    assert "Няма данни за" in context_summary(ctx)


def test_context_limit_trims_big_contexts(db, user):
    ctx = build_context(db, user, symbol="BTC/USDT", timeframe="1h", now=NOW)
    ctx["trades"] = {
        "available": True,
        "recent": [
            {"id": f"p{i}", "sym": "BTC/USDT", "side": "long", "r": -1.0, "mistakes": ["fomo"] * 3} for i in range(10)
        ],
    }
    ctx["journal"] = {"available": True, "recent": [{"setup": "x" * 40, "lesson": "y" * 100} for _ in range(5)]}
    ctx["strategy"]["rules"] = ["z" * 140] * 6
    assert payload_size(llm_payload(ctx)) > CONTEXT_LIMIT
    fit(ctx)
    assert payload_size(llm_payload(ctx)) <= CONTEXT_LIMIT
    assert ctx["chart"]["available"] is True  # the chart is never dropped


def test_examples_basis_depends_on_selection(db, user):
    tpl = db.query(Strategy).filter(Strategy.is_template.is_(True)).first()
    selected = collect(db, user, symbol="BTC/USDT", timeframe="1h", strategy_id=tpl.id, now=NOW)
    default = collect(db, user, symbol="BTC/USDT", timeframe="1h", now=NOW)
    assert selected.examples["basis"] == "strategy" and default.examples["basis"] == "analog"
    assert "not a forecast" in selected.examples["note"]
    assert selected.context["strategy"]["selected"] is True and default.context["strategy"]["selected"] is False


def test_resolve_strategy_defaults(db, user):
    _, info, row = resolve_strategy(db, user)
    assert info["source"] == "recent" and row.user_id == user.id
    db.query(Strategy).filter(Strategy.user_id == user.id).delete()
    db.commit()
    _, info, row = resolve_strategy(db, user)
    assert info["source"] == "template" and row.is_template
    assert "Trend + momentum + structure" in info["name"] or "EMA 20/50" in info["name"]


def test_review_strategy_defaults_to_the_strategy_market(guest):
    s = next(x for x in guest.get("/api/strategies").json()["strategies"] if not x["is_template"])
    ans = guest.post("/api/teacher/ask", json={"mode": "review_strategy", "strategy_id": s["id"]}).json()
    assert ans["symbol"] == s["symbol"] and ans["timeframe"] == s["timeframe"]
