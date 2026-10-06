"""Runs backtests (inline or via Celery) and stores the results."""

from __future__ import annotations

import logging
import time

from sqlalchemy.orm import Session

from app.backtesting.engine import BacktestSettings, run_backtest
from app.backtesting.metrics import json_safe
from app.backtesting.validation import validate
from app.market.catalog import get_asset
from app.market.timeframes import tf_seconds
from app.models import Backtest, BacktestTrade
from app.services import market_service
from app.strategies.rules import StrategyDefinition, describe

log = logging.getLogger(__name__)
MAX_BARS = 20_000


def execute(db: Session, backtest_id: int) -> Backtest:
    bt = db.get(Backtest, backtest_id)
    if bt is None:
        raise ValueError("Backtest not found")
    bt.status = "running"
    db.commit()
    try:
        spec = get_asset(bt.symbol)
        sec = tf_seconds(bt.timeframe)
        settings = BacktestSettings.from_dict(bt.settings)
        start = bt.start_ts - settings.warmup_bars * sec  # warm-up before the requested range
        bars = (bt.end_ts - start) // sec
        if bars > MAX_BARS:
            raise ValueError(
                f"Периодът е твърде дълъг ({bars} свещи, максимум {MAX_BARS}). "
                "Избери по-кратък период или по-голям timeframe."
            )
        candles = market_service.candles(
            bt.symbol, bt.timeframe, start=start, end=bt.end_ts, limit=0, include_partial=False
        )
        if len(candles) < settings.warmup_bars + 30:
            raise ValueError("Твърде малко данни за този период.")
        defn = StrategyDefinition(**bt.strategy_snapshot)
        res = run_backtest(candles, spec, defn, settings, bt.timeframe)
        bt.validation = json_safe(validate(candles, spec, defn, settings, bt.timeframe, res))
        bt.metrics = json_safe(res["metrics"])
        bt.equity_curve = res["equity_curve"]
        bt.data_source = market_service.source_of(bt.symbol)["id"]
        db.query(BacktestTrade).filter(BacktestTrade.backtest_id == bt.id).delete()
        for t in res["trades"]:
            db.add(
                BacktestTrade(
                    backtest_id=bt.id,
                    side=t["side"],
                    entry_ts=t["entry_ts"],
                    exit_ts=t["exit_ts"],
                    entry_price=t["entry_price"],
                    exit_price=t["exit_price"],
                    qty=t["qty"],
                    net_pnl=t["net_pnl"],
                    fees=t["fees"],
                    r_multiple=t["r_multiple"],
                    exit_reason=t["exit_reason"],
                    regime=t.get("regime"),
                )
            )
        bt.status = "done"
    except Exception as exc:  # noqa: BLE001 - surface any failure to the user
        log.exception("Backtest %s failed", backtest_id)
        bt.status = "failed"
        bt.error = str(exc)[:1000]
    bt.finished_ts = int(time.time())
    db.commit()
    return bt


def to_dict(bt: Backtest, with_trades: bool = False, db: Session | None = None) -> dict:
    out = {
        "id": bt.id,
        "strategy_id": bt.strategy_id,
        "strategy_name": bt.strategy_name,
        "symbol": bt.symbol,
        "timeframe": bt.timeframe,
        "start_ts": bt.start_ts,
        "end_ts": bt.end_ts,
        "settings": bt.settings,
        "status": bt.status,
        "metrics": bt.metrics,
        "validation": bt.validation,
        "error": bt.error,
        "data_source": bt.data_source,
        "created_ts": bt.created_ts,
        "finished_ts": bt.finished_ts,
    }
    if with_trades and db is not None:
        out["equity_curve"] = bt.equity_curve
        try:
            out["strategy_description"] = describe(StrategyDefinition(**bt.strategy_snapshot))
        except ValueError:
            out["strategy_description"] = []
        rows = db.query(BacktestTrade).filter(BacktestTrade.backtest_id == bt.id).order_by(BacktestTrade.entry_ts).all()
        out["trades"] = [
            {
                "side": t.side,
                "entry_ts": t.entry_ts,
                "exit_ts": t.exit_ts,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "qty": t.qty,
                "net_pnl": t.net_pnl,
                "fees": t.fees,
                "r_multiple": t.r_multiple,
                "exit_reason": t.exit_reason,
                "regime": t.regime,
            }
            for t in rows
        ]
    return out
