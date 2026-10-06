"""Celery application (optional). Start with:

celery -A app.workers.celery_app worker -l info
celery -A app.workers.celery_app beat -l info
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

_s = get_settings()
broker_url = _s.redis_url or "redis://localhost:6379/0"


def build_beat_schedule(settings) -> dict:
    schedule: dict = {
        "sync-paper-accounts": {"task": "app.workers.tasks.sync_paper_accounts", "schedule": 20.0},
        "run-bots": {"task": "app.workers.tasks.run_bots", "schedule": 30.0},
    }
    if settings.catalog_auto_sync:
        # daily instrument-list sync (read-only public reference endpoints); off by default
        schedule["sync-catalog"] = {"task": "app.workers.tasks.sync_catalog", "schedule": crontab(hour=3, minute=17)}
    return schedule


beat_schedule = build_beat_schedule(_s)

celery_app = Celery("trading_academy", broker=broker_url, backend=broker_url, include=["app.workers.tasks"])
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule=beat_schedule,
)
