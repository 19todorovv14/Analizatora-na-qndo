"""Learning API — learning path (LEVEL 0–10), interactive labs (candlesticks, market structure)
and the leverage lab.

Owner: work package S3. Registered in app.main under /api (no prefix here: declare full paths such as
"/learn/path"). Educational only — every simulation is paper/virtual.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["learn"])
