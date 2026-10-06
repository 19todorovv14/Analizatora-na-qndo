"""Live-trading guard, authentication, sessions and database behaviour."""

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password, hash_session_token, password_problems, verify_password
from app.exchange.base import LiveTradingDisabledError
from app.exchange.paper import PaperExchangeAdapter
from app.exchange.registry import LIVE_TRADING_AVAILABLE, get_adapter
from app.models import PaperAccount, User, UserSession, WatchlistItem
from app.services import user_service
from tests.conftest import HEADERS


@pytest.mark.parametrize("mode", ["live", "bybit", "metatrader", "real", ""])
def test_live_trading_is_impossible(mode):
    assert LIVE_TRADING_AVAILABLE is False
    with pytest.raises(LiveTradingDisabledError):
        get_adapter(mode)


def test_paper_adapter_is_not_live():
    assert PaperExchangeAdapter.is_live is False
    for m in ("get_balance", "get_positions", "get_ticker", "get_ohlcv", "create_order", "cancel_order"):
        assert callable(getattr(PaperExchangeAdapter, m))


def test_password_hashing():
    h = hash_password("Secret123")
    assert h.startswith("scrypt$") and "Secret123" not in h
    assert verify_password("Secret123", h)
    assert not verify_password("secret123", h)
    assert not verify_password("x", None)
    assert hash_password("Secret123") != h  # salted
    assert password_problems("short")
    assert password_problems("Longenough1") == []


def test_session_token_is_hashed(db):
    user = user_service.create_user(db, email="hash@example.com", password="Abcdefg123", display_name="H")
    token = user_service.start_session(db, user)
    row = db.query(UserSession).filter(UserSession.user_id == user.id).one()
    assert row.token_hash == hash_session_token(token) and token not in row.token_hash
    assert user_service.user_from_token(db, token).id == user.id
    user_service.end_session(db, token)
    assert user_service.user_from_token(db, token) is None


def test_onboarding_creates_demo_ready_state(db):
    user = user_service.create_guest(db)
    assert db.query(PaperAccount).filter(PaperAccount.user_id == user.id, PaperAccount.kind == "manual").count() == 1
    assert db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).count() >= 5


def test_unique_email_and_watchlist_constraints(db):
    db.add(User(email="dup@example.com", display_name="a", settings={}))
    db.commit()
    db.add(User(email="dup@example.com", display_name="b", settings={}))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    u = db.query(User).filter(User.email == "dup@example.com").one()
    db.add(WatchlistItem(user_id=u.id, symbol="BTC/USDT"))
    db.add(WatchlistItem(user_id=u.id, symbol="BTC/USDT"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_cascade_delete(db):
    user = user_service.create_guest(db)
    uid = user.id
    db.delete(user)
    db.commit()
    assert db.query(PaperAccount).filter(PaperAccount.user_id == uid).count() == 0


# ------------------------------------------------------------------- auth API
def test_register_login_me_logout(client):
    r = client.post(
        "/api/auth/register", json={"email": "ana@example.com", "password": "Strong123", "display_name": "Ana"}
    )
    assert r.status_code == 200
    token = r.json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == "ana@example.com"
    bad = client.post("/api/auth/login", json={"email": "ana@example.com", "password": "wrong"})
    assert bad.status_code == 401
    ok = client.post("/api/auth/login", json={"email": "ana@example.com", "password": "Strong123"})
    assert ok.status_code == 200 and "ta_session" in ok.cookies
    out = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert out.status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"email": "bad", "password": "Strong123"}).status_code == 422
    r = client.post("/api/auth/register", json={"email": "weak@example.com", "password": "weakpassword"})
    assert r.status_code == 400


def test_unauthenticated_and_csrf(client):
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    assert c.get("/api/paper/account").status_code == 401
    assert c.post("/api/auth/guest", headers=HEADERS).status_code == 200
    # cookie auth without the CSRF header must not be able to change state
    r = c.post("/api/paper/orders", json={"symbol": "BTC/USDT", "side": "buy", "qty": 0.001})
    assert r.status_code == 403
    assert c.get("/api/paper/account").status_code == 200  # reads are fine


def test_claim_guest(guest):
    r = guest.post(
        "/api/auth/claim", json={"email": "claimed@example.com", "password": "Claimed123", "display_name": "Claimed"}
    )
    assert r.status_code == 200 and r.json()["is_guest"] is False


def test_health_reports_paper_only(client):
    h = client.get("/api/health").json()
    assert h["execution_mode"] == "paper" and h["live_trading"] is False


def test_cors_origins_from_comma_separated_env(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    assert Settings(_env_file=None).cors_origins == ["https://a.example", "https://b.example"]
