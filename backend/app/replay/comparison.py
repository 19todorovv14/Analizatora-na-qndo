"""Strategy comparison for the replay review: "Here is what a rule-based strategy would have done."

The chosen strategy is backtested (app.backtesting.engine.run_backtest) over the SAME window the user replayed —
signals from the first replay candle (start_ts) up to the cursor, fills on the next open — with the SAME costs as
the replay paper account (fees, spread, slippage, leverage, intrabar policy). Up to WARMUP_BARS candles before the
window warm the indicators up; a walk-forward segment boundary at the window start guarantees that no strategy
trade is opened before the window (positions from the warm-up are closed there and are not reported).
"""

from __future__ import annotations

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.backtesting.engine import BacktestSettings, run_backtest
from app.backtesting.metrics import json_safe, trade_metrics
from app.market.base import AssetSpec, Candle
from app.models import Strategy, User
from app.paper_engine.models import ExecutionConfig
from app.strategies.rules import StrategyDefinition, describe
from app.strategies.templates import TEMPLATES, TEMPLATES_BY_KEY

SENTENCE = "Here is what a rule-based strategy would have done."
SETUP_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement."
PAST_PERFORMANCE = "Past backtest performance does not guarantee future results."
DEFAULT_TEMPLATE_KEYS = ("trend_momentum_structure", "ema_cross_trend")
WARMUP_BARS = 200
MIN_WINDOW_BARS = 5


class StrategyNotFound(LookupError):
    pass


def _definition(s: Strategy) -> StrategyDefinition:
    return StrategyDefinition(**(s.definition or {}))


def _info(s: Strategy | None, *, source: str, name: str | None = None, key: str | None = None) -> dict:
    return {
        "id": s.id if s else None,
        "name": (s.name if s else name) or "Strategy",
        "is_template": bool(s.is_template) if s else True,
        "source": source,  # selected | recent | template
        "template_key": key,
        "timeframe": s.timeframe if s else None,
    }


def check_access(db: Session, user: User, strategy_id: int) -> Strategy:
    s = db.get(Strategy, strategy_id)
    if s is None or (s.user_id is not None and s.user_id != user.id):
        raise StrategyNotFound("Стратегията не е намерена.")
    return s


def resolve_strategy(
    db: Session, user: User, strategy_id: int | None = None
) -> tuple[StrategyDefinition, dict, Strategy | None]:
    """The selected strategy, else the user's most recent own strategy, else the default template."""
    if strategy_id is not None:
        s = db.get(Strategy, strategy_id)
        if s is not None and (s.user_id is None or s.user_id == user.id):
            try:
                return _definition(s), _info(s, source="selected"), s
            except (ValidationError, ValueError):
                pass  # an invalid stored definition falls back to the defaults below
    own = db.scalars(
        select(Strategy)
        .where(Strategy.user_id == user.id, Strategy.is_template.is_(False))
        .order_by(Strategy.updated_ts.desc(), Strategy.id.desc())
        .limit(5)
    )
    for s in own:
        try:
            return _definition(s), _info(s, source="recent"), s
        except (ValidationError, ValueError):
            continue
    templates = list(db.scalars(select(Strategy).where(Strategy.is_template.is_(True)).order_by(Strategy.id)))
    by_name = {t.name: t for t in templates}
    key_by_name = {t["name"]: t["key"] for t in TEMPLATES}
    preferred = [by_name.get(TEMPLATES_BY_KEY[k]["name"]) for k in DEFAULT_TEMPLATE_KEYS if k in TEMPLATES_BY_KEY]
    for s in [p for p in preferred if p is not None] + templates:
        try:
            return _definition(s), _info(s, source="template", key=key_by_name.get(s.name)), s
        except (ValidationError, ValueError):
            continue
    key = next((k for k in DEFAULT_TEMPLATE_KEYS if k in TEMPLATES_BY_KEY), TEMPLATES[0]["key"])
    tpl = TEMPLATES_BY_KEY[key]
    return StrategyDefinition(**tpl["definition"]), _info(None, source="template", name=tpl["name"], key=key), None


def settings_from_account(initial_balance: float, leverage: float, execution: dict | None) -> BacktestSettings:
    """Backtest settings with the replay account's costs."""
    cfg = ExecutionConfig.from_dict(execution or {})
    return BacktestSettings(
        initial_balance=initial_balance,
        fees_enabled=cfg.fees_enabled,
        spread_enabled=cfg.spread_enabled,
        spread_multiplier=cfg.spread_multiplier,
        slippage_bps=cfg.base_slippage_bps if cfg.slippage_enabled else 0.0,
        leverage=leverage,
        intrabar_policy=cfg.intrabar_policy,
        allow_short=True,
        max_open_positions=1,
    )


def _unavailable(info: dict, reason: str, **extra) -> dict:
    return {
        "available": False,
        "reason": reason,
        "sentence": SENTENCE,
        "strategy": info,
        "trades": [],
        "metrics": None,
        "text": [reason],
        "disclaimer": f"{SETUP_DISCLAIMER} {PAST_PERFORMANCE}",
        **extra,
    }


def compare(
    candles: list[Candle],
    *,
    start_ts: int,
    cursor_ts: int,
    spec: AssetSpec,
    timeframe: str,
    defn: StrategyDefinition,
    info: dict,
    settings: BacktestSettings,
    user_total_r: float | None = None,
    user_resolved: int = 0,
) -> dict:
    """`candles` = closed candles up to the cursor (warm-up history first). Never uses anything after the cursor."""
    rows = [c for c in candles if c.ts <= cursor_ts]
    w = next((i for i, c in enumerate(rows) if c.ts >= start_ts), None)
    period = {"start_ts": start_ts, "end_ts": cursor_ts}
    if w is None or len(rows) - w < MIN_WINDOW_BARS:
        return _unavailable(
            info,
            f"Твърде кратък период за сравнение — нужни са поне {MIN_WINDOW_BARS} разкрити свещи.",
            period=period,
        )
    if len(rows) < 30:
        return _unavailable(info, "Твърде малко история за backtest (нужни са поне 30 свещи).", period=period)
    s = BacktestSettings.from_dict({**settings.to_dict(), "warmup_bars": max(w, 1)})
    try:
        res = run_backtest(rows, spec, defn, s, timeframe, with_regimes=False, segments=[w])
    except ValueError as exc:
        return _unavailable(info, str(exc), period=period)
    window_start = rows[w].ts
    trades = [t for t in res["trades"] if t["entry_ts"] > window_start - 1 and t["exit_reason"] != "end_of_window"]
    windows = res.get("windows") or []
    start_equity = windows[-1]["start_equity"] if windows else s.initial_balance
    m = trade_metrics(trades, None, start_equity)
    rs = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None]
    total_r = round(sum(rs), 3) if rs else 0.0
    bh = (rows[-1].close / rows[w].close - 1) * 100 if rows[w].close else None
    metrics = {
        "total_trades": m["total_trades"],
        "winning_trades": m["winning_trades"],
        "losing_trades": m["losing_trades"],
        "win_rate": m["win_rate"],
        "net_pnl": m["net_pnl"],
        "return_pct": m["return_pct"],
        "profit_factor": m["profit_factor"],
        "expectancy_r": m["expectancy_r"],
        "total_r": total_r,
        "max_drawdown_pct": m["max_drawdown_pct"],
        "fees_total": m["fees_total"],
        "buy_and_hold_pct": bh,
        "start_equity": start_equity,
        "window_bars": len(rows) - w,
        "warmup_bars": w,
    }
    out_trades = [
        {
            "side": t["side"],
            "entry_ts": t["entry_ts"],
            "exit_ts": t["exit_ts"],
            "entry_price": t["entry_price"],
            "exit_price": t["exit_price"],
            "qty": t["qty"],
            "net_pnl": t["net_pnl"],
            "fees": t["fees"],
            "r_multiple": t["r_multiple"],
            "exit_reason": t["exit_reason"],
        }
        for t in trades
    ]
    text = [SENTENCE]
    if not trades:
        text.append(
            f"„{info['name']}“ не намери setup в тези {len(rows) - w} свещи — правилата казваха NO TRADE. "
            "Липсата на сделка също е решение."
        )
    else:
        wins = m["winning_trades"]
        text.append(
            f"„{info['name']}“ направи {len(trades)} сделки ({wins} печеливши), общо {total_r:+.2f}R, "
            f"нетно {m['net_pnl']:+,.2f} (след такси и spread)."
        )
    if user_resolved:
        if user_total_r is not None:
            cmp_word = "повече" if user_total_r > total_r else "по-малко" if user_total_r < total_r else "колкото"
            text.append(
                f"Твоите {user_resolved} оценени прогнози дадоха общо {user_total_r:+.2f}R — {cmp_word} от правилата."
            )
    if info.get("timeframe") and info["timeframe"] != timeframe:
        text.append(f"Стратегията е записана за {info['timeframe']}; тук правилата са приложени върху {timeframe}.")
    if w < 50:
        text.append("Малко история преди периода — индикаторите на стратегията може да не са „загрели“ напълно.")
    try:
        rules = describe(defn)
    except Exception:  # noqa: BLE001 - description is cosmetic
        rules = []
    return json_safe(
        {
            "available": True,
            "reason": None,
            "sentence": SENTENCE,
            "strategy": info,
            "rules": rules,
            "period": period,
            "trades": out_trades,
            "metrics": metrics,
            "costs": {
                "fees_enabled": s.fees_enabled,
                "spread_enabled": s.spread_enabled,
                "spread_multiplier": s.spread_multiplier,
                "slippage_bps": s.slippage_bps,
                "leverage": s.leverage,
                "intrabar_policy": s.intrabar_policy,
                "initial_balance": s.initial_balance,
            },
            "text": text,
            "disclaimer": f"{SETUP_DISCLAIMER} {PAST_PERFORMANCE}",
        }
    )
