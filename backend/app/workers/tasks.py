"""Background jobs. Each task opens its own DB session. All of them are simulation-only."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.database import SessionLocal
from app.market import discovery
from app.models import PaperAccount, PaperOrder, PaperPosition
from app.paper_engine.models import ACTIVE_ORDER_STATUSES
from app.services import backtest_service, bot_service, paper_service
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

# Worker processes never run the FastAPI lifespan: install the (lazy) DB loader of provider-synced
# instruments here, otherwise paper accounts / bots / backtests on synced symbols fail with
# UnknownAssetError in the worker. Nothing is read from the database until the first synced lookup.
discovery.ensure_db_loader()


@celery_app.task(name="app.workers.tasks.run_backtest")
def run_backtest_task(backtest_id: int) -> str:
    with SessionLocal() as db:
        return backtest_service.execute(db, backtest_id).status


@celery_app.task(name="app.workers.tasks.sync_paper_accounts")
def sync_paper_accounts() -> int:
    """Process SL/TP/limit orders of manual paper accounts even when nobody has the page open."""
    with SessionLocal() as db:
        with_positions = select(PaperPosition.account_id).where(PaperPosition.status == "open")
        with_orders = select(PaperOrder.account_id).where(PaperOrder.status.in_(ACTIVE_ORDER_STATUSES))
        ids = set(db.scalars(with_positions)) | set(db.scalars(with_orders))
        n = 0
        for acc in db.scalars(select(PaperAccount).where(PaperAccount.id.in_(ids), PaperAccount.kind == "manual")):
            try:
                paper_service.sync_account(db, acc)
                n += 1
            except Exception:  # noqa: BLE001 - one bad account must not stop the others
                log.exception("sync failed for account %s", acc.id)
                db.rollback()
        return n


@celery_app.task(name="app.workers.tasks.run_bots")
def run_bots() -> int:
    with SessionLocal() as db:
        return bot_service.run_all_bots(db)


@celery_app.task(name="app.workers.tasks.sync_catalog")
def sync_catalog(provider: str = "all", kinds: list[str] | None = None) -> list[dict]:
    """Sync provider instrument lists into the catalog (read-only reference endpoints).

    Scheduled daily by beat only when CATALOG_AUTO_SYNC=true. Every (provider, kind) run is recorded in
    catalog_syncs; API processes pick the new instruments up within a few minutes (registry version check).
    """
    with SessionLocal() as db:
        results = discovery.run_sync(db, provider, tuple(kinds) if kinds else None)
    for r in results:
        log.info("catalog sync %s/%s: %s (%s)", r["provider"], r["kind"], r["status"], r["message"])
    return results
