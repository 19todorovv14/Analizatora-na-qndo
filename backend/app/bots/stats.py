"""Per-bar evaluation statistics of a paper bot (stored in bot.runtime["stats"] — bounded counters only).

For each entry block (LONG / SHORT) and each evaluated bar:
* a SETUP is generated when the block's trigger condition — its FIRST condition — passes (or the whole block
  passes, which matters for "any" logic);
* the setup either has ALL conditions met (the block passes) or is REJECTED; every failing condition of a
  rejected setup is counted in `rejected_by_condition` (keyed by the condition's readable label);
* a setup with all conditions met can still be blocked by a FILTER (regime, trading hours, max positions,
  daily loss limit, …) — counted in `rejected_by_filters`; otherwise it becomes an ENTRY (paper order).
"""

from __future__ import annotations

FILTER_KEYS = (
    "regime",
    "trading_hours",
    "max_positions",
    "daily_loss",
    "paused",
    "pending_order",
    "short_disabled",
    "conflict",
    "stop_unavailable",
    "position_size",
)
FILTER_LABELS = {
    "regime": "Regime filter",
    "trading_hours": "Trading hours",
    "max_positions": "Max positions",
    "daily_loss": "Daily loss limit",
    "paused": "Ботът е на пауза",
    "pending_order": "Чакаща поръчка",
    "short_disabled": "SHORT е изключен",
    "conflict": "LONG и SHORT едновременно",
    "stop_unavailable": "Няма stop distance (ATR)",
    "position_size": "Количество под минималното",
}
MAX_CONDITION_LABELS = 48  # bounded dict even for the largest allowed strategy (4 blocks × 12 conditions)
SIDES = (("long", "entry_long"), ("short", "entry_short"))


def empty_stats() -> dict:
    return {
        "version": 1,
        "bars_evaluated": 0,
        "setups_generated": 0,
        "all_conditions_met": 0,
        "rejected": 0,
        "entries": 0,
        "rejected_by_condition": {},
        "rejected_by_filters": dict.fromkeys(FILTER_KEYS, 0),
        "by_side": {side: {"setups": 0, "all_met": 0, "rejected": 0, "entries": 0} for side, _ in SIDES},
        "first_ts": None,
        "last_ts": None,
    }


def normalise(stats: dict | None) -> dict:
    """A complete stats dict (fills keys missing in older / partial runtime data)."""
    base = empty_stats()
    if not stats:
        return base
    out = {**base, **{k: v for k, v in stats.items() if k in base}}
    out["rejected_by_filters"] = {**base["rejected_by_filters"], **(stats.get("rejected_by_filters") or {})}
    out["rejected_by_condition"] = dict(stats.get("rejected_by_condition") or {})
    out["by_side"] = {
        side: {**base["by_side"][side], **((stats.get("by_side") or {}).get(side) or {})} for side, _ in SIDES
    }
    return out


def record_bar(stats: dict, ev: dict, ts: int) -> dict[str, bool]:
    """Count setups / all-met / rejected for one evaluated bar. Returns {side: all_conditions_met}."""
    stats["bars_evaluated"] += 1
    stats["first_ts"] = stats["first_ts"] or ts
    stats["last_ts"] = ts
    both = all(ev.get(key, {}).get("active") for _, key in SIDES)
    met: dict[str, bool] = {}
    for side, key in SIDES:
        block = ev.get(key) or {}
        if not block.get("active"):
            continue
        conds = block.get("conditions") or []
        trigger = bool(conds) and bool(conds[0]["passed"])
        if not (trigger or block.get("passed")):
            continue
        stats["setups_generated"] += 1
        stats["by_side"][side]["setups"] += 1
        if block.get("passed"):
            stats["all_conditions_met"] += 1
            stats["by_side"][side]["all_met"] += 1
            met[side] = True
            continue
        stats["rejected"] += 1
        stats["by_side"][side]["rejected"] += 1
        met[side] = False
        by_cond = stats["rejected_by_condition"]
        for c in conds:
            if c["passed"]:
                continue
            label = f"{side.upper()}: {c['label']}" if both else c["label"]
            if label in by_cond or len(by_cond) < MAX_CONDITION_LABELS:
                by_cond[label] = by_cond.get(label, 0) + 1
    return met


def record_filter(stats: dict, key: str) -> None:
    filters = stats["rejected_by_filters"]
    filters[key] = filters.get(key, 0) + 1


def record_entry(stats: dict, side: str) -> None:
    stats["entries"] += 1
    stats["by_side"][side]["entries"] += 1


def top_blockers(stats: dict, limit: int = 5) -> list[dict]:
    """Most frequent reasons a setup did not become a trade: failing conditions and filters, by count."""
    items = [{"label": k, "count": v, "kind": "condition"} for k, v in stats["rejected_by_condition"].items() if v]
    items += [
        {"label": FILTER_LABELS.get(k, k), "count": v, "kind": "filter", "key": k}
        for k, v in stats["rejected_by_filters"].items()
        if v
    ]
    items.sort(key=lambda x: (-x["count"], x["label"]))
    return items[:limit]


def headline(stats: dict) -> str:
    return (
        f"{stats['setups_generated']} setups → {stats['all_conditions_met']} с изпълнени условия → "
        f"{stats['entries']} сделки"
    )
