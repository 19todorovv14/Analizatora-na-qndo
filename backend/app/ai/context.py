"""AI TEACHER CONTEXT — "What the teacher knows".

`build_context(db, user, ...)` returns a COMPACT, JSON-safe dict (numbers rounded, lists capped, the part sent
to the LLM is ≤ `CONTEXT_LIMIT` characters of JSON) with one entry per section:

    chart               symbol, timeframe, source/status, last price, last candle + 20-bar summary, indicator values
                        (EMA20/50/200, RSI, MACD hist, ATR / ATR%, BB width, volume vs average, ADX), swing structure
                        (HH/HL/LH/LL), trend, regime, nearest support/resistance, the signal engine's decision
    compare             the same (reduced) for a 2nd symbol or timeframe (COMPARE mode)
    strategy            describe() summary + the current per-condition evaluation (strategy view, regime filter applied)
    historical_examples past bars with the same conditions → forward 10-bar outcome distribution ("not a forecast")
    account             paper balance, equity, used/free margin, exposure, open positions
    trades              last 10 closed paper positions: symbol, side, R, exit reason, mistakes (lessons) from the review
    journal             last 5 journal entries: setup, emotion, mistakes, lesson
    learning            level, XP, completed lessons, weakest modules (quiz results)
    backtest            latest finished backtest of the strategy: key metrics + validation warnings / overfitting risk

Every section carries `available` (and a `reason` when it is false) and `context_used` lists them for the UI
chips ({key, label, available, detail, values}). `collect()` returns the same dict plus the full objects the
offline generators need (analysis, strategy view, reviews…) in a `ContextBundle`.

Numbers only ever come from market data, the paper engine and the database — never invented. Market data that
cannot be served gives `available: false` + reason (DATA NOT AVAILABLE), never a substitute.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from math import floor, log10
from statistics import mean

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import indicators as ind
from app.ai.examples import historical_examples
from app.ai.review import review_position
from app.analysis.signal import analyze
from app.market.base import AssetSpec, Candle, MarketDataError
from app.market.catalog import UnknownAssetError, get_asset
from app.models import Backtest, LearningProgress, PaperPosition, Strategy, User
from app.risk.engine import RiskRules
from app.services import learning_service, market_service, paper_service, settings_service, stats_service
from app.strategies.rules import StrategyDefinition, describe
from app.strategies.templates import TEMPLATES, TEMPLATES_BY_KEY
from app.strategies.view import strategy_view

log = logging.getLogger(__name__)

HISTORY_BARS = 1000  # closed bars fetched once: analysis uses the last ANALYSIS_BARS, examples scan all
ANALYSIS_BARS = 400  # same window as /api/ai/analyze → identical numbers
CONTEXT_LIMIT = 4096  # characters of compact JSON sent to the LLM
SECTIONS = (
    "chart",
    "compare",
    "strategy",
    "historical_examples",
    "account",
    "trades",
    "journal",
    "learning",
    "backtest",
)
DEFAULT_INCLUDE = frozenset(s for s in SECTIONS if s != "compare")
DEFAULT_TEMPLATE_KEYS = ("trend_momentum_structure", "ema_cross_trend")
HIGHER_TF = {"1m": "15m", "5m": "1h", "15m": "1h", "30m": "4h", "1h": "4h", "4h": "1d", "1d": "1w", "1w": "1d"}
_QUERY_STRING = re.compile(r"\?[^\s'\"]*=[^\s'\"]*")


class TeacherError(Exception):
    """A request the teacher cannot serve (unknown strategy / position / backtest …) → HTTP status + message."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ------------------------------------------------------------------ helpers
def _r(v, nd: int = 2):
    if v is None:
        return None
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


def _sig(v, digits: int = 4):
    if v is None:
        return None
    if v == 0:
        return 0.0
    return round(v, max(0, digits - 1 - floor(log10(abs(v)))))


def _pp(symbol: str) -> int:
    try:
        return get_asset(symbol).price_precision
    except UnknownAssetError:
        return 2


def fmt_price(v, pp: int) -> str:
    return "—" if v is None else f"{v:,.{pp}f}"


def _reason(exc: Exception) -> str:
    return _QUERY_STRING.sub("?…", str(exc))[:240]


def payload_size(d: dict) -> int:
    return len(json.dumps(d, ensure_ascii=False, separators=(",", ":"), default=str))


# -------------------------------------------------------------- strategies
def _definition(s: Strategy) -> StrategyDefinition:
    return StrategyDefinition(**(s.definition or {}))


def _info(s: Strategy | None, *, selected: bool, source: str, name: str | None = None) -> dict:
    return {
        "id": s.id if s else None,
        "name": (s.name if s else name) or "Strategy",
        "is_template": bool(s.is_template) if s else True,
        "selected": selected,
        "source": source,  # selected | recent | template
        "symbol": s.symbol if s else None,
        "timeframe": s.timeframe if s else None,
    }


def resolve_strategy(
    db: Session, user: User, strategy_id: int | None = None
) -> tuple[StrategyDefinition, dict, Strategy | None]:
    """The selected strategy, else the user's most recent non-template strategy, else the default template."""
    if strategy_id is not None:
        s = db.get(Strategy, strategy_id)
        if s is None or (s.user_id is not None and s.user_id != user.id):
            raise TeacherError(404, "Стратегията не е намерена.")
        try:
            return _definition(s), _info(s, selected=True, source="selected"), s
        except (ValidationError, ValueError) as exc:
            raise TeacherError(400, "Дефиницията на стратегията е невалидна.") from exc
    own = db.scalars(
        select(Strategy)
        .where(Strategy.user_id == user.id, Strategy.is_template.is_(False))
        .order_by(Strategy.updated_ts.desc(), Strategy.id.desc())
        .limit(5)
    )
    for s in own:
        try:
            return _definition(s), _info(s, selected=False, source="recent"), s
        except (ValidationError, ValueError):
            continue
    templates = list(db.scalars(select(Strategy).where(Strategy.is_template.is_(True)).order_by(Strategy.id)))
    by_name = {t.name: t for t in templates}
    preferred = [by_name.get(TEMPLATES_BY_KEY[k]["name"]) for k in DEFAULT_TEMPLATE_KEYS if k in TEMPLATES_BY_KEY]
    for s in [p for p in preferred if p is not None] + templates:
        try:
            return _definition(s), _info(s, selected=False, source="template"), s
        except (ValidationError, ValueError):
            continue
    key = next((k for k in DEFAULT_TEMPLATE_KEYS if k in TEMPLATES_BY_KEY), TEMPLATES[0]["key"])
    tpl = TEMPLATES_BY_KEY[key]
    return (
        StrategyDefinition(**tpl["definition"]),
        _info(None, selected=False, source="template", name=tpl["name"]),
        None,
    )


# ------------------------------------------------------------------- chart
@dataclass
class ChartData:
    symbol: str
    timeframe: str
    spec: AssetSpec | None
    available: bool
    reason: str | None = None
    candles: list[Candle] = field(default_factory=list)  # closed candles (≤ HISTORY_BARS)
    analysis: dict | None = None
    view: dict | None = None
    source: dict | None = None
    price: float | None = None
    compact: dict = field(default_factory=dict)

    @property
    def recent(self) -> list[Candle]:
        return self.candles[-ANALYSIS_BARS:]


def load_chart(
    symbol: str,
    timeframe: str,
    *,
    now: int,
    defn: StrategyDefinition | None = None,
    info: dict | None = None,
    min_rr: float = 1.5,
    news_risk: bool = False,
    indicators: list[str] | None = None,
) -> ChartData:
    """Closed candles → signal-engine analysis (+ strategy view). Unavailable data → available False + reason."""
    spec = get_asset(symbol)
    try:
        rows = market_service.candles(symbol, timeframe, limit=HISTORY_BARS, now=now, include_partial=False)
        source = market_service.source_of(symbol)
    except MarketDataError as exc:
        cd = ChartData(symbol, timeframe, spec, False, reason=_reason(exc))
        cd.compact = _unavailable_chart(cd)
        return cd
    if len(rows) < 60:
        cd = ChartData(
            symbol,
            timeframe,
            spec,
            False,
            reason=f"Недостатъчно история ({len(rows)} затворени свещи) — нужни са поне 60.",
            candles=rows,
            source=source,
        )
        cd.compact = _unavailable_chart(cd)
        return cd
    recent = rows[-ANALYSIS_BARS:]
    a = analyze(
        recent, spec=spec, timeframe=timeframe, min_rr=min_rr, news_risk=news_risk, source=source.get("id") or "demo"
    )
    price = None
    try:
        price = market_service.ticker(symbol, now=now).price
    except MarketDataError:
        price = None
    view = None
    if defn is not None:
        view = strategy_view(recent, defn, spec, timeframe, info=info, analysis=a, source=source.get("id"))
    cd = ChartData(symbol, timeframe, spec, True, candles=rows, analysis=a, view=view, source=source, price=price)
    cd.compact = _compact_chart(cd, indicators)
    return cd


def _unavailable_chart(cd: ChartData) -> dict:
    return {"available": False, "symbol": cd.symbol, "tf": cd.timeframe, "reason": cd.reason}


def _status(source: dict | None) -> str | None:
    if not source:
        return None
    return source.get("status") or ("live" if source.get("is_live") else "demo")


def _compact_chart(cd: ChartData, indicators: list[str] | None = None) -> dict:
    a, spec = cd.analysis or {}, cd.spec
    pp = spec.price_precision if spec else 2
    last = cd.candles[-1]
    recent = cd.recent
    closes = [c.close for c in recent]
    _, _, hist = ind.macd(closes)
    v = a.get("indicators") or {}
    vol = a.get("volatility") or {}
    st = a.get("structure") or {}
    bb_width = None
    if v.get("bb_upper") is not None and v.get("bb_lower") is not None and v.get("bb_middle"):
        bb_width = (v["bb_upper"] - v["bb_lower"]) / v["bb_middle"] * 100
    vol_sma = v.get("volume_sma")
    w20 = cd.candles[-20:]
    setup = a.get("setup")
    out = {
        "available": True,
        "symbol": cd.symbol,
        "tf": cd.timeframe,
        "source": (cd.source or {}).get("id"),
        "status": _status(cd.source),
        "time": last.ts,
        "price": _r(cd.price if cd.price is not None else last.close, pp),
        "candle": {
            "o": _r(last.open, pp),
            "h": _r(last.high, pp),
            "l": _r(last.low, pp),
            "c": _r(last.close, pp),
            "dir": "bullish" if last.close > last.open else "bearish" if last.close < last.open else "neutral",
            "patterns": list((a.get("candle") or {}).get("patterns") or [])[:3],
        },
        "last20": {
            "chg_pct": _r((last.close / w20[0].open - 1) * 100, 2) if w20 and w20[0].open else None,
            "hi": _r(max(c.high for c in w20), pp),
            "lo": _r(min(c.low for c in w20), pp),
            "up_bars": sum(1 for c in w20 if c.close > c.open),
        },
        "ind": {
            "ema20": _r(v.get("ema20"), pp),
            "ema50": _r(v.get("ema50"), pp),
            "ema200": _r(v.get("ema200"), pp),
            "rsi": _r(v.get("rsi"), 1),
            "macd_hist": _sig(v.get("macd_hist"), 4),
            "macd_rising": bool(hist[-1] is not None and hist[-2] is not None and hist[-1] > hist[-2]),
            "atr": _r(vol.get("atr"), pp),
            "atr_pct": _r(vol.get("atr_pct"), 3),
            "bb_width_pct": _r(bb_width, 2),
            "vol_ratio": _r(last.volume / vol_sma, 2) if vol_sma else None,
            "adx": _r(v.get("adx"), 1),
        },
        "structure": {
            "trend": st.get("trend"),
            "high": st.get("last_high_label"),
            "low": st.get("last_low_label"),
            "swings": [
                [s.get("label") or s.get("kind"), _r(s.get("price"), pp)] for s in (st.get("swings") or [])[-4:]
            ],
        },
        "trend": a.get("trend"),
        "regime": (a.get("regime") or {}).get("regime"),
        "momentum": (a.get("momentum") or {}).get("label"),
        "volatility": vol.get("label"),
        "atr_rank": int(round(vol["rank"])) if vol.get("rank") is not None else None,
        "support": [[_r(x["price"], pp), x.get("touches", 1)] for x in a.get("support") or []],
        "resistance": [[_r(x["price"], pp), x.get("touches", 1)] for x in a.get("resistance") or []],
        "signal": {
            "decision": a.get("decision"),
            "confidence": a.get("confidence"),
            "setup": {
                "side": setup["side"],
                "name": setup["name"],
                "entry": _r(setup.get("entry"), pp),
                "inv": _r(setup.get("invalidation"), pp),
                "target": _r(setup.get("target"), pp),
                "rr": setup.get("reward_risk"),
            }
            if setup
            else None,
            "wait": (a.get("wait_reason") or "")[:160] or None,
            "no_trade": [r["title"] for r in a.get("no_trade_reasons") or []],
        },
    }
    shown = [i for i in (indicators or []) if isinstance(i, str)][:8]
    if shown:
        out["shown"] = shown
    return out


def _compare_compact(cd: ChartData) -> dict:
    if not cd.available:
        return _unavailable_chart(cd)
    c = cd.compact
    view = cd.view or {}
    return {
        "available": True,
        "symbol": cd.symbol,
        "tf": cd.timeframe,
        "status": c.get("status"),
        "price": c.get("price"),
        "regime": c.get("regime"),
        "trend": c.get("trend"),
        "structure": {k: c["structure"].get(k) for k in ("trend", "high", "low")},
        "momentum": c.get("momentum"),
        "rsi": c["ind"].get("rsi"),
        "atr_pct": c["ind"].get("atr_pct"),
        "volatility": c.get("volatility"),
        "support": c["support"][:1],
        "resistance": c["resistance"][:1],
        "decision": c["signal"].get("decision"),
        "strategy_result": view.get("result"),
    }


# --------------------------------------------------------------- sections
def _strategy_section(info: dict, defn: StrategyDefinition, view: dict | None) -> dict:
    sec: dict = {
        "available": True,
        "id": info.get("id"),
        "name": info.get("name"),
        "selected": info.get("selected", False),
        "template": info.get("is_template", False),
        "rules": [line[:140] for line in describe(defn)][:6],
    }
    if view and view.get("available"):
        conds = view["conditions"]

        def side(rows: list[dict], passed: bool) -> dict | None:
            return {"passed": passed, "met": sum(1 for r in rows if r["passed"]), "n": len(rows)} if rows else None

        plan = view.get("risk_plan")
        sec.update(
            {
                "result": view["result"],
                "long": side(conds["long"], view["long_passed"]),
                "short": side(conds["short"], view["short_passed"]),
                "failed": [r["label"] for r in conds["long"] + conds["short"] if not r["passed"]][:4],
                "regime_filter": view["regime_filter"],
                "plan": {k: plan.get(k) for k in ("side", "entry", "stop", "target", "rr")} if plan else None,
            }
        )
    elif view:
        sec["result"] = view.get("result")
        sec["eval_reason"] = view.get("reason")
    return sec


def _examples_compact(ex: dict) -> dict:
    keys = (
        "available",
        "basis",
        "criteria",
        "horizon",
        "count",
        "long",
        "short",
        "median_move_atr",
        "p25_move_atr",
        "p75_move_atr",
        "plus_first_pct",
        "minus_first_pct",
        "neither_pct",
        "reliable",
        "r_unit",
        "reason",
    )
    return {k: ex[k] for k in keys if k in ex}


def _account_section(db: Session, user: User, now: int, rules: RiskRules) -> dict:
    acc = paper_service.get_manual_account(db, user)
    broker = paper_service.sync_account(db, acc, now)
    snap = broker.snapshot()
    positions = []
    for p in broker.open_positions()[:5]:
        pp = _pp(p.symbol)
        risk_unit = abs(p.entry_price - p.initial_stop) if p.initial_stop is not None else None
        upnl = broker.position_upnl(p)
        positions.append(
            {
                "id": p.id,
                "sym": p.symbol,
                "side": p.side,
                "qty": _r(p.qty, 6),
                "entry": _r(p.entry_price, pp),
                "stop": _r(p.stop_loss, pp),
                "tp": _r(p.take_profit, pp),
                "upnl": _r(upnl, 2),
                "r": _r(upnl / (risk_unit * p.qty), 2) if risk_unit and p.qty else None,
            }
        )
    return {
        "available": True,
        "balance": _r(snap["balance"]),
        "equity": _r(snap["equity"]),
        "used_margin": _r(snap["used_margin"]),
        "free_margin": _r(snap["free_margin"]),
        "exposure": _r(snap["exposure"]),
        "exposure_pct": _r(snap.get("exposure_pct"), 1),
        "open": snap.get("open_positions", len(positions)),
        "positions": positions,
        "risk_rule_pct": rules.max_risk_per_trade_pct,
        "min_rr": rules.min_reward_risk,
        "max_open": rules.max_open_positions,
    }


def _review(
    db: Session, ids: list[int], pid: str, trades: list[dict], rules: RiskRules
) -> tuple[dict, list[dict], dict] | None:
    found = paper_service.position_detail(db, ids, pid)
    if not found:
        return None
    pos, pts = found
    if not pts:
        return None
    rev = review_position(
        pos,
        pts,
        rules=rules,
        precision=_pp(pos["symbol"]),
        previous_trades=[t for t in trades if t["closed_ts"] <= pos["opened_ts"]],
    )
    return pos, pts, rev


def _trades_section(db: Session, user: User, rules: RiskRules, limit: int = 10) -> tuple[dict, dict[str, dict]]:
    ids = stats_service.user_account_ids(db, user)
    trades = paper_service.closed_trades(db, ids) if ids else []
    reviews: dict[str, dict] = {}
    items = []
    for pid in list(dict.fromkeys(t["position_id"] for t in reversed(trades))):
        if len(items) >= limit:
            break
        row = db.get(PaperPosition, pid)
        if row is None or row.status != "closed":
            continue
        got = _review(db, ids, pid, trades, rules)
        if got is None:
            continue
        pos, pts, rev = got
        reviews[pid] = rev
        items.append(
            {
                "id": pid,
                "sym": pos["symbol"],
                "side": pos["side"],
                "r": _r(rev.get("r_multiple"), 2),
                "pnl": _r(rev.get("net_pnl"), 2),
                "exit": pts[-1]["exit_reason"],
                "grade": rev.get("grade"),
                "mistakes": list(rev.get("lessons") or [])[:3],
            }
        )
    if not items:
        return {"available": False, "reason": "Още няма затворени paper сделки.", "closed_trades": len(trades)}, {}
    rs = [i["r"] for i in items if i["r"] is not None]
    return {
        "available": True,
        "closed_trades": len(trades),
        "recent": items,
        "win_rate": round(sum(1 for i in items if (i["pnl"] or 0) > 0) / len(items) * 100),
        "avg_r": _r(mean(rs), 2) if rs else None,
    }, reviews


def position_review(db: Session, user: User, rules: RiskRules, position_id: str) -> tuple[dict, list[dict], dict]:
    ids = stats_service.user_account_ids(db, user)
    row = db.get(PaperPosition, position_id)
    if row is None or row.account_id not in ids:
        raise TeacherError(404, "Сделката не е намерена.")
    if row.status != "closed":
        raise TeacherError(400, "Позицията още е отворена — REVIEW TRADE е за затворени сделки.")
    trades = paper_service.closed_trades(db, ids)
    got = _review(db, ids, position_id, trades, rules)
    if got is None:
        raise TeacherError(404, "Няма затворени части на тази позиция.")
    return got


def latest_closed_position_id(db: Session, user: User) -> str | None:
    ids = stats_service.user_account_ids(db, user)
    if not ids:
        return None
    trades = paper_service.closed_trades(db, ids)
    for pid in dict.fromkeys(t["position_id"] for t in reversed(trades)):
        row = db.get(PaperPosition, pid)
        if row is not None and row.status == "closed":
            return pid
    return None


def _journal_section(db: Session, user: User, limit: int = 5) -> tuple[dict, list[dict]]:
    entries = stats_service.journal_dicts(db, user)
    if not entries:
        return {"available": False, "reason": "Дневникът (journal) е празен.", "entries": 0}, []
    recent = entries[-limit:][::-1]
    items = [
        {
            "sym": e.get("symbol"),
            "side": e.get("side"),
            "setup": (e.get("setup") or "")[:40] or None,
            "emotion": e.get("emotion") or None,
            "mistakes": list(e.get("mistakes") or [])[:3],
            "lesson": (e.get("lesson") or "")[:100] or None,
            "r": _r(e.get("r_multiple"), 2),
        }
        for e in recent
    ]
    emotions = Counter(e["emotion"] for e in entries if e.get("emotion")).most_common(2)
    mistakes = Counter(m for e in entries for m in (e.get("mistakes") or [])).most_common(2)
    return {
        "available": True,
        "entries": len(entries),
        "recent": items,
        "top_emotions": [k for k, _ in emotions],
        "top_mistakes": [k for k, _ in mistakes],
    }, entries


def completed_lessons(db: Session, user: User) -> set[str]:
    return set(db.scalars(select(LearningProgress.lesson_slug).where(LearningProgress.user_id == user.id)))


def _learning_section(db: Session, user: User) -> tuple[dict, dict]:
    prog = learning_service.progress(db, user)
    mods = [m for m in prog.get("modules") or [] if isinstance(m, dict)]
    taken = sorted((m for m in mods if m.get("quiz_score") is not None), key=lambda m: m["quiz_score"])
    weak = [m for m in taken if m["quiz_score"] < 0.7]
    started = [
        m
        for m in mods
        if m.get("unlocked", True) and (m.get("lessons_completed") or 0) > 0 and (m.get("percent") or 0) < 100
    ]
    weakest = list({m["key"]: m for m in weak + started}.values())[:3]
    nxt = next((m for m in mods if m.get("unlocked", True) and (m.get("percent") or 0) < 100), None)
    return {
        "available": True,
        "level": prog.get("level"),
        "xp": prog.get("xp"),
        "lessons_done": prog.get("lessons_completed"),
        "lessons_total": prog.get("lessons_total"),
        "quizzes_passed": sum(1 for m in mods if m.get("quiz_passed")),
        "weak": [
            {
                "module": m["key"],
                "title": (m.get("title") or m["key"])[:60],
                "quiz_pct": round(m["quiz_score"] * 100) if m.get("quiz_score") is not None else None,
                "progress_pct": m.get("percent"),
            }
            for m in weakest
        ],
        "next_module": nxt["key"] if nxt else None,
    }, prog


def find_backtest(db: Session, user: User, backtest_id: int | None, strategy_row_id: int | None) -> Backtest | None:
    if backtest_id is not None:
        bt = db.get(Backtest, backtest_id)
        if bt is None or bt.user_id != user.id:
            raise TeacherError(404, "Backtest-ът не е намерен.")
        return bt
    if strategy_row_id is None:
        return None
    return db.scalar(
        select(Backtest)
        .where(Backtest.user_id == user.id, Backtest.strategy_id == strategy_row_id, Backtest.status == "done")
        .order_by(Backtest.id.desc())
        .limit(1)
    )


def _backtest_section(bt: Backtest | None) -> dict:
    if bt is None:
        return {"available": False, "reason": "Няма завършен backtest за тази стратегия."}
    if bt.status != "done":
        return {"available": False, "id": bt.id, "reason": f"Backtest #{bt.id} е в статус '{bt.status}'."}
    m = bt.metrics or {}
    v = bt.validation or {}
    pf = m.get("profit_factor")
    sec = {
        "available": True,
        "id": bt.id,
        "symbol": bt.symbol,
        "tf": bt.timeframe,
        "trades": m.get("total_trades"),
        "win_rate": _r(m.get("win_rate"), 1),
        "pf": None if pf is None else (999.0 if pf >= 1e8 else _r(pf, 2)),
        "exp_r": _r(m.get("expectancy_r"), 2),
        "net_pnl": _r(m.get("net_pnl"), 2),
        "max_dd_pct": _r(m.get("max_drawdown_pct"), 1),
        "sample": (v.get("sample_size") or {}).get("verdict"),
        "warnings": [w.get("code") for w in v.get("warnings") or [] if isinstance(w, dict)][:6],
    }
    oos = v.get("out_of_sample")
    if isinstance(oos, dict) and oos.get("in_sample"):
        sec["oos"] = {
            "is_exp_r": _r((oos.get("in_sample") or {}).get("expectancy_r"), 2),
            "oos_exp_r": _r((oos.get("out_of_sample") or {}).get("expectancy_r"), 2),
        }
    of = v.get("overfitting")
    if isinstance(of, dict) and of.get("risk"):
        sec["overfitting"] = of.get("risk")
    wf = v.get("walk_forward")
    if isinstance(wf, dict) and wf.get("verdict"):
        sec["walk_forward"] = wf.get("verdict")
    return sec


# ------------------------------------------------------------ context used
LABELS = {
    "chart": "Графика",
    "compare": "Сравнение",
    "strategy": "Стратегия",
    "historical_examples": "Исторически примери",
    "account": "Paper сметка",
    "trades": "Последни сделки",
    "journal": "Дневник",
    "learning": "Академия",
    "backtest": "Backtest",
}


def _num(v, nd: int = 2, suffix: str = "") -> str:
    if v is None:
        return "—"
    return f"{v:,.{nd}f}{suffix}"


def _used_item(key: str, sec: dict) -> dict:
    label = LABELS[key]
    if not sec.get("available"):
        if key in ("chart", "compare") and sec.get("symbol"):
            label = f"{label} {sec['symbol']} {str(sec.get('tf', '')).upper()}"
        reason = sec.get("reason") or "Няма данни."
        detail = f"DATA NOT AVAILABLE — {reason}" if key in ("chart", "compare") else reason
        return {"key": key, "label": label, "available": False, "detail": detail[:200], "values": {}}
    values: dict[str, str] = {}
    if key in ("chart", "compare"):
        label = f"{label} {sec['symbol']} {sec['tf'].upper()}"
        status = (sec.get("status") or "").upper()
        if key == "chart":
            i = sec["ind"]
            values = {
                "Последна цена": _num(sec.get("price"), _decimals(sec.get("price"))),
                "Режим": sec.get("regime") or "—",
                "Структура": f"{sec['structure'].get('high') or '—'} + {sec['structure'].get('low') or '—'}",
                "RSI(14)": _num(i.get("rsi"), 1),
                "ATR%": _num(i.get("atr_pct"), 2, "%"),
                "Обем / ср.": _num(i.get("vol_ratio"), 2, "×"),
            }
            detail = f"{status} · {sec.get('regime')} · RSI {_num(i.get('rsi'), 1)} · {sec['signal'].get('decision')}"
        else:
            values = {
                "Цена": _num(sec.get("price"), _decimals(sec.get("price"))),
                "Режим": sec.get("regime") or "—",
                "RSI(14)": _num(sec.get("rsi"), 1),
                "ATR%": _num(sec.get("atr_pct"), 2, "%"),
            }
            detail = f"{status} · {sec.get('regime')} · {sec.get('strategy_result') or sec.get('decision')}"
    elif key == "strategy":
        label = f"{label}: {sec.get('name')}"
        values = {"Резултат": sec.get("result") or "—"}
        for side in ("long", "short"):
            s = sec.get(side)
            if s:
                values[side.upper()] = f"{s['met']}/{s['n']} условия"
        rf = sec.get("regime_filter")
        if rf:
            values["Regime filter"] = ("OK" if rf.get("passed") else "BLOCKED") + f" ({rf.get('actual')})"
        detail = f"{sec.get('result') or '—'}" + (" · избрана" if sec.get("selected") else " · по подразбиране")
    elif key == "historical_examples":
        values = {"Случаи": str(sec.get("count", 0)), "Хоризонт": f"{sec.get('horizon')} свещи"}
        if sec.get("count"):
            values["Медиана"] = _num(sec.get("median_move_atr"), 2, " ATR")
            values["+1R първо"] = _num(sec.get("plus_first_pct"), 0, "%")
            values["−1R първо"] = _num(sec.get("minus_first_pct"), 0, "%")
        detail = f"{sec.get('count', 0)} минали случая — past examples, not a forecast"
    elif key == "account":
        values = {
            "Equity": _num(sec.get("equity")),
            "Balance": _num(sec.get("balance")),
            "Free margin": _num(sec.get("free_margin")),
            "Отворени позиции": str(sec.get("open", 0)),
            "Exposure": _num(sec.get("exposure")),
            "Риск правило": _num(sec.get("risk_rule_pct"), 2, "%"),
        }
        detail = f"Equity {_num(sec.get('equity'))} · {sec.get('open', 0)} отворени позиции"
    elif key == "trades":
        values = {
            "Прегледани": str(len(sec.get("recent") or [])),
            "Win rate": _num(sec.get("win_rate"), 0, "%"),
            "Среден R": _num(sec.get("avg_r"), 2, "R"),
        }
        last = (sec.get("recent") or [{}])[0]
        if last:
            values["Последна"] = f"{last.get('sym')} {str(last.get('side', '')).upper()} {_num(last.get('r'), 2, 'R')}"
        detail = f"{len(sec.get('recent') or [])} затворени · win rate {_num(sec.get('win_rate'), 0, '%')}"
    elif key == "journal":
        values = {"Записи": str(sec.get("entries", 0))}
        if sec.get("top_emotions"):
            values["Чести емоции"] = ", ".join(sec["top_emotions"])
        if sec.get("top_mistakes"):
            values["Чести грешки"] = ", ".join(sec["top_mistakes"])
        detail = f"{sec.get('entries', 0)} записа"
    elif key == "learning":
        weak = sec.get("weak") or []
        values = {
            "Ниво": str(sec.get("level")),
            "XP": str(sec.get("xp")),
            "Уроци": f"{sec.get('lessons_done')}/{sec.get('lessons_total')}",
            "Quiz-ове (passed)": str(sec.get("quizzes_passed")),
        }
        if weak:
            values["Слаба зона"] = weak[0]["title"]
        detail = f"Ниво {sec.get('level')} · {sec.get('lessons_done')}/{sec.get('lessons_total')} урока"
    else:  # backtest
        label = f"{label} #{sec.get('id')}"
        values = {
            "Сделки": str(sec.get("trades")),
            "Win rate": _num(sec.get("win_rate"), 1, "%"),
            "Profit factor": "∞" if sec.get("pf") == 999.0 else _num(sec.get("pf")),
            "Expectancy": _num(sec.get("exp_r"), 2, "R"),
            "Max DD": _num(sec.get("max_dd_pct"), 1, "%"),
        }
        if sec.get("overfitting"):
            values["Overfitting"] = sec["overfitting"]
        detail = f"{sec.get('trades')} сделки · {sec.get('symbol')} {str(sec.get('tf', '')).upper()}"
    return {"key": key, "label": label[:80], "available": True, "detail": detail[:200], "values": values}


def _decimals(price) -> int:
    if price is None:
        return 2
    return 2 if price >= 10 else 4 if price >= 1 else 6


def context_used(ctx: dict) -> list[dict]:
    return [_used_item(k, ctx[k]) for k in SECTIONS if isinstance(ctx.get(k), dict)]


def context_summary(ctx: dict) -> str:
    """One Bulgarian sentence: what the teacher knows right now."""
    parts = []
    for item in ctx.get("context_used") or context_used(ctx):
        if item["available"]:
            parts.append(f"{item['label']} ({item['detail']})")
    missing = [i["label"] for i in ctx.get("context_used") or [] if not i["available"]]
    text = "Учителят вижда: " + "; ".join(parts) + "." if parts else "Учителят още няма данни за теб."
    if missing:
        text += " Няма данни за: " + ", ".join(missing) + "."
    return text


# --------------------------------------------------------------- fit / size
def llm_payload(ctx: dict) -> dict:
    """The part of the context sent to the LLM (everything except the UI metadata)."""
    return {k: v for k, v in ctx.items() if k != "context_used"}


def _trim_steps():
    def cap(section: str, key: str, n: int):
        def f(p: dict) -> None:
            s = p.get(section)
            if isinstance(s, dict) and isinstance(s.get(key), list) and len(s[key]) > n:
                s[key] = s[key][:n]

        return f

    def drop(section: str, *keys: str):
        def f(p: dict) -> None:
            s = p.get(section)
            if isinstance(s, dict):
                for k in keys:
                    s.pop(k, None)

        return f

    def drop_section(section: str):
        def f(p: dict) -> None:
            s = p.get(section)
            if isinstance(s, dict) and s.get("available"):
                p[section] = {"available": True, "omitted": "size limit"}

        return f

    return [
        cap("trades", "recent", 5),
        cap("journal", "recent", 3),
        cap("strategy", "rules", 4),
        drop("chart", "last20"),
        cap("trades", "recent", 3),
        cap("journal", "recent", 2),
        drop("historical_examples", "criteria"),
        cap("strategy", "failed", 2),
        cap("learning", "weak", 2),
        cap("account", "positions", 3),
        drop("backtest", "warnings"),
        drop_section("journal"),
        drop_section("trades"),
        drop_section("backtest"),
    ]


def fit(ctx: dict, limit: int = CONTEXT_LIMIT) -> dict:
    """Trim lists (least important first) until the LLM payload is ≤ `limit` characters of JSON."""
    payload = llm_payload(ctx)
    if payload_size(payload) <= limit:
        return ctx
    for step in _trim_steps():
        step(ctx)
        if payload_size(llm_payload(ctx)) <= limit:
            break
    return ctx


# ------------------------------------------------------------------ bundle
@dataclass
class ContextBundle:
    context: dict
    now: int
    user_mode: str = "beginner"
    rules: RiskRules = field(default_factory=RiskRules)
    chart: ChartData | None = None
    compare: ChartData | None = None
    strategy_def: StrategyDefinition | None = None
    strategy_info: dict | None = None
    strategy_row: Strategy | None = None
    examples: dict | None = None
    reviews: dict[str, dict] = field(default_factory=dict)
    position: dict | None = None
    position_trades: list[dict] = field(default_factory=list)
    position_review: dict | None = None
    journal_entries: list[dict] = field(default_factory=list)
    progress: dict | None = None
    completed_lessons: set[str] = field(default_factory=set)
    backtest: Backtest | None = None

    @property
    def analysis(self) -> dict | None:
        return self.chart.analysis if self.chart and self.chart.available else None

    @property
    def view(self) -> dict | None:
        return self.chart.view if self.chart and self.chart.available else None


def collect(
    db: Session,
    user: User,
    *,
    symbol: str | None = None,
    timeframe: str | None = None,
    indicators: list[str] | None = None,
    strategy_id: int | None = None,
    position_id: str | None = None,
    backtest_id: int | None = None,
    compare: dict | None = None,
    include=None,
    now: int | None = None,
) -> ContextBundle:
    """Gather everything the teacher may use. `include` limits the sections (default: all but compare);
    `compare` = {"symbol": …, "timeframe": …} adds the compare section."""
    now = int(now or time.time())
    inc = set(include) if include is not None else set(DEFAULT_INCLUDE)
    if compare:
        inc.add("compare")
    rules = settings_service.risk_rules(user)
    settings = settings_service.user_settings(user)
    b = ContextBundle(context={}, now=now, user_mode=user.mode or "beginner", rules=rules)
    ctx = b.context
    ctx["user"] = {"mode": b.user_mode, "risk_rule_pct": rules.max_risk_per_trade_pct, "min_rr": rules.min_reward_risk}

    if position_id:
        b.position, b.position_trades, b.position_review = position_review(db, user, rules, position_id)
        symbol = symbol or b.position["symbol"]
        timeframe = timeframe or (b.position.get("meta") or {}).get("timeframe")
    timeframe = timeframe or "1h"

    defn, info, row = resolve_strategy(db, user, strategy_id)
    b.strategy_def, b.strategy_info, b.strategy_row = defn, info, row

    chart_kwargs = {
        "now": now,
        "defn": defn,
        "info": info,
        "min_rr": rules.min_reward_risk,
        "news_risk": bool(settings.get("news_risk")),
    }
    if symbol and inc & {"chart", "compare", "historical_examples", "strategy"}:
        b.chart = load_chart(symbol, timeframe, indicators=indicators, **chart_kwargs)
        if "chart" in inc:
            ctx["chart"] = b.chart.compact
    if "compare" in inc and compare and b.chart is not None:
        sym2 = compare.get("symbol") or symbol
        tf2 = compare.get("timeframe") or timeframe
        if sym2 == symbol and tf2 == timeframe:
            tf2 = HIGHER_TF.get(timeframe, "1d")
        b.compare = load_chart(sym2, tf2, **chart_kwargs)
        ctx["compare"] = _compare_compact(b.compare)
    if "strategy" in inc:
        ctx["strategy"] = _strategy_section(info, defn, b.view)
    if "historical_examples" in inc:
        if b.chart is not None and b.chart.available and b.chart.spec is not None:
            b.examples = historical_examples(
                b.chart.candles,
                b.chart.spec,
                strategy=defn if info.get("selected") else None,
                strategy_name=info.get("name"),
            )
            ctx["historical_examples"] = _examples_compact(b.examples)
        else:
            reason = b.chart.reason if b.chart is not None else "Няма избран символ."
            ctx["historical_examples"] = {"available": False, "reason": reason}
    if "account" in inc:
        try:
            ctx["account"] = _account_section(db, user, now, rules)
        except Exception as exc:  # noqa: BLE001 - the teacher still works without the account snapshot
            log.warning("teacher context: account unavailable: %s", exc)
            db.rollback()
            ctx["account"] = {"available": False, "reason": "Paper сметката не може да бъде заредена."}
    if "trades" in inc:
        ctx["trades"], b.reviews = _trades_section(db, user, rules)
    if "journal" in inc:
        ctx["journal"], b.journal_entries = _journal_section(db, user)
    if "learning" in inc:
        ctx["learning"], b.progress = _learning_section(db, user)
        b.completed_lessons = completed_lessons(db, user)
    if "backtest" in inc:
        b.backtest = find_backtest(db, user, backtest_id, row.id if row is not None else None)
        ctx["backtest"] = _backtest_section(b.backtest)
    ctx["context_used"] = context_used(ctx)  # from the full sections, before any size trimming
    fit(ctx)
    return b


def build_context(db: Session, user: User, **kwargs) -> dict:
    """Compact context dict (see module docstring). Keyword arguments as in `collect`."""
    return collect(db, user, **kwargs).context
