from __future__ import annotations

import os
import tempfile

# Configure the app BEFORE importing it.
_tmpdir = tempfile.mkdtemp(prefix="ta-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["APP_ENV"] = "test"
os.environ["AI_PROVIDER"] = "offline"
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["USE_CELERY"] = "false"
os.environ["MARKET_DATA_CRYPTO"] = "demo"
os.environ["MARKET_DATA_FX"] = "demo"
os.environ["MARKET_DATA_STOCKS"] = "demo"
os.environ["AUTH_RATE_LIMIT_PER_MINUTE"] = "1000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.market.catalog import ASSETS_BY_SYMBOL  # noqa: E402

HEADERS = {"x-ta-client": "web"}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def guest(client):
    """A fresh isolated guest session (cookie-based)."""
    c = TestClient(app)
    r = c.post("/api/auth/guest", headers=HEADERS)
    assert r.status_code == 200
    c.headers.update(HEADERS)
    return c


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def specs():
    return ASSETS_BY_SYMBOL
