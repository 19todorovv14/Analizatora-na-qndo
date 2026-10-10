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
from app.ai.review import narrate, review_position
from app.backtesting.metrics import json_safe, trade_metrics
from app.bots import stats as bot_stats
from app.journal import performance as perf
from app.journal import review as journal_review
from app.journal.stats import journal_stats
from app.market import overview
from app.market.base import MarketDataError
from app.market.catalog import ASSETS, UnknownAssetError, get_asset
from app.market.overview import ENGINE
from app.models import (
    Backtest,
    Bot,
    ChallengeProgress,
    JournalEntry,
    LearningProgress,
    PaperAccount,
    PaperPosition,
    PaperTrade,
    ReplayDecision,
    RiskEvent,
    Strategy,
    User,
    WatchlistItem,
)
from app.psychology.behavior import analyze_behavior
from app.psychology.patterns import build_positions, detect_patterns, lesson_ref
from app.services import (
    bot_service,
    learning_service,
    market_service,
    markets_service,
    paper_service,
    settings_service,
)


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
        # v2
        "exit_price": e.exit_price,
        "strategy": e.strategy,
        "risk_amount": e.risk_amount,
        "notes": e.notes,
        "ai_review": e.ai_review,
    }


# ------------------------------------------------------------------ journal v2: strategy labels, linking, AI review
def _label(value) -> str | None:
    if isinstance(value, dict):
        value = value.get("name")
    return str(value).strip()[:100] or None if value else None


def strategy_labels(db: Session, trades: list[dict]) -> list[dict]:
    """Set t["strategy"] on closed-trade dicts (in place): the trade meta's strategy / strategy_name, else the saved
    strategy (meta.strategy_id), else the bot's strategy (meta.bot_id → its strategy, else the bot name)."""
    metas = [t.get("meta") or {} for t in trades]
    bot_ids = {m["bot_id"] for m in metas if isinstance(m.get("bot_id"), int)}
    bots = {b.id: b for b in db.scalars(select(Bot).where(Bot.id.in_(bot_ids)))} if bot_ids else {}
    strat_ids = {m["strategy_id"] for m in metas if isinstance(m.get("strategy_id"), int)}
    strat_ids |= {b.strategy_id for b in bots.values() if b.strategy_id}
    names = dict(db.execute(select(Strategy.id, Strategy.name).where(Strategy.id.in_(strat_ids))).all()) if strat_ids else {}
    for t, m in zip(trades, metas, strict=True):
        label = _label(m.get("strategy")) or _label(m.get("strategy_name")) or _label(names.get(m.get("strategy_id")))
        bot = bots.get(m.get("bot_id"))
        if not label and bot is not None:
            label = _label(names.get(bot.strategy_id)) or _label(bot.name)
        t["strategy"] = label
    return trades


def linked_position(db: Session, user: User, trade_id: str) -> dict | None:
    """The paper position behind a journal link (a trade id — any closed slice — or a position id) of the user's
    manual / replay / bot accounts, aggregated over every closed slice: {position_id, trade_ids, symbol, side,
    entry, stop, target, exit_price, result, r_multiple, risk_amount, timeframe, setup, strategy, slices, closed}."""
    ids = user_account_ids(db, user, ("manual", "replay", "bot"))
    if not ids or not trade_id:
        return None
    row = db.get(PaperTrade, trade_id)
    pid = row.position_id if (row is not None and row.account_id in ids) else trade_id
    rows = db.scalars(
        select(PaperTrade)
        .where(PaperTrade.position_id == pid, PaperTrade.account_id.in_(ids))
        .order_by(PaperTrade.closed_ts)
    ).all()
    if not rows:
        return None
    trades = strategy_labels(db, [paper_service.trade_to_dict(t) for t in rows])
    (p,) = build_positions(trades)
    pos = db.get(PaperPosition, pid)
    return {
        "position_id": pid,
        "trade_ids": p["trade_ids"],
        "symbol": p["symbol"],
        "side": p["side"],
        "entry": p["entry_price"],
        "stop": p["stop"],
        "target": p["target"],
        "exit_price": p["exit_price"],
        "result": p["net_pnl"],
        "r_multiple": p["r"],
        "risk_amount": p["risk_amount"],
        "timeframe": p["timeframe"],
        "setup": p["setup"],
        "strategy": trades[0]["strategy"],
        "slices": p["slices"],
        "closed": pos is None or pos.status == "closed",
    }


def journal_ai_review(db: Session, user: User, e: JournalEntry, now: int | None = None) -> dict:
    """AI review of a journal entry: the TRADE REVIEW (app.ai.review.review_position) when the entry is linked to a
    closed paper position, else a reflection review of the written fields (app.journal.review). Optional LLM
    narrative (sanitised) on top; offline it is fully rule-based."""
    now = int(now or time.time())
    rules = settings_service.risk_rules(user)
    link = linked_position(db, user, e.trade_id) if e.trade_id else None
    out: dict | None = None
    if link is not None and link["closed"]:
        ids = user_account_ids(db, user, ("manual", "replay", "bot"))
        detail = paper_service.position_detail(db, ids, link["position_id"])
        if detail is not None and detail[1]:
            pos, pts = detail
            try:
                precision = get_asset(pos["symbol"]).price_precision
            except UnknownAssetError:
                precision = 2
            history = paper_service.closed_trades(db, ids)
            out = journal_review.trade_review(
                review_position(
                    pos,
                    pts,
                    rules=rules,
                    precision=precision,
                    previous_trades=[t for t in history if t["closed_ts"] <= pos["opened_ts"]],
                )
            )
    if out is None:
        out = journal_review.reflection_review(journal_to_dict(e, with_screenshot=False), rules)
        if link is not None and not link["closed"]:
            out["note"] = "Позицията още е отворена — прегледът е по записаните полета."
        elif e.trade_id and link is None:
            out["note"] = "Свързаната сделка не е намерена — прегледът е по записаните полета."
    out = narrate(out, get_llm())
    out.setdefault("provider", "offline")
    out["generated_ts"] = now
    out["entry_id"] = e.id
    out["linked"] = (
        {k: link[k] for k in ("position_id", "symbol", "side", "result", "r_multiple", "closed")} if link else None
    )
    return json_safe(out)


def journal_statistics(db: Session, user: User) -> dict:
    """GET /api/journal/stats — journal_stats over the manual + replay history (trades carry strategy labels)."""
    trades = strategy_labels(db, paper_service.closed_trades(db, user_account_ids(db, user)))
    return json_safe(journal_stats(journal_dicts(db, user), trades, behavior(db, user)))


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


def replay_flag_counts(db: Session, user: User) -> dict[str, int]:
    """How often each Replay scoring flag (entered_too_early, ignored_structure, chased, …) was raised on the
    user's Replay decisions (the flags live in replay_decisions.outcome.meta.flags)."""
    counts: Counter = Counter()
    for outcome in db.scalars(select(ReplayDecision.outcome).where(ReplayDecision.user_id == user.id)):
        meta = (outcome or {}).get("meta") or {}
        for f in meta.get("flags") or []:
            key = f.get("key") if isinstance(f, dict) else f
            if key:
                counts[str(key)] += 1
    return dict(counts)


def completed_lessons(db: Session, user: User) -> set[str]:
    return set(db.scalars(select(LearningProgress.lesson_slug).where(LearningProgress.user_id == user.id)))


def patterns(db: Session, user: User, trades: list[dict] | None = None, journal: list[dict] | None = None) -> dict:
    """AI COACH v2 pattern detection over the user's manual + replay history (app.psychology.patterns)."""
    trades = trades if trades is not None else paper_service.closed_trades(db, user_account_ids(db, user))
    journal = journal if journal is not None else journal_dicts(db, user)
    return detect_patterns(
        trades,
        settings_service.risk_rules(user),
        replay_flags=replay_flag_counts(db, user),
        journal_mistakes=[m for e in journal for m in (e.get("mistakes") or [])],
    )


PERFORMANCE_SCOPES: dict[str, tuple[str, ...]] = {
    "manual": ("manual", "replay"),  # the user's own decisions (paper terminal + Replay) — default, as /stats/report
    "bots": ("bot",),
    "all": ("manual", "replay", "bot"),
}
DEFAULT_CAPITAL = 10_000.0


def _asset_class(symbol: str) -> str | None:
    try:
        return get_asset(symbol).asset_class
    except UnknownAssetError:
        return None


def performance(db: Session, user: User, scope: str = "manual") -> dict:
    """GET /api/stats/performance — v2 performance report over closed paper POSITIONS of the scope.

    Return % / drawdown use a reference capital: the initial balance of the scope's manual and bot accounts
    (Replay practice accounts are left out of the capital; their P/L is included for scope manual/all)."""
    if scope not in PERFORMANCE_SCOPES:
        raise ValueError(f"Unknown scope '{scope}'")
    accounts = list(
        db.scalars(
            select(PaperAccount).where(
                PaperAccount.user_id == user.id, PaperAccount.kind.in_(PERFORMANCE_SCOPES[scope])
            )
        )
    )
    ids = [a.id for a in accounts]
    trades = strategy_labels(db, paper_service.closed_trades(db, ids)) if ids else []
    positions = build_positions(trades)
    # labels: the trades' resolved strategy; a linked journal entry's setup / strategy wins (as in journal stats)
    label_of = {t["position_id"]: t.get("strategy") for t in trades if t.get("strategy")}
    linked = {e["trade_id"]: e for e in journal_dicts(db, user) if e.get("trade_id")}
    for p in positions:
        e = linked.get(p["position_id"]) or next((linked[i] for i in p["trade_ids"] if i in linked), None)
        p["strategy"] = (e and e.get("strategy")) or label_of.get(p["position_id"]) or p.get("strategy")
        p["setup"] = (e and e.get("setup")) or p.get("setup")
    capital_accounts = [a for a in accounts if a.kind != "replay"]
    reference = sum(a.initial_balance for a in capital_accounts) or DEFAULT_CAPITAL
    report = perf.build_report(positions, reference_capital=reference, asset_class_of=_asset_class)
    n = len(positions)
    enough = n >= 10
    return json_safe(
        {
            "version": 2,
            "scope": scope,
            "scopes": list(PERFORMANCE_SCOPES),
            "currency": "USD",
            "reference_capital": reference,
            "reference_capital_note": (
                f"Return % и drawdown са спрямо {reference:,.2f} USD — началния баланс на "
                + ("paper сметките на ботовете" if scope == "bots" else "основната paper сметка")
                + (" и ботовете" if scope == "all" and any(a.kind == "bot" for a in accounts) else "")
                + ". Replay сделките влизат в P/L, но не и в капитала."
            ),
            "enough_data": enough,
            "message": None if enough else f"Направи поне 10 paper сделки за пълен отчет (имаш {n}).",
            "positions": n,
            "trades": len(trades),
            **report,
            # v1-compatible extras (same meaning as /api/stats/report, for this scope)
            "metrics": report["summary"],
            "equity_curve": _equity(trades),
            "by_exit_reason": dict(Counter(p["exit_reason"] for p in positions)),
        }
    )


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
            patterns=patterns(db, user, all_trades, journal),
            rules=settings_service.risk_rules(user),
            learning=learning_service.learning_dashboard(db, user),
            completed_lessons=completed_lessons(db, user),
        )
    )


def exposure_breakdown(broker, equity: float) -> dict:
    """Open exposure (USD notional at the current mark) by instrument and by asset class, as % of equity."""
    by_symbol: dict[tuple[str, str], float] = {}
    for p in broker.open_positions():
        key = (p.symbol, p.side)
        by_symbol[key] = by_symbol.get(key, 0.0) + broker.position_notional(p)
    by_class: dict[str, float] = {}
    for (symbol, _side), notional in by_symbol.items():
        cls = _asset_class(symbol) or "unknown"
        by_class[cls] = by_class.get(cls, 0.0) + notional

    def pct(v: float) -> float | None:
        return v / equity * 100 if equity > 0 else None

    return {
        "by_symbol": [
            {"symbol": s, "side": side, "notional": n, "pct_of_equity": pct(n)}
            for (s, side), n in sorted(by_symbol.items(), key=lambda x: -x[1])
        ],
        "by_class": [
            {"asset_class": c, "label": perf.CLASS_LABELS_BG.get(c, c), "notional": n, "pct_of_equity": pct(n)}
            for c, n in sorted(by_class.items(), key=lambda x: -x[1])
        ],
    }


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
        # v2 (additive)
        "exposure_breakdown": exposure_breakdown(broker, snap["equity"]),
        "max_exposure_pct": rules.max_portfolio_exposure_pct,
        "used_margin": snap.get("used_margin"),
        "available_margin": snap.get("available_margin"),
    }


# ------------------------------------------------------------------ dashboard v2 (TRADING COMMAND CENTER)
DASHBOARD_WATCHLIST = 20
DASHBOARD_MOVERS = 5
DASHBOARD_LIST_SECONDS = 0.75  # time the dashboard may spend computing missing market snapshots (warm-up fills the rest)
DASHBOARD_INSIGHT_FINDINGS = 2
REGIME_TIMEFRAME = "4h"

REGIME_INSIGHTS: dict[str, tuple[str, str]] = {
    # regime → (why, lesson): describes the PAST candles and what a beginner should watch — never a direction call
    "TRENDING_UP": (
        "Последните свещи правят по-високи върхове и дъна. В тренд setup-ите в посоката му се търсят след pullback "
        "и затворена потвърждаваща свещ, със stop под последното дъно. Това описва миналото, не бъдещата посока.",
        "trend",
    ),
    "TRENDING_DOWN": (
        "Последните свещи правят по-ниски върхове и дъна. LONG срещу такава структура изисква много по-силна причина; "
        "чакай потвърждение на затворена свещ. Това описва миналото, не бъдещата посока.",
        "trend",
    ),
    "RANGING": (
        "Цената се движи между support и resistance. Пробивите на диапазона често са фалшиви (fakeout) — изчаквай "
        "затворена свещ извън него, преди да действаш.",
        "range",
    ),
    "HIGH_VOLATILITY": (
        "Свещите са по-големи от обичайното. По-широк stop означава по-малък размер на позицията, за да остане "
        "рискът в пари същият.",
        "volatility-and-sizing",
    ),
    "LOW_VOLATILITY": (
        "Тих пазар с малки свещи — движението може да не покрие разходите (spread, такси). Не форсирай сделки.",
        "volatility",
    ),
    "UNCLEAR": (
        "Няма ясен режим. Когато картината е смесена, WAIT е легитимно решение — сделка не е задължителна.",
        "market-regimes",
    ),
}
CLASS_ORDER = ("crypto", "stock", "etf", "forex", "index", "commodity")


def _lesson_href(slug: str | None) -> str | None:
    ref = lesson_ref(slug)
    return ref["href"] if ref else None


def _summary_item(spec, quote: dict) -> dict:
    """S1 list item (asset_summary + quote) — the shape QuoteList / MarketMovers rows use."""
    return {**market_service.asset_summary(spec), "quote": quote}


def market_row(spec, quote: dict) -> dict:
    """Dashboard row from an S1 snapshot quote: the v1 WatchRow keys (symbol, name, asset_class, price,
    change_24h_pct, volume_24h, volatility_pct, trend, regime, source, precision, error?) + slug, category,
    available/status/code/reason, sparkline, as_of, href. Unavailable data → nulls + `error` (never invented)."""
    ok = bool(quote.get("available"))
    row = {
        "symbol": spec.symbol,
        "slug": spec.slug,
        "name": spec.name,
        "asset_class": spec.asset_class,
        "category": spec.category,
        "price": quote.get("price"),
        "change_24h_pct": quote.get("change_24h_pct"),
        "volume_24h": quote.get("volume_24h"),
        "volume_24h_usd": quote.get("volume_24h_usd"),
        "volatility_pct": quote.get("atr_pct_1d"),
        "trend": quote.get("trend"),
        "regime": quote.get("regime"),
        "source": quote.get("source"),
        "precision": quote.get("precision") or spec.price_precision,
        "sparkline": quote.get("sparkline") or [],
        "available": ok,
        "status": quote.get("status"),
        "code": quote.get("code"),
        "reason": quote.get("reason"),
        "as_of": quote.get("as_of"),
        "href": f"/markets/{spec.slug}",
    }
    if not ok:
        row["error"] = quote.get("reason") or "DATA NOT AVAILABLE"
    return row


def _unknown_row(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "slug": None,
        "name": symbol,
        "asset_class": None,
        "available": False,
        "status": "unknown",
        "code": "UNKNOWN_INSTRUMENT",
        "reason": f"Непознат инструмент: {symbol} (вече не е в каталога)",
        "error": f"Непознат инструмент: {symbol} (вече не е в каталога)",
        "href": None,
    }


def dashboard_market(now: int) -> tuple[list[dict], dict]:
    """(market_overview rows: the top 24h mover of every asset class, market block: movers across classes + per
    class tiles + coverage) from the S1 snapshot engine (cached snapshots ≤ 10 min; missing ones are computed within
    a small time budget and the warm-up thread fills the rest)."""
    col = ENGINE.collect(ASSETS, now=now, seconds=DASHBOARD_LIST_SECONDS)
    sources = markets_service.sources_by_class()
    movable = [(s, q) for s, q in col.items if q.get("available") and q.get("change_24h_pct") is not None]
    classes = []
    overview_rows = []
    for cls in CLASS_ORDER:
        members = [(s, q) for s, q in movable if s.asset_class == cls]
        source = sources.get(cls) or {}
        if members:
            spec, quote = max(members, key=lambda x: (abs(x[1]["change_24h_pct"]), -x[0].popularity))
            changes = [q["change_24h_pct"] for _, q in members]
            overview_rows.append(market_row(spec, quote))
            classes.append(
                {
                    "asset_class": cls,
                    "label": perf.CLASS_LABELS_BG[cls],
                    "available": True,
                    "reason": None,
                    "code": None,
                    "source": source,
                    "ranked": len(members),
                    "advancers": sum(1 for c in changes if c > 0),
                    "decliners": sum(1 for c in changes if c < 0),
                    "average_change_pct": round(mean(changes), 3),
                    "top_mover": _summary_item(spec, quote),
                    "href": f"/markets?asset_class={cls}",
                }
            )
            continue
        if source.get("status") == "unavailable":
            reason, code = "DATA NOT AVAILABLE: няма конфигуриран доставчик за този клас.", "DATA_NOT_AVAILABLE"
        elif cls in col.rate_limited_classes:
            reason, code = markets_service.REASON_PLAN + " (само on demand на страницата на актива).", "PLAN_LIMIT"
        elif col.missing:
            reason, code = markets_service.REASON_WARMING, "WARMING"
        else:
            reason, code = "DATA NOT AVAILABLE", "DATA_NOT_AVAILABLE"
        classes.append(
            {
                "asset_class": cls,
                "label": perf.CLASS_LABELS_BG[cls],
                "available": False,
                "reason": reason,
                "code": code,
                "source": source,
                "ranked": 0,
                "advancers": None,
                "decliners": None,
                "average_change_pct": None,
                "top_mover": None,
                "href": f"/markets?asset_class={cls}",
            }
        )
    movers = {
        kind: [_summary_item(s, q) for s, q in markets_service.rank(kind, col.items)[:DASHBOARD_MOVERS]]
        for kind in ("gainers", "losers", "most_volume")
    }
    if col.missing:
        ENGINE.start_warmup()  # no-op when disabled (tests) — otherwise fills the remaining snapshots
    block = {
        "as_of": now,
        "movers": movers,
        "classes": classes,
        "coverage": {
            "ranked": len(col.items),
            "eligible": col.eligible,
            "unavailable": col.unavailable,
            "rate_limited": col.rate_limited,
            "missing": col.missing,
            "excluded_classes": list(col.rate_limited_classes),
        },
        "note": (
            f"{col.missing} инструмента още се зареждат (warm-up) и не са в класацията." if col.missing else None
        ),
        "heatmap_href": "/markets?view=heatmap",
        "markets_href": "/markets",
    }
    return overview_rows, block


def dashboard_watchlist(db: Session, user: User, now: int) -> tuple[list[dict], int]:
    """(first DASHBOARD_WATCHLIST rows by position, total) — snapshot quotes (cheap: no on-demand provider wait)."""
    symbols = list(
        db.scalars(
            select(WatchlistItem.symbol)
            .where(WatchlistItem.user_id == user.id)
            .order_by(WatchlistItem.position, WatchlistItem.id)
        )
    )
    first = symbols[:DASHBOARD_WATCHLIST]
    specs = {}
    for s in first:
        try:
            specs[s] = get_asset(s)
        except UnknownAssetError:
            continue
    quotes = ENGINE.quotes(list(specs.values()), now=now, fetch="cheap", max_age=overview.LIST_MAX_STALE)
    rows = [market_row(specs[s], quotes[specs[s].symbol]) if s in specs else _unknown_row(s) for s in first]
    return rows, len(symbols)


def _finding_insight(f: dict) -> dict:
    lesson = f.get("lesson") or {}
    return {
        "kind": "behavior",
        "key": f["key"],
        "title": f["title"],
        "text": f["evidence"],
        "why": f["impact"],
        "lesson": lesson.get("slug"),
        "href": lesson.get("href"),
        "action": {"label": f"Урок: {lesson['title']}", "href": lesson["href"]} if lesson else None,
        "severity": f.get("severity", "warn"),
        "count": f.get("count"),
        "sample": f.get("sample"),
        "available": True,
    }


def _behavior_insight(f: dict) -> dict:
    href = _lesson_href(f.get("lesson"))
    return {
        "kind": "behavior",
        "key": f["kind"],
        "title": f["title"],
        "text": f["text"],
        "why": "Повтарящ се модел в твоите paper сделки — урокът обяснява правилото, което го спира.",
        "lesson": f.get("lesson"),
        "href": href,
        "action": {"label": "Към урока", "href": href} if href else None,
        "severity": f.get("severity", "warn"),
        "count": f.get("count"),
        "sample": None,
        "available": True,
    }


def regime_insight(symbol: str, now: int) -> dict:
    """Market regime of `symbol` on 4H (closed candles) with an educational why — DATA NOT AVAILABLE when the
    provider cannot serve it. Describes the past candles; never a direction call."""
    try:
        spec = get_asset(symbol)
    except UnknownAssetError:
        spec = None
    slug = spec.slug if spec else None
    base = {"kind": "market", "key": "regime", "symbol": symbol, "timeframe": REGIME_TIMEFRAME, "count": None,
            "sample": None}
    try:
        snap = market_service.regime_snapshot(symbol, REGIME_TIMEFRAME, now)
    except MarketDataError as exc:
        return {
            **base,
            "title": f"{symbol} {REGIME_TIMEFRAME.upper()}: DATA NOT AVAILABLE",
            "text": getattr(exc, "reason", None) or overview.scrub_secrets(exc),
            "why": "Без пазарни данни режимът не може да се определи — числата никога не се измислят.",
            "lesson": None,
            "href": f"/markets/{slug}" if slug else None,
            "action": None,
            "severity": "info",
            "regime": None,
            "available": False,
        }
    regime = snap["regime"]
    why, lesson = REGIME_INSIGHTS.get(regime, REGIME_INSIGHTS["UNCLEAR"])
    href = _lesson_href(lesson)
    return {
        **base,
        "title": f"{symbol} {REGIME_TIMEFRAME.upper()}: {regime}",
        "text": " ".join(snap.get("reasons", [])[:2]) or f"Режим {regime} на затворените {REGIME_TIMEFRAME} свещи.",
        "why": why,
        "lesson": lesson,
        "href": href,
        "action": {"label": f"Отвори {symbol}", "href": f"/markets/{slug}"} if slug else None,
        "severity": "info",
        "regime": regime,
        "trend": snap.get("trend"),
        "volatility_pct": snap.get("volatility_pct"),
        "source": market_service.source_of(symbol) if spec else None,
        "available": True,
    }


def dashboard_insights(
    pattern_findings: list[dict], behavior_findings: list[dict], learning: dict, focus_symbol: str, has_trades: bool,
    now: int,
) -> list[dict]:
    """AI MARKET INSIGHTS v2: behaviour findings (coach patterns first, legacy behaviour detector as fallback) +
    the market regime of the user's top watchlist asset + the next learning step. Each: {kind, key, title, text,
    why, lesson, href, action, severity, available} (v1 keys kind/title/text/lesson kept)."""
    insights = [_finding_insight(f) for f in pattern_findings[:DASHBOARD_INSIGHT_FINDINGS]]
    covered = {"moving_stops", "no_stop", "oversizing"} | {i["key"] for i in insights}
    for f in behavior_findings:
        if len(insights) >= DASHBOARD_INSIGHT_FINDINGS:
            break
        if f["kind"] not in covered:
            insights.append(_behavior_insight(f))
    insights.append(regime_insight(focus_symbol, now))
    nxt = learning.get("next") or {}
    if nxt.get("href"):
        level = (learning.get("current_level") or {})
        insights.append(
            {
                "kind": "next_step",
                "key": "learning",
                "title": f"Следваща стъпка: {nxt.get('title')}",
                "text": f"LEVEL {nxt.get('level')} — {level.get('title_bg') or level.get('title') or ''}".strip(" —"),
                "why": "Следващият урок / quiz / lab в твоя learning path — уменията се трупат по ред.",
                "lesson": nxt.get("slug"),
                "href": nxt["href"],
                "action": {"label": "Продължи", "href": nxt["href"]},
                "severity": "info",
                "available": True,
            }
        )
    if not has_trades:
        href = _lesson_href("stop-order")
        insights.append(
            {
                "kind": "next_step",
                "key": "first_trade",
                "title": "Първа paper сделка",
                "text": "Отвори Paper Trading, избери актив, постави stop loss и направи първата си виртуална сделка.",
                "why": "Без сделки няма какво да анализираме — първата сделка със stop loss отключва AI Coach.",
                "lesson": "stop-order",
                "href": "/trade",
                "action": {"label": "Към Paper Trading", "href": "/trade"},
                "lesson_href": href,
                "severity": "info",
                "available": True,
            }
        )
    return insights


def next_actions(learning: dict, has_trades: bool, unjournaled: int, risk: dict) -> list[dict]:
    """Clear next actions for the command center (new users first): [{key, label, href, reason}] (≤ 4)."""
    out = []
    nxt = learning.get("next") or {}
    if nxt.get("href"):
        out.append({"key": "learn", "label": f"Продължи: {nxt.get('title')}", "href": nxt["href"],
                    "reason": "Следващата стъпка в learning path."})
    if not has_trades:
        out.append({"key": "first_trade", "label": "Първа paper сделка", "href": "/trade",
                    "reason": "Виртуални пари — упражни входа със stop loss."})
        out.append({"key": "replay", "label": "Replay сесия", "href": "/replay?preset=trend&mode=predict",
                    "reason": "Решения върху исторически свещи без риск."})
    if unjournaled:
        out.append({"key": "journal", "label": "Запиши сделките в журнала", "href": "/journal",
                    "reason": f"{unjournaled} затворени сделки без запис в журнала."})
    if risk.get("status") in ("WARNING", "LIMIT"):
        out.append({"key": "risk", "label": "Провери риска", "href": "/risk",
                    "reason": f"Risk status: {risk['status']}."})
    return out[:4]


def _bot_row(b: Bot) -> dict:
    stats = bot_service.evaluation_stats(b)
    return {
        "id": b.id,
        "name": b.name,
        "symbol": b.symbol,
        "timeframe": b.timeframe,
        "status": b.status,
        "regime": b.regime,
        "last_signal": (b.last_signal or {}).get("signal"),
        # v2: BOT AI COACH headline (pure counters from the bot runtime, no data fetch)
        "pause_reason": b.pause_reason,
        "coach_headline": bot_stats.headline(stats),
        "setups_generated": stats["setups_generated"],
        "all_conditions_met": stats["all_conditions_met"],
        "entries": stats["entries"],
        "last_processed_ts": b.last_processed_ts,
        "href": f"/bots/{b.id}",
    }


def dashboard(db: Session, user: User, now: int | None = None) -> dict:
    """GET /api/dashboard — TRADING COMMAND CENTER. Keeps every v1 key (user, market_overview, watchlist, account,
    open_positions, recent_trades, learning, bots, strategy_performance, risk, ai_insights, tour_done) with
    additive v2 fields (see the S7 report for the exact shape)."""
    now = int(now or time.time())
    acc = paper_service.get_manual_account(db, user)
    broker = paper_service.sync_account(db, acc, now)
    view = paper_service.account_view(db, acc, broker, now)
    settings = settings_service.user_settings(user)
    trades = paper_service.closed_trades(db, [acc.id])
    history = paper_service.closed_trades(db, user_account_ids(db, user))
    bots = db.scalars(select(Bot).where(Bot.user_id == user.id).order_by(Bot.id.desc()).limit(5)).all()
    bts = db.scalars(select(Backtest).where(Backtest.user_id == user.id).order_by(Backtest.id.desc()).limit(5)).all()
    prog = learning_service.progress(db, user)
    ld = learning_service.learning_dashboard(db, user)
    beh = behavior(db, user)
    journal = journal_dicts(db, user)
    pats = patterns(db, user, history, journal)

    overview_rows, market = dashboard_market(now)
    watch_rows, watch_total = dashboard_watchlist(db, user, now)
    focus = next((r["symbol"] for r in watch_rows if r.get("slug")), None) or settings.get("default_symbol", "BTC/USDT")
    risk = risk_status(db, user, now)
    journaled = {e["trade_id"] for e in journal if e.get("trade_id")}
    unjournaled = sum(
        1
        for pid, first in {t["position_id"]: t for t in trades}.items()
        if pid not in journaled and first["id"] not in journaled
    )
    learning = {
        "xp": prog["xp"],
        "level": prog["level"],
        "categories": prog["categories"],
        "lessons_completed": prog["lessons_completed"],
        "lessons_total": prog["lessons_total"],
        "next_module": next((m for m in prog["modules"] if m["unlocked"] and m["percent"] < 100), None),
        # v2: GET /api/learn/dashboard summary
        **{
            k: ld.get(k)
            for k in (
                "current_level",
                "next",
                "xp_level",
                "xp_progress",
                "levels_completed",
                "levels_total",
                "quiz_avg_score",
                "quizzes_passed",
                "quizzes_total",
                "replay_score",
                "replay_sessions",
                "replay_finished",
                "paper_trades",
                "risk_discipline",
                "strongest_skill",
                "weakest_skill",
                "most_common_mistake",
            )
        },
        "recommendations": (ld.get("recommendations") or [])[:3],
    }
    return json_safe(
        {
            "user": {
                "display_name": user.display_name,
                "mode": user.mode,
                "xp": user.xp,
                "is_guest": user.is_guest,
                "app_mode": settings.get("app_mode", "learn"),
                "explain_mode": bool(settings.get("explain_mode", False)),
            },
            "market_overview": overview_rows,
            "market": market,
            "watchlist": watch_rows,
            "watchlist_total": watch_total,
            "watchlist_limit": DASHBOARD_WATCHLIST,
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
                    # v2
                    "currency",
                    "used_margin",
                    "available_margin",
                    "margin_level",
                    "margin_level_pct",
                    "exposure",
                    "exposure_pct",
                    "effective_leverage",
                )
            }
            | {"open_positions": len(view["positions"]), "initial_balance": acc.initial_balance},
            "open_positions": view["positions"],
            "recent_trades": trades[-5:][::-1],
            "learning": learning,
            "bots": [_bot_row(b) for b in bots],
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
            "risk": risk,
            "ai_insights": dashboard_insights(pats["findings"], beh["findings"], ld, focus, bool(history), now),
            "next_actions": next_actions(ld, bool(history), unjournaled, risk),
            "tour_done": settings.get("tour_done", False),
            "as_of": now,
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
