"""MARKET REPLAY — historical candles revealed one by one. The user never sees the future:
the API only returns candles up to the cursor, and orders are filled by the same
PaperBroker on the next revealed candle.

V2 (work package S5) adds, on top of the unchanged 'trade' flow:
* modes — 'trade' (paper orders, the original behaviour) and 'predict' (LONG / SHORT / WAIT predictions only:
  no account orders are ever placed);
* period presets (app.replay.presets) — a deterministic PAST window matching a regime, never the last bars;
* decisions — LONG / SHORT / WAIT at the cursor (one per bar, a new one replaces the old), resolved on the candles
  revealed later (app.replay.outcomes) and scored 0–100 with explainable flags (app.replay.scoring);
* the AI HISTORY REVIEW at finish (app.replay.review) incl. "what a rule-based strategy would have done"
  (app.replay.comparison) — stored in replay_sessions.review, the score in replay_sessions.score (0–100).
Everything is PAPER / educational.
"""

from __future__ import annotations

import time
from collections import Counter
from statistics import mean

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.review import review_position
from app.backtesting.metrics import trade_metrics
from app.market.base import Candle
from app.market.catalog import get_asset
from app.market.timeframes import align, tf_seconds
from app.models import PaperAccount, PaperPosition, ReplayDecision, ReplaySession, Strategy, User
from app.paper_engine.models import Bar
from app.replay import comparison, outcomes, presets, review, scoring
from app.replay import indicators as replay_indicators
from app.services import market_service, paper_service, settings_service

HISTORY_BARS = 150  # context shown before the first replay candle
CONTEXT_BARS = 300  # history (all ≤ the decision bar) for the decision context: ATR, EMA 20, swings, regime
NEXT_BARS = 30  # "what happened next" revealed at finish
REVIEW_WARMUP_BARS = 300  # history before the window for the review's regimes and the strategy warm-up
SNAP_BARS = 120  # look-back used to anchor a chosen start date on a real candle (nights, weekends, holidays)
STEP_SCAN_ROUNDS = 10  # growing look-ahead fetches one step may make to jump over a market-closed gap
STEP_SCAN_MAX = 1000  # candles per look-ahead fetch
MAX_STEP = 100
MODES = ("trade", "predict")
ACTIONS = ("long", "short", "wait")
DECISION_SETUP = "replay-decision"


class ReplayError(ValueError):
    pass


# ------------------------------------------------------------------------------------------------ candles
def _closed(symbol: str, timeframe: str, start: int, end: int, *, now: int | None = None) -> list[Candle]:
    """Closed candles with start ≤ ts ≤ end (an explicit limit — some providers need one for a range)."""
    if end < start:
        return []
    sec = tf_seconds(timeframe)
    count = (align(end, timeframe) - align(start, timeframe)) // sec + 2
    rows = market_service.candles(
        symbol, timeframe, start=start, end=end, limit=max(count, 2), now=now, include_partial=False
    )
    return [c for c in rows if start <= c.ts <= end]


def _window_candles(s: ReplaySession, extra_history: int = 0) -> list[Candle]:
    """HISTORY_BARS (+ extra_history) before the first replay candle … the cursor. Never anything after it."""
    sec = tf_seconds(s.timeframe)
    return _closed(s.symbol, s.timeframe, s.start_ts - (HISTORY_BARS + extra_history) * sec, s.cursor_ts)


def visible_candles(s: ReplaySession) -> list[dict]:
    return [c.to_dict() for c in _window_candles(s)]


def _scan_candles(symbol: str, timeframe: str, after_ts: int, n: int, until_ts: int) -> tuple[list[Candle], int, bool]:
    """The first `n` closed candles with after_ts < ts ≤ until_ts, the last time scanned, and whether nothing is left
    after them up to until_ts.

    Market-closed gaps (nights, weekends, holidays) are skipped with growing look-ahead fetches, so a step always
    reveals real candles while the range still has one. For 24/7 markets the first fetch is enough.
    """
    sec = tf_seconds(timeframe)
    out: list[Candle] = []
    lo = after_ts + sec
    span = max(1, n)
    scanned = after_ts
    for _ in range(STEP_SCAN_ROUNDS):
        if lo > until_ts or len(out) >= n:
            break
        hi = min(lo + (span - 1) * sec, until_ts)
        out.extend(_closed(symbol, timeframe, lo, hi))
        scanned = hi
        lo = hi + sec
        span = min(span * 4, STEP_SCAN_MAX)
    return out[:n], scanned, scanned >= until_ts and len(out) <= n


def _next_candles(s: ReplaySession, n: int) -> tuple[list[Candle], int, bool]:
    """The next `n` candles of the window after the cursor (never after end_ts)."""
    return _scan_candles(s.symbol, s.timeframe, s.cursor_ts, n, s.end_ts)


def _after_cursor(s: ReplaySession, n: int = NEXT_BARS) -> list[Candle]:
    """The `n` closed candles after the cursor ("what happened next") — revealed only once the session is finished."""
    return _scan_candles(s.symbol, s.timeframe, s.cursor_ts, n, int(time.time()))[0]


# ------------------------------------------------------------------------------------------------ create
def create_session(
    db: Session,
    user: User,
    symbol: str,
    timeframe: str,
    start_ts: int | None = None,
    bars: int = 200,
    balance: float = 10_000.0,
    *,
    mode: str = "trade",
    preset: str | None = None,
    strategy_id: int | None = None,
    seed: int | None = None,
    now: int | None = None,
) -> ReplaySession:
    spec = get_asset(symbol)
    if mode not in MODES:
        raise ReplayError("mode трябва да е 'trade' или 'predict'.")
    now = int(now if now is not None else time.time())
    sec = tf_seconds(timeframe)
    if strategy_id is not None:
        comparison.check_access(db, user, strategy_id)  # StrategyNotFound → 404
    _, strat_info, strat_row = comparison.resolve_strategy(db, user, strategy_id)
    if preset:
        rows = market_service.candles(symbol, timeframe, limit=presets.fetch_span(bars), now=now, include_partial=False)
        if seed is None:
            seed = db.scalar(select(func.count()).select_from(ReplaySession).where(ReplaySession.user_id == user.id))
        try:
            w = presets.choose_window(rows, preset, bars, seed_key=f"{user.id}:{symbol}:{timeframe}:{seed}")
        except presets.PresetError as exc:
            raise ReplayError(str(exc)) from exc
        start = w["start_ts"]
        end = rows[w["end_index"]].ts
        setup = {
            "preset": preset,
            "seed": int(seed or 0),
            "matched": w["matched"],
            "score": w["score"],
            "info": w["info"],
            "regime_mix": w["regime_mix"],
            "focus_bars": w["focus_bars"],
            "candidates": w["candidates"],
            "matching": w["matching"],
            "future_bars_hidden": len(rows) - 1 - w["end_index"],
            "window_candles": w["end_index"] - w["index"],
        }
    else:
        if start_ts is None:
            raise ReplayError("Избери начална дата (start_ts) или preset за периода.")
        start = align(start_ts, timeframe)
        end = min(start + bars * sec, align(now, timeframe) - sec)
        if start >= end:
            raise ReplayError("Избери начална дата поне няколко свещи преди днес.")
        # anchor on real candles: a date inside a market-closed gap starts at the last candle before it, and the
        # window ends on its last real candle (24/7 markets: unchanged)
        rows = _closed(symbol, timeframe, start - SNAP_BARS * sec, end, now=now)
        before = [c for c in rows if c.ts <= start]
        anchor = before[-1] if before else (rows[0] if rows else None)
        window = [c for c in rows if anchor is not None and anchor.ts < c.ts <= end]
        if anchor is None or not window:
            raise ReplayError("Няма исторически свещи за избрания период — избери друга начална дата.")
        start, end = anchor.ts, window[-1].ts
        setup = {"preset": None, "seed": None, "window_candles": len(window)}
    setup["strategy_source"] = strat_info.get("source")
    setup["strategy"] = {
        "id": strat_info.get("id"),
        "name": strat_info.get("name"),
        "is_template": strat_info.get("is_template"),
        "source": strat_info.get("source"),
        "template_key": strat_info.get("template_key"),
        "timeframe": strat_info.get("timeframe"),
    }
    acc = paper_service.create_account(
        db,
        user,
        kind="replay",
        name=f"Replay {symbol} {timeframe}" + (" (predict)" if mode == "predict" else ""),
        balance=balance,
        leverage=min(2.0, spec.max_leverage),
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
        mode=mode,
        strategy_id=strat_row.id if strat_row is not None else None,
        review={"setup": setup},
    )
    db.add(s)
    db.commit()
    return s


# ------------------------------------------------------------------------------------------------ broker
def _broker(db: Session, s: ReplaySession):
    acc = db.get(PaperAccount, s.account_id)
    broker = paper_service.load_broker(db, acc)
    sec = tf_seconds(s.timeframe)
    last = _closed(s.symbol, s.timeframe, s.cursor_ts - 5 * sec, s.cursor_ts)
    if not last:  # the cursor sits in a market-closed gap → the last candle before it
        last = _closed(s.symbol, s.timeframe, s.cursor_ts - 200 * sec, s.cursor_ts)
    if last:
        c = last[-1]
        broker.set_mark(s.symbol, c.close)
        broker.last_bar[s.symbol] = Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, tf_seconds(s.timeframe))
    return acc, broker


# ------------------------------------------------------------------------------------------------ decisions
def _setup(s: ReplaySession) -> dict:
    return dict((s.review or {}).get("setup") or {})


def _decision_rows(db: Session, s: ReplaySession) -> list[ReplayDecision]:
    return list(
        db.scalars(
            select(ReplayDecision)
            .where(ReplayDecision.session_id == s.id)
            .order_by(ReplayDecision.bar_ts, ReplayDecision.id)
        )
    )


def _split(d: ReplayDecision) -> tuple[dict, dict]:
    """(public outcome, meta) of a stored decision."""
    out = dict(d.outcome or {})
    meta = out.pop("meta", None) or {}
    return out, meta


def serialize_decision(d: ReplayDecision) -> dict:
    out, meta = _split(d)
    assessment = meta.get("assessment") or {}
    final = bool(meta.get("final"))
    return {
        "id": d.id,
        "bar_ts": d.bar_ts,
        "action": d.action,
        "entry_price": d.entry_price,
        "stop": d.stop,
        "target": d.target,
        "note": d.note,
        "planned_rr": assessment.get("planned_rr"),
        "risk": assessment.get("risk"),
        "risk_atr": assessment.get("risk_atr"),
        "outcome": out,
        "score": d.score,
        "score_final": final,
        "entry_score": meta.get("entry_score"),
        "grade": scoring.grade(d.score) if final else None,
        "components": meta.get("components") or {},
        "flags": meta.get("flags") or [],
        "correct": scoring.is_correct(d.action, out) if final else None,
        "context": meta.get("context") or {},
        "order_id": meta.get("order_id"),
        "created_ts": d.created_ts,
    }


def _evaluate(
    action: str, entry: float, stop, target, meta: dict, bars_after: list[Candle], precision: int, *, final: bool
):
    """(outcome, score, meta) for a decision given the candles revealed after its bar."""
    meta = dict(meta)
    if action == "wait":
        res = outcomes.resolve_wait(entry, (meta.get("context") or {}).get("atr"), bars_after, precision=precision)
        sw = scoring.score_wait(res)
        meta["components"] = sw["components"]
        meta["flags"] = scoring.wait_flags(res)
        meta["final"] = sw["final"]
        meta["entry_score"] = None
        return res, sw["score"], meta
    res = outcomes.resolve_prediction(action, entry, stop, target, bars_after)
    sp = scoring.score_prediction(meta["assessment"], res, final=final)
    meta["components"] = sp["components"]
    meta["flags"] = list(meta["assessment"]["flags"])
    meta["final"] = sp["final"]
    return res, sp["score"], meta


def _refresh_decisions(db: Session, s: ReplaySession, *, until: int | None = None, final: bool = False) -> list[dict]:
    """Resolve every not-yet-final decision on the candles revealed up to `until` (default: the cursor) and update
    the session score. Returns the decisions that became final now."""
    rows = _decision_rows(db, s)
    pending = [d for d in rows if not _split(d)[1].get("final")]
    newly: list[dict] = []
    if pending:
        sec = tf_seconds(s.timeframe)
        until = s.cursor_ts if until is None else until
        first = min(d.bar_ts for d in pending)
        bars = _closed(s.symbol, s.timeframe, first + sec, until)
        precision = get_asset(s.symbol).price_precision
        for d in pending:
            after = [c for c in bars if c.ts > d.bar_ts]
            _, meta = _split(d)
            res, score, meta = _evaluate(d.action, d.entry_price, d.stop, d.target, meta, after, precision, final=final)
            d.outcome = {**res, "meta": meta}
            d.score = score
            if meta.get("final"):
                newly.append(
                    {
                        "id": d.id,
                        "bar_ts": d.bar_ts,
                        "action": d.action,
                        "status": res.get("status"),
                        "r_result": res.get("r_result"),
                        "right_to_wait": res.get("right_to_wait"),
                        "score": score,
                        "correct": scoring.is_correct(d.action, res),
                    }
                )
    s.score = _decision_score(rows, final=final)
    return newly


def _decision_score(rows: list[ReplayDecision], *, final: bool) -> float | None:
    items = []
    for d in rows:
        out, meta = _split(d)
        items.append({"action": d.action, "outcome": out, "score": d.score, "final": meta.get("final")})
    return scoring.session_score(items, final=final)


def _risk_qty(broker, spec, acc: PaperAccount, side: str, stop: float, risk_pct: float) -> float:
    """Quantity whose loss at `stop` (entry + exit fees included) is `risk_pct`% of the equity, in the account
    currency (USD) — instruments quoted in another currency (USD/JPY, EUR/GBP, …) are converted at the cursor."""
    q = broker.quote(spec.symbol)
    price = q.ask if side == "buy" else q.bid
    if abs(price - stop) <= 0:
        raise ReplayError("Stop-ът е на цената на входа — няма как да се изчисли размер по риск.")
    snap = broker.snapshot()
    risk_amount = snap["equity"] * risk_pct / 100
    qty_for_risk = getattr(broker, "qty_for_risk", None)
    if callable(qty_for_risk):  # the paper engine's own sizing (FX-aware, fees as configured)
        qty = qty_for_risk(spec.symbol, side=side, entry=price, stop=stop, risk_amount=risk_amount, cap_by_margin=False)
    else:
        fx_rate = getattr(broker, "fx_rate", None)
        rate = float(fx_rate(spec.symbol, price=price, strict=True)) if callable(fx_rate) else 1.0
        qty = risk_amount / ((abs(price - stop) + price * 2 * spec.taker_fee) * rate)
    cap = None
    max_qty = getattr(broker, "max_qty", None)
    if callable(max_qty):
        try:
            cap = max_qty(spec.symbol, entry=price)
        except Exception:  # noqa: BLE001 - fall back to the simple margin cap below
            cap = None
    if cap is None:
        cap = max(snap["free_margin"], 0.0) * acc.leverage / price
    qty = spec.round_qty(min(qty, cap * 0.95))  # headroom: the fill is at the next candle's open
    if qty < spec.min_qty:
        raise ReplayError(
            f"Размерът по риск ({risk_pct:g}% до stop-а) е под минималното количество {spec.min_qty:g} — "
            "разшири риска, премести stop-а или въведи qty."
        )
    return qty


def decide(db: Session, user: User, s: ReplaySession, req: dict, *, indicators: str | None = None) -> dict:
    """LONG / SHORT / WAIT at the current cursor bar (one per bar — a new decision replaces the old one)."""
    if s.status != "active":
        raise ReplayError("Replay сесията е приключила.")
    action = req.get("action")
    if action not in ACTIONS:
        raise ReplayError("action трябва да е long, short или wait.")
    spec = get_asset(s.symbol)
    p = spec.price_precision
    sec = tf_seconds(s.timeframe)
    ctx_rows = _closed(s.symbol, s.timeframe, s.cursor_ts - CONTEXT_BARS * sec, s.cursor_ts)
    if not ctx_rows:
        raise ReplayError("Няма разкрита свещ на текущата позиция — придвижи replay-а с една свещ.")
    bar = ctx_rows[-1]
    entry = bar.close
    stop = req.get("stop") if action != "wait" else None
    target = req.get("target") if action != "wait" else None
    scoring.validate_levels(action, entry, stop, target, p)
    place = bool(req.get("place_order")) and action != "wait"
    if place and s.mode != "trade":
        raise ReplayError("Predict режим: решенията са само прогнози — не се пускат paper поръчки.")
    ctx = scoring.decision_context(ctx_rows)
    meta: dict = {"context": ctx, "order_id": None}
    if action != "wait":
        assessment = scoring.assess_entry(action, entry, stop, target, ctx, p)
        meta["assessment"] = assessment
        meta["entry_score"] = scoring.score_prediction(assessment, {"status": "open"})["score"]
    res, score, meta = _evaluate(action, entry, stop, target, meta, [], p, final=False)
    note = (req.get("note") or "").strip()[:300] or None

    if req.get("preview"):
        tmp = ReplayDecision(
            session_id=s.id,
            user_id=user.id,
            bar_ts=bar.ts,
            action=action,
            entry_price=entry,
            stop=stop,
            target=target,
            note=note,
            outcome={**res, "meta": meta},
            score=score,
            created_ts=int(time.time()),
        )
        return {"preview": True, "decision": serialize_decision(tmp)}

    existing = db.scalar(
        select(ReplayDecision).where(ReplayDecision.session_id == s.id, ReplayDecision.bar_ts == bar.ts)
    )
    replaced = existing is not None
    order_out = None
    findings: list[dict] = []
    if place:  # the new paper order first: a sizing error or a rejection leaves the previous decision untouched
        acc, broker = _broker(db, s)
        side = "buy" if action == "long" else "sell"
        qty = req.get("qty")
        if qty is None:
            risk_pct = req.get("risk_pct") or settings_service.risk_rules(user).max_risk_per_trade_pct
            qty = _risk_qty(broker, spec, acc, side, stop, float(risk_pct))
        placed = order(
            db,
            user,
            s,
            {
                "side": side,
                "type": "market",
                "qty": float(qty),
                "stop_loss": stop,
                "take_profit": target,
                "setup": DECISION_SETUP,
            },
            with_state=False,
        )
        order_out, findings = placed["order"], placed["findings"]
        if order_out.get("status") == "rejected":
            raise ReplayError(f"Paper поръчката е отхвърлена: {order_out.get('reject_reason') or 'невалидна поръчка'}")
        meta["order_id"] = order_out["id"]
    if existing is not None:  # the replaced decision's order is still pending (same bar) → cancel it
        old_order = _split(existing)[1].get("order_id")
        if old_order and old_order != meta["order_id"]:
            acc, broker = _broker(db, s)
            if any(o.id == old_order for o in broker.active_orders(s.symbol)):
                broker.cancel_order(old_order, s.cursor_ts)
                paper_service.save_broker(db, acc, broker, user.id)
    d = existing or ReplayDecision(session_id=s.id, user_id=user.id, bar_ts=bar.ts)
    d.action = action
    d.entry_price = entry
    d.stop = stop
    d.target = target
    d.note = note
    d.outcome = {**res, "meta": meta}
    d.score = score
    d.created_ts = int(time.time())
    if existing is None:
        db.add(d)
    db.flush()
    s.score = _decision_score(_decision_rows(db, s), final=False)
    db.commit()
    return {
        "decision": serialize_decision(d),
        "order": order_out,
        "findings": findings,
        "replaced": replaced,
        **state(db, s, indicators=indicators),
    }


# ------------------------------------------------------------------------------------------------ state
def _strategy_info(db: Session, s: ReplaySession) -> dict | None:
    """The strategy used for the final comparison (chosen at creation)."""
    stored = _setup(s).get("strategy")
    if s.strategy_id is not None:
        row = db.get(Strategy, s.strategy_id)
        if row is not None and (row.user_id is None or row.user_id == s.user_id):
            return {
                "id": row.id,
                "name": row.name,
                "is_template": bool(row.is_template),
                "source": (stored or {}).get("source") or "selected",
                "template_key": (stored or {}).get("template_key"),
                "timeframe": row.timeframe,
            }
    return dict(stored) if stored else None


def _preset_info(s: ReplaySession) -> dict | None:
    key = _setup(s).get("preset")
    if not key:
        return None
    meta = presets.PRESETS.get(key, {})
    # only the name — the matched regime/direction is revealed in the history review, never during the session
    return {
        "key": key,
        "label": meta.get("label"),
        "label_bg": meta.get("label_bg"),
        "description": meta.get("description"),
    }


def decisions_summary(items: list[dict]) -> dict:
    counts = Counter(d["action"] for d in items)
    flags: Counter = Counter(f["key"] for d in items for f in d["flags"])
    final = [d for d in items if d["score_final"]]
    rs = [
        d["outcome"].get("r_result")
        for d in final
        if d["action"] != "wait" and d["outcome"].get("r_result") is not None
    ]
    rrs = [d["planned_rr"] for d in items if d.get("planned_rr") is not None]
    return {
        "total": len(items),
        "long": counts.get("long", 0),
        "short": counts.get("short", 0),
        "wait": counts.get("wait", 0),
        "resolved": len(final),
        "open": len(items) - len(final),
        "correct": sum(1 for d in items if d["correct"] is True),
        "wrong": sum(1 for d in items if d["correct"] is False),
        "total_r": round(sum(rs), 3) if rs else None,
        "avg_planned_rr": round(mean(rrs), 2) if rrs else None,
        "avg_score": round(mean(d["score"] for d in final), 1) if final else None,
        "flags": dict(flags),
        "last_bar_ts": items[-1]["bar_ts"] if items else None,
    }


def _session_info(db: Session, s: ReplaySession, precision: int, candles: list[Candle] | None = None) -> dict:
    """`candles` = the visible candles (ending at the cursor): with the window size stored at creation they give
    exact candle counts even for markets with closed hours; otherwise the counts are derived from time."""
    sec = tf_seconds(s.timeframe)
    total = _setup(s).get("window_candles")
    if candles is not None and isinstance(total, int) and total > 0:
        revealed = min(total, sum(1 for c in candles if s.start_ts < c.ts <= s.cursor_ts))
        remaining = 0 if s.cursor_ts >= s.end_ts else max(0, total - revealed)
        bars = total
    else:
        revealed = max(0, (s.cursor_ts - s.start_ts) // sec)
        remaining = max(0, (s.end_ts - s.cursor_ts) // sec)
        bars = max(0, (s.end_ts - s.start_ts) // sec)
    return {
        "id": s.id,
        "symbol": s.symbol,
        "timeframe": s.timeframe,
        "start_ts": s.start_ts,
        "cursor_ts": s.cursor_ts,
        "end_ts": s.end_ts,
        "status": s.status,
        "remaining": remaining,
        "mode": s.mode or "trade",
        "precision": precision,
        "bars": bars,
        "revealed": revealed,
        "score": s.score,
        "grade": scoring.grade(s.score),
        "preset": _preset_info(s),
        "strategy": _strategy_info(db, s),
        "created_ts": s.created_ts,
        "has_review": bool((s.review or {}).get("history_review")),
    }


def state(db: Session, s: ReplaySession, *, indicators: str | None = None) -> dict:
    parsed = replay_indicators.parse(indicators) if indicators else []
    acc, broker = _broker(db, s)
    view = paper_service.account_view(db, acc, broker, s.cursor_ts)
    spec = get_asset(s.symbol)
    rows = _window_candles(s, replay_indicators.WARMUP_BARS if parsed else 0)
    visible_from = s.start_ts - HISTORY_BARS * tf_seconds(s.timeframe)
    visible = [c for c in rows if c.ts >= visible_from]
    items = [serialize_decision(d) for d in _decision_rows(db, s)]
    last_ts = visible[-1].ts if visible else None
    out = {
        "session": _session_info(db, s, spec.price_precision, visible),
        "candles": [c.to_dict() for c in visible],
        "account": view,
        "events": paper_service.events(db, acc, 20),
        "mode": s.mode or "trade",
        "precision": spec.price_precision,
        "source": market_service.source_of(s.symbol),
        "score": {
            "value": s.score,
            "grade": scoring.grade(s.score),
            "scored": sum(1 for d in items if d["score_final"]),
            "pending": sum(1 for d in items if not d["score_final"]),
        },
        "decisions": items,
        "decisions_summary": decisions_summary(items),
        "current_decision": next((d for d in items if d["bar_ts"] == last_ts), None),
        "can_trade": (s.mode or "trade") == "trade" and s.status == "active",
    }
    if parsed:
        out["indicators"] = replay_indicators.compute(parsed, rows, visible_from)
    return out


# ------------------------------------------------------------------------------------------------ step / orders
def step(db: Session, s: ReplaySession, n: int = 1, *, indicators: str | None = None) -> dict:
    """Reveal the next `n` candles (1–100). Market-closed gaps are skipped: every step reveals real candles."""
    if s.status != "active":
        raise ReplayError("Replay сесията е приключила.")
    sec = tf_seconds(s.timeframe)
    rows, scanned, exhausted = _next_candles(s, max(1, min(n, MAX_STEP)))
    acc, broker = _broker(db, s)
    for c in rows:
        broker.process_bar(s.symbol, Bar(c.ts, c.open, c.high, c.low, c.close, c.volume, sec))
        s.cursor_ts = c.ts
    if exhausted and s.cursor_ts < s.end_ts:
        # no candle is left in the window (it ends inside a market-closed gap): the period is over and the
        # cursor stays on the last real candle
        s.end_ts = s.cursor_ts
    elif not rows:
        s.cursor_ts = scanned  # a very long gap without candles — time still moves on, the next step continues
    paper_service.save_broker(db, acc, broker, s.user_id)
    if s.cursor_ts >= s.end_ts:
        s.status = "finished"
    resolved = _refresh_decisions(db, s)
    db.commit()
    return {**state(db, s, indicators=indicators), "resolved": resolved}


def order(db: Session, user: User, s: ReplaySession, req: dict, *, with_state: bool = True) -> dict:
    if s.status != "active":
        raise ReplayError("Replay сесията е приключила.")
    if (s.mode or "trade") != "trade":
        raise ReplayError("Predict режим: без paper поръчки — използвай LONG / SHORT / WAIT прогнози.")
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
    from app.market.base import MarketDataError
    from app.risk.engine import evaluate_trade

    snap = broker.snapshot()
    try:  # money in the account currency (USD) — risk.engine.trade_plan alone is in the QUOTE currency (W4a fix:
        # a USD/JPY replay order was reported as "15090% exposure, 150x leverage" and stored risk_pct ×150)
        plan = paper_service.account_plan(
            broker,
            symbol=s.symbol,
            side=req["side"],
            entry=entry,
            stop=req.get("stop_loss"),
            take_profit=req.get("take_profit"),
            qty=float(req["qty"]),
            equity=snap["equity"],
            fee_rate=spec.taker_fee,
            ts=s.cursor_ts,
        )
    except MarketDataError as exc:  # ConversionUnavailableError: no quote → USD rate at the cursor
        raise ReplayError(f"Няма курс за превалутиране на {s.symbol} в USD: {getattr(exc, 'reason', None) or exc}") from exc
    findings = evaluate_trade(
        rules=rules,
        equity=snap["equity"],
        plan=plan,
        has_stop=req.get("stop_loss") is not None,
        open_positions=snap["open_positions"],
        exposure=snap["exposure"],
        new_notional=plan["notional"],
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
    out = {"order": paper_service.order_to_dict(o), "findings": [f.to_dict() for f in findings]}
    return {**out, **state(db, s)} if with_state else out


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


# ------------------------------------------------------------------------------------------------ finish
def _trade_reviews(db: Session, user: User, s: ReplaySession, acc: PaperAccount) -> tuple[list[dict], list[dict]]:
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
    return trades, reviews


def _paper_trade(t: dict) -> dict:
    """A closed paper trade of the replay account (trade mode) — for the markers on the review chart."""
    return {
        k: t.get(k)
        for k in (
            "id",
            "position_id",
            "side",
            "qty",
            "entry_price",
            "exit_price",
            "stop_price",
            "target_price",
            "net_pnl",
            "fees",
            "r_multiple",
            "exit_reason",
            "opened_ts",
            "closed_ts",
        )
    }


def finish(db: Session, user: User, s: ReplaySession) -> dict:
    """Close the period: open positions are closed at the cursor, pending orders cancelled, every decision gets its
    final resolution (on the window AND the next NEXT_BARS candles, now revealed) and the AI HISTORY REVIEW is built
    and stored. Finishing again returns the stored review — nothing can change after the first finish."""
    acc, broker = _broker(db, s)
    for p in broker.open_positions():
        broker.close_position(p.id, ts=s.cursor_ts, reason="manual")
    for o in broker.active_orders():  # an entry order can never fill once the period is over
        broker.cancel_order(o.id, s.cursor_ts)
    paper_service.save_broker(db, acc, broker, user.id)
    s.status = "finished"
    db.commit()
    spec = get_asset(s.symbol)
    sec = tf_seconds(s.timeframe)
    trades, reviews = _trade_reviews(db, user, s, acc)
    metrics = trade_metrics(trades, None, acc.initial_balance)
    hidden_after = _after_cursor(s)

    hr = (s.review or {}).get("history_review")
    if hr and hr.get("version") == review.REVIEW_VERSION and hr.get("end_ts") == s.cursor_ts:
        items = [serialize_decision(d) for d in _decision_rows(db, s)]
    else:
        # final resolution: the period is over, so the decisions are resolved on the window AND the next bars
        _refresh_decisions(db, s, until=hidden_after[-1].ts if hidden_after else s.cursor_ts, final=True)
        items = [serialize_decision(d) for d in _decision_rows(db, s)]
        score_basis = "decisions" if s.score is not None else None
        if s.score is None:
            process = [r["process_score"] for r in reviews if r.get("process_score") is not None]
            if process:
                s.score = round(mean(process), 1)
                score_basis = "trades"

        history = _closed(s.symbol, s.timeframe, s.start_ts - REVIEW_WARMUP_BARS * sec, s.cursor_ts)
        defn, info, _ = comparison.resolve_strategy(db, user, s.strategy_id)
        setup = _setup(s)
        if setup.get("strategy_source") and info.get("id") == s.strategy_id:
            info = {**info, "source": setup["strategy_source"]}
        resolved_r = [
            d["outcome"].get("r_result")
            for d in items
            if d["action"] != "wait" and d["score_final"] and d["outcome"].get("r_result") is not None
        ]
        cmp = comparison.compare(
            history,
            start_ts=s.start_ts,
            cursor_ts=s.cursor_ts,
            spec=spec,
            timeframe=s.timeframe,
            defn=defn,
            info=info,
            settings=comparison.settings_from_account(acc.initial_balance, acc.leverage, acc.execution),
            user_total_r=round(sum(resolved_r), 3) if resolved_r else None,
            user_resolved=len(resolved_r),
        )
        hr = review.build_history_review(
            symbol=s.symbol,
            timeframe=s.timeframe,
            precision=spec.price_precision,
            mode=s.mode or "trade",
            setup=setup,
            history=history,
            start_ts=s.start_ts,
            cursor_ts=s.cursor_ts,
            next_bars=hidden_after,
            decisions=items,
            score=s.score,
            score_basis=score_basis,
            comparison=cmp,
            trade_reviews=reviews,
            trade_metrics=metrics,
        )
        hr["end_ts"] = s.cursor_ts
        s.review = {"setup": setup, "history_review": hr}
        db.commit()

    summary = []
    if (s.mode or "trade") == "trade" or trades:
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
    ds = decisions_summary(items)
    if items:
        summary.append(
            f"{ds['total']} решения ({ds['long']} LONG, {ds['short']} SHORT, {ds['wait']} WAIT): "
            f"{ds['correct']} верни, {ds['wrong']} грешни."
        )
    elif s.mode == "predict":
        summary.append("Не взе нито една прогноза (LONG / SHORT / WAIT) в тази сесия.")
    if s.score is not None:
        summary.append(f"Replay score: {s.score:.0f}/100 ({scoring.grade(s.score)}).")
    return {
        **state(db, s),
        "metrics": metrics,
        "reviews": reviews,
        "summary": summary,
        "what_happened_next": [c.to_dict() for c in hidden_after],
        "paper_trades": [_paper_trade(t) for t in trades],
        "history_review": hr,
    }


def stored_review(db: Session, s: ReplaySession) -> dict | None:
    """The stored history review plus the fully revealed chart (window + the next bars)."""
    hr = (s.review or {}).get("history_review")
    if not hr:
        return None
    spec = get_asset(s.symbol)
    rows = _window_candles(s)
    acc = db.get(PaperAccount, s.account_id)
    trades = paper_service.closed_trades(db, [acc.id]) if acc is not None else []
    return {
        "session": _session_info(db, s, spec.price_precision, rows),
        "precision": spec.price_precision,
        "source": market_service.source_of(s.symbol),
        "candles": [c.to_dict() for c in rows],
        "what_happened_next": [c.to_dict() for c in _after_cursor(s)],
        "decisions": [serialize_decision(d) for d in _decision_rows(db, s)],
        "paper_trades": [_paper_trade(t) for t in trades],
        "history_review": hr,
    }


# ------------------------------------------------------------------------------------------------ options
MODE_INFO = {
    "trade": {
        "label": "Trade",
        "label_bg": "Търговия с paper поръчки",
        "description": "BUY / SELL paper поръчки по историческите свещи (виртуални пари). LONG / SHORT решенията "
        "могат да пуснат и paper поръчка.",
    },
    "predict": {
        "label": "Predict",
        "label_bg": "Само прогнози",
        "description": "LONG / SHORT / WAIT прогнози със stop и target — без поръчки по сметка. Всяка прогноза "
        "се оценява по разкритите свещи.",
    },
}


def options() -> dict:
    """Static setup metadata for the replay UI: modes, period presets, limits, the scoring rules and the flags."""
    flags = []
    for key, info in scoring.FLAGS.items():
        lesson = review.lesson_ref(info["lesson"], info["label"])
        flags.append(
            {
                "key": key,
                "label": info["label"],
                "severity": info["severity"],
                "lesson": info["lesson"],
                "lesson_title": lesson["title"] if lesson else None,
                "href": lesson["href"] if lesson else None,
            }
        )
    return {
        "modes": [{"key": k, **v} for k, v in MODE_INFO.items()],
        "presets": [{"key": k, **v} for k, v in presets.PRESETS.items()],
        "actions": list(ACTIONS),
        "defaults": {"mode": "trade", "bars": 200, "balance": 10_000.0, "preset": None},
        "limits": {
            "bars": {"min": 20, "max": 1000},
            "balance": {"min": 100.0, "max": 1_000_000.0},
            "step_max": MAX_STEP,
            "history_bars": HISTORY_BARS,
            "next_bars": NEXT_BARS,
            "preset_min_window_bars": presets.MIN_WINDOW_BARS,
            "preset_future_gap_bars": presets.FUTURE_GAP_BARS,
        },
        "rules": {
            "prediction_horizon_bars": outcomes.PREDICTION_HORIZON,
            "wait_horizon_bars": outcomes.WAIT_HORIZON,
            "wait_move_atr": outcomes.WAIT_MOVE_ATR,
            "wait_against_atr": outcomes.WAIT_AGAINST_ATR,
            "same_candle_policy": "stop_first",
            "rr_good": scoring.RR_GOOD,
            "rr_bad": scoring.RR_BAD,
            "noise_stop_atr": scoring.NOISE_STOP_ATR,
            "chase_ema_atr": scoring.CHASE_EMA_ATR,
            "structure_atr": scoring.STRUCTURE_ATR,
            "weights": dict(scoring.WEIGHTS),
        },
        "flags": flags,
        "strategy_sentence": comparison.SENTENCE,
        "disclaimer": review.DISCLAIMER,
    }


# ------------------------------------------------------------------------------------------------ list / stats
def list_sessions(db: Session, user: User, limit: int = 20) -> list[dict]:
    rows = list(
        db.scalars(
            select(ReplaySession).where(ReplaySession.user_id == user.id).order_by(ReplaySession.id.desc()).limit(limit)
        )
    )
    counts = (
        dict(
            db.execute(
                select(ReplayDecision.session_id, func.count())
                .where(ReplayDecision.session_id.in_([s.id for s in rows]))
                .group_by(ReplayDecision.session_id)
            ).all()
        )
        if rows
        else {}
    )
    return [
        {
            "id": s.id,
            "symbol": s.symbol,
            "timeframe": s.timeframe,
            "start_ts": s.start_ts,
            "cursor_ts": s.cursor_ts,
            "status": s.status,
            "end_ts": s.end_ts,
            "mode": s.mode or "trade",
            "score": s.score,
            "grade": scoring.grade(s.score),
            "preset": _setup(s).get("preset"),
            "decisions": counts.get(s.id, 0),
            "created_ts": s.created_ts,
            "has_review": bool((s.review or {}).get("history_review")),
        }
        for s in rows
    ]


def stats(db: Session, user: User, last: int = 10) -> dict:
    rows = list(
        db.scalars(select(ReplaySession).where(ReplaySession.user_id == user.id).order_by(ReplaySession.id.desc()))
    )
    finished = [s for s in rows if s.status == "finished"]
    scored = [s for s in finished if s.score is not None]
    scores = [s.score for s in scored]
    decisions = list(db.scalars(select(ReplayDecision).where(ReplayDecision.user_id == user.id)))
    flag_counts: Counter = Counter()
    correct = wrong = 0
    for d in decisions:
        out, meta = _split(d)
        for f in meta.get("flags") or []:
            flag_counts[f["key"]] += 1
        if meta.get("final"):
            c = scoring.is_correct(d.action, out)
            correct += c is True
            wrong += c is False
    common = []
    for key, n in flag_counts.most_common(5):
        info = scoring.FLAGS.get(key)
        if info is None:
            continue
        lesson = review.lesson_ref(info["lesson"], info["label"])
        common.append(
            {
                "key": key,
                "label": info["label"],
                "severity": info["severity"],
                "count": n,
                "lesson": info["lesson"],
                "lesson_title": lesson["title"] if lesson else None,
                "href": lesson["href"] if lesson else None,
            }
        )
    return {
        "sessions": len(rows),
        "finished": len(finished),
        "active": sum(1 for s in rows if s.status == "active"),
        "avg_score": round(mean(scores), 1) if scores else None,
        "best_score": max(scores) if scores else None,
        "last_scores": [
            {
                "id": s.id,
                "symbol": s.symbol,
                "timeframe": s.timeframe,
                "mode": s.mode or "trade",
                "preset": _setup(s).get("preset"),
                "score": s.score,
                "grade": scoring.grade(s.score),
                "created_ts": s.created_ts,
            }
            for s in scored[:last]
        ],
        "common_flags": common,
        "decisions": len(decisions),
        "correct": correct,
        "wrong": wrong,
        "accuracy_pct": round(correct / (correct + wrong) * 100, 1) if (correct + wrong) else None,
    }
