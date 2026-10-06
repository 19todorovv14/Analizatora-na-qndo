"""AI teacher API — teacher modes (EXPLAIN / ANALYZE / TEACH ME / REVIEW TRADE / REVIEW STRATEGY /
QUIZ ME / WHY? / COMPARE) and the strategy view checklist.

Owner: work package S4. Registered in app.main under /api (no prefix here: declare full paths such as
"/teacher/ask"). Educational only — no financial advice, no real orders; AI safety rules of app.ai apply.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["teacher"])
