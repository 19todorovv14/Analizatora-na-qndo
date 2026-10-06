"""Celery application (optional). Start with:

celery -A app.workers.celery_app worker -l info
celery -A app.workers.celery_app beat -l info
"""

from __future__ import annotations

from celery import Celery

from app.config import get_settings

_s = get_settings()
broker_url = _s.redis_url or "redis://localhost:6379/0"

celery_app = Celery("trading_academy", broker=broker_url, backend=broker_url, include=["app.workers.tasks"])
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule={
        "sync-paper-accounts": {"task": "app.workers.tasks.sync_paper_accounts", "schedule": 20.0},
        "run-bots": {"task": "app.workers.tasks.run_bots", "schedule": 30.0},
    },
)
