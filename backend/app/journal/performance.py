"""Performance report v2 — pure functions over closed paper POSITIONS (app.psychology.patterns.build_positions rows;
the closed slices of one position are merged, so a partial close does not count as an extra trade).

Everything is descriptive statistics of the user's PAST simulated trades, always with the sample size and a
confidence note — never a forecast."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from statistics import mean, median, stdev

from app.backtesting.metrics import INFINITE_PF, drawdown_curve, streaks, trade_metrics
from app.psychology.patterns import tf_label

UNLABELLED = "unlabelled"
MIN_GROUP_TRADES = 5  # a breakdown row with fewer positions is marked enough_data=false
MAX_CURVE_POINTS = 1500
TOP_TRADES = 5
Z95 = 1.96

BREAKDOWN_KEYS = ("asset", "asset_class", "timeframe", "setup", "strategy", "side", "weekday", "hour")
WEEKDAYS_BG = ("Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота", "Неделя")
CLASS_LABELS_BG = {
    "crypto": "Крипто",
    "stock": "Акции",
    "etf": "ETF",
    "forex": "Forex",
    "index": "Индекси",
    "commodity": "Стоки",
    "unknown": "Неизвестен клас",
}
SIDE_LABELS = {"long": "LONG", "short": "SHORT"}
# R buckets: [from, to) — None = open end
R_BUCKETS: tuple[tuple[float | None, float | None], ...] = (
    (None, -2.0),
    (-2.0, -1.0),
    (-1.0, -0.5),
    (-0.5, 0.0),
    (0.0, 0.5),
    (0.5, 1.0),
    (1.0, 2.0),
    (2.0, 3.0),
    (3.0, None),
)


# ------------------------------------------------------------------ sample size
def sample_level(n: int) -> str:
    if n == 0:
        return "none"
    if n < 10:
        return "very_small"
    if n < 30:
        return "small"
    if n < 100:
        return "moderate"
    return "large"


def sample_note(n: int) -> str:
    if n == 0:
        return "Още няма затворени сделки — отчетът се попълва след първите paper сделки."
    if n < 10:
        return f"Много малка извадка ({n} сделки) — числата описват миналото, но не са надеждна основа за изводи."
    if n < 30:
        return f"Малка извадка ({n} сделки) — третирай изводите като хипотези; нужни са поне 30 сделки."
    if n < 100:
        return f"Умерена извадка ({n} сделки) — изводите са ориентировъчни; миналите резултати не предсказват бъдещите."
    return f"{n} сделки — достатъчно за ориентировъчни изводи; миналите резултати не предсказват бъдещите."


# ------------------------------------------------------------------ helpers
def _r2(v: float | None, digits: int = 2) -> float | None:
    return round(v, digits) if v is not None else None


def profit_factor(nets: list[float]) -> float | None:
    gp = sum(x for x in nets if x > 0)
    gl = sum(x for x in nets if x < 0)
    if gl < 0:
        return gp / abs(gl)
    return INFINITE_PF if gp > 0 else None


def group_stats(rows: list[dict]) -> dict:
    nets = [float(p["net_pnl"]) for p in rows]
    rs = [p["r"] for p in rows if p.get("r") is not None]
    wins = sum(1 for x in nets if x > 0)
    n = len(rows)
    return {
        "trades": n,
        "wins": wins,
        "losses": n - wins,  # breakeven counts as a non-win (same convention as the backtest metrics)
        "win_rate": _r2(wins / n * 100, 1) if n else None,
        "net_pnl": round(sum(nets), 2),
        "average_pnl": _r2(mean(nets)) if nets else None,
        "with_r": len(rs),
        "average_r": _r2(mean(rs), 3) if rs else None,
        "profit_factor": _r2(profit_factor(nets), 3),
        "enough_data": n >= MIN_GROUP_TRADES,
    }


def _ts(p: dict) -> int:
    return int(p.get("closed_ts") or p.get("opened_ts") or 0)


def _dt(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), UTC)


def downsample_points(points: list[list], limit: int = MAX_CURVE_POINTS) -> list[list]:
    """Keep at most `limit` points (every k-th point, always the first and the last). The exact maximum drawdown
    is reported separately in `summary`."""
    if len(points) <= limit:
        return points
    step = math.ceil(len(points) / limit)
    out = points[::step]
    if out[-1] is not points[-1]:
        out.append(points[-1])
    return out


# ------------------------------------------------------------------ sections
def breakdown(
    positions: list[dict],
    key_fn: Callable[[dict], str],
    label_fn: Callable[[str], str] | None = None,
    *,
    natural: list[str] | None = None,
) -> list[dict]:
    """Rows {key, label, trades, wins, losses, win_rate, net_pnl, average_pnl, with_r, average_r, profit_factor,
    enough_data}: sorted by net P/L (desc), or in `natural` order (weekday / hour) when given."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for p in positions:
        groups[key_fn(p)].append(p)
    rows = [{"key": k, "label": label_fn(k) if label_fn else k, **group_stats(v)} for k, v in groups.items()]
    if natural is not None:
        order = {k: i for i, k in enumerate(natural)}
        return sorted(rows, key=lambda r: order.get(r["key"], len(order)))
    return sorted(rows, key=lambda r: (-r["net_pnl"], r["key"]))


def curves(positions: list[dict], reference: float) -> dict:
    """Equity (reference capital + realised P/L after each closed position), drawdown % below the running peak,
    and cumulative P/L — all [[ts, value], …] in close-time order (a start point at the first entry)."""
    ordered = sorted(positions, key=_ts)
    if not ordered:
        return {"equity": [], "drawdown": [], "pnl": []}
    start = int(min(p.get("opened_ts") or _ts(p) for p in ordered))
    equity = [[start, round(reference, 2)]]
    pnl = [[start, 0.0]]
    cum = 0.0
    for p in ordered:
        cum += float(p["net_pnl"])
        equity.append([_ts(p), round(reference + cum, 2)])
        pnl.append([_ts(p), round(cum, 2)])
    dd = drawdown_curve(equity)
    return {
        "equity": downsample_points(equity),
        "drawdown": downsample_points(dd),
        "pnl": downsample_points(pnl),
    }


def monthly_returns(positions: list[dict], reference: float) -> list[dict]:
    """Per calendar month (UTC, by close time): P/L, return % on the equity at the start of the month, trades.
    [{year, months: [null | {month, pnl, return_pct, trades}] × 12, pnl, return_pct, trades}] (oldest year first)."""
    ordered = sorted(positions, key=_ts)
    if not ordered:
        return []
    by_month: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for p in ordered:
        d = _dt(_ts(p))
        by_month[(d.year, d.month)].append(p)
    cum = 0.0
    month_rows: dict[tuple[int, int], dict] = {}
    year_start: dict[int, float] = {}
    for (y, m) in sorted(by_month):
        year_start.setdefault(y, reference + cum)
        start_equity = reference + cum
        pnl = sum(float(p["net_pnl"]) for p in by_month[(y, m)])
        month_rows[(y, m)] = {
            "month": m,
            "pnl": round(pnl, 2),
            "return_pct": round(pnl / start_equity * 100, 2) if start_equity > 0 else None,
            "trades": len(by_month[(y, m)]),
        }
        cum += pnl
    out = []
    for y in sorted({y for y, _ in by_month}):
        months = [month_rows.get((y, m)) for m in range(1, 13)]
        pnl = sum(r["pnl"] for r in months if r)
        start = year_start[y]
        out.append(
            {
                "year": y,
                "months": months,
                "pnl": round(pnl, 2),
                "return_pct": round(pnl / start * 100, 2) if start > 0 else None,
                "trades": sum(r["trades"] for r in months if r),
            }
        )
    return out


def _bucket_label(lo: float | None, hi: float | None) -> str:
    if lo is None:
        return f"< {hi:g}R"
    if hi is None:
        return f"≥ {lo:g}R"
    return f"{lo:g}R … {hi:g}R"


def r_distribution(positions: list[dict]) -> dict:
    rs = [float(p["r"]) for p in positions if p.get("r") is not None]
    buckets = []
    for lo, hi in R_BUCKETS:
        count = sum(1 for r in rs if (lo is None or r >= lo) and (hi is None or r < hi))
        buckets.append(
            {
                "key": f"{'-inf' if lo is None else f'{lo:g}'}:{'inf' if hi is None else f'{hi:g}'}",
                "label": _bucket_label(lo, hi),
                "from": lo,
                "to": hi,
                "count": count,
                "pct": round(count / len(rs) * 100, 1) if rs else 0.0,
            }
        )
    return {
        "buckets": buckets,
        "with_r": len(rs),
        "without_r": len(positions) - len(rs),
        "average_r": _r2(mean(rs), 3) if rs else None,
        "median_r": _r2(median(rs), 3) if rs else None,
        "note": "R = резултат / планиран риск (1R = загубата при стопа). Сделки без stop loss нямат R."
        if len(positions) > len(rs)
        else None,
    }


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    """Wilson score 95% interval for a proportion, in %."""
    if n <= 0:
        return None
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return round(max(0.0, centre - half) * 100, 1), round(min(1.0, centre + half) * 100, 1)


def mean_interval(values: list[float], digits: int = 3) -> dict:
    """{value, stdev, stderr, ci95: [lo, hi] | None} — normal approximation (needs ≥ 2 values)."""
    if not values:
        return {"value": None, "stdev": None, "stderr": None, "ci95": None}
    m = mean(values)
    if len(values) < 2:
        return {"value": round(m, digits), "stdev": None, "stderr": None, "ci95": None}
    sd = stdev(values)
    se = sd / math.sqrt(len(values))
    return {
        "value": round(m, digits),
        "stdev": round(sd, digits),
        "stderr": round(se, digits),
        "ci95": [round(m - Z95 * se, digits), round(m + Z95 * se, digits)],
    }


def _interval_note(name: str, unit: str, est: dict, n: int) -> str:
    if est["value"] is None:
        return f"{name}: няма данни."
    fmt = (lambda v: f"{v:+.2f}{unit}") if unit == "R" else (lambda v: f"{v:+,.2f} {unit}")
    if est["ci95"] is None:
        return f"{name} {fmt(est['value'])} от една сделка — без статистическа стойност."
    lo, hi = est["ci95"]
    text = f"{name} {fmt(est['value'])} на сделка; 95% интервал ≈ {fmt(lo)} … {fmt(hi)} (n = {n})."
    if lo <= 0 <= hi:
        text += " Интервалът включва 0 — още няма статистическо доказателство за edge."
    else:
        text += " Интервалът не включва 0, но миналите резултати не предсказват бъдещите."
    if n < 30:
        text += " Малка извадка — интервалът е широк."
    return text


def confidence(positions: list[dict]) -> dict:
    n = len(positions)
    nets = [float(p["net_pnl"]) for p in positions]
    rs = [float(p["r"]) for p in positions if p.get("r") is not None]
    exp_r = mean_interval(rs)
    exp_usd = mean_interval(nets, 2)
    wins = sum(1 for x in nets if x > 0)
    wr = wilson(wins, n)
    pf = profit_factor(nets)
    if pf is None:
        pf_note = "Profit factor: няма данни (няма затворени сделки с резултат)."
    elif pf >= INFINITE_PF:
        pf_note = "Няма губещи сделки — profit factor е ∞; почти винаги това е ефект на малка извадка."
    elif n < 30:
        pf_note = (
            f"Profit factor {pf:.2f} от {n} сделки — при малка извадка една голяма сделка променя PF драстично."
        )
    else:
        pf_note = f"Profit factor {pf:.2f} от {n} сделки (> 1 = печалбите покриват загубите)."
    return {
        "sample": {"positions": n, "with_r": len(rs), "level": sample_level(n), "note": sample_note(n)},
        "expectancy_r": {**exp_r, "n": len(rs), "note": _interval_note("Expectancy", "R", exp_r, len(rs))},
        "expectancy": {**exp_usd, "n": n, "note": _interval_note("Expectancy", "USD", exp_usd, n)},
        "win_rate": {
            "value": round(wins / n * 100, 1) if n else None,
            "ci95": list(wr) if wr else None,
            "n": n,
            "note": (
                f"Win rate {wins / n * 100:.0f}% ({wins} от {n}); 95% интервал ≈ {wr[0]:.0f}% … {wr[1]:.0f}%."
                if wr
                else "Win rate: няма данни."
            ),
        },
        "profit_factor": {"value": _r2(pf, 3), "n": n, "note": pf_note},
    }


def streak_info(positions: list[dict]) -> dict:
    nets = [float(p["net_pnl"]) for p in sorted(positions, key=_ts)]
    best_win, best_loss = streaks(nets)
    kind, length = None, 0
    for x in reversed(nets):
        k = "win" if x > 0 else "loss"
        if kind is None:
            kind = k
        if k != kind:
            break
        length += 1
    return {"max_wins": best_win, "max_losses": best_loss, "current": {"kind": kind, "length": length}}


def trade_row(p: dict) -> dict:
    return {
        "position_id": p["position_id"],
        "symbol": p["symbol"],
        "side": p["side"],
        "opened_ts": p["opened_ts"],
        "closed_ts": p["closed_ts"],
        "holding_seconds": p["holding_seconds"],
        "net_pnl": round(float(p["net_pnl"]), 2),
        "r": _r2(p["r"], 3),
        "timeframe": p.get("timeframe"),
        "setup": p.get("setup"),
        "strategy": p.get("strategy"),
        "exit_reason": p.get("exit_reason"),
    }


def summary(positions: list[dict], reference: float) -> dict:
    """trade_metrics over positions (close order) with the reference capital (return %, drawdown)."""
    ordered = sorted(positions, key=_ts)
    rows = [
        {
            "net_pnl": float(p["net_pnl"]),
            "fees": float(p.get("fees") or 0.0),
            "r_multiple": p.get("r"),
            "opened_ts": p.get("opened_ts"),
            "closed_ts": p.get("closed_ts"),
        }
        for p in ordered
    ]
    m = trade_metrics(rows, None, reference)
    nets = [r["net_pnl"] for r in rows]
    aw, al = m.get("average_win"), m.get("average_loss")
    m["payoff_ratio"] = aw / abs(al) if aw is not None and al not in (None, 0) else None
    m["breakeven_trades"] = sum(1 for x in nets if x == 0)
    return m


# ------------------------------------------------------------------ entry point
def build_report(
    positions: list[dict], *, reference_capital: float, asset_class_of: Callable[[str], str | None]
) -> dict:
    """The v2 sections of GET /api/stats/performance (see stats_service.performance for the envelope)."""
    classes: dict[str, str] = {}

    def cls(p: dict) -> str:
        sym = p.get("symbol") or ""
        if sym not in classes:
            classes[sym] = asset_class_of(sym) or "unknown"
        return classes[sym]

    def tf(p: dict) -> str:
        return p.get("timeframe") or "unknown"

    def tf_name(k: str) -> str:
        return "Неизвестен" if k == "unknown" else tf_label(k)

    def unl(k: str) -> str:
        return "Без етикет" if k == UNLABELLED else k

    hours = [str(h) for h in range(24)]
    breakdowns = {
        "asset": breakdown(positions, lambda p: p.get("symbol") or "?"),
        "asset_class": breakdown(positions, cls, lambda k: CLASS_LABELS_BG.get(k, k)),
        "timeframe": breakdown(positions, tf, tf_name),
        "setup": breakdown(positions, lambda p: (p.get("setup") or "").strip() or UNLABELLED, unl),
        "strategy": breakdown(positions, lambda p: (p.get("strategy") or "").strip() or UNLABELLED, unl),
        "side": breakdown(positions, lambda p: p.get("side") or "long", lambda k: SIDE_LABELS.get(k, k.upper())),
        "weekday": breakdown(
            positions,
            lambda p: str(_dt(p.get("opened_ts") or _ts(p)).weekday()),
            lambda k: WEEKDAYS_BG[int(k)],
            natural=[str(i) for i in range(7)],
        ),
        "hour": breakdown(
            positions,
            lambda p: str(_dt(p.get("opened_ts") or _ts(p)).hour),
            lambda k: f"{int(k):02d}:00 UTC",
            natural=hours,
        ),
    }
    winners = sorted((p for p in positions if p["net_pnl"] > 0), key=lambda p: -p["net_pnl"])
    losers = sorted((p for p in positions if p["net_pnl"] < 0), key=lambda p: p["net_pnl"])
    return {
        "summary": summary(positions, reference_capital),
        "confidence": confidence(positions),
        "curves": curves(positions, reference_capital),
        "breakdowns": breakdowns,
        "breakdown_min_trades": MIN_GROUP_TRADES,
        "monthly_returns": monthly_returns(positions, reference_capital),
        "r_distribution": r_distribution(positions),
        "best_trades": [trade_row(p) for p in winners[:TOP_TRADES]],
        "worst_trades": [trade_row(p) for p in losers[:TOP_TRADES]],
        "streaks": streak_info(positions),
    }
