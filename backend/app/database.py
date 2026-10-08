from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def now_ts() -> int:
    """Current UTC time as integer epoch seconds (all timestamps are stored like this)."""
    return int(time.time())


def _make_engine(url: str):
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            if ":memory:" not in url:
                cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    return engine


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def configure_engine(url: str) -> None:
    """Rebind the global engine (used by tests)."""
    global engine
    engine = _make_engine(url)
    SessionLocal.configure(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_ALEMBIC_DIR = Path(__file__).resolve().parent.parent / "alembic"


def _run_alembic(connection, action: str, revision: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config()  # no ini file: keeps the app's logging configuration untouched
    cfg.set_main_option("script_location", str(_ALEMBIC_DIR))
    cfg.attributes["connection"] = connection
    getattr(command, action)(cfg, revision)


def init_db(bind=None) -> None:
    """Dev convenience (AUTO_CREATE_TABLES): create a fresh schema or bring an older dev database up to date.

    * empty database -> create_all + Alembic stamp at head
    * database created by an earlier version (with Alembic, or by create_all without it) -> Alembic upgrade,
      so a local SQLite file from V1 keeps working instead of failing on the V2 catalog columns.
    Production runs `alembic upgrade head` itself (AUTO_CREATE_TABLES=false).
    """
    import app.models  # noqa: F401  (register models)

    with (bind if bind is not None else engine).begin() as conn:
        insp = inspect(conn)
        tables = set(insp.get_table_names())
        if not tables - {"alembic_version"}:
            Base.metadata.create_all(bind=conn)
            _run_alembic(conn, "stamp", "head")
            return
        if "alembic_version" not in tables:
            # made by create_all: decide which known schema it matches (V2 added assets.slug in 0002)
            asset_cols = {c["name"] for c in insp.get_columns("assets")} if "assets" in tables else set()
            _run_alembic(conn, "stamp", "head" if "slug" in asset_cols else "0001")
        _run_alembic(conn, "upgrade", "head")
