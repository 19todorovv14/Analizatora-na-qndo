"""W4a adversarial review — regression tests for the safety invariants and the bugs fixed in that pass."""

from __future__ import annotations

import ast
import pathlib
import re
import time

import pytest
from fastapi.testclient import TestClient

from app.ai.safety import find_violations, sanitize, sanitize_lines
from app.core.json_guard import has_non_finite
from app.database import Base, SessionLocal
from app.main import app
from app.market.base import redact_secrets
from app.market.catalog import get_asset
from app.models import PaperAccount, User
from app.paper_engine.models import ExecutionConfig
from app.risk.engine import RiskRules
from app.services import settings_service
from tests.conftest import HEADERS

APP_DIR = pathlib.Path(__file__).resolve().parents[1] / "app"


@pytest.fixture(autouse=True)
def _app_started(client):
    """Every test needs the app lifespan (tables, seed) — the session-wide `client` fixture runs it."""
    yield


def _new_guest() -> TestClient:
    c = TestClient(app)
    assert c.post("/api/auth/guest", headers=HEADERS).status_code == 200
    c.headers.update(HEADERS)
    return c


def _user_id(c: TestClient) -> int:
    return c.get("/api/auth/me").json()["id"]


# ===================================================================================== safety invariants
def _calls(path: pathlib.Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            yield node


def test_outbound_http_is_read_only_get():
    """Every outbound HTTP request of the backend is a GET to a public / read-only market-data endpoint:
    no POST/PUT/PATCH/DELETE through an HTTP client, and no exchange order / account / withdrawal endpoint."""
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "urllib.request" not in source and "import requests" not in source, path
        if "httpx" not in source and "anthropic" not in source:
            continue
        for call in _calls(path):
            receiver = ast.unparse(call.func.value)
            if call.func.attr in ("post", "put", "patch", "delete", "request", "stream", "send") and re.search(
                r"client|httpx", receiver, re.I
            ):
                offenders.append(f"{path.name}:{call.lineno} {ast.unparse(call.func)}")
    assert not offenders, offenders
    private = re.compile(
        r"/api/v3/(?:order|account|myTrades|openOrders|allOrders)|/sapi/|/fapi/|/dapi/|X-MBX-APIKEY|signature=", re.I
    )
    hits = [
        f"{path.relative_to(APP_DIR)}:{i}"
        for path in APP_DIR.rglob("*.py")
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if private.search(line) and "_SECRET_PARAM" not in line and "signature)=" not in line
    ]
    assert not hits, hits


def test_future_live_adapter_cannot_be_constructed_or_selected():
    from app.exchange.base import LiveTradingDisabledError
    from app.exchange.live import FutureLiveExecutionAdapter
    from app.exchange.registry import LIVE_TRADING_AVAILABLE, get_adapter

    assert LIVE_TRADING_AVAILABLE is False and FutureLiveExecutionAdapter.enabled is False
    with pytest.raises(LiveTradingDisabledError):
        FutureLiveExecutionAdapter(api_key="k", api_secret="s")
    for mode in ("live", "LIVE", "future_live", "binance", "real"):
        with pytest.raises(LiveTradingDisabledError):
            get_adapter(mode)


_SECRET_COLUMN = re.compile(
    r"api_?key|secret|private_?key|seed|mnemonic|passphrase|withdraw|wallet|card|iban|cvv|payment|credential", re.I
)


def test_no_table_stores_trading_or_payment_credentials():
    allowed = {("users", "password_hash"), ("user_sessions", "token_hash")}  # salted hashes for login only
    found = []
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if _SECRET_COLUMN.search(col.name) and (table.name, col.name) not in allowed:
                found.append(f"{table.name}.{col.name}")
    assert not found, found


def test_settings_never_store_unknown_keys_such_as_api_keys(guest):
    r = guest.put(
        "/api/settings",
        json={
            "binance_api_key": "k",
            "api_secret": "s",
            "seed_phrase": "a b c",
            "private_key": "0x1",
            "tour_done": True,
        },
    )
    assert r.status_code == 200
    stored = r.json()["settings"]
    assert stored["tour_done"] is True
    for k in ("binance_api_key", "api_secret", "seed_phrase", "private_key"):
        assert k not in stored
    with SessionLocal() as db:
        user = db.get(User, _user_id(guest))
        assert not any(k in (user.settings or {}) for k in ("binance_api_key", "api_secret", "seed_phrase"))


def test_configured_api_keys_are_redacted_verbatim(monkeypatch):
    import app.config as config

    real = config.get_settings()
    fake = real.model_copy(update={"twelvedata_api_key": "TDKEY-123456789", "finnhub_api_key": "FHKEY-987654321"})
    monkeypatch.setattr(config, "get_settings", lambda: fake)
    text = 'Twelve Data error: "TDKEY-123456789" is not valid; finnhub FHKEY-987654321 rejected'
    out = redact_secrets(text)
    assert "TDKEY-123456789" not in out and "FHKEY-987654321" not in out and "***" in out


@pytest.mark.parametrize(
    "text",
    [
        "BTC will reach 120000 next week.",
        "The price is going to hit 1.20 soon.",
        "ETH will definitely go up to 5000.",
        "This coin will moon.",
        "It will certainly rally from here.",
        "Цената ще достигне 1.1050 до петък.",
        "Златото със сигурност ще се покачи.",
        "Акцията ще се срине утре.",
        "BUY NOW — guaranteed profit!",
    ],
)
def test_safety_filter_blocks_price_predictions(text):
    assert find_violations(text), text
    clean, removed = sanitize(f"Наблюдение: тренд нагоре. {text}")
    assert removed and text not in clean and clean.startswith("Наблюдение: тренд нагоре.")
    lines, removed_lines = sanitize_lines([text])
    assert removed_lines and lines == []


def test_safety_filter_keeps_decimal_prices_inside_one_sentence():
    """Before: "1.0900" was split at the dot, so removing "Купи сега на 1." left an orphaned "0900!" behind."""
    clean, removed = sanitize("EUR/USD е 1.0850. Купи сега на 1.0900! Риск: 1%.")
    assert removed == ["Купи сега"] and "0900" not in clean and clean.startswith("EUR/USD е 1.0850. Риск: 1%.")
    lines, _ = sanitize_lines(["Stop под 1.0800, target 1.0950.", "BTC will reach 120.5 soon."])
    assert lines == ["Stop под 1.0800, target 1.0950."]


@pytest.mark.parametrize(
    "text",
    [
        "Никой не знае дали цената ще достигне 1.1050.",
        "Това не означава, че цената ще падне.",
        "It is not known whether BTC will reach 120000.",
        "Ако цената достигне stop loss-а, позицията се затваря.",
        "Invalidation би било затваряне под 95.",
    ],
)
def test_safety_filter_keeps_negated_or_conditional_teaching_text(text):
    assert not find_violations(text), text


# ===================================================================================== non-finite JSON numbers
@pytest.mark.parametrize(
    "body",
    [
        '{"symbol":"BTC/USDT","side":"sell","qty":0.01,"stop_loss":Infinity}',
        '{"symbol":"BTC/USDT","side":"buy","qty":Infinity}',
        '{"symbol":"BTC/USDT","side":"buy","qty":NaN}',
        '{"symbol":"BTC/USDT","side":"buy","qty":0.01,"take_profit":1e999}',
        '{"symbol":"BTC/USDT","side":"buy","qty":0.01,"stop_loss":-Infinity}',
    ],
)
def test_non_finite_numbers_are_rejected_and_never_stored(body):
    """Before: the order was stored with stop_loss=inf and GET /api/paper/account answered 500 forever."""
    g = _new_guest()
    r = g.post("/api/paper/orders", content=body, headers={"content-type": "application/json"})
    assert r.status_code == 422 and r.json()["code"] == "NON_FINITE_NUMBER"
    acc = g.get("/api/paper/account")
    assert acc.status_code == 200 and acc.json()["positions"] == []


def test_non_finite_guard_keeps_normal_json_working(guest):
    assert not has_non_finite(b'{"setup":"NaN Infinity are words here","entry":1.5e10}')
    assert has_non_finite(b'{"entry":NaN}') and has_non_finite(b"[1e400]")
    assert not has_non_finite(b"not json at all")
    r = guest.post("/api/journal", json={"setup": "NaN Infinity", "reason": "text only", "entry": 101.5})
    assert r.status_code == 200 and r.json()["setup"] == "NaN Infinity"
    bad = guest.post("/api/journal", content='{"setup":"x","entry":NaN}', headers={"content-type": "application/json"})
    assert bad.status_code == 422
    listed = guest.get("/api/journal")
    assert listed.status_code == 200 and len(listed.json()["entries"]) == 1
    # malformed JSON is still FastAPI's ordinary 422 (unchanged behaviour)
    r = guest.post("/api/journal", content="{bad json", headers={"content-type": "application/json"})
    assert r.status_code == 422 and "code" not in r.json()


# ===================================================================================== settings validation
@pytest.mark.parametrize(
    "patch",
    [
        {"max_trades_per_day": None},
        {"max_trades_per_day": "abc"},
        {"max_trades_per_day": 0},
        {"max_trades_per_day": 2.5},
        {"tour_done": {"x": 1}},
        {"news_risk": "yes"},
        {"default_symbol": {"a": 1}},
        {"default_timeframe": 5},
        {"risk_rules": {"max_risk_per_trade_pct": "abc"}},
        {"risk_rules": {"max_open_positions": None}},
        {"risk_rules": "nope"},
        {"execution": {"latency_ms": None}},
        {"execution": {"stop_out_level": -5}},
        {"execution": {"intrabar_policy": "zzz"}},
    ],
)
def test_put_settings_rejects_invalid_values_with_422(guest, patch):
    """Before: these were stored and broke /dashboard, /stats/behavior, /risk/status or order placement (500)."""
    r = guest.put("/api/settings", json=patch)
    assert r.status_code == 422, r.text
    assert guest.get("/api/dashboard").status_code == 200
    assert guest.get("/api/stats/behavior").status_code == 200
    assert guest.get("/api/risk/status").status_code == 200


def test_valid_settings_still_save(guest):
    r = guest.put(
        "/api/settings",
        json={
            "max_trades_per_day": 5,
            "news_risk": True,
            "default_timeframe": "4h",
            "app_mode": "trade",
            "risk_rules": {"max_risk_per_trade_pct": 0.5},
            "execution": {"latency_ms": 100},
        },
    )
    assert r.status_code == 200, r.text
    s = r.json()["settings"]
    assert s["max_trades_per_day"] == 5 and s["news_risk"] is True and s["default_timeframe"] == "4h"
    assert s["risk_rules"]["max_risk_per_trade_pct"] == 0.5 and s["execution"]["latency_ms"] == 100


def test_stored_invalid_settings_read_as_defaults():
    """Values saved before validation existed must not crash the engines that read them."""
    user = User(
        email=None,
        display_name="x",
        settings={
            "max_trades_per_day": None,
            "news_risk": "yes",
            "tour_done": {"a": 1},
            "risk_rules": {"max_risk_per_trade_pct": "abc", "max_open_positions": None, "min_reward_risk": -3},
            "execution": {"latency_ms": None, "stop_out_level": "x", "spread_multiplier": 1e9, "intrabar_policy": 1},
        },
    )
    s = settings_service.user_settings(user)
    assert s["max_trades_per_day"] == 8 and s["news_risk"] is False and s["tour_done"] is False
    rules = settings_service.risk_rules(user)
    assert rules.max_risk_per_trade_pct == RiskRules().max_risk_per_trade_pct
    assert rules.max_open_positions == RiskRules().max_open_positions
    assert rules.min_reward_risk == pytest.approx(0.001)  # clamped into range
    cfg = settings_service.execution_config(user)
    assert cfg.latency_ms == ExecutionConfig().latency_ms and cfg.stop_out_level == 0.5
    assert cfg.spread_multiplier == 10.0 and cfg.intrabar_policy == "worst_case"
    user.settings = "garbage"
    assert settings_service.user_settings(user)["risk_rules"] == RiskRules().to_dict()


def test_strict_dataclass_validation_messages():
    with pytest.raises(ValueError, match="latency_ms"):
        ExecutionConfig.from_dict({"latency_ms": "abc"}, strict=True)
    with pytest.raises(ValueError, match="fees_enabled"):
        ExecutionConfig.from_dict({"fees_enabled": "no"}, strict=True)
    with pytest.raises(ValueError, match="max_open_positions"):
        RiskRules.from_dict({"max_open_positions": 0}, strict=True)
    assert ExecutionConfig.from_dict({"unknown": 1, "latency_ms": 10.4}, strict=True).latency_ms == 10
    assert RiskRules.from_dict(None) == RiskRules()


@pytest.mark.parametrize(
    "execution",
    [
        {"latency_ms": None},
        {"stop_out_level": None},
        {"stop_out_level": -5},
        {"participation_rate": 0},
        {"intrabar_policy": "zzz"},
        {"liquidation_enabled": "off"},
        {"spread_multiplier": "x"},
    ],
)
def test_patch_paper_account_rejects_invalid_execution(execution):
    """Before: {"latency_ms": null} made every later market order a 500, {"stop_out_level": null} broke the account."""
    g = _new_guest()
    r = g.patch("/api/paper/account", json={"execution": execution})
    assert r.status_code == 400, r.text
    placed = g.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.01})
    assert placed.status_code == 200 and placed.json()["order"]["status"] in ("filled", "partially_filled")
    assert g.get("/api/paper/account").status_code == 200


def test_stored_invalid_execution_config_never_breaks_the_account():
    g = _new_guest()
    assert g.get("/api/paper/account").status_code == 200
    uid = _user_id(g)
    with SessionLocal() as db:
        acc = db.query(PaperAccount).filter(PaperAccount.user_id == uid, PaperAccount.kind == "manual").one()
        acc.execution = {**(acc.execution or {}), "latency_ms": None, "stop_out_level": None, "participation_rate": "x"}
        db.commit()
    placed = g.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.01})
    assert placed.status_code == 200, placed.text
    assert g.get("/api/paper/account").status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"max_risk_per_trade_pct": "abc"},
        {"max_risk_per_trade_pct": None},
        {"max_open_positions": "x"},
        {"require_stop_loss": "no"},
    ],
)
def test_put_risk_rules_invalid_types_are_400_not_500(guest, body):
    r = guest.put("/api/risk/rules", json=body)
    assert r.status_code == 400, r.text
    assert guest.get("/api/risk/rules").json() == RiskRules().to_dict()


# ===================================================================================== bounds / overflow
def test_paper_trades_limit_must_be_positive(guest):
    assert guest.get("/api/paper/trades?limit=-1").status_code == 422
    assert guest.get("/api/paper/trades?limit=0").status_code == 422
    assert guest.get("/api/paper/trades?limit=5").status_code == 200


def test_absurd_limit_price_is_not_a_500(guest):
    """Before: max_qty = free / (1e-300 …) overflowed in round_qty → OverflowError → 500."""
    spec = get_asset("BTC/USDT")
    assert spec.round_qty(1e306) == 1e306 and spec.round_qty(float("inf")) == 0.0 and spec.round_qty(0.0123456) > 0
    body = {"symbol": "BTC/USDT", "side": "buy", "type": "limit", "qty": 0.01, "price": 1e-300}
    assert guest.post("/api/paper/orders/preview", json=body).status_code in (200, 400)
    assert guest.post("/api/paper/orders", json=body).status_code in (200, 400)
    assert guest.get("/api/paper/account").status_code == 200


# ===================================================================================== guest isolation
STRATEGY = {
    "name": "A private strategy",
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "definition": {
        "entry_long": {
            "conditions": [
                {
                    "left": {"kind": "indicator", "name": "rsi", "params": {"period": 14}},
                    "op": "<",
                    "right": {"kind": "value", "value": 30},
                }
            ]
        },
    },
}


def _owner_with_data() -> tuple[TestClient, dict]:
    a = _new_guest()
    ids: dict = {}
    price = a.get("/api/market/ticker?symbol=BTC/USDT").json()["price"]
    placed = a.post(
        "/api/paper/orders",
        json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.02, "stop_loss": round(price * 0.95, 2)},
    ).json()
    ids["position"] = placed["view"]["positions"][0]["id"]
    ids["order"] = placed["order"]["id"]
    closed = a.post(f"/api/paper/positions/{ids['position']}/close", json={"qty": 0.01})
    assert closed.status_code == 200
    pending = a.post(
        "/api/paper/orders",
        json={"symbol": "BTC/USDT", "side": "buy", "type": "limit", "qty": 0.01, "price": round(price * 0.5, 2)},
    ).json()
    ids["pending_order"] = pending["order"]["id"]
    ids["journal"] = a.post("/api/journal", json={"setup": "secret A", "trade_id": ids["position"]}).json()["id"]
    ids["strategy"] = a.post("/api/strategies", json=STRATEGY).json()["id"]
    now = int(time.time())
    ids["backtest"] = a.post(
        "/api/backtests",
        json={
            "strategy_id": ids["strategy"],
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "start_ts": now - 20 * 86400,
            "end_ts": now,
        },
    ).json()["id"]
    bot = a.post(
        "/api/bots", json={"name": "A bot", "symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": ids["strategy"]}
    )
    assert bot.status_code == 200, bot.text
    ids["bot"] = bot.json()["id"]
    rep = a.post(
        "/api/replay", json={"symbol": "BTC/USDT", "timeframe": "1h", "start_ts": now - 30 * 86400, "bars": 30}
    )
    ids["replay"] = rep.json()["session"]["id"]
    ids["chat"] = a.post("/api/ai/chat", json={"message": "Какво е stop loss?"}).json()["session_id"]
    return a, ids


def test_user_b_cannot_read_or_change_user_a_data():
    a, ids = _owner_with_data()
    b = _new_guest()
    denied = [
        ("GET", f"/api/strategies/{ids['strategy']}", None),
        ("PUT", f"/api/strategies/{ids['strategy']}", {**STRATEGY, "name": "hijack"}),
        ("POST", f"/api/strategies/{ids['strategy']}/copy", None),
        ("GET", f"/api/strategies/{ids['strategy']}/signal?symbol=BTC/USDT&timeframe=1h", None),
        ("DELETE", f"/api/strategies/{ids['strategy']}", None),
        ("GET", f"/api/backtests/{ids['backtest']}", None),
        ("DELETE", f"/api/backtests/{ids['backtest']}", None),
        ("GET", f"/api/bots/{ids['bot']}", None),
        ("GET", f"/api/bots/{ids['bot']}/coach", None),
        ("POST", f"/api/bots/{ids['bot']}/start", None),
        ("DELETE", f"/api/bots/{ids['bot']}", None),
        ("PUT", f"/api/journal/{ids['journal']}", {"setup": "hijack"}),
        ("DELETE", f"/api/journal/{ids['journal']}", None),
        ("POST", f"/api/journal/{ids['journal']}/ai-review", None),
        ("GET", f"/api/replay/{ids['replay']}", None),
        ("POST", f"/api/replay/{ids['replay']}/step", {"n": 1}),
        ("POST", f"/api/replay/{ids['replay']}/decision", {"action": "wait"}),
        ("POST", f"/api/replay/{ids['replay']}/finish", None),
        ("GET", f"/api/replay/{ids['replay']}/review", None),
        ("GET", f"/api/ai/sessions/{ids['chat']}", None),
        ("GET", f"/api/paper/positions/{ids['position']}/review", None),
        ("POST", f"/api/paper/positions/{ids['position']}/close", {}),
        ("PATCH", f"/api/paper/positions/{ids['position']}", {"stop_loss": 1.0}),
        ("DELETE", f"/api/paper/orders/{ids['pending_order']}", None),
        (
            "POST",
            "/api/backtests",
            {
                "strategy_id": ids["strategy"],
                "symbol": "BTC/USDT",
                "timeframe": "1h",
                "start_ts": int(time.time()) - 86400 * 5,
                "end_ts": int(time.time()),
            },
        ),
        ("POST", "/api/bots", {"name": "x", "symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": ids["strategy"]}),
        ("POST", "/api/ai/analyze", {"symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": ids["strategy"]}),
        ("POST", "/api/teacher/ask", {"mode": "review_trade", "position_id": ids["position"]}),
        ("POST", "/api/teacher/ask", {"mode": "review_strategy", "backtest_id": ids["backtest"]}),
    ]
    for method, path, body in denied:
        r = b.request(method, path, json=body)
        assert r.status_code in (400, 403, 404), f"{method} {path} → {r.status_code} {r.text[:200]}"
        assert "secret A" not in r.text and "A private strategy" not in r.text, f"{method} {path} leaked data"

    # B's own lists never contain A's rows
    assert all(s["id"] != ids["strategy"] for s in b.get("/api/strategies").json()["strategies"])
    assert b.get("/api/backtests").json()["backtests"] == []
    assert b.get("/api/bots").json()["bots"] == []
    assert b.get("/api/journal").json()["entries"] == []
    assert b.get("/api/replay").json()["sessions"] == []
    assert b.get("/api/ai/sessions").json()["sessions"] == []
    assert b.get("/api/paper/trades").json()["trades"] == []
    assert b.get("/api/paper/account").json()["positions"] == []
    # linking A's position from B's journal does not import A's trade
    linked = b.post("/api/journal", json={"setup": "b", "trade_id": ids["position"]}).json()
    assert linked["result"] is None and linked.get("r_multiple") is None and linked["symbol"] is None
    # chatting into A's session id opens a NEW session for B
    assert b.post("/api/ai/chat", json={"message": "hi", "session_id": ids["chat"]}).json()["session_id"] != ids["chat"]

    # …and A's data is intact
    assert a.get(f"/api/strategies/{ids['strategy']}").status_code == 200
    assert a.get(f"/api/backtests/{ids['backtest']}").status_code == 200
    assert a.get(f"/api/bots/{ids['bot']}").status_code == 200
    assert a.get(f"/api/replay/{ids['replay']}").status_code == 200
    assert any(e["id"] == ids["journal"] and e["setup"] == "secret A" for e in a.get("/api/journal").json()["entries"])
    assert any(p["id"] == ids["position"] for p in a.get("/api/paper/account").json()["positions"])


def test_non_finite_values_in_responses_become_null_instead_of_500():
    from app.core.json_guard import SafeJSONResponse
    from app.models import PaperPosition

    assert (
        SafeJSONResponse({"a": float("inf"), "b": [1.5, float("nan")], "c": "x"}).body
        == b'{"a":null,"b":[1.5,null],"c":"x"}'
    )
    assert SafeJSONResponse({"a": 1.25}).body == b'{"a":1.25}'
    # a row stored before the request guard existed (stop_loss = inf) no longer bricks the account
    g = _new_guest()
    placed = g.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.01}).json()
    pid = placed["view"]["positions"][0]["id"]
    with SessionLocal() as db:
        db.get(PaperPosition, pid).take_profit = float("inf")
        db.commit()
    r = g.get("/api/paper/account")
    assert r.status_code == 200
    assert next(p for p in r.json()["positions"] if p["id"] == pid)["take_profit"] is None


def test_bots_per_user_are_capped(monkeypatch):
    from app.services import bot_service

    monkeypatch.setattr(bot_service, "MAX_BOTS_PER_USER", 2)
    g = _new_guest()
    sid = g.post("/api/strategies", json=STRATEGY).json()["id"]
    body = {"name": "b", "symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": sid}
    assert g.post("/api/bots", json=body).status_code == 200
    assert g.post("/api/bots", json=body).status_code == 200
    third = g.post("/api/bots", json=body)
    assert third.status_code == 400 and "Максимум 2" in third.json()["detail"]
    assert len(g.get("/api/bots").json()["bots"]) == 2
    other = _new_guest()  # the cap is per user
    sid2 = other.post("/api/strategies", json=STRATEGY).json()["id"]
    assert other.post("/api/bots", json={**body, "strategy_id": sid2}).status_code == 200


def test_journal_list_is_paged(guest):
    for i in range(3):
        assert guest.post("/api/journal", json={"setup": f"s{i}"}).status_code == 200
    page = guest.get("/api/journal?limit=2").json()
    assert [e["setup"] for e in page["entries"]] == ["s2", "s1"] and page["total"] == 3
    assert [e["setup"] for e in guest.get("/api/journal?limit=2&offset=2").json()["entries"]] == ["s0"]
    assert len(guest.get("/api/journal").json()["entries"]) == 3  # default: everything up to 500
    assert guest.get("/api/journal?limit=0").status_code == 422


def test_vwap_on_daily_bars_is_anchored_weekly_not_per_bar():
    from app.indicators import compute, vwap
    from app.market.base import Candle

    day = 86_400
    monday = 1_759_708_800  # 2025-10-06 00:00 UTC (a Monday)
    bars = [Candle(monday + i * day, 10 + i, 12 + i, 9 + i, 11 + i, 100 + 10 * i) for i in range(10)]
    v = vwap(bars)
    typical = [(c.high + c.low + c.close) / 3 for c in bars]
    assert v[0] == pytest.approx(typical[0])
    assert v[1] != pytest.approx(typical[1])  # accumulates over the week …
    expected = (typical[0] * 100 + typical[1] * 110) / 210
    assert v[1] == pytest.approx(expected)
    assert v[7] == pytest.approx(typical[7])  # … and resets on the next Monday
    assert compute("vwap", bars)["value"] == v
    hourly = [Candle(monday + i * 3600, 10, 11, 9, 10, 1) for i in range(30)]
    assert vwap(hourly) == vwap(hourly, anchor="day")


def test_replay_order_risk_is_measured_in_usd_for_non_usd_quotes(guest):
    """Before: replay used the quote-currency plan, so 10 000 USD/JPY (≈ $10k notional, ≈0.3 % risk) was reported as
    'unusually large risk', 15 090 % exposure and 150x leverage, and the stored risk_pct was ×150."""
    start = int(time.time()) - 30 * 86400
    s = guest.post("/api/replay", json={"symbol": "USD/JPY", "timeframe": "1h", "start_ts": start, "bars": 40}).json()
    sid, price = s["session"]["id"], s["candles"][-1]["close"]
    r = guest.post(f"/api/replay/{sid}/order", json={"side": "buy", "qty": 10_000, "stop_loss": round(price - 0.5, 3)})
    assert r.status_code == 200, r.text
    kinds = {f["kind"] for f in r.json()["findings"]}
    assert not kinds & {"oversized", "exposure", "leverage"}, r.json()["findings"]
    # a genuinely oversized USD/JPY order is still flagged
    big = guest.post(f"/api/replay/{sid}/order", json={"side": "buy", "qty": 2_000_000, "stop_loss": round(price - 1, 3)})
    assert big.status_code == 200 and "oversized" in {f["kind"] for f in big.json()["findings"]}


def test_hypothetical_setup_disclaimer_is_exact_everywhere(guest):
    from app.replay import comparison
    from app.strategies import meta, view

    exact = "This is a rule-based hypothetical setup, not a guarantee of future price movement."
    assert meta.SETUP_DISCLAIMER == view.SETUP_DISCLAIMER == comparison.SETUP_DISCLAIMER == exact
    r = guest.post("/api/strategies/check", json={"definition": STRATEGY["definition"]})
    assert r.status_code == 200 and r.json()["disclaimer"] == exact
    sid = guest.post("/api/strategies", json=STRATEGY).json()["id"]
    sig = guest.get(f"/api/strategies/{sid}/signal?symbol=BTC/USDT&timeframe=1h").json()
    assert sig["disclaimer"] == exact
