"""S3b — Lab endpoints under /api/learn: Candlestick Lab (gallery, examples, signed practice → QuizResult
"lab:candlesticks"), Market Structure Lab (exercise → check → structure_attempts → history) and the Leverage Lab."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.academy import patterns as P
from app.academy import structure_lab as S
from app.main import app
from app.market import catalog
from app.market.base import Candle
from app.models import QuizResult, StructureAttempt


@pytest.fixture
def synced_without_demo():
    spec = catalog.spec_from_item(
        {
            "symbol": "ZZLAB/EUR",
            "name": "Lab test coin",
            "asset_class": "crypto",
            "price_precision": 4,
            "qty_step": 1,
            "min_qty": 1,
            "max_leverage": 2,
            "spread_bps": 5,
            "providers": {"binance": "ZZLABEUR"},
        },
        curated=False,
        source="binance",
    )
    catalog.set_synced_assets([spec])
    yield spec
    catalog.clear_synced()


def _labs(path_body: dict) -> dict[str, object]:
    return {lab["href"]: lab["attempted"] for lvl in path_body["levels"] for lab in lvl["labs"]}


def _skill(dashboard: dict, key: str) -> dict:
    return next(s for s in dashboard["skills"] if s["key"] == key)


# ----------------------------------------------------------------------------------------- candlesticks
def test_gallery_and_single_pattern(client):
    r = client.get("/api/learn/candlesticks")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 24 and len(body["patterns"]) == 24
    assert body["types"] == ["single", "double", "triple"]
    one = client.get("/api/learn/candlesticks/morning_star").json()
    assert one["key"] == "morning_star" and one["type"] == "triple" and one["bias"] == "bullish"
    assert client.get("/api/learn/candlesticks/nope").status_code == 404


def test_examples_on_closed_candles_with_next_bar_statistics(client):
    now = int(time.time())
    r = client.get("/api/learn/candlesticks/doji/examples", params={"symbol": "BTC/USDT", "timeframe": "1h"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True and body["code"] is None and body["source"]["status"] == "demo"
    assert "not a prediction" in body["disclaimer"]
    assert body["horizons"] == [5, 10] and [s["bars"] for s in body["stats"]] == [5, 10]
    assert body["candles"] and all(c["time"] + 3600 <= now + 5 for c in body["candles"])  # closed candles only
    times = {c["time"] for c in body["candles"]}
    assert body["total_found"] >= len(body["examples"]) > 0
    for ex in body["examples"]:
        assert ex["time"] in times and ex["bars"] == 1
        for nxt in ex["next"]:
            assert nxt is None or {"bars", "close", "move", "move_pct", "move_atr", "direction"} <= set(nxt)
    assert body["sample_note"]


def test_examples_errors_and_data_not_available(client, synced_without_demo):
    url = "/api/learn/candlesticks/hammer/examples"
    assert client.get(url, params={"symbol": "NOPE/X"}).status_code == 404
    assert client.get(url, params={"timeframe": "2h"}).status_code == 400
    assert client.get("/api/learn/candlesticks/nope/examples").status_code == 404
    r = client.get(url, params={"symbol": synced_without_demo.symbol, "timeframe": "1h"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and body["code"] == "DATA_NOT_AVAILABLE" and body["reason"]
    assert body["candles"] == [] and body["examples"] == [] and body["source"] is None


def _answers(rounds):
    out = []
    for rnd in rounds:
        found = P.detected_at_end(rnd["candles"]) & {o["key"] for o in rnd["options"]}
        out.append({"token": rnd["token"], "answer": found.pop()})
    return out


def test_practice_flow_stores_a_quiz_result_and_feeds_the_dashboard(client, guest, db):
    assert client.get("/api/learn/candlesticks/practice", params={"n": 0}).status_code == 422
    assert client.get("/api/learn/candlesticks/practice", params={"n": 21}).status_code == 422
    data = client.get("/api/learn/candlesticks/practice", params={"n": 10}).json()
    assert len(data["rounds"]) == 10 and data["module"] == "lab:candlesticks"
    assert all(len(r["options"]) == 4 for r in data["rounds"])
    anon = TestClient(app)
    assert anon.post("/api/learn/candlesticks/practice", json={"answers": _answers(data["rounds"])}).status_code == 401
    before = _labs(guest.get("/api/learn/path").json())
    assert before["/learn/candlesticks"] is False
    answers = _answers(data["rounds"])
    answers[0]["answer"] = next(o["key"] for o in data["rounds"][0]["options"] if o["key"] != answers[0]["answer"])
    r = guest.post("/api/learn/candlesticks/practice", json={"answers": answers})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["stored"] is True and res["module"] == "lab:candlesticks"
    assert res["correct"] == 9 and res["total"] == 10 and res["score"] == pytest.approx(0.9) and res["passed"] is True
    assert len(res["results"]) == 10 and res["results"][0]["correct"] is False and res["results"][0]["explanation"]
    row = db.scalars(select(QuizResult).where(QuizResult.id == res["result_id"])).one()
    assert row.module == "lab:candlesticks" and row.score == pytest.approx(0.9)  # a fraction 0–1
    assert row.correct == 9 and row.total == 10 and row.passed is True
    assert row.answers["set_id"] == data["set_id"] and len(row.answers["rounds"]) == 10
    again = guest.post("/api/learn/candlesticks/practice", json={"answers": answers})
    assert again.status_code == 409
    assert _labs(guest.get("/api/learn/path").json())["/learn/candlesticks"] is True
    candles_skill = _skill(guest.get("/api/learn/dashboard").json(), "candles")
    assert candles_skill["inputs"]["practice_avg"] == pytest.approx(90)


def test_practice_with_only_invalid_tokens_is_rejected(guest):
    data = guest.get("/api/learn/candlesticks/practice", params={"n": 2}).json()
    tampered = [{"token": r["token"][:-2] + "00", "answer": "doji"} for r in data["rounds"]]
    r = guest.post("/api/learn/candlesticks/practice", json={"answers": tampered})
    assert r.status_code == 400
    assert guest.post("/api/learn/candlesticks/practice", json={"answers": []}).status_code == 422


# ------------------------------------------------------------------------------------- market structure
def _perfect(body):
    cs = [Candle(c["time"], c["open"], c["high"], c["low"], c["close"], c["volume"]) for c in body["candles"]]
    ref = S.analyze(cs)
    marks = [{"time": s.time, "price": s.price, "label": s.label} for s in ref.swings if s.label]
    marks += [{"time": e.time, "price": e.price, "label": e.type} for e in ref.events if not e.undetermined]
    return marks, ref.structure["expected"]


@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
def test_structure_exercise_shape(client, difficulty):
    now = int(time.time())
    r = client.get("/api/learn/structure/exercise", params={"difficulty": difficulty})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tasks"] == [
        "Mark every swing high/low as HH, HL, LH or LL",
        "What is the structure: uptrend / downtrend / range?",
        "Mark a breakout, a retest and a fakeout if present",
    ]
    assert body["difficulty"] == difficulty and body["difficulty_matched"] is True
    assert 80 <= len(body["candles"]) <= 140 and body["bars"] == len(body["candles"])
    assert body["start"] == body["candles"][0]["time"] and body["end"] == body["candles"][-1]["time"]
    from app.market.timeframes import tf_seconds

    assert all(c["time"] + tf_seconds(body["timeframe"]) <= now + 5 for c in body["candles"])
    assert len(body["anchors"]) >= 1 and body["labels"] == ["HH", "HL", "LH", "LL", "BREAKOUT", "RETEST", "FAKEOUT"]
    assert body["tolerance"]["bars"] == 2 and body["tolerance"]["atr_mult"] == 0.35
    assert "reference" not in body and "swings" not in body  # the answer is not shipped with the exercise
    assert client.get("/api/learn/structure/exercise", params={"difficulty": "extreme"}).status_code == 422


def test_structure_check_stores_once_and_history(guest, db):
    ex = guest.get("/api/learn/structure/exercise", params={"difficulty": "easy"}).json()
    assert _labs(guest.get("/api/learn/path").json())["/learn/market-structure"] is False
    marks, structure = _perfect(ex)
    payload = {"token": ex["token"], "marks": marks, "structure": structure}
    assert TestClient(app).post("/api/learn/structure/check", json=payload).status_code == 401
    r = guest.post("/api/learn/structure/check", json=payload)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["score"] == 100 and res["stored"] is True and res["attempt_id"]
    assert res["checker"] == "deterministic" and res["ai_summary"] is None
    assert all(m["verdict"] == "CORRECT" for m in res["marks"]) and res["missed"] == []
    assert res["structure"]["correct"] is True and res["reference"]["swings"]
    row = db.scalars(select(StructureAttempt).where(StructureAttempt.id == res["attempt_id"])).one()
    assert (
        row.score == 100 and row.symbol == ex["symbol"] and row.start_ts == ex["start"] and len(row.marks) == len(marks)
    )
    assert row.result["difficulty"] == "easy"
    again = guest.post("/api/learn/structure/check", json={**payload, "marks": marks[:1]})
    assert again.status_code == 200 and again.json()["stored"] is False and again.json()["note"]
    hist = guest.get("/api/learn/structure/history").json()
    assert hist["count"] == 1 and hist["best_score"] == 100 and hist["avg_score"] == 100 and hist["last_score"] == 100
    assert hist["by_difficulty"]["easy"]["count"] == 1 and hist["by_difficulty"]["hard"]["count"] == 0
    assert hist["attempts"][0]["symbol"] == ex["symbol"] and hist["attempts"][0]["marks"] == len(marks)
    assert _labs(guest.get("/api/learn/path").json())["/learn/market-structure"] is True
    assert _skill(guest.get("/api/learn/dashboard").json(), "structure")["inputs"]["practice_avg"] == pytest.approx(100)


def test_structure_check_errors(guest, synced_without_demo):
    ex = guest.get("/api/learn/structure/exercise", params={"difficulty": "medium"}).json()
    body, mac = ex["token"].rsplit(".", 1)
    bad = guest.post("/api/learn/structure/check", json={"token": body + "." + mac[::-1], "marks": []})
    assert bad.status_code == 400 and "token" in bad.json()["detail"]
    wrong_label = {"token": ex["token"], "marks": [{"time": ex["start"], "price": 1, "label": "TOP"}]}
    assert guest.post("/api/learn/structure/check", json=wrong_label).status_code == 422
    r = guest.get("/api/learn/structure/exercise", params={"symbol": synced_without_demo.symbol})
    assert r.status_code == 503 and r.json()["code"] == "DATA_NOT_AVAILABLE"
    assert guest.get("/api/learn/structure/exercise", params={"symbol": "NOPE/X"}).status_code == 404
    assert TestClient(app).get("/api/learn/structure/history").status_code == 401


def test_structure_exercise_for_a_chosen_symbol(client):
    r = client.get("/api/learn/structure/exercise", params={"symbol": "ETH/USDT", "timeframe": "4h"})
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "ETH/USDT" and body["timeframe"] == "4h"


# ------------------------------------------------------------------------------------------------ leverage
def test_leverage_simulate_endpoint(client):
    r = client.post("/api/learn/leverage/simulate", json={"leverage": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["position_notional"] == 2_000 and body["required_margin"] == 400 and body["asset"] is None
    assert body["warning"].startswith("Higher leverage magnifies exposure and liquidation risk.")
    assert [s["leverage"] for s in body["curves"]["series"]] == [1, 2, 5, 10, 20, 50, 100]
    assert body["curves_same_notional"]["position_notional"] == 2_000
    assert [s["move_pct"] for s in body["scenarios"]] == [-10, -5, -2, -1, 1, 2, 5, 10] and body["plan"] is None
    lite = client.post("/api/learn/leverage/simulate", json={"leverage": 20, "margin": 2_000, "price_move_pct": -5,
                                                             "include_curves": False}).json()  # fmt: skip
    assert lite["curves"] is None and lite["pnl_at_move"] == pytest.approx(-2_000)
    planned = client.post(
        "/api/learn/leverage/simulate",
        json={"leverage": 10, "risk_pct": 1, "entry_price": 100, "stop_price": 98, "target_price": 106,
              "scenario_moves": [-3, 3]},
    ).json()  # fmt: skip
    assert planned["basis"] == "risk" and planned["plan"]["risk_amount"] == pytest.approx(100)
    assert planned["plan"]["reward_risk"] == pytest.approx(3) and len(planned["scenarios"]) == 2


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"leverage": 150}, 422),
        ({"leverage": 0.5}, 422),
        ({"leverage": 5, "position_notional": 1_000, "margin": 100}, 400),
        ({"leverage": 5, "stop_price": 120}, 400),
        ({"leverage": 5, "risk_pct": 1}, 400),
        ({"leverage": 5, "scenario_moves": list(range(30))}, 422),
        ({"leverage": 5, "symbol": "NOPE/X"}, 404),
    ],
)
def test_leverage_simulate_validation(client, payload, status):
    assert client.post("/api/learn/leverage/simulate", json=payload).status_code == status


def test_leverage_simulate_with_an_instrument(client):
    body = client.post("/api/learn/leverage/simulate", json={"leverage": 5, "symbol": "BTC/USDT"}).json()
    spec = catalog.SPECS["BTC/USDT"]
    assert body["asset"]["max_leverage"] == spec.max_leverage == 2 and body["asset"]["leverage_allowed"] is False
    assert any("до 2x" in n for n in body["notes"])
    assert body["fee_rate"] == spec.taker_fee and body["spread_bps"] == spec.spread_bps
    assert body["daily_vol_source"] == "asset" and body["daily_vol_pct"] == pytest.approx(spec.daily_vol * 100)
    jpy = client.post("/api/learn/leverage/simulate", json={"leverage": 5, "symbol": "USD/JPY"}).json()
    assert jpy["asset"]["currency"] == "JPY" and any("превалутиране" in n for n in jpy["notes"])
    given = client.post("/api/learn/leverage/simulate", json={"leverage": 2, "symbol": "BTC/USDT", "fee_rate": 0,
                                                              "daily_vol_pct": 1}).json()  # fmt: skip
    assert (
        given["fee_rate"] == 0 and given["daily_vol_source"] == "given" and given["asset"]["leverage_allowed"] is True
    )


def test_leverage_scenario_endpoint(client):
    r = client.get("/api/learn/leverage/scenario", params={"stake": 2_000, "move_pct": -5})
    assert r.status_code == 200
    body = r.json()
    assert [s["leverage"] for s in body["steps"]] == [1, 5, 20]
    assert [round(s["pnl_pct_of_equity"]) for s in body["steps"]] == [-1, -5, -20]
    assert client.get("/api/learn/leverage/scenario", params={"stake": -1}).status_code == 422
