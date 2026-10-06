"""MARKET REPLAY — historical candles revealed one by one. The user never sees the future:
the API only returns candles up to the cursor, and orders are filled by the same
PaperBroker on the next revealed candle."""

from __future__ import annotations

import time

from sqlalchemy.orm import Session

from app.ai.review import review_position
from app.backtesting.metrics import trade_metrics
from app.market.catalog import get_asset
from app.market.timeframes import align, tf_seconds
from app.models import PaperAccount, PaperPosition, ReplaySession, User
from app.paper_engine.models import Bar
from app.services import market_service, paper_service, settings_service

HISTORY_BARS = 150


class ReplayError(ValueError):
    pass


def create_session(
    db: Session, user: User, symbol: str, timeframe: str, start_ts: int, bars: int = 200, balance: float = 10_000.0
) -> ReplaySession:
    get_asset(symbol)
    now = int(time.time())
    sec = tf_seconds(timeframe)
    start = align(start_ts, timeframe)
    end = min(start + bars * sec, align(now, timeframe) - sec)
    if start >= end:
        raise ReplayError("Избери начална дата поне няколко свещи преди днес.")
    acc = paper_service.create_account(
        db,
        user,
        kind="replay",
        name=f"Replay {symbol} {timeframe}",
        balance=balance,
        leverage=min(2.0, get_asset(symbol).max_leverage),
    )
    acc.execution = {**acc.execution, "latency_enabled": False, "partial_fills_enabled": False}
    s = ReplaySession(
        user_id=user.id,
        account_id=acc.id,
        symbol=symbol,
        timeframe=timeframe,
        start_ts=start,
        cursor_ts=start,
        end_ts=end,
        status="active",
    )
    db.add(s)
    db.commit()
    return s


def visible_candles(s: ReplaySession) -> list[dict]:
    sec = tf_seconds(s.timeframe)
    rows = market_service.candles(
        s.symbol, s.timeframe, start=s.cursor_ts - HISTORY_BARS * sec, end=s.cursor_ts, limit=0, include_partial=False
    )
    return [c.to_dict() for c in rows if c.ts <= s.cursor_ts]


def _broker(db: Session, s: ReplaySession):
    acc = db.get(PaperAccount, s.account_id)
    broker = paper_service.load_broker(db, acc)
    last = market_service.candles(
        s.symbol, s.timeframe, start=s.cursor_ts, end=s.cursor_ts, limit=1, include_partial=False
    )
    if last:
        c = last[-1]
        broker.set_mark(s.symbol, c.close)
        broker.last_bar[s.symbol] = Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, tf_seconds(s.timeframe))
    return acc, broker


def state(db: Session, s: ReplaySession) -> dict:
    acc, broker = _broker(db, s)
    view = paper_service.account_view(db, acc, broker, s.cursor_ts)
    return {
        "session": {
            "id": s.id,
            "symbol": s.symbol,
            "timeframe": s.timeframe,
            "start_ts": s.start_ts,
            "cursor_ts": s.cursor_ts,
            "end_ts": s.end_ts,
            "status": s.status,
            "remaining": max(0, (s.end_ts - s.cursor_ts) // tf_seconds(s.timeframe)),
        },
        "candles": visible_candles(s),
        "account": view,
        "events": paper_service.events(db, acc, 20),
    }


def step(db: Session, s: ReplaySession, n: int = 1) -> dict:
    if s.status != "active":
        raise ReplayError("Replay сесията е приключила.")
    sec = tf_seconds(s.timeframe)
    target = min(s.cursor_ts + max(1, min(n, 100)) * sec, s.end_ts)
    rows = market_service.candles(
        s.symbol, s.timeframe, start=s.cursor_ts + sec, end=target, limit=0, include_partial=False
    )
    acc, broker = _broker(db, s)
    for c in rows:
        broker.process_bar(s.symbol, Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, sec))
        s.cursor_ts = c.ts
    paper_service.save_broker(db, acc, broker, s.user_id)
    if s.cursor_ts >= s.end_ts:
        s.status = "finished"
    db.commit()
    return state(db, s)


def order(db: Session, user: User, s: ReplaySession, req: dict) -> dict:
    if s.status != "active":
        raise ReplayError("Replay сесията е приключила.")
    acc, broker = _broker(db, s)
    sec = tf_seconds(s.timeframe)
    spec = get_asset(s.symbol)
    q = broker.quote(s.symbol)
    entry = (
        req.get("price")
        if req.get("type") in ("limit", "stop") and req.get("price")
        else (q.ask if req["side"] == "buy" else q.bid)
    )
    rules = settings_service.risk_rules(user)
    from app.risk.engine import evaluate_trade, trade_plan

    snap = broker.snapshot()
    plan = trade_plan(
        side=req["side"],
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
        day_pnl=0.0,
    )
    o = broker.place_order(
        symbol=s.symbol,
        side=req["side"],
        type=req.get("type", "market"),
        qty=float(req["qty"]),
        ts=s.cursor_ts + sec,
        price=req.get("price"),
        stop_loss=req.get("stop_loss"),
        take_profit=req.get("take_profit"),
        fill_mode="next_bar",
        active_from_ts=s.cursor_ts + sec,
        meta={
            "source": "replay",
            "risk_pct": plan.get("risk_pct"),
            "setup": req.get("setup"),
            "timeframe": s.timeframe,
            "replay_session": s.id,
        },
    )
    paper_service.save_broker(db, acc, broker, user.id)
    return {"order": paper_service.order_to_dict(o), "findings": [f.to_dict() for f in findings], **state(db, s)}


def action(db: Session, user: User, s: ReplaySession, kind: str, payload: dict) -> dict:
    acc, broker = _broker(db, s)
    sec = tf_seconds(s.timeframe)
    if kind == "close":
        broker.close_position(
            payload["position_id"], ts=s.cursor_ts + sec, qty=payload.get("qty"), fill_mode="next_bar"
        )
    elif kind == "modify":
        err = broker.modify_position(
            payload["position_id"],
            ts=s.cursor_ts,
            **{k: payload[k] for k in ("stop_loss", "take_profit") if k in payload},
        )
        if err:
            raise ReplayError(err)
    elif kind == "cancel":
        broker.cancel_order(payload["order_id"], s.cursor_ts)
    paper_service.save_broker(db, acc, broker, user.id)
    return state(db, s)


def finish(db: Session, user: User, s: ReplaySession) -> dict:
    acc, broker = _broker(db, s)
    for p in broker.open_positions():
        broker.close_position(p.id, ts=s.cursor_ts, reason="manual")
    paper_service.save_broker(db, acc, broker, user.id)
    s.status = "finished"
    db.commit()
    trades = paper_service.closed_trades(db, [acc.id])
    rules = settings_service.risk_rules(user)
    reviews = []
    for pid in dict.fromkeys(t["position_id"] for t in trades):
        row = db.get(PaperPosition, pid)
        pts = [t for t in trades if t["position_id"] == pid]
        pos = {
            "id": row.id,
            "symbol": row.symbol,
            "side": row.side,
            "entry_price": row.entry_price,
            "initial_stop": row.initial_stop,
            "take_profit": row.take_profit,
            "initial_qty": row.initial_qty,
            "opened_ts": row.opened_ts,
            "closed_ts": row.closed_ts,
            "sl_history": row.sl_history,
            "mfe": row.mfe,
            "mae": row.mae,
            "meta": row.meta,
        }
        reviews.append(review_position(pos, pts, rules=rules, precision=get_asset(s.symbol).price_precision))
    metrics = trade_metrics(trades, None, acc.initial_balance)
    hidden_after = market_service.candles(
        s.symbol,
        s.timeframe,
        start=s.cursor_ts + tf_seconds(s.timeframe),
        end=s.cursor_ts + 30 * tf_seconds(s.timeframe),
        limit=0,
        include_partial=False,
    )
    summary = []
    if not trades:
        summary.append("Не направи нито една сделка. Ако нямаше ясен setup — това е валидно решение (NO TRADE).")
    else:
        summary.append(
            f"{metrics['total_trades']} сделки, нетен резултат {metrics['net_pnl']:+,.2f}, "
            f"win rate {metrics['win_rate']:.0f}%."
        )
        poor = [p for r in reviews for p in r["did_poorly"]]
        if poor:
            summary.append(f"Най-важната забележка: {poor[0]}")
    return {
        **state(db, s),
        "metrics": metrics,
        "reviews": reviews,
        "summary": summary,
        "what_happened_next": [c.to_dict() for c in hidden_after],
    }
