"""Idempotent seed: assets, lessons, strategy templates and a demo user.

Run manually with:  python -m app.seed
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.database import SessionLocal, init_db, now_ts
from app.market.base import AssetSpec
from app.market.catalog import ASSETS, ASSETS_BY_SYMBOL
from app.models import Asset, Strategy, User
from app.services import learning_service, user_service
from app.strategies.templates import TEMPLATES

log = logging.getLogger(__name__)

DEMO_EMAIL = "demo@trading-academy.local"
DEMO_PASSWORD = "Demo12345"


def asset_row_values(spec: AssetSpec) -> dict:
    """Column values of an `assets` row for a catalog instrument."""
    return {
        "name": spec.name,
        "asset_class": spec.asset_class,
        "price_precision": spec.price_precision,
        "qty_step": spec.qty_step,
        "min_qty": spec.min_qty,
        "spread_bps": spec.spread_bps,
        "maker_fee": spec.maker_fee,
        "taker_fee": spec.taker_fee,
        "max_leverage": spec.max_leverage,
        "category": spec.category,
        "sector": spec.sector,
        "industry": spec.industry,
        "exchange": spec.exchange,
        "country": spec.country,
        "currency": spec.currency,
        "base": spec.base,
        "aliases": list(spec.aliases),
        "popularity": spec.popularity,
        "session": spec.session,
        "provider_symbols": dict(spec.provider_symbols),
        "source": spec.source,
        "slug": spec.slug,
        "description": spec.description,
        "demo": (
            {
                "anchor_price": spec.anchor_price,
                "daily_vol": spec.daily_vol,
                "daily_volume_usd": spec.daily_volume_usd,
                "drift": spec.drift,
            }
            if spec.demo_capable
            else None
        ),
    }


def _check_schema(db: Session) -> None:
    columns = {c["name"] for c in inspect(db.get_bind()).get_columns("assets")}
    if "slug" not in columns:
        raise RuntimeError(
            "The database schema is older than the code (assets table lacks the V2 catalog columns). "
            "Run `alembic upgrade head` (for a dev database created without Alembic: `alembic stamp 0001` "
            "first), or delete the local dev SQLite file so it is recreated."
        )


def seed_assets(db: Session) -> int:
    """Upsert every curated instrument (source='curated'). Returns the number of rows inserted/changed."""
    _check_schema(db)
    existing = {a.symbol: a for a in db.scalars(select(Asset))}
    curated_slugs = {spec.slug for spec in ASSETS}
    # a synced row may hold a slug that a (newly added) curated instrument now needs: free it first —
    # the synced registry re-assigns a suffixed slug when it loads
    freed = False
    for row in existing.values():
        if row.slug in curated_slugs and row.symbol not in ASSETS_BY_SYMBOL:
            row.slug = None
            freed = True
    if freed:
        db.flush()
    changed = 0
    now = now_ts()
    for spec in ASSETS:
        row = existing.get(spec.symbol)
        if row is None:
            row = Asset(symbol=spec.symbol, active=True)
            db.add(row)
        values = asset_row_values(spec)
        dirty = [k for k, v in values.items() if getattr(row, k) != v]
        if dirty or row.id is None:
            for k in dirty:
                setattr(row, k, values[k])
            row.updated_ts = now
            changed += 1
    db.commit()
    return changed


def seed(db: Session) -> None:
    seed_assets(db)

    learning_service.sync_lessons(db)

    templates = {s.name: s for s in db.scalars(select(Strategy).where(Strategy.is_template.is_(True)))}
    for tpl in TEMPLATES:
        user_service.save_strategy(
            db,
            None,
            name=tpl["name"],
            description=tpl["description"],
            symbol="BTC/USDT",
            timeframe=tpl["timeframe"],
            definition=tpl["definition"],
            strategy=templates.get(tpl["name"]),
            is_template=True,
        )

    if db.scalar(select(User).where(User.email == DEMO_EMAIL)) is None:
        user_service.create_user(db, email=DEMO_EMAIL, password=DEMO_PASSWORD, display_name="Demo Trader")
        log.info("Demo user created: %s / %s", DEMO_EMAIL, DEMO_PASSWORD)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    init_db()
    with SessionLocal() as db:
        seed(db)
    print("Seed complete.")


if __name__ == "__main__":
    main()
