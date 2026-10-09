"""Behavioural pattern detection on paper-trading history.

Detects: overtrading, oversizing, revenge trading, moving stops away, chasing entries,
trading without a stop, and the "cut winners / let losers run" pattern.
Input trades are dicts (see services.paper_service.trade_to_dict).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from statistics import median

from app.risk.engine import RiskRules

LESSON_FOR = {
    "overtrading": "overtrading",
    "oversizing": "position-sizing",
    "revenge_trading": "revenge-trading",
    "moving_stops": "stop-loss-placement",
    "chasing": "fomo",
    "no_stop": "stop-order",
    "cut_winners": "loss-aversion",
}

TITLES = {
    "overtrading": "Overtrading",
    "oversizing": "Oversizing",
    "revenge_trading": "Revenge trading",
    "moving_stops": "Moving stops",
    "chasing": "Chasing entries",
    "no_stop": "Trading without a stop",
    "cut_winners": "Cutting winners, holding losers",
}


def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


def analyze_behavior(trades: list[dict], rules: RiskRules, max_trades_per_day: int = 8) -> dict:
    trades = sorted(trades, key=lambda t: t["opened_ts"])
    # only count each position once (partial closes create several trade rows); `parts` keeps every closed slice
    parts: dict[str, list[dict]] = defaultdict(list)
    entries = []
    for t in trades:
        if t["position_id"] not in parts:
            entries.append(t)
        parts[t["position_id"]].append(t)

    findings: dict[str, dict] = {}

    def add(kind: str, severity: str, text: str, trade_ids: list[str]) -> None:
        f = findings.setdefault(
            kind,
            {
                "kind": kind,
                "title": TITLES[kind],
                "severity": severity,
                "count": 0,
                "text": text,
                "trade_ids": [],
                "lesson": LESSON_FOR[kind],
            },
        )
        f["count"] += len(trade_ids) or 1
        f["trade_ids"].extend(trade_ids)
        if severity == "high":
            f["severity"] = "high"

    per_day = Counter(_day(t["opened_ts"]) for t in entries)
    busy = {d: n for d, n in per_day.items() if n > max_trades_per_day}
    if busy:
        add(
            "overtrading",
            "warn",
            f"{len(busy)} дни с повече от {max_trades_per_day} сделки (макс. {max(busy.values())} за ден).",
            [t["position_id"] for t in entries if _day(t["opened_ts"]) in busy][:20],
        )

    risks = [t["meta"].get("risk_pct") for t in entries if t.get("meta") and t["meta"].get("risk_pct") is not None]
    med = median(risks) if risks else None
    over = [
        t
        for t in entries
        if (t.get("meta") or {}).get("risk_pct") is not None and t["meta"]["risk_pct"] > rules.max_risk_per_trade_pct
    ]
    if over:
        worst = max(t["meta"]["risk_pct"] for t in over)
        add(
            "oversizing",
            "high" if worst > rules.warn_risk_pct else "warn",
            f"{len(over)} сделки над правилото от {rules.max_risk_per_trade_pct:g}% (най-голям риск {worst:.1f}%).",
            [t["position_id"] for t in over],
        )

    prev_loss_close: dict | None = None
    by_close = sorted(trades, key=lambda t: t["closed_ts"])
    closes_iter = iter(by_close)
    nxt = next(closes_iter, None)
    for t in entries:
        while nxt is not None and nxt["closed_ts"] <= t["opened_ts"]:
            prev_loss_close = nxt if nxt["net_pnl"] < 0 else None
            nxt = next(closes_iter, None)
        if prev_loss_close and t["opened_ts"] - prev_loss_close["closed_ts"] <= 15 * 60:
            prev_risk = (prev_loss_close.get("meta") or {}).get("risk_pct") or 0
            cur_risk = (t.get("meta") or {}).get("risk_pct") or 0
            prev_notional = prev_loss_close["qty"] * prev_loss_close["entry_price"]
            cur_notional = t["qty"] * t["entry_price"]
            if cur_risk > prev_risk * 1.3 or cur_notional > prev_notional * 1.3:
                add(
                    "revenge_trading",
                    "high",
                    "Нова, по-голяма позиция до 15 минути след губеща сделка.",
                    [t["position_id"]],
                )

    # a stop widened before a LATER partial close is only recorded on that later slice → look at every part
    moved = [t for t in entries if any((p.get("meta") or {}).get("stop_widened") for p in parts[t["position_id"]])]
    if moved:
        add(
            "moving_stops",
            "high",
            f"{len(moved)} пъти стопът е преместен ПО-ДАЛЕЧ (рискът е увеличен след входа).",
            [t["position_id"] for t in moved],
        )

    chased = [t for t in entries if ((t.get("meta") or {}).get("entry_context") or {}).get("chasing")]
    if chased:
        add(
            "chasing",
            "warn",
            f"{len(chased)} входа, когато цената е била > 1.5 ATR от EMA 20 в посоката на сделката.",
            [t["position_id"] for t in chased],
        )

    no_stop = [t for t in entries if t.get("stop_price") is None]
    if no_stop:
        add("no_stop", "high", f"{len(no_stop)} сделки без stop loss при входа.", [t["position_id"] for t in no_stop])

    rs_win = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None and t["r_multiple"] > 0]
    rs_loss = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None and t["r_multiple"] <= 0]
    if len(rs_win) >= 3 and len(rs_loss) >= 3:
        avg_w = sum(rs_win) / len(rs_win)
        avg_l = abs(sum(rs_loss) / len(rs_loss))
        if avg_l > 1.2 and avg_l > avg_w:
            add(
                "cut_winners",
                "warn",
                f"Средната загуба е {avg_l:.1f}R, а средната печалба {avg_w:.1f}R — режеш печелившите и държиш губещите.",
                [],
            )

    ordered = sorted(findings.values(), key=lambda f: (f["severity"] != "high", -f["count"]))
    score = max(0, 100 - sum(25 if f["severity"] == "high" else 10 for f in ordered))
    by_day = defaultdict(int)
    for t in entries:
        by_day[_day(t["opened_ts"])] += 1
    return {
        "findings": ordered,
        "discipline_score": score,
        "median_risk_pct": med,
        "trades_per_day": dict(sorted(by_day.items())[-14:]),
        "most_common": ordered[0] if ordered else None,
    }
