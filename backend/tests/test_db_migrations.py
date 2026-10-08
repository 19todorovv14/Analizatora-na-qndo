"""Schema management: Alembic migrations match the models and old dev databases are upgraded in place."""

from __future__ import annotations

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

import app.models  # noqa: F401  (register models)
from app.database import _ALEMBIC_DIR, Base, _run_alembic, init_db


@pytest.fixture
def fresh_engine(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    yield eng
    eng.dispose()


def _head() -> str:
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", str(_ALEMBIC_DIR))
    return ScriptDirectory.from_config(cfg).get_current_head()


def _version(eng) -> str | None:
    with eng.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def _schema_diff(eng) -> list:
    with eng.connect() as conn:
        return compare_metadata(MigrationContext.configure(conn), Base.metadata)


def test_migrations_produce_the_model_schema(fresh_engine):
    # a model change without a migration would make production (alembic upgrade head) diverge from tests
    with fresh_engine.begin() as conn:
        _run_alembic(conn, "upgrade", "head")
    assert _version(fresh_engine) == _head()
    assert _schema_diff(fresh_engine) == []


def test_init_db_on_empty_database_creates_schema_and_stamps_head(fresh_engine):
    init_db(fresh_engine)
    assert _version(fresh_engine) == _head()
    assert _schema_diff(fresh_engine) == []
    init_db(fresh_engine)  # idempotent
    assert _version(fresh_engine) == _head()


def test_init_db_upgrades_a_v1_database_created_without_alembic(fresh_engine):
    # V1 dev databases were made by create_all: the 0001 schema without an alembic_version table
    with fresh_engine.begin() as conn:
        _run_alembic(conn, "upgrade", "0001")
        conn.execute(text("DROP TABLE alembic_version"))
        conn.execute(
            text(
                "INSERT INTO assets (symbol, name, asset_class, price_precision, qty_step, spread_bps,"
                " maker_fee, taker_fee, max_leverage, active)"
                " VALUES ('BTC/USDT', 'Bitcoin', 'crypto', 2, 0.0001, 2, 0.001, 0.001, 5, 1)"
            )
        )
    assert "slug" not in {c["name"] for c in inspect(fresh_engine).get_columns("assets")}

    init_db(fresh_engine)

    assert _version(fresh_engine) == _head()
    assert "slug" in {c["name"] for c in inspect(fresh_engine).get_columns("assets")}
    assert {"favorite_assets", "recent_assets", "replay_decisions"} <= set(inspect(fresh_engine).get_table_names())
    with fresh_engine.connect() as conn:
        assert conn.execute(text("SELECT name FROM assets WHERE symbol = 'BTC/USDT'")).scalar() == "Bitcoin"
    assert _schema_diff(fresh_engine) == []


def test_init_db_upgrades_an_alembic_database_at_an_older_revision(fresh_engine):
    with fresh_engine.begin() as conn:
        _run_alembic(conn, "upgrade", "0001")
    init_db(fresh_engine)
    assert _version(fresh_engine) == _head()
    assert _schema_diff(fresh_engine) == []
