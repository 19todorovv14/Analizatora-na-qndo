"""Paper bots: evaluate a strategy on every CLOSED candle of their timeframe and trade
their own virtual account. A bot can never reach a real exchange."""

from __future__ import annotations

import copy
import time
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.analysis.regime import RegimeInputs, classify_at
from app.backtesting.metrics import drawdown_series, trade_metrics
from app.bots import stats as bot_stats
from app.market.base import MarketDataError
from app.market.catalog import SPECS, get_asset
from app.market.timeframes import align, last_closed_open, tf_seconds
from app.models import Bot, BotLog, BotRun, PaperAccount, PaperPosition, Strategy, User
from app.paper_engine.models import BUY, MARKET, SELL, Bar
from app.services import market_service, paper_service
from app.strategies.rules import IndicatorCache, StrategyDefinition, evaluate, stop_distance, target_distance

DEFAULT_CONFIG = {
    "risk_per_trade_pct": 1.0,
    "max_open_positions": 1,
    "daily_loss_limit_pct": 3.0,
    "trading_hours": {"start": 0, "end": 24, "days": [0, 1, 2, 3, 4, 5, 6]},
    "allow_short": True,
    "initial_balance": 10_000.0,
    "warm_start_days": 30,
}
WARMUP_BARS = 250
MAX_BARS_PER_RUN = 3000


def log(db: Session, bot: Bot, level: str, message: str, ts: int | None = None, **data) -> None:
    db.add(BotLog(bot_id=bot.id, ts=ts or int(time.time()), level=level, message=message[:500], data=data))


def create_bot(db: Session, user: User, data: dict) -> Bot:
    strategy = db.get(Strategy, data["strategy_id"]) if data.get("strategy_id") else None
    if strategy is None or (strategy.user_id not in (None, user.id)):
        raise ValueError("Избери стратегия.")
    definition = dict(strategy.definition)
    if data.get("stop"):
        definition["stop"] = data["stop"]
    if data.get("take_profit"):
        definition["take_profit"] = data["take_profit"]
    StrategyDefinition(**definition)  # validate
    config = {**DEFAULT_CONFIG, **{k: v for k, v in (data.get("config") or {}).items() if k in DEFAULT_CONFIG}}
    if data.get("max_positions") is not None:  # v2 alias of config.max_open_positions
        config["max_open_positions"] = int(data["max_positions"])
    config["max_open_positions"] = max(1, int(config["max_open_positions"]))
    get_asset(data["symbol"])
    acc = paper_service.create_account(
        db,
        user,
        kind="bot",
        name=f"Bot: {data['name']}",
        balance=float(config["initial_balance"]),
        leverage=min(2.0, SPECS[data["symbol"]].max_leverage),
    )
    bot = Bot(
        user_id=user.id,
        name=data["name"][:100],
        symbol=data["symbol"],
        timeframe=data["timeframe"],
        strategy_id=strategy.id,
        strategy_snapshot=definition,
        config=config,
        status="STOPPED",
        paper_account_id=acc.id,
        run_mode=data.get("run_mode", "forward"),
        runtime={},
    )
    db.add(bot)
    db.commit()
    log(db, bot, "info", f"Ботът е създаден със стратегия '{strategy.name}'. Работи САМО с виртуални пари.")
    db.commit()
    return bot


def start_bot(db: Session, bot: Bot, now: int | None = None) -> Bot:
    now = int(now or time.time())
    if bot.status == "RUNNING":
        return bot
    sec = tf_seconds(bot.timeframe)
    if bot.last_processed_ts is None:
        if bot.run_mode == "warm_start":
            days = float(bot.config.get("warm_start_days", 30))
            bot.last_processed_ts = align(now - int(days * 86400), bot.timeframe)
            log(
                db,
                bot,
                "info",
                f"Warm start: ботът ще симулира последните {days:g} дни върху исторически данни, "
                "после продължава в реално време.",
                now,
            )
        else:
            bot.last_processed_ts = align(now, bot.timeframe) - sec
    acc = db.get(PaperAccount, bot.paper_account_id)
    broker = paper_service.load_broker(db, acc)
    bot.status = "RUNNING"
    bot.pause_reason = None
    db.add(BotRun(bot_id=bot.id, started_ts=now, start_equity=broker.snapshot()["equity"]))
    log(db, bot, "info", "Status → RUNNING (paper).", now)
    db.commit()
    return bot


def pause_bot(db: Session, bot: Bot, reason: str = "Паузиран от потребителя.") -> Bot:
    bot.status = "PAUSED"
    bot.pause_reason = reason
    log(db, bot, "warn", f"Status → PAUSED: {reason} Отворените позиции се управляват (SL/TP), нови не се отварят.")
    db.commit()
    return bot


def stop_bot(db: Session, bot: Bot, now: int | None = None) -> Bot:
    now = int(now or time.time())
    acc = db.get(PaperAccount, bot.paper_account_id)
    broker = paper_service.load_broker(db, acc)
    try:
        price = market_service.ticker(bot.symbol, now=now).price
        broker.set_mark(bot.symbol, price)
        for p in broker.open_positions():
            broker.close_position(p.id, ts=now, reason="manual")
    except MarketDataError as exc:
        log(db, bot, "error", f"Не успях да затворя позициите: {exc}", now)
    paper_service.save_broker(db, acc, broker, bot.user_id)
    run = db.scalar(
        select(BotRun).where(BotRun.bot_id == bot.id, BotRun.stopped_ts.is_(None)).order_by(BotRun.id.desc())
    )
    if run:
        run.stopped_ts = now
        run.status = "stopped"
        run.end_equity = broker.snapshot()["equity"]
    bot.status = "STOPPED"
    bot.pause_reason = None
    log(db, bot, "info", "Status → STOPPED. Отворените позиции са затворени (paper).", now)
    db.commit()
    return bot


def _in_hours(cfg: dict, ts: int) -> bool:
    th = cfg.get("trading_hours") or {}
    dt = datetime.fromtimestamp(ts, UTC)
    days = th.get("days", list(range(7)))
    start, end = int(th.get("start", 0)), int(th.get("end", 24))
    in_window = start <= dt.hour < end if start <= end else (dt.hour >= start or dt.hour < end)
    return dt.weekday() in days and in_window


def has_new_candle(bot: Bot, now: int) -> bool:
    """Cheap check (no data fetch): can a candle newer than the last processed one have closed by `now`?"""
    return bot.last_processed_ts is None or last_closed_open(now, bot.timeframe) > bot.last_processed_ts


def run_bot(db: Session, bot: Bot, now: int | None = None) -> int:
    """Process all newly closed candles. Returns the number of candles processed."""
    if bot.status not in ("RUNNING", "PAUSED"):
        return 0
    now = int(now or time.time())
    if not has_new_candle(bot, now):
        return 0  # nothing can have closed since the last run — skip the candle fetch entirely
    sec = tf_seconds(bot.timeframe)
    spec = get_asset(bot.symbol)
    cfg = {**DEFAULT_CONFIG, **(bot.config or {})}
    try:
        defn = StrategyDefinition(**bot.strategy_snapshot)
        start = (bot.last_processed_ts or now) - WARMUP_BARS * sec
        rows = market_service.candles(
            bot.symbol, bot.timeframe, start=start, end=now, limit=0, now=now, include_partial=False
        )
    except (MarketDataError, ValueError) as exc:
        bot.error_count += 1
        bot.last_error = str(exc)
        log(db, bot, "error", f"Грешка: {exc}", now)
        db.commit()
        return 0
    new_idx = [i for i, c in enumerate(rows) if c.ts > (bot.last_processed_ts or 0)][:MAX_BARS_PER_RUN]
    if not new_idx:
        return 0
    acc = db.get(PaperAccount, bot.paper_account_id)
    broker = paper_service.load_broker(db, acc)
    if new_idx[0] > 0:
        broker.set_mark(bot.symbol, rows[new_idx[0] - 1].close)
    cache = IndicatorCache(rows)
    rx = RegimeInputs.from_candles(rows)
    runtime = copy.deepcopy(bot.runtime or {})
    stats = bot_stats.normalise(runtime.get("stats"))
    processed = 0
    last_signal = bot.last_signal or {}
    regime = bot.regime

    seen_events = 0
    for i in new_idx:
        c = rows[i]
        bar = Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, sec)
        broker.process_bar(bot.symbol, bar)
        for e in broker.events[seen_events:]:
            if e.type in (
                "order_filled",
                "stop_loss",
                "take_profit",
                "liquidation",
                "position_closed",
                "order_rejected",
                "margin_call",
                "exit_signal",
            ):
                log(db, bot, "trade", e.message, e.ts, type=e.type)
        seen_events = len(broker.events)
        close_ts = c.ts + sec
        processed += 1
        bot.last_processed_ts = c.ts

        snap = broker.snapshot()
        day = datetime.fromtimestamp(close_ts, UTC).strftime("%Y-%m-%d")
        if runtime.get("day") != day:
            runtime = {**runtime, "day": day, "start_equity": snap["equity"]}
            if bot.status == "PAUSED" and bot.pause_reason and bot.pause_reason.startswith("Daily loss limit"):
                bot.status = "RUNNING"
                bot.pause_reason = None
                log(db, bot, "info", "Нов ден — daily loss limit е нулиран, ботът продължава.", close_ts)

        ev = evaluate(defn, cache, i)
        regime = classify_at(rx, i)["regime"]
        met = bot_stats.record_bar(stats, ev, close_ts)
        open_pos = broker.open_positions(bot.symbol)
        for p in open_pos:
            if (p.side == "long" and ev["exit_long"]["passed"]) or (p.side == "short" and ev["exit_short"]["passed"]):
                broker.close_position(p.id, ts=close_ts, reason="exit_signal", fill_mode="next_bar")
                log(db, bot, "signal", f"EXIT сигнал за {p.side.upper()} — затваряне на следващата свещ.", close_ts)

        side = None
        if ev["entry_long"]["passed"] and not ev["entry_short"]["passed"]:
            side = BUY
        elif ev["entry_short"]["passed"] and not ev["entry_long"]["passed"] and cfg.get("allow_short", True):
            side = SELL
        if met.get("long") and met.get("short"):
            bot_stats.record_filter(stats, "conflict")
        elif met.get("short") and side is None:
            bot_stats.record_filter(stats, "short_disabled")
        signal = "LONG SETUP" if side == BUY else "SHORT SETUP" if side == SELL else "WAIT"
        reason = None
        filter_key = None
        day_loss_pct = (
            (runtime["start_equity"] - snap["equity"]) / runtime["start_equity"] * 100
            if runtime.get("start_equity")
            else 0
        )
        if side:
            if bot.status == "PAUSED":
                reason = f"Ботът е на пауза ({bot.pause_reason})"
                filter_key = "daily_loss" if (bot.pause_reason or "").startswith("Daily loss limit") else "paused"
            elif day_loss_pct >= float(cfg["daily_loss_limit_pct"]):
                reason = "Daily loss limit reached"
                filter_key = "daily_loss"
                bot.status = "PAUSED"
                bot.pause_reason = f"Daily loss limit reached ({day_loss_pct:.2f}% ≥ {cfg['daily_loss_limit_pct']}%)"
                log(db, bot, "warn", f"{bot.pause_reason}. Нови сделки до края на деня няма да има.", close_ts)
            elif not _in_hours(cfg, close_ts):
                reason = "Извън зададените trading hours"
                filter_key = "trading_hours"
            elif len(open_pos) >= int(cfg["max_open_positions"]):
                reason = f"Max open positions ({cfg['max_open_positions']}) достигнат"
                filter_key = "max_positions"
            elif any(o.is_active and not o.reduce_only for o in broker.s.orders.values()):
                reason = "Има чакаща поръчка"
                filter_key = "pending_order"
            elif defn.regime_filter and regime not in defn.regime_filter:
                reason = f"Режим {regime} не е разрешен от филтъра"
                filter_key = "regime"
        if side and reason:
            signal = "NO TRADE"
            bot_stats.record_filter(stats, filter_key or "paused")
        last_signal = {
            "ts": close_ts,
            "signal": signal,
            "reason": reason,
            "regime": regime,
            "conditions": {k: v["conditions"] for k, v in ev.items() if v["active"]},
        }
        if side and not reason:
            sd = stop_distance(defn, cache, i, side)
            if not sd:
                bot_stats.record_filter(stats, "stop_unavailable")
                log(db, bot, "warn", "Не може да се изчисли stop distance (липсва ATR) — пропускам.", close_ts)
                continue
            td = target_distance(defn, cache, i, sd)
            risk_pct = float(cfg.get("risk_per_trade_pct", defn.risk_per_trade_pct))
            per_unit = sd + c.close * 2 * spec.taker_fee
            qty = snap["equity"] * risk_pct / 100 / per_unit
            qty = spec.round_qty(min(qty, snap["equity"] * broker.leverage_for(bot.symbol) / c.close * 0.95))
            if qty < spec.min_qty:
                bot_stats.record_filter(stats, "position_size")
                log(db, bot, "warn", "Изчисленото количество е под минималното — сделката е пропусната.", close_ts)
                continue
            atr_pct = rx.atr_pct[i]
            bot_stats.record_entry(stats, "long" if side == BUY else "short")
            broker.place_order(
                symbol=bot.symbol,
                side=side,
                type=MARKET,
                qty=qty,
                ts=close_ts,
                fill_mode="next_bar",
                active_from_ts=c.ts + sec,
                sl_offset=sd,
                tp_offset=td,
                meta={
                    "source": "bot",
                    "bot_id": bot.id,
                    "risk_pct": risk_pct,
                    "timeframe": bot.timeframe,
                    "setup": "strategy",
                    "entry_context": {"regime": regime, "decision": signal},
                    # v2: context at the signal bar, used by the BOT AI COACH breakdowns
                    "regime": regime,
                    "atr_pct": round(atr_pct, 4) if atr_pct is not None else None,
                    "signal_ts": close_ts,
                    "strategy_id": bot.strategy_id,
                },
            )
            log(
                db,
                bot,
                "signal",
                f"{signal}: {side.upper()} {qty:g} {bot.symbol} на следващата свещ "
                f"(стоп {sd:.{spec.price_precision}f}, риск {risk_pct:g}%).",
                close_ts,
                regime=regime,
            )
        elif side and reason:
            log(db, bot, "signal", f"Сигнал игнориран: {reason}", close_ts)

    runtime["stats"] = stats
    bot.runtime = runtime
    flag_modified(bot, "runtime")
    bot.last_signal = last_signal
    bot.regime = regime
    if processed and rows:
        broker.set_mark(bot.symbol, rows[-1].close)
    paper_service.save_broker(db, acc, broker, bot.user_id)
    db.commit()
    return processed


def run_all_bots(db: Session, now: int | None = None) -> int:
    total = 0
    for bot in db.scalars(select(Bot).where(Bot.status.in_(("RUNNING", "PAUSED")))):
        total += run_bot(db, bot, now)
    return total


def max_positions(bot: Bot) -> int:
    return int({**DEFAULT_CONFIG, **(bot.config or {})}["max_open_positions"])


def evaluation_stats(bot: Bot) -> dict:
    """Per-bar evaluation counters (setups, all conditions met, rejected, filters, entries)."""
    return bot_stats.normalise((bot.runtime or {}).get("stats"))


def _account_state(db: Session, bot: Bot, now: int | None) -> tuple[PaperAccount, object, dict, list[dict], dict]:
    acc = db.get(PaperAccount, bot.paper_account_id)
    broker = paper_service.load_broker(db, acc)
    try:
        broker.set_mark(bot.symbol, market_service.ticker(bot.symbol, now=now).price)
    except MarketDataError:
        pass
    snap = broker.snapshot()
    trades = paper_service.closed_trades(db, [acc.id])
    equity = [acc.initial_balance]
    for t in trades:
        equity.append(equity[-1] + t["net_pnl"])
    metrics = trade_metrics(trades, equity, acc.initial_balance)
    return acc, broker, snap, trades, metrics


def bot_summary(db: Session, bot: Bot, now: int | None = None) -> dict:
    """Light row for the bot list (no logs / runs / positions)."""
    acc, _broker, snap, _trades, metrics = _account_state(db, bot, now)
    stats = evaluation_stats(bot)
    return {
        "id": bot.id,
        "name": bot.name,
        "symbol": bot.symbol,
        "timeframe": bot.timeframe,
        "status": bot.status,
        "pause_reason": bot.pause_reason,
        "equity": snap["equity"],
        "pnl": snap["equity"] - acc.initial_balance,
        "drawdown_pct": metrics["max_drawdown_pct"],
        "regime": bot.regime,
        "last_signal": bot.last_signal,
        "run_mode": bot.run_mode,
        "trades": metrics["total_trades"],
        "win_rate": metrics["win_rate"],
        # v2 (additive)
        "strategy_id": bot.strategy_id,
        "max_positions": max_positions(bot),
        "average_r": metrics["average_r"],
        "last_processed_ts": bot.last_processed_ts,
        "setups_generated": stats["setups_generated"],
        "all_conditions_met": stats["all_conditions_met"],
        "rejected": stats["rejected"],
        "coach_headline": bot_stats.headline(stats),
    }


def bot_view(db: Session, bot: Bot, now: int | None = None) -> dict:
    acc, broker, snap, trades, metrics = _account_state(db, bot, now)
    logs = db.scalars(select(BotLog).where(BotLog.bot_id == bot.id).order_by(BotLog.id.desc()).limit(80))
    errors = db.scalars(
        select(BotLog).where(BotLog.bot_id == bot.id, BotLog.level == "error").order_by(BotLog.id.desc()).limit(10)
    )
    runs = db.scalars(select(BotRun).where(BotRun.bot_id == bot.id).order_by(BotRun.id.desc()).limit(10))
    defn = StrategyDefinition(**bot.strategy_snapshot)
    from app.strategies.rules import describe

    stats = evaluation_stats(bot)
    equity_values = [acc.initial_balance]
    for t in trades:
        equity_values.append(equity_values[-1] + t["net_pnl"])

    return {
        "id": bot.id,
        "name": bot.name,
        "symbol": bot.symbol,
        "timeframe": bot.timeframe,
        "status": bot.status,
        "pause_reason": bot.pause_reason,
        "run_mode": bot.run_mode,
        "strategy_id": bot.strategy_id,
        "config": bot.config,
        "strategy": bot.strategy_snapshot,
        "strategy_description": describe(defn),
        "balance": snap["balance"],
        "equity": snap["equity"],
        "pnl": snap["equity"] - acc.initial_balance,
        "initial_balance": acc.initial_balance,
        "unrealized_pnl": snap["unrealized_pnl"],
        "metrics": metrics,
        "drawdown_pct": metrics["max_drawdown_pct"],
        "positions": [paper_service.position_to_dict(p, broker) for p in broker.open_positions()],
        "trades": trades[-50:][::-1],
        "equity_curve": [[t["closed_ts"], round(v, 2)] for t, v in zip(trades, equity_values[1:], strict=False)],
        "last_signal": bot.last_signal,
        "regime": bot.regime,
        "last_processed_ts": bot.last_processed_ts,
        "errors": [{"ts": e.ts, "message": e.message} for e in errors],
        "error_count": bot.error_count,
        "logs": [{"ts": entry.ts, "level": entry.level, "message": entry.message} for entry in logs],
        "runs": [
            {
                "started_ts": r.started_ts,
                "stopped_ts": r.stopped_ts,
                "start_equity": r.start_equity,
                "end_equity": r.end_equity,
                "status": r.status,
            }
            for r in runs
        ],
        "paper_only_notice": "Този бот работи САМО в paper-trading среда с виртуални пари.",
        # v2 (additive)
        "max_positions": max_positions(bot),
        # same time axis as equity_curve; the peak includes the initial balance
        "drawdown_curve": [
            [t["closed_ts"], round(d, 3)] for t, d in zip(trades, drawdown_series(equity_values)[1:], strict=False)
        ],
        "evaluation_stats": stats,
        "coach_headline": bot_stats.headline(stats),
    }


def open_bot_positions(db: Session, bot: Bot) -> int:
    return (
        db.query(PaperPosition)
        .filter(PaperPosition.account_id == bot.paper_account_id, PaperPosition.status == "open")
        .count()
    )
