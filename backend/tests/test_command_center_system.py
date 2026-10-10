"""S7 — DATA SOURCES & AI SETTINGS info (/api/system/*), settings v2 defaults and the additive `data` of AI
session messages. The system endpoints must never return a secret value, even when keys are configured."""

from __future__ import annotations

import pytest

from app.ai import providers as ai_providers
from app.api import system
from app.config import get_settings
from app.market import registry
from app.models import CatalogSync

SECRETS = {
    "twelvedata_api_key": "TD-SECRET-9f8e7d6c5b4a",
    "finnhub_api_key": "FH-SECRET-1a2b3c4d5e6f",
    "coingecko_api_key": "CG-SECRET-0a9b8c7d6e5f",
    "anthropic_api_key": "sk-ant-SECRET-112233445566",
}
CLASS_KEYS = ("asset_class", "label", "env", "fallback_env", "inherited", "chain", "providers", "source", "status",
              "available", "reason", "instruments", "how_to_enable")
PROVIDER_KEYS = ("id", "name", "status", "source", "used_by", "configured", "key_required", "key_env", "key_present",
                 "problem", "reachable", "checked_at", "latency_ms", "http_status", "error", "stale", "rate_limit",
                 "docs_url", "note", "how_to_enable")


@pytest.fixture
def fresh_providers():
    """Providers built from the (patched) settings; health cache and caches reset afterwards."""
    registry._twelvedata.cache_clear()
    system.clear_health()
    yield
    registry._twelvedata.cache_clear()
    system.clear_health()


@pytest.fixture
def with_secrets(monkeypatch, fresh_providers):
    s = get_settings()
    for k, v in SECRETS.items():
        monkeypatch.setattr(s, k, v)
    monkeypatch.setattr(s, "market_data_stocks", "twelvedata")
    monkeypatch.setattr(s, "market_data_crypto", "binance,twelvedata")
    monkeypatch.setattr(s, "market_cap_provider", "coingecko")
    return s


def _assert_no_secret(text: str) -> None:
    for v in SECRETS.values():
        assert v not in text
        assert v[-8:] not in text


# ------------------------------------------------------------------ data sources
def test_data_sources_requires_auth(client):
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/system/data-sources").status_code == 401
    assert TestClient(app).get("/api/system/ai").status_code == 401


def test_data_sources_shape_demo_defaults(guest, fresh_providers):
    d = guest.get("/api/system/data-sources").json()
    assert "environment variables" in d["keys_policy"] and "withdrawal" in d["keys_policy"]
    assert [c["asset_class"] for c in d["classes"]] == ["crypto", "stock", "etf", "forex", "index", "commodity"]
    for c in d["classes"]:
        for k in CLASS_KEYS:
            assert k in c, (c["asset_class"], k)
        assert c["chain"] == ["demo"] and c["status"] == "demo" and c["available"] is True
        assert c["instruments"]["total"] >= c["instruments"]["available"] > 0
        assert c["instruments"]["serving"] == {"demo": c["instruments"]["available"]}
        assert c["instruments"]["supported_by"]["demo"] == c["instruments"]["total"]
        assert c["env"].startswith("MARKET_DATA_")
    etf = next(c for c in d["classes"] if c["asset_class"] == "etf")
    assert etf["fallback_env"] == "MARKET_DATA_STOCKS" and etf["inherited"] is True
    assert set(d["providers"]) == {"demo", "binance", "twelvedata"}
    for p in d["providers"].values():
        for k in PROVIDER_KEYS:
            assert k in p, (p["id"], k)
    demo, binance, td = d["providers"]["demo"], d["providers"]["binance"], d["providers"]["twelvedata"]
    assert demo["configured"] and demo["reachable"] is True and demo["key_present"] is None
    assert len(demo["used_by"]) == 6
    assert binance["key_required"] is False and binance["configured"] is False and binance["used_by"] == []
    assert binance["reachable"] is None and binance["checked_at"] is None  # never checked (no network in tests)
    assert td["key_required"] is True and td["key_env"] == "TWELVEDATA_API_KEY"
    assert td["key_present"] is False and td["status"] == "unavailable" and "TWELVEDATA_API_KEY" in td["problem"]
    cat = d["catalog"]
    assert cat["total"] == sum(cat["by_class"].values()) == sum(cat["by_source"].values())
    assert isinstance(cat["last_syncs"], list) and "auto_sync" in cat
    assert d["market_cap"]["provider"] == "none" and d["market_cap"]["status"] == "unavailable"
    assert d["news"]["configured"] is False and "FINNHUB_API_KEY" in d["news"]["how_to_enable"]
    assert d["health_checks"]["enabled"] is False and d["checked"] == []
    assert "enabled" in d["warmup"]


def test_data_sources_last_syncs_are_scrubbed(guest, db, fresh_providers, monkeypatch):
    monkeypatch.setattr(get_settings(), "twelvedata_api_key", SECRETS["twelvedata_api_key"])
    row = CatalogSync(provider="twelvedata", kind="stocks", started_ts=1_700_000_000, finished_ts=1_700_000_050,
                      status="error", count=0,
                      message=f"HTTP error for https://api.twelvedata.com/stocks?apikey={SECRETS['twelvedata_api_key']}")
    db.add(row)
    db.commit()
    try:
        r = guest.get("/api/system/data-sources")
        _assert_no_secret(r.text)
        syncs = r.json()["catalog"]["last_syncs"]
        hit = next(s for s in syncs if s["id"] == row.id)
        assert hit["provider"] == "twelvedata" and hit["status"] == "error" and hit["kind"] == "stocks"
        assert hit["finished_ts"] == 1_700_000_050 and "HTTP error" in hit["message"]
        assert syncs == sorted(syncs, key=lambda s: -s["id"])
    finally:
        db.delete(row)
        db.commit()


def test_system_endpoints_never_return_secrets(guest, with_secrets):
    r = guest.get("/api/system/data-sources")
    assert r.status_code == 200
    _assert_no_secret(r.text)
    d = r.json()
    td = d["providers"]["twelvedata"]
    assert td["key_present"] is True and td["problem"] is None and td["configured"] is True
    assert td["status"] == "delayed" and td["used_by"] == ["crypto", "stock", "etf", "index", "commodity"]
    stock = next(c for c in d["classes"] if c["asset_class"] == "stock")
    assert stock["chain"] == ["twelvedata"] and stock["status"] == "delayed" and stock["available"] is True
    assert stock["instruments"]["serving"].get("twelvedata") == stock["instruments"]["available"]
    crypto = next(c for c in d["classes"] if c["asset_class"] == "crypto")
    assert crypto["chain"] == ["binance", "twelvedata"] and crypto["status"] == "live"
    assert d["market_cap"]["configured"] is True and d["market_cap"]["key_present"] is True
    assert d["news"]["configured"] is True and d["news"]["key_present"] is True and d["news"]["provider"] == "finnhub"
    r = guest.get("/api/system/ai")
    assert r.status_code == 200
    _assert_no_secret(r.text)
    assert r.json()["key_present"] is True


def test_data_sources_without_provider_is_not_available(guest, fresh_providers, monkeypatch):
    monkeypatch.setattr(get_settings(), "market_data_fx", "twelvedata")  # no key configured
    d = guest.get("/api/system/data-sources").json()
    fx = next(c for c in d["classes"] if c["asset_class"] == "forex")
    assert fx["status"] == "unavailable" and fx["available"] is False
    assert "TWELVEDATA_API_KEY" in fx["reason"] and fx["instruments"]["available"] == 0
    assert fx["providers"][0]["problem"] and fx["providers"][0]["status"] == "unavailable"


# ------------------------------------------------------------------ cached health check
def test_health_check_is_cached_and_sends_no_keys(guest, with_secrets, monkeypatch):
    calls: list[str] = []

    def fake_probe(url, timeout=system.HEALTH_TIMEOUT):
        calls.append(url)
        return {"reachable": "binance" in url, "latency_ms": 12, "http_status": 200 if "binance" in url else None,
                "error": None if "binance" in url else "ConnectError: refused"}

    # disabled (APP_ENV=test) → ?check=true never probes
    monkeypatch.setattr(system, "probe", fake_probe)
    assert guest.get("/api/system/data-sources?check=true").json()["checked"] == []
    assert calls == []

    monkeypatch.setattr(system, "network_checks_enabled", lambda: True)
    d = guest.get("/api/system/data-sources?check=true").json()
    assert sorted(d["checked"]) == ["binance", "coingecko", "finnhub", "twelvedata"]
    assert len(calls) == 4
    for url in calls:
        _assert_no_secret(url)
        assert "key=" not in url and "token=" not in url
    b = d["providers"]["binance"]
    assert b["reachable"] is True and b["latency_ms"] == 12 and b["stale"] is False and b["checked_at"]
    td = d["providers"]["twelvedata"]
    assert td["reachable"] is False and td["error"] == "ConnectError: refused"
    assert d["market_cap"]["reachable"] is False and d["news"]["reachable"] is False

    again = guest.get("/api/system/data-sources?check=true").json()
    assert again["checked"] == [] and len(calls) == 4  # cached for HEALTH_TTL
    assert again["providers"]["binance"]["reachable"] is True
    plain = guest.get("/api/system/data-sources").json()  # no check → cached values only
    assert plain["checked"] == [] and plain["providers"]["binance"]["reachable"] is True


def test_health_entry_goes_stale(fresh_providers, monkeypatch):
    monkeypatch.setattr(system, "network_checks_enabled", lambda: True)
    monkeypatch.setattr(system, "probe", lambda url, timeout=5.0: {"reachable": True, "latency_ms": 1,
                                                                    "http_status": 200, "error": None})
    assert system.refresh_health(["binance", "binance", "unknown"], 1000) == ["binance"]
    assert system.health("binance", 1000 + system.HEALTH_TTL - 1)["stale"] is False
    assert system.health("binance", 1000 + system.HEALTH_TTL)["stale"] is True
    assert system.refresh_health(["binance"], 1000 + 10) == []
    assert system.refresh_health(["binance"], 1000 + system.HEALTH_TTL) == ["binance"]
    assert system.health("twelvedata", 1000)["reachable"] is None


# ------------------------------------------------------------------ AI settings
def test_ai_settings_offline(guest):
    d = guest.get("/api/system/ai").json()
    assert d["provider"] == "offline" and d["active"] == "offline" and d["model"] is None
    assert d["fallbacks"] == "server-side default" and d["effort"] in ("low", "medium", "high")
    assert d["offline"]["active"] is True and d["offline"]["reason"]
    assert d["output_sections"] == ["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK",
                                    "ALTERNATIVE SCENARIO"]
    keys = {r["key"] for r in d["safety_rules"]}
    assert {"no_predictions", "no_commands", "no_guarantees", "hypothetical_setups", "paper_only"} <= keys
    assert d["setup_disclaimer"] == "This is a rule-based hypothetical setup, not a guarantee of future price movement."
    assert d["key_present"] is False and d["key_env"] == "ANTHROPIC_API_KEY"
    assert d["explain_mode_default"] is True and d["language"]["code"] == "bg"
    assert any(m["key"] == "explain" for m in d["modes"])


def test_ai_settings_anthropic_active(guest, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "anthropic")
    monkeypatch.setattr(s, "anthropic_api_key", SECRETS["anthropic_api_key"])

    class FakeLLM:
        name = "anthropic"

    monkeypatch.setattr(ai_providers, "get_llm", lambda: FakeLLM())
    monkeypatch.setattr(system, "get_llm", lambda: FakeLLM())
    r = guest.get("/api/system/ai")
    _assert_no_secret(r.text)
    d = r.json()
    assert d["provider"] == "anthropic" and d["active"] == "anthropic" and d["model"] == s.anthropic_model
    assert d["offline"]["active"] is False and d["offline"]["reason"] is None and d["key_present"] is True


def test_ai_settings_anthropic_without_key_falls_back(guest, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_provider", "anthropic")
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    monkeypatch.setattr(ai_providers, "get_llm", lambda: None)
    monkeypatch.setattr(system, "get_llm", lambda: None)
    d = guest.get("/api/system/ai").json()
    assert d["active"] == "offline" and d["offline"]["active"] is True
    assert "ANTHROPIC_API_KEY" in d["offline"]["reason"]


# ------------------------------------------------------------------ settings v2 + AI session data
def test_settings_v2_defaults_and_put(guest):
    s = guest.get("/api/settings").json()["settings"]
    assert s["app_mode"] == "learn" and s["explain_mode"] is True
    out = guest.put("/api/settings", json={"app_mode": "trade", "explain_mode": False}).json()["settings"]
    assert out["app_mode"] == "trade" and out["explain_mode"] is False
    again = guest.get("/api/settings").json()["settings"]
    assert again["app_mode"] == "trade" and again["explain_mode"] is False
    assert guest.get("/api/system/ai").json()["explain_mode_default"] is False
    user = guest.get("/api/dashboard").json()["user"]
    assert user["app_mode"] == "trade" and user["explain_mode"] is False
    assert guest.put("/api/settings", json={"app_mode": "casino"}).status_code == 422
    assert guest.put("/api/settings", json={"explain_mode": "yes"}).status_code == 422
    assert guest.get("/api/settings").json()["settings"]["app_mode"] == "trade"


def test_ai_session_messages_include_data(guest):
    res = guest.post("/api/ai/chat", json={"message": "Какво е stop loss?"}).json()
    d = guest.get(f"/api/ai/sessions/{res['session_id']}").json()
    assert [m["role"] for m in d["messages"]] == ["user", "assistant"]
    for m in d["messages"]:
        assert set(m) == {"role", "content", "ts", "data"} and isinstance(m["data"], dict)
    assert d["messages"][0]["data"] == {"symbol": None, "timeframe": None}
    assert d["messages"][1]["data"]["provider"] == "offline"
