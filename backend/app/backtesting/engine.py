"""Backtesting engine.

* Signals are evaluated on the CLOSE of bar i and executed at the OPEN of bar i+1
  (no lookahead).
* Position size comes from the risk engine (risk % of current equity ÷ stop distance),
  capped by the available margin.
* Execution goes through the same PaperBroker as live paper trading: spread, fees,
  slippage, SL/TP and the intrabar worst-case policy.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, fields

from app.analysis.regime import RegimeInputs, classify_at
from app.backtesting.metrics import trade_metrics
from app.market.base import AssetSpec, Candle
from app.market.timeframes import tf_seconds
from app.paper_engine.broker import PaperBroker
from app.paper_engine.models import BUY, MARKET, SELL, AccountState, Bar, ExecutionConfig
from app.strategies.rules import IndicatorCache, StrategyDefinition, evaluate, stop_distance, target_distance


@dataclass
class BacktestSettings:
    initial_balance: float = 10_000.0
    risk_per_trade_pct: float | None = None  # None → use the strategy's value
    fees_enabled: bool = True
    fee_bps: float | None = None  # override taker/maker fee (basis points); None → asset defaults
    slippage_bps: float = 1.0
    spread_enabled: bool = True
    spread_multiplier: float = 1.0
    leverage: float | None = None  # None → asset maximum
    allow_short: bool = True
    max_open_positions: int = 1
    intrabar_policy: str = "worst_case"
    warmup_bars: int = 200

    @classmethod
    def from_dict(cls, data: dict | None) -> BacktestSettings:
        data = data or {}
        allowed = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in allowed and v is not None})

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


def _downsample(points: list[list], max_points: int = 600) -> list[list]:
    if len(points) <= max_points:
        return points
    step = len(points) / max_points
    out = [points[int(i * step)] for i in range(max_points)]
    out[-1] = points[-1]
    return out


def run_backtest(
    candles: list[Candle],
    spec: AssetSpec,
    defn: StrategyDefinition,
    settings: BacktestSettings,
    timeframe: str,
    *,
    with_regimes: bool = True,
) -> dict:
    if len(candles) < 30:
        raise ValueError("Нужни са поне 30 свещи за backtest.")
    if settings.fee_bps is not None:
        spec = dataclasses.replace(spec, maker_fee=settings.fee_bps / 1e4, taker_fee=settings.fee_bps / 1e4)
    sym = spec.symbol
    risk_pct = settings.risk_per_trade_pct or defn.risk_per_trade_pct
    leverage = settings.leverage or spec.max_leverage
    cfg = ExecutionConfig(
        fees_enabled=settings.fees_enabled,
        spread_enabled=settings.spread_enabled,
        spread_multiplier=settings.spread_multiplier,
        slippage_enabled=settings.slippage_bps > 0,
        base_slippage_bps=settings.slippage_bps,
        volatility_slippage=0.02 if settings.slippage_bps > 0 else 0.0,
        impact_bps_per_pct_volume=0.0,
        latency_enabled=False,
        partial_fills_enabled=False,
        intrabar_policy=settings.intrabar_policy,
    )
    state = AccountState(cash=settings.initial_balance, leverage=leverage)
    broker = PaperBroker(state, {sym: spec}, cfg, seed=f"bt:{sym}:{candles[0].ts}")
    cache = IndicatorCache(candles)
    regime_x = RegimeInputs.from_candles(candles) if with_regimes else None
    sec = tf_seconds(timeframe)
    warmup = min(settings.warmup_bars, max(len(candles) // 4, 30))

    equity: list[list] = []
    signals = 0
    last_idx = len(candles) - 1

    for i, c in enumerate(candles):
        bar = Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, sec)
        if i == 0:
            broker.set_mark(sym, c.close)
            broker.last_bar[sym] = bar
        else:
            broker.process_bar(sym, bar)
        snap_equity = broker.snapshot()["equity"]
        equity.append([c.ts, round(snap_equity, 2)])
        if len(state.orders) > 16:
            state.orders = {k: o for k, o in state.orders.items() if o.is_active}
            state.positions = {k: p for k, p in state.positions.items() if p.is_open}
        if i < warmup or i == last_idx:
            continue

        ev = evaluate(defn, cache, i)
        open_pos = broker.open_positions(sym)
        for p in open_pos:
            if (p.side == "long" and ev["exit_long"]["passed"]) or (p.side == "short" and ev["exit_short"]["passed"]):
                broker.close_position(p.id, ts=c.ts, reason="exit_signal", fill_mode="next_bar")

        pending_entry = any(o.is_active and not o.reduce_only for o in state.orders.values())
        if pending_entry or len(open_pos) >= settings.max_open_positions or snap_equity <= 0:
            continue
        side = None
        if ev["entry_long"]["passed"] and not ev["entry_short"]["passed"]:
            side = BUY
        elif ev["entry_short"]["passed"] and not ev["entry_long"]["passed"] and settings.allow_short:
            side = SELL
        if side is None:
            continue
        regime = classify_at(regime_x, i)["regime"] if regime_x else None
        if defn.regime_filter and regime not in defn.regime_filter:
            continue
        sd = stop_distance(defn, cache, i, side)
        if not sd or sd <= 0:
            continue
        td = target_distance(defn, cache, i, sd)
        signals += 1
        fee_rate = spec.taker_fee if settings.fees_enabled else 0.0
        per_unit = sd + c.close * 2 * fee_rate
        qty = snap_equity * risk_pct / 100 / per_unit
        qty = min(qty, snap_equity * leverage / c.close * 0.95)
        qty = spec.round_qty(qty)
        if qty < spec.min_qty:
            continue
        broker.place_order(
            symbol=sym,
            side=side,
            type=MARKET,
            qty=qty,
            ts=c.ts,
            fill_mode="next_bar",
            active_from_ts=candles[i + 1].ts,
            sl_offset=sd,
            tp_offset=td,
            meta={"signal_index": i, "regime": regime},
        )

    for p in broker.open_positions(sym):
        broker.close_position(p.id, ts=candles[-1].ts + sec, reason="end_of_test")
    if equity:
        equity[-1][1] = round(broker.snapshot()["equity"], 2)

    trades = []
    for t in broker.new_trades:
        trades.append(
            {
                "side": t.side,
                "entry_ts": t.opened_ts,
                "exit_ts": t.closed_ts,
                "opened_ts": t.opened_ts,
                "closed_ts": t.closed_ts,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "qty": t.qty,
                "gross_pnl": t.gross_pnl,
                "net_pnl": t.net_pnl,
                "fees": t.fees,
                "r_multiple": t.r_multiple,
                "exit_reason": t.exit_reason,
                "regime": t.meta.get("regime"),
            }
        )
    eq_values = [e[1] for e in equity]
    metrics = trade_metrics(trades, eq_values, settings.initial_balance)
    metrics["final_equity"] = eq_values[-1] if eq_values else settings.initial_balance
    metrics["return_pct"] = (metrics["final_equity"] / settings.initial_balance - 1) * 100
    metrics["buy_and_hold_pct"] = (
        (candles[-1].close / candles[warmup].close - 1) * 100 if len(candles) > warmup else None
    )
    metrics["signals"] = signals
    metrics["bars"] = len(candles)
    metrics["warmup_bars"] = warmup
    metrics["slippage_cost_est"] = broker.slippage_total
    held = sum(max(t["closed_ts"] - t["opened_ts"], 0) for t in trades)
    span = candles[-1].ts - candles[warmup].ts if len(candles) > warmup else 0
    metrics["time_in_market_pct"] = min(held / span * 100, 100.0) if span else None
    return {"trades": trades, "equity_curve": _downsample(equity), "metrics": metrics}
