"""End-to-end API tests — the 16-step demo walkthrough plus the remaining endpoints."""

import time

import pytest

from app.academy.content import LESSONS_BY_SLUG, MODULES
from app.academy.scenarios import SCENARIOS, get_scenario

VISUALS = {
    "orderbook",
    "asset_table",
    "order_types",
    "leverage",
    "fees",
    "candle",
    "live_chart",
    "timeframes",
    "scenario",
    "indicator",
    "risk_calc",
    "drawdown",
    "expectancy",
    "reflection",
    "strategy_flow",
}


def test_academy_content_integrity():
    assert len(MODULES) == 8
    slugs = set()
    for m in MODULES:
        assert 5 <= len(m["quiz"]) <= 10, m["key"]
        for q in m["quiz"]:
            assert 0 <= q["answer"] < len(q["options"])
        for lesson in m["lessons"]:
            assert lesson["slug"] not in slugs
            slugs.add(lesson["slug"])
            assert lesson["title"] and lesson["summary"] and lesson["key_points"]
            if lesson["visual"]:
                assert lesson["visual"]["type"] in VISUALS
                if lesson["visual"]["type"] == "scenario":
                    assert lesson["visual"]["scenario"] in SCENARIOS
    indicator_lessons = [x for x in MODULES if x["key"] == "indicators"][0]["lessons"]
    for lesson in indicator_lessons:
        headings = [s["heading"] for s in lesson["sections"]]
        assert headings == [
            "What it is",
            "What it measures",
            "How it is calculated (conceptually)",
            "What traders use it for",
            "Common mistakes",
            "When it can fail",
        ]


@pytest.mark.parametrize("key", list(SCENARIOS))
def test_scenarios_build(key):
    s = get_scenario(key)
    assert len(s["candles"]) >= 20
    for c in s["candles"]:
        assert c["low"] <= min(c["open"], c["close"]) and max(c["open"], c["close"]) <= c["high"]


def test_demo_walkthrough(guest):
    # 1-4: chart, candles, timeframe change, indicators
    for tf in ("1m", "15m", "1h", "1d"):
        r = guest.get(f"/api/market/candles?symbol=BTC/USDT&timeframe={tf}&limit=120&indicators=ema:20,rsi:14,bb")
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["candles"]) == 120
        assert body["source"]["id"] == "demo" and body["execution"] == "PAPER"
        assert set(body["indicators"]) == {"ema_20", "rsi_14", "bb"}
    assert guest.get("/api/market/candles?symbol=BTC/USDT&timeframe=2h").status_code == 400
    assert guest.get("/api/market/candles?symbol=FAKE&timeframe=1h").status_code == 404

    # 5: read a lesson and complete it
    r = guest.get("/api/academy/lessons/candlestick")
    assert r.status_code == 200 and r.json()["visual"]["type"] == "candle"
    assert guest.post("/api/academy/lessons/candlestick/complete").json()["xp_gained"] == 10
    assert guest.post("/api/academy/lessons/candlestick/complete").json()["xp_gained"] == 0  # idempotent

    # 6: quiz (answers shown afterwards, unlocks next module)
    quiz = guest.get("/api/academy/quiz/level0").json()
    assert "answer" not in quiz["questions"][0]
    from app.academy.content import MODULES_BY_KEY

    answers = {q["id"]: q["answer"] for q in MODULES_BY_KEY["level0"]["quiz"]}
    res = guest.post("/api/academy/quiz/level0", json={"answers": answers}).json()
    assert res["passed"] and res["score"] == 1 and res["unlocked_module"] == "charts"
    assert all("explanation" in x for x in res["results"])
    prog = guest.get("/api/academy/progress").json()
    assert prog["modules"][1]["unlocked"] is True and prog["modules"][2]["unlocked"] is False

    # 7: paper account with $10,000 virtual balance
    acc = guest.get("/api/paper/account").json()
    assert acc["balance"] == pytest.approx(10_000)
    assert "виртуални" in acc["virtual_funds_notice"]

    # 8-9: virtual trade with SL/TP, preview first ("How much are you risking?")
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
    prev = guest.post("/api/paper/orders/preview", json=order).json()
    assert prev["plan"]["reward_risk"] == pytest.approx(2, rel=0.05)
    assert prev["plan"]["risk_pct"] < 1
    placed = guest.post("/api/paper/orders", json=order).json()
    assert placed["order"]["status"] == "filled"
    pos = placed["view"]["positions"][0]
    assert pos["stop_loss"] == order["stop_loss"]

    # move stop loss closer (allowed), widening is tracked as a risk event
    r = guest.patch(f"/api/paper/positions/{pos['id']}", json={"stop_loss": round(price * 0.98, 2)})
    assert r.status_code == 200
    bad = guest.patch(f"/api/paper/positions/{pos['id']}", json={"stop_loss": round(price * 1.05, 2)})
    assert bad.status_code == 400

    # oversized trade → warning but not blocked (educational)
    big = {"symbol": "ETH/USDT", "side": "sell", "qty": 2.0, "stop_loss": None}
    prev_big = guest.post("/api/paper/orders/preview", json=big).json()
    assert any(f["kind"] == "no_stop" for f in prev_big["findings"])

    # 10-11: partial close, close, see P/L
    r = guest.post(f"/api/paper/positions/{pos['id']}/close", json={"qty": 0.004})
    assert r.status_code == 200
    r = guest.post(f"/api/paper/positions/{pos['id']}/close", json={})
    assert r.status_code == 200
    view = r.json()["view"]
    assert view["metrics"]["total_trades"] == 2
    assert view["realized_pnl"] != 0

    # 12: trade review
    review = guest.get(f"/api/paper/positions/{pos['id']}/review").json()
    assert review["title"] == "TRADE REVIEW" and review["main_lesson"]
    chat = guest.post("/api/ai/chat", json={"message": "Защо загубих този trade?"}).json()
    assert "TRADE REVIEW" in chat["answer"]

    # 13: create strategy from the builder
    strategy = {
        "name": "RSI pullback test",
        "symbol": "BTC/USDT",
        "timeframe": "1h",
        "definition": {
            "entry_long": {
                "logic": "all",
                "conditions": [
                    {
                        "left": {"kind": "indicator", "name": "rsi", "params": {"period": 14}},
                        "op": "<",
                        "right": {"kind": "value", "value": 40},
                    },
                    {
                        "left": {"kind": "price", "field": "close"},
                        "op": ">",
                        "right": {"kind": "indicator", "name": "ema", "params": {"period": 200}},
                    },
                ],
            },
            "stop": {"type": "atr", "value": 2},
            "take_profit": {"type": "r_multiple", "value": 2},
        },
    }
    s = guest.post("/api/strategies", json=strategy)
    assert s.status_code == 200, s.text
    sid = s.json()["id"]
    assert s.json()["rules_count"] == 2
    bad_s = guest.post("/api/strategies", json={**strategy, "definition": {"stop": {"type": "atr", "value": 2}}})
    assert bad_s.status_code == 400
    sig = guest.get(f"/api/strategies/{sid}/signal?symbol=BTC/USDT&timeframe=1h").json()
    assert sig["signal"] in ("LONG SETUP", "SHORT SETUP", "NO TRADE")

    # 14: backtest (runs as a background task)
    now = int(time.time())
    bt = guest.post(
        "/api/backtests",
        json={
            "strategy_id": sid,
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "start_ts": now - 120 * 86400,
            "end_ts": now,
        },
    ).json()
    detail = guest.get(f"/api/backtests/{bt['id']}").json()
    assert detail["status"] == "done", detail.get("error")
    assert detail["validation"]["disclaimer"] == "Past backtest performance does not guarantee future results."
    assert "equity_curve" in detail and "trades" in detail
    for k in (
        "total_trades",
        "win_rate",
        "net_pnl",
        "profit_factor",
        "max_drawdown_pct",
        "average_r",
        "expectancy",
        "largest_win",
        "largest_loss",
    ):
        assert k in detail["metrics"]

    # 15: paper bot (warm start over recent history)
    bot = guest.post(
        "/api/bots",
        json={
            "name": "Test bot",
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "strategy_id": sid,
            "run_mode": "warm_start",
            "config": {"daily_loss_limit_pct": 3, "risk_per_trade_pct": 1, "warm_start_days": 20},
        },
    ).json()
    assert bot["status"] == "STOPPED" and "paper" in bot["paper_only_notice"].lower()
    started = guest.post(f"/api/bots/{bot['id']}/start").json()
    assert started["status"] in ("RUNNING", "PAUSED")
    assert started["last_processed_ts"] > now - 3 * 3600
    assert started["logs"]
    paused = guest.post(f"/api/bots/{bot['id']}/pause").json()
    assert paused["status"] == "PAUSED"
    stopped = guest.post(f"/api/bots/{bot['id']}/stop").json()
    assert stopped["status"] == "STOPPED" and not stopped["positions"]

    # 16: performance report + weekly coach + dashboard
    rep = guest.get("/api/stats/report").json()
    assert "metrics" in rep and "behavioral_mistakes" in rep
    coach = guest.get("/api/ai/coach").json()
    assert coach["title"] == "WEEKLY REVIEW" and coach["next_lessons"]
    dash = guest.get("/api/dashboard").json()
    for k in (
        "market_overview",
        "watchlist",
        "open_positions",
        "recent_trades",
        "learning",
        "bots",
        "strategy_performance",
        "risk",
        "ai_insights",
    ):
        assert k in dash


def test_ai_analyze_endpoint(guest):
    r = guest.post("/api/ai/analyze", json={"symbol": "EUR/USD", "timeframe": "4h"})
    assert r.status_code == 200
    body = r.json()
    assert body["panel"]["MARKET"] == "EUR/USD"
    assert "OBSERVATION" in body["explanation"]["text"]
    assert guest.get("/api/ai/status").json()["active"] == "offline"


def test_position_size_endpoint(client):
    r = client.post(
        "/api/risk/position-size", json={"balance": 10_000, "risk_pct": 1, "entry": 100, "stop": 98, "take_profit": 106}
    )
    body = r.json()
    assert body["qty"] == pytest.approx(50)
    assert body["plan"]["reward_risk"] == pytest.approx(3)
    assert body["explanation"] and body["ruin"]
    assert (
        client.post("/api/risk/position-size", json={"balance": 1, "risk_pct": 1, "entry": 1, "stop": 1}).status_code
        == 400
    )


def test_risk_rules_and_status(guest):
    rules = guest.get("/api/risk/rules").json()
    assert rules["max_risk_per_trade_pct"] == 1.0
    upd = guest.put("/api/risk/rules", json={**rules, "max_risk_per_trade_pct": 0.5}).json()
    assert upd["max_risk_per_trade_pct"] == 0.5
    st = guest.get("/api/risk/status").json()
    assert st["status"] in ("OK", "WARNING", "LIMIT")


def test_limit_order_and_cancel(guest):
    price = guest.get("/api/market/ticker?symbol=ETH/USDT").json()["price"]
    r = guest.post(
        "/api/paper/orders",
        json={
            "symbol": "ETH/USDT",
            "side": "buy",
            "type": "limit",
            "qty": 0.1,
            "price": round(price * 0.9, 2),
            "stop_loss": round(price * 0.85, 2),
        },
    )
    assert r.json()["order"]["status"] == "open"
    oid = r.json()["order"]["id"]
    assert any(o["id"] == oid for o in guest.get("/api/paper/account").json()["orders"])
    assert guest.delete(f"/api/paper/orders/{oid}").status_code == 200
    assert not guest.get("/api/paper/account").json()["orders"]
    missing = guest.post("/api/paper/orders", json={"symbol": "ETH/USDT", "side": "buy", "type": "limit", "qty": 0.1})
    assert missing.status_code == 422


def test_journal_crud_and_stats(guest):
    e = guest.post(
        "/api/journal",
        json={
            "setup": "pullback",
            "reason": "trend + support",
            "emotion": "calm",
            "confidence": 4,
            "lesson": "wait for the close",
            "tags": ["trend"],
            "mistakes": ["entered early"],
            "screenshot": "data:image/png;base64,iVBORw0KGgo=",
        },
    ).json()
    assert e["id"] and e["screenshot"].startswith("data:image/png")
    upd = guest.put(
        f"/api/journal/{e['id']}", json={"setup": "pullback", "reason": "x", "emotion": "FOMO", "lesson": "y"}
    ).json()
    assert upd["emotion"] == "FOMO"
    stats = guest.get("/api/journal/stats").json()
    assert stats["entries"] == 1
    bad = guest.post("/api/journal", json={"screenshot": "javascript:alert(1)"})
    assert bad.status_code == 400
    assert guest.delete(f"/api/journal/{e['id']}").status_code == 200


def test_replay_flow(guest):
    start = int(time.time()) - 30 * 86400
    s = guest.post("/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": start, "bars": 50}).json()
    sid = s["session"]["id"]
    cursor = s["session"]["cursor_ts"]
    assert max(c["time"] for c in s["candles"]) == cursor  # nothing from the future
    price = s["candles"][-1]["close"]
    o = guest.post(
        f"/api/replay/{sid}/order",
        json={"side": "buy", "qty": 0.01, "stop_loss": round(price * 0.97, 2), "take_profit": round(price * 1.03, 2)},
    ).json()
    assert o["order"]["status"] == "pending"  # fills on the next revealed candle
    st = guest.post(f"/api/replay/{sid}/step", json={"n": 5}).json()
    assert st["session"]["cursor_ts"] == cursor + 5 * 3600
    assert max(c["time"] for c in st["candles"]) == st["session"]["cursor_ts"]
    fin = guest.post(f"/api/replay/{sid}/finish").json()
    assert fin["session"]["status"] == "finished"
    assert fin["reviews"] and fin["what_happened_next"]


def test_challenges(guest):
    ch = guest.get("/api/challenges").json()["challenges"]
    keys = {c["key"] for c in ch}
    assert {"identify_trend", "find_support", "risk_1pct", "no_overtrade", "twenty_with_stop", "trade_breakout"} <= keys
    rounds = guest.get("/api/challenges/identify_trend/rounds").json()["rounds"]
    from app.academy.challenges import verify_token

    answers = [{"token": r["token"], "answer": verify_token(r["token"])["a"]} for r in rounds]
    res = guest.post("/api/challenges/identify_trend/attempt", json={"answers": answers}).json()
    assert res["passed"] and res["xp_gained"] == 30
    forged = [{"token": rounds[0]["token"][:-2] + "zz", "answer": "uptrend"}]
    assert guest.post("/api/challenges/identify_trend/attempt", json={"answers": forged}).json()["correct"] == 0


def test_watchlist_and_settings(guest):
    assert guest.post("/api/market/watchlist", json={"symbol": "TSLA"}).status_code == 200
    items = guest.get("/api/market/watchlist").json()["items"]
    row = next(i for i in items if i["symbol"] == "TSLA")
    for k in ("price", "change_24h_pct", "volume_24h", "volatility_pct", "trend", "regime"):
        assert k in row
    assert guest.delete("/api/market/watchlist/TSLA").status_code == 200
    s = guest.put("/api/settings", json={"tour_done": True, "default_timeframe": "4h"}).json()["settings"]
    assert s["tour_done"] is True and s["default_timeframe"] == "4h"
    assert guest.patch("/api/auth/me", json={"mode": "advanced"}).json()["mode"] == "advanced"


def test_news_without_key(client):
    n = client.get("/api/news").json()
    assert n["configured"] is False and n["items"] == []


def test_lessons_endpoint_covers_all(guest):
    mods = guest.get("/api/academy/modules").json()["modules"]
    assert sum(m["lessons_total"] for m in mods) == len(LESSONS_BY_SLUG)
    assert guest.get("/api/academy/lessons/nope").status_code == 404
