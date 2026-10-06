"""Markets explorer API — market overview, lists (gainers/losers/volume/volatility), heatmap, asset page
and per-instrument news.

Owner: work package S1. Registered in app.main under /api (no prefix here: declare full paths such as
"/markets/overview"). Market data is READ-ONLY; when no provider can serve an instrument, respond with
an explicit DATA_NOT_AVAILABLE state — never with invented numbers. Demo data must stay labelled DEMO.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["markets"])
