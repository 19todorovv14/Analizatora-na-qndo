"""Trading Academy API — educational trading platform. PAPER TRADING ONLY."""

from __future__ import annotations

import logging
import re
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import academy, ai, auth, learn, market, markets, misc, paper, replay, risk, strategies, teacher
from app.config import get_settings
from app.core.json_guard import RejectNonFiniteJSONMiddleware, SafeJSONResponse
from app.database import SessionLocal, init_db
from app.exchange.base import LiveTradingDisabledError
from app.market.base import DataNotAvailableError, MarketDataError, redact_secrets
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
    # provider-synced instruments (app.market.discovery) are loaded lazily from the assets table
    from app.market import discovery, search

    discovery.install_db_loader()
    if settings.app_env != "test":  # build the search index off the request path

        def _warm() -> None:
            try:
                log.info("Instrument search index ready (%d instruments)", search.warm())
            except Exception:  # noqa: BLE001 - warm-up is an optimisation only
                log.warning("Search index warm-up failed", exc_info=True)

        threading.Thread(target=_warm, name="catalog-warmup", daemon=True).start()
    log.info("Trading Academy API started — execution mode: PAPER (virtual funds only)")
    yield


app = FastAPI(
    title="Trading Academy API",
    version="1.0.0",
    description="Educational trading platform. All trading is simulated (paper). No real orders, deposits or withdrawals.",
    lifespan=lifespan,
    default_response_class=SafeJSONResponse,  # NaN / ±inf in a payload → null, never a 500 (app.core.json_guard)
)

# innermost: JSON bodies with NaN / Infinity → 422 before any endpoint can store them (app.core.json_guard)
app.add_middleware(RejectNonFiniteJSONMiddleware)
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


_QUERY_STRING = re.compile(r"\?[^\s'\"]*=[^\s'\"]*")


@app.exception_handler(MarketDataError)
async def _market_error(_: Request, exc: MarketDataError):
    """503 as before; `detail` stays a string, `code`/`reason` are added for the UI.

    code = DATA_NOT_AVAILABLE when no configured provider supports the instrument (configuration),
    MARKET_DATA_ERROR for provider failures. Query strings are stripped (never echo API keys).
    """
    reason = redact_secrets(_QUERY_STRING.sub("?…", str(exc)))
    content: dict = {
        "detail": f"Market data unavailable: {reason}",
        "code": exc.code if isinstance(exc, DataNotAvailableError) else "MARKET_DATA_ERROR",
        "reason": reason,
    }
    symbol = getattr(exc, "symbol", None)
    if symbol:
        content["symbol"] = symbol
    return JSONResponse(status_code=503, content=content)


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
    replay.router,  # /replay… (moved out of misc; work package S5)
    markets.router,  # markets explorer (S1)
    learn.router,  # learning path & labs (S3)
    teacher.router,  # AI teacher modes (S4)
):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    s = get_settings()
    return {
        "status": "ok",
        "execution_mode": "paper",
        "live_trading": False,
        "market_data": {
            "crypto": s.market_data_crypto,
            "fx": s.market_data_fx,
            "stocks": s.market_data_stocks,
            "etf": s.market_data_etf or s.market_data_stocks,
            "indices": s.market_data_indices or s.market_data_stocks,
            "commodities": s.market_data_commodities or s.market_data_stocks,
        },
        "ai_provider": s.ai_provider,
        "celery": s.use_celery,
    }
