"""BOT AI COACH — explains a paper bot's PAST simulated behaviour from its evaluation statistics and closed trades.

Deterministic (no LLM): setups funnel, top blockers, the losing context with the worst average R (side, regime at
entry, volatility tercile, session), worst / best regime, Bulgarian insights and next steps. It never predicts
future results and never recommends real trading.
"""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from statistics import mean
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.analysis.regime import RegimeInputs, classify_at
from app.bots import stats as bot_stats
from app.market.base import MarketDataError
from app.market.timeframes import last_closed_open, tf_seconds
from app.models import Bot
from app.services import bot_service, market_service, paper_service
from app.strategies.rules import IndicatorCache, StrategyDefinition, evaluate

COACH_TITLE = "BOT AI COACH"
COACH_DISCLAIMER = "Analysis of past simulated behaviour, not a guarantee."
MIN_GROUP_TRADES = 3
MIN_VOLATILITY_TRADES = 6
SMALL_SAMPLE = 30

ATTRIBUTE_LABELS = {
    "side": "Посока",
    "regime": "Пазарен режим при входа",
    "volatility": "Волатилност при входа (ATR% терцил)",
    "session": "Сесия / час на входа (UTC)",
}
SESSIONS = (
    (0, 8, "asia", "Азиатска сесия (00–08 UTC)"),
    (8, 13, "europe", "Европейска сесия (08–13 UTC)"),
    (13, 21, "us", "Американска сесия (13–21 UTC)"),
    (21, 24, "late", "Късна сесия (21–24 UTC)"),
)


# ------------------------------------------------------------------ setup statistics
def estimate_stats(bot: Bot, now: int) -> tuple[dict, dict]:
    """Re-evaluate the bot's strategy over its warm-start window (no positions are simulated): setups, all
    conditions met, rejected, and the filters that need no account state (regime, trading hours, shorts,
    conflicts). Used when the bot has not processed any bar yet."""
    cfg = {**bot_service.DEFAULT_CONFIG, **(bot.config or {})}
    sec = tf_seconds(bot.timeframe)
    days = float(cfg.get("warm_start_days") or 30)
    window = max(1, min(int(days * 86400 // sec), bot_service.MAX_BARS_PER_RUN))
    end_open = last_closed_open(now, bot.timeframe)
    start = end_open - (window + bot_service.WARMUP_BARS) * sec
    rows = market_service.candles(
        bot.symbol, bot.timeframe, start=start, end=now, limit=0, now=now, include_partial=False
    )
    defn = StrategyDefinition(**bot.strategy_snapshot)
    cache = IndicatorCache(rows)
    rx = RegimeInputs.from_candles(rows) if defn.regime_filter else None
    stats = bot_stats.empty_stats()
    first = max(0, len(rows) - window)
    for i in range(first, len(rows)):
        close_ts = rows[i].ts + sec
        met = bot_stats.record_bar(stats, evaluate(defn, cache, i), close_ts)
        if met.get("long") and met.get("short"):
            bot_stats.record_filter(stats, "conflict")
            continue
        side = "long" if met.get("long") else "short" if met.get("short") else None
        if side is None:
            continue
        if side == "short" and not cfg.get("allow_short", True):
            bot_stats.record_filter(stats, "short_disabled")
        elif not bot_service._in_hours(cfg, close_ts):
            bot_stats.record_filter(stats, "trading_hours")
        elif rx is not None and classify_at(rx, i)["regime"] not in defn.regime_filter:
            bot_stats.record_filter(stats, "regime")
    period = {"from_ts": stats["first_ts"], "to_ts": stats["last_ts"], "bars_evaluated": stats["bars_evaluated"]}
    return stats, period


# ------------------------------------------------------------------ trade breakdowns
def _trade_regime(t: dict) -> str | None:
    meta = t.get("meta") or {}
    return meta.get("regime") or (meta.get("entry_context") or {}).get("regime")


def _session(ts: int | None) -> tuple[str, str] | None:
    if not ts:
        return None
    hour = datetime.fromtimestamp(ts, UTC).hour
    for start, end, key, label in SESSIONS:
        if start <= hour < end:
            return key, label
    return None


def _group(trades: list[dict]) -> dict:
    rs = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None]
    wins = sum(1 for t in trades if t["net_pnl"] > 0)
    return {
        "trades": len(trades),
        "win_rate": wins / len(trades) * 100 if trades else None,
        "average_r": mean(rs) if rs else None,
        "net_pnl": sum(t["net_pnl"] for t in trades),
    }


def _breakdown(trades: list[dict], keyfn: Callable[[dict], tuple[str, str] | None]) -> list[dict]:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in trades:
        k = keyfn(t)
        if k is not None:
            groups[k].append(t)
    rows = [
        {"value": value, "label": label, **_group(ts), "enough_trades": len(ts) >= MIN_GROUP_TRADES}
        for (value, label), ts in groups.items()
    ]
    rows.sort(key=lambda r: -r["trades"])
    return rows


def _volatility_keyfn(trades: list[dict]) -> Callable[[dict], tuple[str, str] | None] | None:
    vals = sorted(v for v in ((t.get("meta") or {}).get("atr_pct") for t in trades) if v is not None)
    if len(vals) < MIN_VOLATILITY_TRADES:
        return None
    q1, q2 = vals[len(vals) // 3], vals[(2 * len(vals)) // 3]

    def keyfn(t: dict) -> tuple[str, str] | None:
        v = (t.get("meta") or {}).get("atr_pct")
        if v is None:
            return None
        if v <= q1:
            return "low", f"Ниска волатилност (ATR% ≤ {q1:.2f}%)"
        if v > q2:
            return "high", f"Висока волатилност (ATR% > {q2:.2f}%)"
        return "mid", f"Средна волатилност (ATR% {q1:.2f}–{q2:.2f}%)"

    return keyfn


def breakdowns(trades: list[dict]) -> dict[str, list[dict]]:
    out = {
        "side": _breakdown(trades, lambda t: (t["side"], f"{t['side'].upper()} сделки") if t.get("side") else None),
        "regime": _breakdown(trades, lambda t: (r, f"Режим {r}") if (r := _trade_regime(t)) else None),
        "session": _breakdown(trades, lambda t: _session(t.get("opened_ts"))),
    }
    vol = _volatility_keyfn(trades)
    out["volatility"] = _breakdown(trades, vol) if vol else []
    return out


def main_losing_condition(groups: dict[str, list[dict]]) -> dict | None:
    """The context (attribute value) with the worst average R — only attributes that split the trades into at
    least two groups, only groups with ≥ 3 trades, and only when that average R is negative."""
    best: dict | None = None
    for attr in ("side", "regime", "volatility", "session"):
        rows = groups.get(attr) or []
        if len(rows) < 2:
            continue
        for r in rows:
            if r["trades"] < MIN_GROUP_TRADES or r["average_r"] is None:
                continue
            if best is None or r["average_r"] < best["average_r"]:
                best = {"attribute": attr, **r}
    if best is None or best["average_r"] >= 0:
        return None
    return {
        "attribute": best["attribute"],
        "attribute_label": ATTRIBUTE_LABELS[best["attribute"]],
        "value": best["value"],
        "description": best["label"],
        "trades": best["trades"],
        "average_r": best["average_r"],
        "win_rate": best["win_rate"],
        "net_pnl": best["net_pnl"],
    }


def _regime_extremes(rows: list[dict]) -> tuple[dict | None, dict | None]:
    """(worst, best) regime among regimes with ≥ 3 trades: worst = lowest average R if it is negative,
    best = highest average R if it is positive."""
    ok = [r for r in rows if r["trades"] >= MIN_GROUP_TRADES and r["average_r"] is not None]

    def view(r: dict) -> dict:
        return {
            "regime": r["value"],
            "trades": r["trades"],
            "average_r": r["average_r"],
            "win_rate": r["win_rate"],
            "net_pnl": r["net_pnl"],
        }

    if not ok:
        return None, None
    # "worst" only when it actually loses on average, "best" only when it actually wins on average
    worst = min(ok, key=lambda r: r["average_r"])
    best = max(ok, key=lambda r: r["average_r"])
    return (view(worst) if worst["average_r"] < 0 else None), (view(best) if best["average_r"] > 0 else None)


# ------------------------------------------------------------------ the coach
def bot_coach(db: Session, bot: Bot, now: int | None = None) -> dict:
    now = int(now or time.time())
    stats = bot_service.evaluation_stats(bot)
    source, source_label, unavailable = "bot", "Статистика от свещите, обработени от бота.", None
    period = {"from_ts": stats["first_ts"], "to_ts": stats["last_ts"], "bars_evaluated": stats["bars_evaluated"]}
    if not stats["bars_evaluated"]:
        days = float({**bot_service.DEFAULT_CONFIG, **(bot.config or {})}.get("warm_start_days") or 30)
        try:
            stats, period = estimate_stats(bot, now)
            source = "estimate"
            source_label = (
                f"ОЦЕНКА: ботът още не е обработил свещи — стратегията е преизчислена върху последните {days:g} дни "
                "история (без симулирани позиции)."
            )
        except (MarketDataError, ValueError) as exc:
            source, source_label, unavailable = "unavailable", "Няма данни за оценка.", str(exc)

    trades = paper_service.closed_trades(db, [bot.paper_account_id])
    overall = _group(trades)
    groups = breakdowns(trades)
    losing = main_losing_condition(groups)
    worst_regime, best_regime = _regime_extremes(groups["regime"])
    blockers = bot_stats.top_blockers(stats)
    defn = StrategyDefinition(**bot.strategy_snapshot)

    insights = _insights(stats, source, period, blockers, overall, losing, worst_regime, best_regime, defn, unavailable)
    return {
        "bot_id": bot.id,
        "name": bot.name,
        "symbol": bot.symbol,
        "timeframe": bot.timeframe,
        "status": bot.status,
        "title": COACH_TITLE,
        "source": source,
        "source_label": source_label,
        "period": period,
        "headline": bot_stats.headline(stats),
        "setups_generated": stats["setups_generated"],
        "all_conditions_met": stats["all_conditions_met"],
        "rejected": stats["rejected"],
        "entries": stats["entries"],
        "rejected_by_condition": stats["rejected_by_condition"],
        "rejected_by_filters": stats["rejected_by_filters"],
        "by_side": stats["by_side"],
        "top_blockers": blockers,
        "trades": overall["trades"],
        "win_rate": overall["win_rate"],
        "average_r": overall["average_r"],
        "net_pnl": overall["net_pnl"],
        "main_losing_condition": losing,
        "worst_regime": worst_regime,
        "best_regime": best_regime,
        "breakdowns": groups,
        "insights": insights,
        "next_steps": _next_steps(bot, overall, worst_regime, blockers),
        "disclaimer": COACH_DISCLAIMER,
        "paper_only_notice": "Този бот работи САМО в paper-trading среда с виртуални пари.",
    }


def _insights(
    stats: dict,
    source: str,
    period: dict,
    blockers: list[dict],
    overall: dict,
    losing: dict | None,
    worst: dict | None,
    best: dict | None,
    defn: StrategyDefinition,
    unavailable: str | None,
) -> list[str]:
    out: list[str] = []
    if source == "unavailable":
        out.append(f"Няма пазарни данни, за да се преизчисли стратегията ({unavailable}).")
    else:
        prefix = "Оценка върху историята: " if source == "estimate" else ""
        out.append(
            f"{prefix}Стратегията генерира {stats['setups_generated']} setups. "
            f"{stats['all_conditions_met']} изпълниха всички условия. {stats['rejected']} бяха отхвърлени."
        )
        if stats["bars_evaluated"] and not stats["setups_generated"]:
            out.append(
                f"За {stats['bars_evaluated']} свещи тригер условието (първото в блока) не се изпълни нито веднъж — "
                "провери дали прагът е реалистичен за този пазар и timeframe."
            )
    cond = next((b for b in blockers if b["kind"] == "condition"), None)
    if cond:
        out.append(f"Най-често блокиращо условие: „{cond['label']}“ ({cond['count']} пъти).")
    filtered = sum(stats["rejected_by_filters"].values())
    if filtered:
        top = max(stats["rejected_by_filters"].items(), key=lambda kv: kv[1])
        out.append(
            f"Филтрите спряха {filtered} setups с изпълнени условия (най-често: "
            f"{bot_stats.FILTER_LABELS.get(top[0], top[0])})."
        )
    if source == "bot" and stats["all_conditions_met"]:
        out.append(f"{stats['entries']} от {stats['all_conditions_met']} пълни setups станаха paper сделки.")
    n = overall["trades"]
    if n == 0:
        out.append("Все още няма затворени сделки — резултатите изискват време (forward test).")
    else:
        avg = overall["average_r"]
        avg_txt = f", среден R {avg:+.2f}" if avg is not None else ""
        out.append(f"{n} затворени сделки, win rate {overall['win_rate']:.0f}%{avg_txt}.")
        if n < SMALL_SAMPLE:
            out.append(f"Само {n} сделки — твърде малко за статистически изводи; не променяй правилата заради тях.")
    if losing:
        out.append(
            f"Основен губещ контекст: {losing['description']} — {losing['trades']} сделки със среден R "
            f"{losing['average_r']:+.2f}."
        )
    if worst:
        out.append(
            f"Най-слабо представяне в режим {worst['regime']} ({worst['trades']} сделки, среден R "
            f"{worst['average_r']:+.2f})."
        )
    if best:
        out.append(
            f"Най-добро представяне в режим {best['regime']} ({best['trades']} сделки, среден R "
            f"{best['average_r']:+.2f})."
        )
    if worst and worst["average_r"] < 0 and not defn.regime_filter:
        out.append(
            f"Хипотеза за проверка: regime filter без {worst['regime']}. Тествай я първо в backtest на по-дълъг "
            "период — не променяй правилата само заради няколко сделки."
        )
    return out


def _next_steps(bot: Bot, overall: dict, worst: dict | None, blockers: list[dict]) -> list[dict]:
    params: dict[str, str | int] = {}
    if bot.strategy_id:
        params["strategy"] = bot.strategy_id
    params.update({"symbol": bot.symbol, "timeframe": bot.timeframe})
    if worst:
        params["regime"] = worst["regime"]
        title = f"Backtest на стратегията и разбивка за режим {worst['regime']}"
    else:
        title = "Backtest на стратегията върху по-дълъг период"
    steps = [{"kind": "backtest", "title": title, "href": "/backtesting?" + urlencode(params)}]
    if bot.strategy_id and any(b["kind"] == "condition" for b in blockers):
        steps.append(
            {
                "kind": "strategy",
                "title": "Прегледай блокиращите условия в Strategy Builder",
                "href": "/strategies?" + urlencode({"strategy": bot.strategy_id}),
            }
        )
    steps.append({"kind": "journal", "title": "Запиши наблюденията в Trading Journal", "href": "/journal"})
    if worst:
        steps.append({"kind": "lesson", "title": "Урок: Market regimes", "href": "/learn/market-regimes"})
    elif overall["trades"] < SMALL_SAMPLE:
        steps.append({"kind": "lesson", "title": "Урок: Sample size", "href": "/learn/sample-size"})
    else:
        steps.append({"kind": "lesson", "title": "Урок: Expectancy", "href": "/learn/expectancy"})
    return steps
