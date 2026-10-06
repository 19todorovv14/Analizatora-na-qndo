"""Trading Academy API — educational trading platform. PAPER TRADING ONLY."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import academy, ai, auth, market, misc, paper, risk, strategies
from app.config import get_settings
from app.database import SessionLocal, init_db
from app.exchange.base import LiveTradingDisabledError
from app.market.base import MarketDataError
from app.market.catalog import UnknownAssetError
from app.market.timeframes import TimeframeError

log = logging.getLogger("trading_academy")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=logging.INFO)
    if settings.is_production and settings.secret_key.startswith("dev-insecure"):
        raise RuntimeError("Set SECRET_KEY to a long random value in production.")
    if settings.auto_create_tables:
        init_db()
    if settings.seed_demo_data:
        from app.seed import seed

        with SessionLocal() as db:
            seed(db)
    log.info("Trading Academy API started — execution mode: PAPER (virtual funds only)")
    yield


app = FastAPI(
    title="Trading Academy API",
    version="1.0.0",
    description="Educational trading platform. All trading is simulated (paper). No real orders, deposits or withdrawals.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers["X-Execution-Mode"] = "paper"
    return response


@app.exception_handler(MarketDataError)
async def _market_error(_: Request, exc: MarketDataError):
    return JSONResponse(status_code=503, content={"detail": f"Market data unavailable: {exc}"})


@app.exception_handler(UnknownAssetError)
async def _unknown_asset(_: Request, exc: UnknownAssetError):
    return JSONResponse(status_code=404, content={"detail": f"Unknown instrument {exc}"})


@app.exception_handler(TimeframeError)
async def _tf_error(_: Request, exc: TimeframeError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(LiveTradingDisabledError)
async def _live_disabled(_: Request, exc: LiveTradingDisabledError):
    return JSONResponse(status_code=403, content={"detail": str(exc)})


for r in (
    auth.router,
    market.router,
    academy.router,
    paper.router,
    risk.router,
    ai.router,
    strategies.router,
    misc.router,
):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    s = get_settings()
    return {
        "status": "ok",
        "execution_mode": "paper",
        "live_trading": False,
        "market_data": {"crypto": s.market_data_crypto, "fx": s.market_data_fx, "stocks": s.market_data_stocks},
        "ai_provider": s.ai_provider,
        "celery": s.use_celery,
    }
