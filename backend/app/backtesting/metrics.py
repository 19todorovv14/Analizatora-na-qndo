"""Performance metrics shared by backtests, paper accounts, bots and reports."""

from __future__ import annotations

import math
from statistics import mean, pstdev

from app.risk.engine import max_drawdown

INFINITE_PF = 1e9


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
