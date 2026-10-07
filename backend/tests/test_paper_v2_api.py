"""S2 — additive query parameters of the paper endpoints used by the trading terminal."""

from __future__ import annotations


def _round_trip(guest, symbol: str, qty: float) -> None:
    placed = guest.post("/api/paper/orders", json={"symbol": symbol, "side": "buy", "qty": qty}).json()
    assert placed["order"]["status"] == "filled", placed["order"]["reject_reason"]
    pos = next(p for p in placed["view"]["positions"] if p["symbol"] == symbol)
    assert guest.post(f"/api/paper/positions/{pos['id']}/close", json={}).status_code == 200


def test_trades_can_be_filtered_by_symbol(guest):
    _round_trip(guest, "EUR/USD", 1_000)
    _round_trip(guest, "BTC/USDT", 0.01)
    _round_trip(guest, "EUR/USD", 2_000)
    every = guest.get("/api/paper/trades").json()["trades"]
    assert sorted(t["symbol"] for t in every) == ["BTC/USDT", "EUR/USD", "EUR/USD"]
    closed = [t["closed_ts"] for t in every]
    assert closed == sorted(closed, reverse=True)  # newest first
    eur = guest.get("/api/paper/trades", params={"symbol": "EUR/USD"}).json()["trades"]
    assert sorted(t["qty"] for t in eur) == [1_000, 2_000]
    assert {t["symbol"] for t in eur} == {"EUR/USD"}
    # slugs and compact spellings resolve to the catalog symbol
    assert len(guest.get("/api/paper/trades", params={"symbol": "btc-usdt"}).json()["trades"]) == 1
    assert len(guest.get("/api/paper/trades", params={"symbol": "EUR/USD", "limit": 1}).json()["trades"]) == 1
    assert guest.get("/api/paper/trades", params={"symbol": "NOPE/USD"}).status_code == 404


def test_events_limit(guest):
    _round_trip(guest, "EUR/USD", 1_000)
    _round_trip(guest, "EUR/USD", 1_000)
    default = guest.get("/api/paper/events").json()["events"]
    assert len(default) >= 4
    assert {"id", "ts", "type", "message", "data"} <= set(default[0])
    ids = [e["id"] for e in default]
    assert ids == sorted(ids, reverse=True)  # newest first
    two = guest.get("/api/paper/events", params={"limit": 2}).json()["events"]
    assert [e["id"] for e in two] == ids[:2]
    assert guest.get("/api/paper/events", params={"limit": 0}).status_code == 422
    assert guest.get("/api/paper/events", params={"limit": 501}).status_code == 422
