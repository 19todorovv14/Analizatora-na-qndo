"""Performance report, behaviour analysis, journal stats, weekly coach, dashboard,
challenge evaluation."""

from __future__ import annotations

import time
from collections import Counter
from datetime import UTC, datetime
from statistics import mean

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.academy.challenges import CHALLENGES, CHALLENGES_BY_KEY
from app.ai.coach import weekly_review
from app.ai.providers import get_llm
from app.backtesting.metrics import json_safe, trade_metrics
from app.journal.stats import journal_stats
from app.models import (
    Backtest,
    Bot,
    ChallengeProgress,
    JournalEntry,
    PaperAccount,
    PaperPosition,
    RiskEvent,
    User,
    WatchlistItem,
)
from app.psychology.behavior import analyze_behavior
from app.services import learning_service, market_service, paper_service, settings_service


def user_account_ids(db: Session, user: User, kinds: tuple[str, ...] = ("manual", "replay")) -> list[int]:
    return list(
        db.scalars(select(PaperAccount.id).where(PaperAccount.user_id == user.id, PaperAccount.kind.in_(kinds)))
    )


def journal_dicts(db: Session, user: User) -> list[dict]:
    rows = db.scalars(select(JournalEntry).where(JournalEntry.user_id == user.id).order_by(JournalEntry.created_ts))
    return [journal_to_dict(e, with_screenshot=False) for e in rows]


def journal_to_dict(e: JournalEntry, with_screenshot: bool = True) -> dict:
    return {
        "id": e.id,
        "trade_id": e.trade_id,
        "symbol": e.symbol,
        "timeframe": e.timeframe,
        "side": e.side,
        "setup": e.setup,
        "reason": e.reason,
        "entry": e.entry,
        "stop": e.stop,
        "target": e.target,
        "emotion": e.emotion,
        "confidence": e.confidence,
        "result": e.result,
        "r_multiple": e.r_multiple,
        "lesson": e.lesson,
        "tags": e.tags or [],
        "mistakes": e.mistakes or [],
        "screenshot": e.screenshot if with_screenshot else (bool(e.screenshot) or None),
        "created_ts": e.created_ts,
        "updated_ts": e.updated_ts,
    }


def behavior(db: Session, user: User) -> dict:
    trades = paper_service.closed_trades(db, user_account_ids(db, user))
    s = settings_service.user_settings(user)
    return analyze_behavior(trades, settings_service.risk_rules(user), int(s.get("max_trades_per_day", 8)))


def performance_report(db: Session, user: User) -> dict:
    ids = user_account_ids(db, user)
    trades = paper_service.closed_trades(db, ids)
    beh = behavior(db, user)
    js = journal_stats(journal_dicts(db, user), trades, beh)
    metrics = trade_metrics(trades, None, 10_000.0)
    halves = None
    if len(trades) >= 10:
        mid = len(trades) // 2
        a, b = trade_metrics(trades[:mid]), trade_metrics(trades[mid:])
        halves = {
            "first_half": {"expectancy_r": a["expectancy_r"], "win_rate": a["win_rate"], "trades": a["total_trades"]},
            "second_half": {"expectancy_r": b["expectancy_r"], "win_rate": b["win_rate"], "trades": b["total_trades"]},
        }
        ea, eb = a["expectancy_r"] or 0, b["expectancy_r"] or 0
        halves["verdict"] = (
            "Стабилно"
            if (ea > 0) == (eb > 0) and abs(ea - eb) < 0.3
            else "Нестабилно — резултатите между двете половини се различават значително"
        )
    enough = len(trades) >= 10
    return json_safe(
        {
            "enough_data": enough,
            "message": None if enough else f"Направи поне 10 paper сделки за пълен отчет (имаш {len(trades)}).",
            "metrics": metrics,
            "best_setup": js["most_profitable_setup"],
            "worst_setup": js["worst_setup"],
            "most_common_mistake": js["most_common_mistake"],
            "behavioral_mistakes": beh["findings"],
            "discipline_score": beh["discipline_score"],
            "strategy_stability": halves,
            "by_symbol": _group(trades, lambda t: t["symbol"]),
            "by_exit_reason": dict(Counter(t["exit_reason"] for t in trades)),
            "equity_curve": _equity(trades),
        }
    )


def _group(trades: list[dict], key) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for t in trades:
        groups.setdefault(key(t), []).append(t)
    return sorted(
        (
            {
                "key": k,
                "trades": len(v),
                "net_pnl": sum(x["net_pnl"] for x in v),
                "win_rate": sum(1 for x in v if x["net_pnl"] > 0) / len(v) * 100,
            }
            for k, v in groups.items()
        ),
        key=lambda r: -r["net_pnl"],
    )


def _equity(trades: list[dict]) -> list[list]:
    eq = 0.0
    out = []
    for t in trades:
        eq += t["net_pnl"]
        out.append([t["closed_ts"], round(eq, 2)])
    return out


def coach(db: Session, user: User, now: int | None = None) -> dict:
    now = int(now or time.time())
    week_ago = now - 7 * 86400
    ids = user_account_ids(db, user)
    all_trades = paper_service.closed_trades(db, ids)
    week = [t for t in all_trades if t["closed_ts"] >= week_ago]
    prog = learning_service.progress(db, user)
    progress_map = {
        m["key"]: {"completed": m["lessons_completed"], "total": m["lessons_total"], "quiz_score": m["quiz_score"]}
        for m in prog["modules"]
    }
    journal = journal_dicts(db, user)
    emotions = Counter(e["emotion"] for e in journal if e["emotion"])
    bts = [
        {"metrics": b.metrics}
        for b in db.scalars(select(Backtest).where(Backtest.user_id == user.id, Backtest.status == "done"))
    ]
    return json_safe(
        weekly_review(
            progress=progress_map,
            week_trades=week,
            all_trades=all_trades,
            behavior=behavior(db, user),
            journal_count=len(journal),
            journal_emotions=dict(emotions),
            backtests=bts,
            period={"from": week_ago, "to": now},
            llm=get_llm(),
        )
    )


def risk_status(db: Session, user: User, now: int | None = None) -> dict:
    now = int(now or time.time())
    acc = paper_service.get_manual_account(db, user)
    broker = paper_service.sync_account(db, acc, now)
    snap = broker.snapshot()
    rules = settings_service.risk_rules(user)
    dp = paper_service.day_pnl(db, acc, broker, now)
    day_loss_pct = -dp / snap["equity"] * 100 if dp < 0 and snap["equity"] > 0 else 0.0
    exposure_pct = snap["exposure"] / snap["equity"] * 100 if snap["equity"] > 0 else 0.0
    events = db.scalars(select(RiskEvent).where(RiskEvent.user_id == user.id).order_by(RiskEvent.id.desc()).limit(15))
    status = "OK"
    if day_loss_pct >= rules.max_daily_loss_pct or snap["open_positions"] > rules.max_open_positions:
        status = "LIMIT"
    elif day_loss_pct >= rules.max_daily_loss_pct * 0.7 or exposure_pct > rules.max_portfolio_exposure_pct:
        status = "WARNING"
    return {
        "status": status,
        "rules": rules.to_dict(),
        "equity": snap["equity"],
        "day_pnl": dp,
        "day_loss_pct": day_loss_pct,
        "daily_loss_limit_remaining": snap["equity"] * rules.max_daily_loss_pct / 100 + min(dp, 0),
        "open_positions": snap["open_positions"],
        "exposure": snap["exposure"],
        "exposure_pct": exposure_pct,
        "margin_level": snap["margin_level"],
        "max_drawdown_pct": acc.max_drawdown_pct,
        "recent_events": [{"ts": e.ts, "kind": e.kind, "severity": e.severity, "message": e.message} for e in events],
    }


def dashboard(db: Session, user: User, now: int | None = None) -> dict:
    now = int(now or time.time())
    acc = paper_service.get_manual_account(db, user)
    broker = paper_service.sync_account(db, acc, now)
    view = paper_service.account_view(db, acc, broker, now)
    symbols = [
        w.symbol
        for w in db.scalars(
            select(WatchlistItem).where(WatchlistItem.user_id == user.id).order_by(WatchlistItem.position)
        )
    ]
    overview_syms = ["BTC/USDT", "EUR/USD", "SPX", "XAU/USD"]
    trades = paper_service.closed_trades(db, [acc.id])
    bots = db.scalars(select(Bot).where(Bot.user_id == user.id).order_by(Bot.id.desc()).limit(5)).all()
    bts = db.scalars(select(Backtest).where(Backtest.user_id == user.id).order_by(Backtest.id.desc()).limit(5)).all()
    prog = learning_service.progress(db, user)
    beh = behavior(db, user)
    insights = []
    for f in beh["findings"][:2]:
        insights.append({"kind": "behavior", "title": f["title"], "text": f["text"], "lesson": f["lesson"]})
    try:
        snap = market_service.regime_snapshot("BTC/USDT", "4h", now)
        insights.append(
            {
                "kind": "market",
                "title": f"BTC/USDT 4H: {snap['regime']}",
                "text": " ".join(snap["reasons"][:2]),
                "lesson": "market-regimes",
            }
        )
    except Exception:  # noqa: BLE001 - dashboard should render even if market data fails
        pass
    if not trades:
        insights.append(
            {
                "kind": "next_step",
                "title": "Първа paper сделка",
                "text": "Отвори Paper Trading, избери актив, постави stop loss и направи първата си виртуална сделка.",
                "lesson": "stop-order",
            }
        )
    return json_safe(
        {
            "user": {"display_name": user.display_name, "mode": user.mode, "xp": user.xp, "is_guest": user.is_guest},
            "market_overview": [market_service.watch_row(s, now) for s in overview_syms],
            "watchlist": [market_service.watch_row(s, now) for s in symbols[:10]],
            "account": {
                k: view[k]
                for k in (
                    "balance",
                    "equity",
                    "unrealized_pnl",
                    "realized_pnl",
                    "day_pnl",
                    "free_margin",
                    "max_drawdown_pct",
                )
            },
            "open_positions": view["positions"],
            "recent_trades": trades[-5:][::-1],
            "learning": {
                "xp": prog["xp"],
                "level": prog["level"],
                "categories": prog["categories"],
                "lessons_completed": prog["lessons_completed"],
                "lessons_total": prog["lessons_total"],
                "next_module": next((m for m in prog["modules"] if m["unlocked"] and m["percent"] < 100), None),
            },
            "bots": [
                {
                    "id": b.id,
                    "name": b.name,
                    "symbol": b.symbol,
                    "timeframe": b.timeframe,
                    "status": b.status,
                    "regime": b.regime,
                    "last_signal": (b.last_signal or {}).get("signal"),
                }
                for b in bots
            ],
            "strategy_performance": [
                {
                    "id": b.id,
                    "strategy": b.strategy_name,
                    "symbol": b.symbol,
                    "timeframe": b.timeframe,
                    "status": b.status,
                    "net_pnl": (b.metrics or {}).get("net_pnl"),
                    "trades": (b.metrics or {}).get("total_trades"),
                    "profit_factor": (b.metrics or {}).get("profit_factor"),
                }
                for b in bts
            ],
            "risk": risk_status(db, user, now),
            "ai_insights": insights,
            "tour_done": settings_service.user_settings(user).get("tour_done", False),
        }
    )


# ------------------------------------------------------------- challenges
def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def evaluate_challenges(db: Session, user: User) -> list[dict]:
    ids = user_account_ids(db, user)
    trades = paper_service.closed_trades(db, ids)
    first_slices = {}
    for t in trades:
        first_slices.setdefault(t["position_id"], t)
    positions = list(first_slices.values())
    stored = {c.key: c for c in db.scalars(select(ChallengeProgress).where(ChallengeProgress.user_id == user.id))}
    out = []
    for ch in CHALLENGES:
        row = stored.get(ch["key"])
        value = (row.progress or {}).get("best", 0) if row else 0
        if ch["kind"] == "auto":
            if ch["key"] == "trade_breakout":
                value = sum(
                    1
                    for p in positions
                    if p["stop_price"] is not None and "breakout" in ((p.get("meta") or {}).get("setup") or "").lower()
                )
            elif ch["key"] == "risk_1pct":
                streak = best = 0
                for p in sorted(positions, key=lambda x: x["opened_ts"]):
                    r = (p.get("meta") or {}).get("risk_pct")
                    streak = streak + 1 if (r is not None and r <= 1.0 + 1e-9) else 0
                    best = max(best, streak)
                value = best
            elif ch["key"] == "no_overtrade":
                per_day = Counter(_day(p["opened_ts"]) for p in positions)
                value = sum(1 for n in per_day.values() if 1 <= n <= 3)
            elif ch["key"] == "twenty_with_stop":
                value = sum(1 for p in positions if p["stop_price"] is not None)
            elif ch["key"] == "journal_5":
                value = (
                    db.scalar(
                        select(func.count())
                        .select_from(JournalEntry)
                        .where(JournalEntry.user_id == user.id, JournalEntry.reason != "", JournalEntry.lesson != "")
                    )
                    or 0
                )
            elif ch["key"] == "first_backtest":
                value = sum(
                    1
                    for b in db.scalars(select(Backtest).where(Backtest.user_id == user.id, Backtest.status == "done"))
                    if (b.metrics or {}).get("total_trades", 0) >= 30
                )
            elif ch["key"] == "safe_bot":
                value = sum(
                    1
                    for b in db.scalars(select(Bot).where(Bot.user_id == user.id))
                    if b.status != "STOPPED" or b.last_processed_ts
                    if float((b.config or {}).get("daily_loss_limit_pct", 99)) <= 3
                    and float((b.config or {}).get("risk_per_trade_pct", 99)) <= 1
                )
        done = value >= ch["target"]
        if done and (row is None or row.status != "completed"):
            if row is None:
                row = ChallengeProgress(user_id=user.id, key=ch["key"], progress={})
                db.add(row)
            row.status = "completed"
            row.completed_ts = int(time.time())
            row.progress = {**(row.progress or {}), "best": value}
            user.xp += ch["xp"]
            db.commit()
        out.append(
            {**ch, "progress": min(value, ch["target"]), "completed": bool(row and row.status == "completed") or done}
        )
    return out


def record_interactive(db: Session, user: User, key: str, result: dict) -> dict:
    ch = CHALLENGES_BY_KEY[key]
    row = db.scalar(select(ChallengeProgress).where(ChallengeProgress.user_id == user.id, ChallengeProgress.key == key))
    if row is None:
        row = ChallengeProgress(user_id=user.id, key=key, progress={})
        db.add(row)
    best = max((row.progress or {}).get("best", 0), result["correct"])
    attempts = (row.progress or {}).get("attempts", 0) + 1
    row.progress = {"best": best, "attempts": attempts}
    gained = 0
    if result["passed"] and row.status != "completed":
        row.status = "completed"
        row.completed_ts = int(time.time())
        user.xp += ch["xp"]
        gained = ch["xp"]
    db.commit()
    return {**result, "xp_gained": gained, "best": best, "attempts": attempts}


def average(values: list[float]) -> float | None:
    return mean(values) if values else None


def open_positions_count(db: Session, acc_id: int) -> int:
    return db.query(PaperPosition).filter(PaperPosition.account_id == acc_id, PaperPosition.status == "open").count()
