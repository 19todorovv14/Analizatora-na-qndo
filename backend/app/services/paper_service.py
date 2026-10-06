"""Bridges the database and the pure PaperBroker engine.

Every call loads the account's active orders/open positions into a PaperBroker,
lets the engine work, then writes the resulting state back. Nothing here can reach a
real exchange — see app.exchange for the (paper-only) adapter.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import indicators as ind
from app.analysis.signal import analyze
from app.backtesting.metrics import trade_metrics
from app.market.base import MarketDataError
from app.market.catalog import ASSETS_BY_SYMBOL, get_asset
from app.market.timeframes import align
from app.models import PaperAccount, PaperEvent, PaperOrder, PaperPosition, PaperTrade, RiskEvent, User
from app.paper_engine.broker import PaperBroker
from app.paper_engine.models import ACTIVE_ORDER_STATUSES, AccountState, Bar, ExecutionConfig, Order, Position
from app.risk.engine import evaluate_trade, max_drawdown, trade_plan
from app.services import market_service, settings_service

MAX_CATCHUP_SECONDS = 3 * 86400

_ORDER_FIELDS = (
    "symbol",
    "side",
    "type",
    "qty",
    "filled_qty",
    "price",
    "avg_fill_price",
    "stop_loss",
    "take_profit",
    "status",
    "fill_mode",
    "position_id",
    "reduce_only",
    "fees",
    "slippage_cost",
    "reject_reason",
    "active_from_ts",
    "created_ts",
    "updated_ts",
    "meta",
)
_POS_FIELDS = (
    "symbol",
    "side",
    "qty",
    "initial_qty",
    "entry_price",
    "stop_loss",
    "take_profit",
    "initial_stop",
    "leverage",
    "fees",
    "realized_pnl",
    "mfe",
    "mae",
    "status",
    "sl_history",
    "active_from_ts",
    "opened_ts",
    "closed_ts",
    "meta",
)


class PaperError(ValueError):
    pass


# ----------------------------------------------------------------- accounts
def get_manual_account(db: Session, user: User) -> PaperAccount:
    acc = db.scalar(
        select(PaperAccount)
        .where(PaperAccount.user_id == user.id, PaperAccount.kind == "manual", PaperAccount.archived.is_(False))
        .order_by(PaperAccount.id)
    )
    if acc is None:
        acc = create_account(db, user, kind="manual", name="Main paper account")
    return acc


def create_account(
    db: Session, user: User, *, kind: str, name: str, balance: float = 10_000.0, leverage: float = 2.0
) -> PaperAccount:
    acc = PaperAccount(
        user_id=user.id,
        name=name,
        kind=kind,
        initial_balance=balance,
        cash=balance,
        peak_equity=balance,
        leverage=leverage,
        execution=settings_service.execution_config(user).to_dict(),
        last_synced_ts=int(time.time()),
    )
    db.add(acc)
    db.commit()
    return acc


def reset_account(db: Session, acc: PaperAccount, balance: float, leverage: float | None = None) -> PaperAccount:
    for model in (PaperOrder, PaperPosition, PaperTrade, PaperEvent):
        db.query(model).filter(model.account_id == acc.id).delete()
    acc.initial_balance = balance
    acc.cash = balance
    acc.realized_pnl = 0.0
    acc.fees_paid = 0.0
    acc.peak_equity = balance
    acc.max_drawdown_pct = 0.0
    acc.rng_counter = 0
    if leverage:
        acc.leverage = leverage
    acc.last_synced_ts = int(time.time())
    db.commit()
    return acc


# ----------------------------------------------------------- load / save
def _order_from_row(r: PaperOrder) -> Order:
    return Order(id=r.id, **{f: getattr(r, f) for f in _ORDER_FIELDS if f != "meta"}, meta=dict(r.meta or {}))


def _pos_from_row(r: PaperPosition) -> Position:
    data = {f: getattr(r, f) for f in _POS_FIELDS if f not in ("meta", "sl_history")}
    return Position(id=r.id, **data, sl_history=list(r.sl_history or []), meta=dict(r.meta or {}))


def load_broker(db: Session, acc: PaperAccount) -> PaperBroker:
    state = AccountState(
        cash=acc.cash,
        leverage=acc.leverage,
        realized_pnl=acc.realized_pnl,
        fees_paid=acc.fees_paid,
        rng_counter=acc.rng_counter,
    )
    for r in db.scalars(
        select(PaperOrder).where(PaperOrder.account_id == acc.id, PaperOrder.status.in_(ACTIVE_ORDER_STATUSES))
    ):
        state.orders[r.id] = _order_from_row(r)
    for r in db.scalars(
        select(PaperPosition).where(PaperPosition.account_id == acc.id, PaperPosition.status == "open")
    ):
        state.positions[r.id] = _pos_from_row(r)
    return PaperBroker(state, ASSETS_BY_SYMBOL, ExecutionConfig.from_dict(acc.execution), seed=f"acct:{acc.id}")


def save_broker(db: Session, acc: PaperAccount, broker: PaperBroker, user_id: int | None = None) -> None:
    s = broker.s
    acc.cash = s.cash
    acc.realized_pnl = s.realized_pnl
    acc.fees_paid = s.fees_paid
    acc.rng_counter = s.rng_counter
    for o in s.orders.values():
        row = db.get(PaperOrder, o.id)
        if row is None:
            row = PaperOrder(id=o.id, account_id=acc.id)
            db.add(row)
        for f in _ORDER_FIELDS:
            setattr(row, f, getattr(o, f))
    for p in s.positions.values():
        row = db.get(PaperPosition, p.id)
        if row is None:
            row = PaperPosition(id=p.id, account_id=acc.id)
            db.add(row)
        for f in _POS_FIELDS:
            setattr(row, f, getattr(p, f))
    for t in broker.new_trades:
        db.add(
            PaperTrade(
                id=t.id,
                account_id=acc.id,
                position_id=t.position_id,
                symbol=t.symbol,
                side=t.side,
                qty=t.qty,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                stop_price=t.stop_price,
                target_price=t.target_price,
                gross_pnl=t.gross_pnl,
                fees=t.fees,
                net_pnl=t.net_pnl,
                risk_amount=t.risk_amount,
                r_multiple=t.r_multiple,
                exit_reason=t.exit_reason,
                opened_ts=t.opened_ts,
                closed_ts=t.closed_ts,
                meta=t.meta,
            )
        )
    for e in broker.events:
        db.add(PaperEvent(account_id=acc.id, ts=e.ts, type=e.type, message=e.message[:500], data=e.data))
        if e.type == "liquidation" and user_id is not None:
            db.add(
                RiskEvent(
                    user_id=user_id,
                    account_id=acc.id,
                    ts=e.ts,
                    kind="liquidation",
                    severity="high",
                    message=e.message[:500],
                    ref_id=e.data.get("position_id"),
                )
            )
    snap = broker.snapshot()
    acc.peak_equity = max(acc.peak_equity, snap["equity"])
    if acc.peak_equity > 0:
        acc.max_drawdown_pct = max(acc.max_drawdown_pct, (acc.peak_equity - snap["equity"]) / acc.peak_equity * 100)
    broker.events.clear()
    broker.new_trades.clear()
    db.commit()


# ------------------------------------------------------------------- sync
def sync_account(db: Session, acc: PaperAccount, now: int | None = None) -> PaperBroker:
    """Advance the account through all CLOSED 1-minute candles since the last sync."""
    now = int(now or time.time())
    broker = load_broker(db, acc)
    symbols = {o.symbol for o in broker.s.orders.values()} | {p.symbol for p in broker.s.positions.values()}
    start = max(acc.last_synced_ts, now - MAX_CATCHUP_SECONDS)
    start = align(start, "1m")
    last_processed_close = acc.last_synced_ts
    if symbols:
        series: dict[str, dict[int, Bar]] = {}
        for sym in symbols:
            try:
                rows = market_service.candles(sym, "1m", start=start, end=now, limit=0, now=now, include_partial=False)
            except MarketDataError:
                rows = []
            series[sym] = {c.ts: Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, 60) for c in rows}
            if rows:
                broker.set_mark(sym, rows[0].open)
        for ts in sorted({ts for bars in series.values() for ts in bars}):
            for sym, bars in series.items():
                bar = bars.get(ts)
                if bar is not None:
                    broker.process_bar(sym, bar)
            last_processed_close = ts + 60
    else:
        last_processed_close = align(now, "1m")
    acc.last_synced_ts = max(acc.last_synced_ts, last_processed_close)
    for sym in symbols:  # mark to the live (forming) price for display
        try:
            broker.set_mark(sym, market_service.ticker(sym, now=now).price)
        except MarketDataError:
            pass
    user = db.get(User, acc.user_id)
    save_broker(db, acc, broker, user.id if user else None)
    return broker


# ------------------------------------------------------------- serialisation
def order_to_dict(o: PaperOrder | Order) -> dict:
    return {
        "id": o.id,
        "symbol": o.symbol,
        "side": o.side,
        "type": o.type,
        "qty": o.qty,
        "filled_qty": o.filled_qty,
        "price": o.price,
        "avg_fill_price": o.avg_fill_price,
        "stop_loss": o.stop_loss,
        "take_profit": o.take_profit,
        "status": o.status,
        "fees": o.fees,
        "slippage_cost": o.slippage_cost,
        "reject_reason": o.reject_reason,
        "reduce_only": o.reduce_only,
        "position_id": o.position_id,
        "created_ts": o.created_ts,
        "updated_ts": o.updated_ts,
        "reason": (o.meta or {}).get("reason"),
    }


def position_to_dict(p: Position, broker: PaperBroker) -> dict:
    spec = get_asset(p.symbol)
    mark = broker.marks.get(p.symbol, p.entry_price)
    upnl = broker.position_upnl(p)
    risk_unit = abs(p.entry_price - p.initial_stop) if p.initial_stop is not None else None
    return {
        "id": p.id,
        "symbol": p.symbol,
        "side": p.side,
        "qty": p.qty,
        "initial_qty": p.initial_qty,
        "entry_price": p.entry_price,
        "mark_price": mark,
        "stop_loss": p.stop_loss,
        "take_profit": p.take_profit,
        "initial_stop": p.initial_stop,
        "leverage": p.leverage,
        "margin": p.qty * p.entry_price / p.leverage,
        "unrealized_pnl": upnl,
        "unrealized_r": upnl / (risk_unit * p.qty) if risk_unit else None,
        "realized_pnl": p.realized_pnl,
        "liquidation_price": broker.liquidation_price(p),
        "opened_ts": p.opened_ts,
        "sl_history": p.sl_history,
        "precision": spec.price_precision,
        "setup": (p.meta or {}).get("setup"),
        "timeframe": (p.meta or {}).get("timeframe"),
        "risk_pct": (p.meta or {}).get("risk_pct"),
    }


def trade_to_dict(t: PaperTrade) -> dict:
    return {
        "id": t.id,
        "position_id": t.position_id,
        "symbol": t.symbol,
        "side": t.side,
        "qty": t.qty,
        "entry_price": t.entry_price,
        "exit_price": t.exit_price,
        "stop_price": t.stop_price,
        "target_price": t.target_price,
        "gross_pnl": t.gross_pnl,
        "fees": t.fees,
        "net_pnl": t.net_pnl,
        "risk_amount": t.risk_amount,
        "r_multiple": t.r_multiple,
        "exit_reason": t.exit_reason,
        "opened_ts": t.opened_ts,
        "closed_ts": t.closed_ts,
        "meta": t.meta or {},
    }


def closed_trades(db: Session, account_ids: list[int], since: int | None = None) -> list[dict]:
    q = select(PaperTrade).where(PaperTrade.account_id.in_(account_ids))
    if since:
        q = q.where(PaperTrade.closed_ts >= since)
    return [trade_to_dict(t) for t in db.scalars(q.order_by(PaperTrade.closed_ts))]


def day_pnl(db: Session, acc: PaperAccount, broker: PaperBroker, now: int) -> float:
    day_start = now - now % 86400
    realized = sum(t["net_pnl"] for t in closed_trades(db, [acc.id], since=day_start))
    return realized + broker.snapshot()["unrealized_pnl"]


def account_view(db: Session, acc: PaperAccount, broker: PaperBroker, now: int | None = None) -> dict:
    now = int(now or time.time())
    snap = broker.snapshot()
    trades = closed_trades(db, [acc.id])
    equity = [acc.initial_balance]
    for t in trades:
        equity.append(equity[-1] + t["net_pnl"])
    metrics = trade_metrics(trades, equity, acc.initial_balance)
    _, dd_pct = max_drawdown(equity + [snap["equity"]])
    orders = [order_to_dict(o) for o in broker.s.orders.values() if o.is_active and not o.reduce_only]
    return {
        "account": {
            "id": acc.id,
            "name": acc.name,
            "kind": acc.kind,
            "currency": acc.currency,
            "initial_balance": acc.initial_balance,
            "leverage": acc.leverage,
            "execution": acc.execution,
            "created_ts": acc.created_ts,
            "last_synced_ts": acc.last_synced_ts,
        },
        "balance": snap["balance"],
        "equity": snap["equity"],
        "unrealized_pnl": snap["unrealized_pnl"],
        "realized_pnl": snap["realized_pnl"],
        "fees_paid": snap["fees_paid"],
        "used_margin": snap["used_margin"],
        "free_margin": snap["free_margin"],
        "margin_level": snap["margin_level"],
        "exposure": snap["exposure"],
        "day_pnl": day_pnl(db, acc, broker, now),
        "max_drawdown_pct": max(acc.max_drawdown_pct, dd_pct),
        "metrics": metrics,
        "positions": [position_to_dict(p, broker) for p in broker.open_positions()],
        "orders": orders,
        "virtual_funds_notice": "PAPER TRADING — всички средства и сделки са виртуални.",
    }


# --------------------------------------------------------------- actions
def entry_context(symbol: str, timeframe: str, side: str, now: int, news_risk: bool = False) -> dict:
    """Snapshot of the market at entry — used later by trade review and behaviour detection."""
    try:
        rows = market_service.candles(symbol, timeframe, limit=300, now=now, include_partial=False)
    except MarketDataError:
        return {}
    if len(rows) < 60:
        return {}
    spec = get_asset(symbol)
    a = analyze(rows, spec=spec, timeframe=timeframe, news_risk=news_risk)
    closes = [c.close for c in rows]
    e20 = ind.ema(closes, 20)[-1]
    atr = ind.atr([c.high for c in rows], [c.low for c in rows], closes, 14)[-1] or 0
    dist = ((rows[-1].close - e20) / atr) if (atr and e20) else 0.0
    directional = dist if side == "buy" else -dist
    return {
        "timeframe": timeframe,
        "decision": a.get("decision"),
        "regime": (a.get("regime") or {}).get("regime"),
        "setup": (a.get("setup") or {}).get("name"),
        "no_trade_reasons": [r["title"] for r in a.get("no_trade_reasons", [])],
        "ema20_distance_atr": round(directional, 2),
        "chasing": directional > 1.5,
        "atr": atr,
    }


def prepare_broker_for_symbol(db: Session, acc: PaperAccount, symbol: str, now: int) -> PaperBroker:
    broker = sync_account(db, acc, now)
    t = market_service.ticker(symbol, now=now)
    broker.set_mark(symbol, t.price)
    bar = market_service.last_closed_1m(symbol, now)
    if bar:
        broker.last_bar[symbol] = Bar(bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume, 60)
    return broker


def preview_order(db: Session, user: User, acc: PaperAccount, req: dict, now: int | None = None) -> dict:
    """Risk preview shown BEFORE the trade ("How much are you risking?")."""
    now = int(now or time.time())
    symbol = req["symbol"]
    spec = get_asset(symbol)
    broker = prepare_broker_for_symbol(db, acc, symbol, now)
    q = broker.quote(symbol)
    side = req["side"]
    entry = (
        req.get("price")
        if req.get("type") in ("limit", "stop") and req.get("price")
        else (q.ask if side == "buy" else q.bid)
    )
    snap = broker.snapshot()
    rules = settings_service.risk_rules(user)
    plan = trade_plan(
        side=side,
        entry=entry,
        stop=req.get("stop_loss"),
        take_profit=req.get("take_profit"),
        qty=float(req["qty"]),
        balance=snap["equity"],
        fee_rate=spec.taker_fee,
    )
    findings = evaluate_trade(
        rules=rules,
        equity=snap["equity"],
        plan=plan,
        has_stop=req.get("stop_loss") is not None,
        open_positions=snap["open_positions"],
        exposure=snap["exposure"],
        new_notional=float(req["qty"]) * entry,
        day_pnl=day_pnl(db, acc, broker, now),
    )
    lev = broker.leverage_for(symbol)
    return {
        "symbol": symbol,
        "entry_estimate": entry,
        "bid": q.bid,
        "ask": q.ask,
        "spread": q.ask - q.bid,
        "plan": plan,
        "findings": [f.to_dict() for f in findings],
        "leverage": lev,
        "margin_required": float(req["qty"]) * entry / lev,
        "free_margin": snap["free_margin"],
        "fee_estimate": float(req["qty"]) * entry * spec.taker_fee,
    }


def place_order(db: Session, user: User, acc: PaperAccount, req: dict, now: int | None = None) -> dict:
    now = int(now or time.time())
    preview = preview_order(db, user, acc, req, now)
    broker = load_broker(db, acc)  # fresh state after the sync performed by preview_order
    symbol = req["symbol"]
    broker.set_mark(symbol, (preview["bid"] + preview["ask"]) / 2)
    bar = market_service.last_closed_1m(symbol, now)
    if bar:
        broker.last_bar[symbol] = Bar(bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume, 60)
    for p in broker.open_positions():
        if p.symbol != symbol:
            try:
                broker.set_mark(p.symbol, market_service.ticker(p.symbol, now=now).price)
            except MarketDataError:
                pass
    settings = settings_service.user_settings(user)
    tf = req.get("timeframe") or settings["default_timeframe"]
    meta = {
        "source": req.get("source", "manual"),
        "risk_pct": preview["plan"].get("risk_pct"),
        "planned_rr": preview["plan"].get("reward_risk"),
        "setup": (req.get("setup") or "").strip()[:100] or None,
        "timeframe": tf,
        "note": (req.get("note") or "")[:500] or None,
        "warnings": [f["kind"] for f in preview["findings"]],
        "entry_context": entry_context(symbol, tf, req["side"], now, settings.get("news_risk", False)),
    }
    order = broker.place_order(
        symbol=symbol,
        side=req["side"],
        type=req.get("type", "market"),
        qty=float(req["qty"]),
        ts=now,
        price=req.get("price"),
        stop_loss=req.get("stop_loss"),
        take_profit=req.get("take_profit"),
        active_from_ts=align(now, "1m") + 60,
        meta=meta,
    )
    save_broker(db, acc, broker, user.id)
    if order.status != "rejected":
        for f in preview["findings"]:
            if f["severity"] in ("warn", "high"):
                db.add(
                    RiskEvent(
                        user_id=user.id,
                        account_id=acc.id,
                        ts=now,
                        kind=f["kind"],
                        severity=f["severity"],
                        message=f["message"][:500],
                        ref_id=order.id,
                        data={"explanation": f["explanation"]},
                    )
                )
        db.commit()
    broker = sync_account(db, acc, now)
    return {"order": order_to_dict(order), "preview": preview, "view": account_view(db, acc, broker, now)}


def close_position(
    db: Session, user: User, acc: PaperAccount, position_id: str, qty: float | None, now: int | None = None
) -> dict:
    now = int(now or time.time())
    row = db.get(PaperPosition, position_id)
    if row is None or row.account_id != acc.id or row.status != "open":
        raise PaperError("Позицията не е намерена или вече е затворена.")
    broker = prepare_broker_for_symbol(db, acc, row.symbol, now)
    order = broker.close_position(position_id, ts=now, qty=qty)
    if order is None:
        raise PaperError("Позицията вече е затворена (вероятно от SL/TP).")
    save_broker(db, acc, broker, user.id)
    return {"order": order_to_dict(order), "view": account_view(db, acc, broker, now)}


def modify_position(
    db: Session, user: User, acc: PaperAccount, position_id: str, changes: dict, now: int | None = None
) -> dict:
    now = int(now or time.time())
    row = db.get(PaperPosition, position_id)
    if row is None or row.account_id != acc.id or row.status != "open":
        raise PaperError("Позицията не е намерена или вече е затворена.")
    broker = prepare_broker_for_symbol(db, acc, row.symbol, now)
    kwargs = {k: changes[k] for k in ("stop_loss", "take_profit") if k in changes}
    err = broker.modify_position(position_id, ts=now, **kwargs)
    if err:
        raise PaperError(err)
    pos = broker.s.positions[position_id]
    if pos.sl_history and pos.sl_history[-1].get("widened") and pos.sl_history[-1]["ts"] == now:
        db.add(
            RiskEvent(
                user_id=user.id,
                account_id=acc.id,
                ts=now,
                kind="moved_stop",
                severity="high",
                message="Stop loss е преместен по-далеч — рискът след входа се увеличи.",
                ref_id=position_id,
            )
        )
    save_broker(db, acc, broker, user.id)
    return {"view": account_view(db, acc, broker, now)}


def cancel_order(db: Session, user: User, acc: PaperAccount, order_id: str, now: int | None = None) -> dict:
    now = int(now or time.time())
    row = db.get(PaperOrder, order_id)
    if row is None or row.account_id != acc.id:
        raise PaperError("Поръчката не е намерена.")
    broker = sync_account(db, acc, now)
    if order_id not in broker.s.orders:
        raise PaperError("Поръчката вече не е активна.")
    broker.cancel_order(order_id, now)
    save_broker(db, acc, broker, user.id)
    return {"view": account_view(db, acc, broker, now)}


def events(db: Session, acc: PaperAccount, limit: int = 50) -> list[dict]:
    rows = db.scalars(
        select(PaperEvent).where(PaperEvent.account_id == acc.id).order_by(PaperEvent.id.desc()).limit(limit)
    )
    return [{"id": e.id, "ts": e.ts, "type": e.type, "message": e.message, "data": e.data} for e in rows]


def position_detail(db: Session, acc_ids: list[int], position_id: str) -> tuple[dict, list[dict]] | None:
    row = db.get(PaperPosition, position_id)
    if row is None or row.account_id not in acc_ids:
        return None
    trades = [
        trade_to_dict(t)
        for t in db.scalars(
            select(PaperTrade).where(PaperTrade.position_id == position_id).order_by(PaperTrade.closed_ts)
        )
    ]
    pos = {"id": row.id, **{f: getattr(row, f) for f in _POS_FIELDS}}
    return pos, trades


def utc_day(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")
