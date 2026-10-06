"""Performance metrics shared by backtests, paper accounts, bots and reports."""

from __future__ import annotations

import math
from statistics import mean, pstdev

from app.risk.engine import max_drawdown

INFINITE_PF = 1e9
SECONDS_PER_MONTH = 30.44 * 86400
SECONDS_PER_YEAR = 365.25 * 86400


def drawdown_series(values: list[float]) -> list[float]:
    """Percent below the running peak for every point (0 at a new high, negative below it)."""
    out: list[float] = []
    peak = None
    for v in values:
        if peak is None or v > peak:
            peak = v
        out.append((v - peak) / peak * 100 if peak and peak > 0 else 0.0)
    return out


def drawdown_curve(points: list[list]) -> list[list]:
    """[[ts, equity], ...] → [[ts, dd_pct], ...] with dd_pct <= 0 (rounded to 0.001 %)."""
    dd = drawdown_series([p[1] for p in points])
    return [[p[0], round(d, 3)] for p, d in zip(points, dd, strict=True)]


def max_drawdown_duration(values: list[float]) -> int:
    """Longest stretch (in points of the curve — bars for a backtest) spent below a previous peak,
    from the peak until equity recovers to it (or until the end if it never does)."""
    longest = current = 0
    peak = None
    for v in values:
        if peak is None or v >= peak:
            peak = v
            current = 0
        else:
            current += 1
            longest = max(longest, current)
    return longest


def streaks(nets: list[float]) -> tuple[int, int]:
    """(longest winning streak, longest losing streak); a trade with net P/L <= 0 counts as a loss."""
    win = loss = best_win = best_loss = 0
    for x in nets:
        if x > 0:
            win, loss = win + 1, 0
        else:
            win, loss = 0, loss + 1
        best_win, best_loss = max(best_win, win), max(best_loss, loss)
    return best_win, best_loss


def trade_ref(t: dict) -> dict:
    """Compact description of one trade (best / worst trade tiles)."""
    return {
        "pnl": t["net_pnl"],
        "r": t.get("r_multiple"),
        "entry_ts": t.get("entry_ts", t.get("opened_ts")),
        "exit_ts": t.get("exit_ts", t.get("closed_ts")),
        "side": t.get("side"),
        "exit_reason": t.get("exit_reason"),
    }


def sharpe_like(values: list[float], timestamps: list[int]) -> float | None:
    """Annualised mean/stdev of per-point equity returns. 'Sharpe-like': no risk-free rate, and the number of
    points per year is estimated from the timestamps (so 24/7 and session-based data are both handled)."""
    if len(values) < 3 or len(values) != len(timestamps):
        return None
    rets = [b / a - 1 for a, b in zip(values, values[1:]) if a > 0]
    span = timestamps[-1] - timestamps[0]
    if len(rets) < 2 or span <= 0:
        return None
    sd = pstdev(rets)
    if sd <= 0:
        return None
    per_year = len(rets) / (span / SECONDS_PER_YEAR)
    return mean(rets) / sd * math.sqrt(per_year)


def trade_metrics(
    trades: list[dict], equity_curve: list[float] | None = None, initial_balance: float | None = None
) -> dict:
    """`trades` items need: net_pnl, fees, r_multiple (optional), opened_ts, closed_ts."""
    n = len(trades)
    nets = [t["net_pnl"] for t in trades]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    gross_profit = sum(wins)
    gross_loss = sum(losses)
    rs = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None]
    holds = [t["closed_ts"] - t["opened_ts"] for t in trades if t.get("closed_ts") and t.get("opened_ts")]

    streak = worst_streak = 0
    for x in nets:
        streak = streak + 1 if x <= 0 else 0
        worst_streak = max(worst_streak, streak)
    win_streak, loss_streak = streaks(nets)
    best = max(trades, key=lambda t: t["net_pnl"]) if trades else None
    worst = min(trades, key=lambda t: t["net_pnl"]) if trades else None
    opens = [t.get("opened_ts") or t.get("entry_ts") for t in trades]
    closes = [t.get("closed_ts") or t.get("exit_ts") for t in trades]
    opens = [x for x in opens if x]
    closes = [x for x in closes if x]
    span = (max(closes) - min(opens)) if opens and closes else 0

    if equity_curve is None and initial_balance is not None:
        equity_curve = [initial_balance]
        for x in nets:
            equity_curve.append(equity_curve[-1] + x)
    dd_abs, dd_pct = max_drawdown(equity_curve or [])
    net = sum(nets)
    sqn = None
    if len(rs) >= 2 and pstdev(rs) > 0:
        sqn = math.sqrt(len(rs)) * mean(rs) / pstdev(rs)
    return {
        "total_trades": n,
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "win_rate": len(wins) / n * 100 if n else None,
        "net_pnl": net,
        "return_pct": net / initial_balance * 100 if initial_balance else None,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        # no losing trades → "infinite" profit factor; 1e9 keeps the payload valid JSON (UI shows ∞)
        "profit_factor": gross_profit / abs(gross_loss) if gross_loss < 0 else (None if not wins else INFINITE_PF),
        "average_win": mean(wins) if wins else None,
        "average_loss": mean(losses) if losses else None,
        "largest_win": max(wins) if wins else None,
        "largest_loss": min(losses) if losses else None,
        "average_r": mean(rs) if rs else None,
        "average_win_r": mean([r for r in rs if r > 0]) if any(r > 0 for r in rs) else None,
        "average_loss_r": mean([r for r in rs if r <= 0]) if any(r <= 0 for r in rs) else None,
        "expectancy": net / n if n else None,
        "expectancy_r": mean(rs) if rs else None,
        "max_drawdown": dd_abs,
        "max_drawdown_pct": dd_pct,
        "fees_total": sum(t.get("fees", 0.0) for t in trades),
        "average_holding_seconds": mean(holds) if holds else None,
        "max_consecutive_losses": worst_streak,
        "sqn": sqn,
        # v2 (additive)
        "avg_win_r": mean([r for r in rs if r > 0]) if any(r > 0 for r in rs) else None,
        "avg_loss_r": mean([r for r in rs if r <= 0]) if any(r <= 0 for r in rs) else None,
        "longest_win_streak": win_streak,
        "longest_loss_streak": loss_streak,
        "best_trade": trade_ref(best) if best else None,
        "worst_trade": trade_ref(worst) if worst else None,
        "max_drawdown_duration_bars": max_drawdown_duration(equity_curve or []),
        # trades per ~30.4 days over the span of the trades (a backtest overrides it with the test period)
        "trades_per_month": n / (span / SECONDS_PER_MONTH) if n and span > 0 else None,
        # share of time with an open position — only known per bar (set by the backtest engine)
        "exposure_pct": None,
    }


def json_safe(value):
    """Replace inf/NaN (not valid JSON) recursively."""
    if isinstance(value, float):
        if math.isinf(value):
            return 1e9 if value > 0 else -1e9
        if math.isnan(value):
            return None
        return value
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(v) for v in value]
    return value
