"""Trading-journal statistics."""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import mean


def journal_stats(entries: list[dict], trades: list[dict], behavior: dict | None = None) -> dict:
    """`entries`: journal rows as dicts; `trades`: closed paper trades as dicts."""
    by_trade = {e["trade_id"]: e for e in entries if e.get("trade_id")}

    def setup_of(t: dict) -> str:
        e = by_trade.get(t["id"]) or by_trade.get(t["position_id"])
        return (e and e.get("setup")) or (t.get("meta") or {}).get("setup") or "unlabelled"

    def tf_of(t: dict) -> str:
        e = by_trade.get(t["id"]) or by_trade.get(t["position_id"])
        return (e and e.get("timeframe")) or (t.get("meta") or {}).get("timeframe") or "unknown"

    def group(key_fn) -> list[dict]:
        g: dict[str, list[dict]] = defaultdict(list)
        for t in trades:
            g[key_fn(t)].append(t)
        rows = []
        for k, ts in g.items():
            rs = [x["r_multiple"] for x in ts if x.get("r_multiple") is not None]
            rows.append(
                {
                    "key": k,
                    "trades": len(ts),
                    "net_pnl": sum(x["net_pnl"] for x in ts),
                    "win_rate": sum(1 for x in ts if x["net_pnl"] > 0) / len(ts) * 100,
                    "average_r": mean(rs) if rs else None,
                }
            )
        return sorted(rows, key=lambda r: r["net_pnl"], reverse=True)

    setups = group(setup_of)
    tfs = group(tf_of)
    mistakes = Counter(m for e in entries for m in (e.get("mistakes") or []))
    for f in (behavior or {}).get("findings", []):
        mistakes[f["title"]] += f["count"]
    emotions = Counter(e["emotion"] for e in entries if e.get("emotion"))
    holds = [t["closed_ts"] - t["opened_ts"] for t in trades]
    risks = [(t.get("meta") or {}).get("risk_pct") for t in trades]
    risks = [r for r in risks if r is not None]
    rs = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None]

    conf: dict[int, list[float]] = defaultdict(list)
    for e in entries:
        if e.get("confidence") and e.get("r_multiple") is not None:
            conf[int(e["confidence"])].append(e["r_multiple"])
    return {
        "entries": len(entries),
        "trades": len(trades),
        "most_profitable_setup": setups[0] if setups else None,
        "worst_setup": setups[-1] if len(setups) > 1 else None,
        "setups": setups,
        "most_common_mistake": (
            {"mistake": mistakes.most_common(1)[0][0], "count": mistakes.most_common(1)[0][1]} if mistakes else None
        ),
        "mistakes": [{"mistake": k, "count": v} for k, v in mistakes.most_common(8)],
        "average_holding_seconds": mean(holds) if holds else None,
        "best_timeframe": tfs[0] if tfs else None,
        "worst_timeframe": tfs[-1] if len(tfs) > 1 else None,
        "timeframes": tfs,
        "average_risk_pct": mean(risks) if risks else None,
        "average_r": mean(rs) if rs else None,
        "emotions": dict(emotions.most_common()),
        "confidence_vs_r": {str(k): mean(v) for k, v in sorted(conf.items())},
    }
