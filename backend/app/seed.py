"""Idempotent seed: assets, lessons, strategy templates and a demo user.

Run manually with:  python -m app.seed
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal, init_db
from app.market.catalog import ASSETS
from app.models import Asset, Strategy, User
from app.services import learning_service, user_service
from app.strategies.templates import TEMPLATES

log = logging.getLogger(__name__)

DEMO_EMAIL = "demo@trading-academy.local"
DEMO_PASSWORD = "Demo12345"


def seed(db: Session) -> None:
    existing = {a.symbol: a for a in db.scalars(select(Asset))}
    for spec in ASSETS:
        row = existing.get(spec.symbol) or Asset(symbol=spec.symbol)
        row.name = spec.name
        row.asset_class = spec.asset_class
        row.price_precision = spec.price_precision
        row.qty_step = spec.qty_step
        row.spread_bps = spec.spread_bps
        row.maker_fee = spec.maker_fee
        row.taker_fee = spec.taker_fee
        row.max_leverage = spec.max_leverage
        db.add(row)
    db.commit()

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
