"""AI COACH v2 — pattern detection on the user's own paper / replay history.

Every detector works on POSITIONS (the closed slices of one position are merged) and returns a finding only when
its threshold is met, always with the evidence counts behind it. Nothing here predicts prices: the findings
describe the user's PAST process (entries, stops, sizing, timing) so the coach can point to a lesson and an
exercise.

Detectors (key → what is measured):
  entered_early            entries before confirmation: the closed-candle analysis at entry said WAIT / NO TRADE,
                           the opposite setup, or the entry was against the current structure / trend regime
                           (trade meta `entry_context`), plus Replay flags and journal mistake chips
  moving_stops             the stop was moved further away after entry (sl_history widened → meta.stop_widened)
  timeframe_performance    average R per timeframe, at least MIN_TF_TRADES positions in each compared timeframe
  volatility               average loss size per ATR% tercile (largest losses when volatility is high)
  overtrading_after_losses quick re-entries (≤ 30 min) after a losing position vs after a winning one
  holding_losers           median holding time of losers vs winners
  no_stop                  positions without a stop loss at entry
  oversized_risk           risk % at entry above the user's max-risk rule
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import defaultdict
from statistics import mean, median

from app.academy import levels as lv
from app.academy.content import LESSONS_BY_SLUG
from app.risk.engine import RiskRules

# ------------------------------------------------------------------ thresholds
EARLY_MIN_KNOWN = 3  # paper positions with an entry context needed to judge entries
EARLY_MIN_COUNT = 2
EARLY_MIN_RATIO = 0.25
EARLY_HIGH_RATIO = 0.5
EARLY_REPLAY_MIN = 3  # Replay decisions flagged "Entered too early" / "Against structure"
EARLY_JOURNAL_MIN = 2  # journal entries tagged "entered before confirmation" / "traded against the trend"
MIN_TF_TRADES = 5  # positions (with a known R) per timeframe
TF_MIN_DIFF_R = 0.3
MIN_VOL_POSITIONS = 9  # ≥ 3 per tercile
VOL_LOSS_RATIO = 1.25
QUICK_REENTRY_SECONDS = 30 * 60
BURST_WINDOW_SECONDS = 2 * 3600
REENTRY_MIN_COUNT = 3
REENTRY_MIN_RATE = 0.4
REENTRY_RATE_GAP = 0.2
REENTRY_HIGH_RATE = 0.6
HOLD_MIN_GROUP = 3
HOLD_RATIO = 1.5
HOLD_MIN_DIFF_SECONDS = 300
MIN_PAIR_FOR_R = 2  # positions with a known R needed on each side of an R comparison
MAX_IDS = 20

SEVERITY_RANK = {"high": 0, "warn": 1, "info": 2}

CHECKS: dict[str, dict] = {
    "entered_early": {"title": "Вход преди потвърждение", "lesson": "market-structure"},
    "moving_stops": {"title": "Местене на стопа по-далеч", "lesson": "stop-loss-placement"},
    "timeframe_performance": {"title": "Резултати по timeframe", "lesson": "multi-timeframe-analysis"},
    "volatility": {"title": "Загуби при висока волатилност", "lesson": "volatility-and-sizing"},
    "overtrading_after_losses": {"title": "Нови сделки веднага след загуба", "lesson": "revenge-trading"},
    "holding_losers": {"title": "Държиш губещите по-дълго от печелившите", "lesson": "loss-aversion"},
    "no_stop": {"title": "Сделки без stop loss", "lesson": "stop-order"},
    "oversized_risk": {"title": "Риск над правилото", "lesson": "position-sizing"},
}
CHECK_ORDER = tuple(CHECKS)

EARLY_JOURNAL_CHIPS = frozenset({"entered before confirmation", "traded against the trend"})
EARLY_REPLAY_FLAGS = ("entered_too_early", "ignored_structure")


# ------------------------------------------------------------------ formatting helpers
def tf_label(tf: str | None) -> str:
    """'1h' → '1H', '4h' → '4H', '1d' → '1D', '15m' → '15m' (as the rest of the UI writes them)."""
    if not tf:
        return "?"
    return tf.upper() if tf[-1:] in ("h", "d", "w") else tf


def fmt_r(v: float) -> str:
    return f"{v:+.2f}R"


def fmt_money(v: float) -> str:
    return f"{v:+,.2f} USD"


def fmt_duration(seconds: float) -> str:
    s = int(round(seconds))
    if s < 60:
        return f"{s} сек"
    minutes = s // 60
    if minutes < 60:
        return f"{minutes} мин"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}ч {minutes:02d}мин" if minutes else f"{hours}ч"
    days, hours = divmod(hours, 24)
    return f"{days}д {hours}ч" if hours else f"{days}д"


def lesson_ref(slug: str | None) -> dict | None:
    """{slug, title, href} for an academy lesson, None for an unknown slug."""
    if not slug or slug not in LESSONS_BY_SLUG:
        return None
    return {"slug": slug, "title": LESSONS_BY_SLUG[slug]["title"], "href": lv.lesson_href(slug)}


# ------------------------------------------------------------------ positions
def _side(value: str | None) -> str:
    v = (value or "").lower()
    return {"buy": "long", "sell": "short"}.get(v, v or "long")


def _avg(values: list[float]) -> float | None:
    return mean(values) if values else None


def build_positions(trades: list[dict]) -> list[dict]:
    """Closed trade rows (paper_service.trade_to_dict) → one record per position, sorted by entry time.

    R of a position = Σ net / Σ risk when every slice has a risk amount, otherwise the qty-weighted R of the
    slices (same thing for a fixed stop), otherwise None (no stop)."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for i, t in enumerate(trades):
        pid = t.get("position_id") or t.get("id") or f"row-{i}"
        groups[str(pid)].append(t)
    out: list[dict] = []
    for pid, rows in groups.items():
        rows = sorted(rows, key=lambda r: (r.get("closed_ts") or 0))
        first = min(rows, key=lambda r: (r.get("opened_ts") or 0, r.get("closed_ts") or 0))
        meta = first.get("meta") or {}
        ctx = meta.get("entry_context") or {}
        net = sum(float(r.get("net_pnl") or 0.0) for r in rows)
        qty = sum(float(r.get("qty") or 0.0) for r in rows)
        risks = [r.get("risk_amount") for r in rows]
        r_value: float | None = None
        if risks and all(x is not None for x in risks) and sum(risks) > 0:
            r_value = net / sum(risks)
        elif all(r.get("r_multiple") is not None for r in rows):
            weights = [float(r.get("qty") or 0.0) for r in rows]
            if sum(weights) > 0:
                r_value = sum(r["r_multiple"] * w for r, w in zip(rows, weights, strict=True)) / sum(weights)
            elif len(rows) == 1:
                r_value = rows[0]["r_multiple"]
        exit_price = None
        if qty > 0 and all(r.get("exit_price") is not None for r in rows):
            exit_price = sum(r["exit_price"] * float(r.get("qty") or 0.0) for r in rows) / qty
        entry_price = first.get("entry_price")
        atr_pct = meta.get("atr_pct")
        if atr_pct is None and ctx.get("atr") and entry_price:
            atr_pct = float(ctx["atr"]) / float(entry_price) * 100
        opened = first.get("opened_ts")
        closed = max((r.get("closed_ts") or 0) for r in rows) or None
        out.append(
            {
                "position_id": pid,
                "symbol": first.get("symbol"),
                "side": _side(first.get("side")),
                "opened_ts": opened,
                "closed_ts": closed,
                "holding_seconds": (closed - opened) if (closed is not None and opened is not None) else None,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "qty": qty,
                "net_pnl": net,
                "fees": sum(float(r.get("fees") or 0.0) for r in rows),
                "risk_amount": sum(risks) if risks and all(x is not None for x in risks) else None,
                "r": r_value,
                "stop": first.get("stop_price"),
                "target": first.get("target_price"),
                "risk_pct": meta.get("risk_pct"),
                "planned_rr": meta.get("planned_rr"),
                "timeframe": meta.get("timeframe") or ctx.get("timeframe"),
                "setup": meta.get("setup"),
                "strategy": meta.get("strategy") or meta.get("strategy_name"),
                "source": meta.get("source"),
                "entry_context": ctx,
                "atr_pct": float(atr_pct) if atr_pct is not None else None,
                "stop_widened": any((r.get("meta") or {}).get("stop_widened") for r in rows),
                "sl_moves": max(int((r.get("meta") or {}).get("sl_moves") or 0) for r in rows),
                "exit_reason": rows[-1].get("exit_reason"),
                "slices": len(rows),
                "trade_ids": [r.get("id") for r in rows if r.get("id")],
            }
        )
    out.sort(key=lambda p: (p["opened_ts"] or 0, p["closed_ts"] or 0))
    return out


# ------------------------------------------------------------------ finding helpers
def _check(key: str, status: str, detail: str, finding: dict | None = None) -> dict:
    return {"key": key, "title": CHECKS[key]["title"], "status": status, "detail": detail, "finding": finding}


def _finding(
    key: str,
    title: str,
    evidence: str,
    impact: str,
    *,
    severity: str,
    count: int,
    sample: int,
    positions: list[dict] | None = None,
    data: dict | None = None,
) -> dict:
    return {
        "key": key,
        "title": title,
        "evidence": evidence,
        "impact": impact,
        "severity": severity,
        "count": count,
        "sample": sample,
        "lesson": lesson_ref(CHECKS[key]["lesson"]),
        "position_ids": [p["position_id"] for p in (positions or [])][:MAX_IDS],
        "data": data or {},
    }


def _r_values(positions: list[dict]) -> list[float]:
    return [p["r"] for p in positions if p["r"] is not None]


def _compare_r(a: list[dict], b: list[dict]) -> tuple[float, float, int, int] | None:
    ra, rb = _r_values(a), _r_values(b)
    if len(ra) < MIN_PAIR_FOR_R or len(rb) < MIN_PAIR_FOR_R:
        return None
    return mean(ra), mean(rb), len(ra), len(rb)


def _pct(num: int, den: int) -> float:
    return num / den * 100 if den else 0.0


# ------------------------------------------------------------------ detectors
def _early_reason(p: dict) -> str | None:
    ctx = p["entry_context"] or {}
    side = p["side"]
    decision = ctx.get("decision")
    if decision in ("WAIT", "NO TRADE"):
        return "unconfirmed"
    if decision in ("POSSIBLE LONG", "POSSIBLE SHORT") and (decision == "POSSIBLE LONG") != (side == "long"):
        return "against_setup"
    structure = ctx.get("structure")
    if isinstance(structure, dict):
        structure = structure.get("trend")
    if (structure == "bearish" and side == "long") or (structure == "bullish" and side == "short"):
        return "against_structure"
    regime = ctx.get("regime")
    if (regime == "TRENDING_DOWN" and side == "long") or (regime == "TRENDING_UP" and side == "short"):
        return "against_structure"
    return None


def _has_context(p: dict) -> bool:
    ctx = p["entry_context"] or {}
    return bool(ctx.get("decision") or ctx.get("regime") or ctx.get("structure"))


def detect_entered_early(
    positions: list[dict], *, replay_flags: dict[str, int] | None = None, journal_mistakes: list[str] | None = None
) -> dict:
    key = "entered_early"
    known = [p for p in positions if _has_context(p)]
    early = [p for p in known if _early_reason(p)]
    reasons = defaultdict(int)
    for p in early:
        reasons[_early_reason(p)] += 1
    replay = sum(int((replay_flags or {}).get(k, 0)) for k in EARLY_REPLAY_FLAGS)
    journal = sum(1 for m in journal_mistakes or [] if str(m).strip().lower() in EARLY_JOURNAL_CHIPS)
    if len(known) < EARLY_MIN_KNOWN and not replay and not journal:
        return _check(
            key,
            "insufficient_data",
            f"Нужни са поне {EARLY_MIN_KNOWN} paper сделки с пазарен контекст при входа (имаш {len(known)}) "
            "или Replay решения.",
        )
    ratio = len(early) / len(known) if known else 0.0
    paper_hit = len(known) >= EARLY_MIN_KNOWN and len(early) >= EARLY_MIN_COUNT and ratio >= EARLY_MIN_RATIO
    if not (paper_hit or replay >= EARLY_REPLAY_MIN or journal >= EARLY_JOURNAL_MIN):
        return _check(
            key,
            "ok",
            f"{len(early)} от {len(known)} входа преди потвърждение — под прага "
            f"({EARLY_MIN_COUNT}+ и {EARLY_MIN_RATIO * 100:.0f}%+).",
        )
    parts: list[str] = []
    if early:
        detail = []
        if reasons["unconfirmed"]:
            detail.append(f"{reasons['unconfirmed']} при WAIT/NO TRADE на затворените свещи")
        if reasons["against_setup"]:
            detail.append(f"{reasons['against_setup']} срещу анализирания setup")
        if reasons["against_structure"]:
            detail.append(f"{reasons['against_structure']} срещу текущата структура/тренд")
        parts.append(
            f"{len(early)} от {len(known)} paper входа ({ratio * 100:.0f}%) са преди потвърждение: {', '.join(detail)}."
        )
    if replay:
        parts.append(f"В Replay: {replay} решения с флаг „Entered too early“ / „Against structure“.")
    if journal:
        parts.append(f"В журнала: {journal} записа „entered before confirmation“ / „traded against the trend“.")
    confirmed = [p for p in known if not _early_reason(p)]
    cmp = _compare_r(early, confirmed)
    if cmp:
        impact = (
            f"Средно {fmt_r(cmp[0])} при входовете преди потвърждение ({cmp[2]}) срещу {fmt_r(cmp[1])} "
            f"при потвърдените ({cmp[3]})."
        )
    else:
        impact = (
            "Входът преди затварянето на сигналната свещ означава, че търгуваш setup, който още не съществува — "
            "invalidation-ът е неясен и стопът се удря по-често."
        )
    severity = "high" if (paper_hit and ratio >= EARLY_HIGH_RATIO) else "warn"
    finding = _finding(
        key,
        "Влизаш преди потвърждение",
        " ".join(parts),
        impact,
        severity=severity,
        count=len(early) + replay + journal,
        sample=len(known),
        positions=early,
        data={
            "paper": len(early),
            "known": len(known),
            "ratio_pct": round(ratio * 100, 1),
            "reasons": dict(reasons),
            "replay_flags": replay,
            "journal_entries": journal,
        },
    )
    return _check(key, "found", finding["evidence"], finding)


def detect_moving_stops(positions: list[dict]) -> dict:
    key = "moving_stops"
    with_stop = [p for p in positions if p["stop"] is not None]
    if not with_stop:
        return _check(key, "insufficient_data", "Още няма сделки със stop loss.")
    widened = [p for p in with_stop if p["stop_widened"]]
    if not widened:
        return _check(key, "ok", f"Стопът не е местен по-далеч в нито една от {len(with_stop)} сделки със стоп.")
    losers = [p for p in widened if p["net_pnl"] < 0]
    # "after losses": the position closed last before this one was opened was a loss
    by_close = sorted((p for p in positions if p["closed_ts"] is not None), key=lambda p: p["closed_ts"])
    close_ts = [p["closed_ts"] for p in by_close]
    after_loss = 0
    for p in widened:
        if p["opened_ts"] is None:
            continue
        i = bisect_right(close_ts, p["opened_ts"]) - 1
        if i >= 0 and by_close[i] is not p and by_close[i]["net_pnl"] < 0:
            after_loss += 1
    evidence = (
        f"{len(widened)} от {len(with_stop)} сделки със стоп: стопът е преместен по-далеч след входа; "
        f"{len(losers)} от тях завършиха на загуба."
    )
    if after_loss:
        evidence += f" {after_loss} са отворени веднага след губеща сделка."
    loser_r = _r_values(losers)
    if loser_r:
        impact = (
            f"Средната загуба при тях е {fmt_r(mean(loser_r))} — планираният риск е 1R; преместеният стоп го увеличава."
        )
    else:
        impact = "Рискът расте по време на сделката — загубата вече не е планираният 1R, а неизвестна величина."
    finding = _finding(
        key,
        "Местиш стопа по-далеч",
        evidence,
        impact,
        severity="high",
        count=len(widened),
        sample=len(with_stop),
        positions=widened,
        data={"widened": len(widened), "with_stop": len(with_stop), "losers": len(losers), "after_loss": after_loss},
    )
    return _check(key, "found", evidence, finding)


def _group_stats(rows: list[dict]) -> dict:
    rs = _r_values(rows)
    wins = sum(1 for p in rows if p["net_pnl"] > 0)
    return {
        "trades": len(rows),
        "with_r": len(rs),
        "average_r": round(mean(rs), 3) if rs else None,
        "win_rate": round(wins / len(rows) * 100, 1) if rows else None,
        "net_pnl": round(sum(p["net_pnl"] for p in rows), 2),
    }


def detect_timeframe(positions: list[dict]) -> dict:
    key = "timeframe_performance"
    groups: dict[str, list[dict]] = defaultdict(list)
    for p in positions:
        if p["timeframe"] and p["r"] is not None:
            groups[p["timeframe"]].append(p)
    stats = {tf: _group_stats(rows) for tf, rows in groups.items()}
    eligible = {tf: s for tf, s in stats.items() if s["with_r"] >= MIN_TF_TRADES}
    have = ", ".join(f"{tf_label(tf)} × {s['with_r']}" for tf, s in sorted(stats.items(), key=lambda x: -x[1]["with_r"]))
    if len(eligible) < 2:
        return _check(
            key,
            "insufficient_data",
            f"Нужни са поне {MIN_TF_TRADES} сделки (с известен R) на поне 2 timeframe-а"
            + (f" (имаш: {have})." if have else "."),
        )
    best = max(eligible, key=lambda tf: (eligible[tf]["average_r"], eligible[tf]["with_r"]))
    worst = min(eligible, key=lambda tf: (eligible[tf]["average_r"], -eligible[tf]["with_r"]))
    diff = eligible[best]["average_r"] - eligible[worst]["average_r"]
    if diff < TF_MIN_DIFF_R:
        return _check(key, "ok", f"Резултатите по timeframe са близки (разлика {diff:.2f}R).")
    b, w = eligible[best], eligible[worst]
    evidence = (
        f"{tf_label(best)}: {b['with_r']} сделки, средно {fmt_r(b['average_r'])}, win rate {b['win_rate']:.0f}% · "
        f"{tf_label(worst)}: {w['with_r']} сделки, средно {fmt_r(w['average_r'])}, win rate {w['win_rate']:.0f}%."
    )
    impact = f"Разлика {diff:.2f}R на сделка."
    if min(b["with_r"], w["with_r"]) < 30:
        impact += " Извадката е малка (< 30 сделки на timeframe) — това е хипотеза за проверка, не правило."
    finding = _finding(
        key,
        f"По-добре се представяш на {tf_label(best)}, отколкото на {tf_label(worst)}",
        evidence,
        impact,
        severity="warn" if w["average_r"] < 0 else "info",
        count=b["with_r"] + w["with_r"],
        sample=sum(s["with_r"] for s in stats.values()),
        positions=groups[worst],
        data={
            "best": {"timeframe": best, "label": tf_label(best), **b},
            "worst": {"timeframe": worst, "label": tf_label(worst), **w},
            "diff_r": round(diff, 3),
            "groups": [
                {"timeframe": tf, "label": tf_label(tf), **s}
                for tf, s in sorted(stats.items(), key=lambda x: -x[1]["with_r"])
            ],
        },
    )
    return _check(key, "found", evidence, finding)


def _loss_size(rows: list[dict], use_r: bool) -> float | None:
    losers = [p for p in rows if p["net_pnl"] < 0]
    if use_r:
        vals = [abs(p["r"]) for p in losers if p["r"] is not None]
    else:
        vals = [abs(p["net_pnl"]) for p in losers]
    return mean(vals) if vals else None


def detect_volatility(positions: list[dict]) -> dict:
    key = "volatility"
    known = sorted((p for p in positions if p["atr_pct"] is not None), key=lambda p: p["atr_pct"])
    if len(known) < MIN_VOL_POSITIONS:
        return _check(
            key,
            "insufficient_data",
            f"Нужни са поне {MIN_VOL_POSITIONS} сделки с известна волатилност (ATR%) при входа (имаш {len(known)}).",
        )
    third = len(known) // 3
    low, high = known[:third], known[-third:]
    low_losses = [p for p in low if p["net_pnl"] < 0]
    high_losses = [p for p in high if p["net_pnl"] < 0]
    use_r = (
        sum(1 for p in high_losses if p["r"] is not None) >= MIN_PAIR_FOR_R
        and sum(1 for p in low_losses if p["r"] is not None) >= 1
    )
    high_size, low_size = _loss_size(high, use_r), _loss_size(low, use_r)
    all_losses = sorted((p for p in known if p["net_pnl"] < 0), key=lambda p: p["net_pnl"])
    top3 = all_losses[:3]
    high_ids = {p["position_id"] for p in high}
    top_in_high = sum(1 for p in top3 if p["position_id"] in high_ids)
    bigger = high_size is not None and (low_size is None or high_size >= low_size * VOL_LOSS_RATIO)
    if len(high_losses) < 2 or not (bigger or (len(top3) == 3 and top_in_high >= 2)):
        return _check(key, "ok", "Загубите не са концентрирани във високата волатилност.")
    lo_edge, hi_edge = low[-1]["atr_pct"], high[0]["atr_pct"]

    def size(v: float | None) -> str:
        if v is None:
            return "няма загуби"
        return f"−{v:.2f}R" if use_r else f"−{v:,.2f} USD"

    evidence = (
        f"Висока волатилност (ATR% ≥ {hi_edge:.2f}%): средна загуба {size(high_size)} ({len(high_losses)} загуби) · "
        f"ниска (ATR% ≤ {lo_edge:.2f}%): {size(low_size)} ({len(low_losses)} загуби)."
    )
    if len(top3) == 3:
        evidence += f" {top_in_high} от 3-те ти най-големи загуби са при висока волатилност."
    impact = (
        "При висок ATR една свещ може да покрие целия стоп — нужни са по-широк стоп и по-малък размер, "
        "така че рискът в пари да остане същият."
    )
    finding = _finding(
        key,
        "Най-големите загуби идват при висока волатилност",
        evidence,
        impact,
        severity="warn",
        count=len(high_losses),
        sample=len(known),
        positions=high_losses,
        data={
            "basis": "r" if use_r else "usd",
            "low": {"max_atr_pct": round(lo_edge, 4), "positions": len(low), "losses": len(low_losses),
                    "avg_loss": round(low_size, 4) if low_size is not None else None},
            "high": {"min_atr_pct": round(hi_edge, 4), "positions": len(high), "losses": len(high_losses),
                     "avg_loss": round(high_size, 4) if high_size is not None else None},
            "top3_in_high": top_in_high,
        },
    )
    return _check(key, "found", evidence, finding)


def detect_overtrading_after_losses(positions: list[dict]) -> dict:
    key = "overtrading_after_losses"
    timed = [p for p in positions if p["opened_ts"] is not None and p["closed_ts"] is not None]
    by_open = sorted(timed, key=lambda p: p["opened_ts"])
    opens = [p["opened_ts"] for p in by_open]
    after: dict[str, list[tuple[dict, int, int, dict]]] = {"loss": [], "win": []}
    for p in timed:
        i = bisect_left(opens, p["closed_ts"])
        while i < len(by_open) and by_open[i] is p:  # an instantly closed position is not its own successor
            i += 1
        if i >= len(by_open):
            continue
        nxt = by_open[i]
        gap = nxt["opened_ts"] - p["closed_ts"]
        burst = bisect_left(opens, p["closed_ts"] + BURST_WINDOW_SECONDS) - i
        after["loss" if p["net_pnl"] < 0 else "win"].append((p, gap, burst, nxt))
    losses, wins = after["loss"], after["win"]
    if len(losses) < REENTRY_MIN_COUNT:
        return _check(
            key,
            "insufficient_data",
            f"Нужни са поне {REENTRY_MIN_COUNT} губещи сделки, последвани от нова сделка (имаш {len(losses)}).",
        )
    quick_loss = [(p, nxt) for p, g, _, nxt in losses if g <= QUICK_REENTRY_SECONDS]
    quick_win = [(p, nxt) for p, g, _, nxt in wins if g <= QUICK_REENTRY_SECONDS]
    rate_loss = len(quick_loss) / len(losses)
    rate_win = len(quick_win) / len(wins) if wins else 0.0
    hit = len(quick_loss) >= REENTRY_MIN_COUNT and rate_loss >= REENTRY_MIN_RATE and (
        not wins or rate_loss - rate_win >= REENTRY_RATE_GAP
    )
    if not hit:
        return _check(
            key,
            "ok",
            f"Нова сделка до 30 мин след загуба: {len(quick_loss)} от {len(losses)} ({rate_loss * 100:.0f}%) — под прага.",
        )
    burst_loss = mean(b for _, _, b, _ in losses)
    burst_win = mean(b for _, _, b, _ in wins) if wins else None
    evidence = (
        f"След {len(quick_loss)} от {len(losses)} губещи сделки ({rate_loss * 100:.0f}%) си отворил нова сделка "
        f"до 30 мин"
        + (f"; след печеливши — {rate_win * 100:.0f}% ({len(quick_win)} от {len(wins)})." if wins else ".")
        + f" Средно {burst_loss:.1f} нови сделки в следващите 2 часа след загуба"
        + (f" срещу {burst_win:.1f} след печалба." if burst_win is not None else ".")
    )
    # results of the re-entries themselves (the position opened right after the loss)
    quick_ids = {nxt["position_id"] for _, nxt in quick_loss}
    reentries = [p for p in timed if p["position_id"] in quick_ids]
    others = [p for p in timed if p["position_id"] not in quick_ids]
    cmp = _compare_r(reentries, others)
    if cmp:
        impact = (
            f"Сделките, отворени до 30 мин след загуба: средно {fmt_r(cmp[0])} ({cmp[2]}); "
            f"останалите: {fmt_r(cmp[1])} ({cmp[3]})."
        )
    else:
        impact = "Бързото връщане след загуба обикновено е емоция, не setup — пауза и запис в журнала прекъсват серията."
    finding = _finding(
        key,
        "Отваряш нови сделки веднага след загуба",
        evidence,
        impact,
        severity="high" if rate_loss >= REENTRY_HIGH_RATE else "warn",
        count=len(quick_loss),
        sample=len(losses),
        positions=reentries,
        data={
            "quick_after_loss": len(quick_loss),
            "losses_followed": len(losses),
            "rate_after_loss_pct": round(rate_loss * 100, 1),
            "quick_after_win": len(quick_win),
            "wins_followed": len(wins),
            "rate_after_win_pct": round(rate_win * 100, 1) if wins else None,
            "avg_trades_2h_after_loss": round(burst_loss, 2),
            "avg_trades_2h_after_win": round(burst_win, 2) if burst_win is not None else None,
            "window_minutes": QUICK_REENTRY_SECONDS // 60,
        },
    )
    return _check(key, "found", evidence, finding)


def detect_holding_losers(positions: list[dict]) -> dict:
    key = "holding_losers"
    timed = [p for p in positions if p["holding_seconds"] is not None]
    winners = [p for p in timed if p["net_pnl"] > 0]
    losers = [p for p in timed if p["net_pnl"] < 0]
    if len(winners) < HOLD_MIN_GROUP or len(losers) < HOLD_MIN_GROUP:
        return _check(
            key,
            "insufficient_data",
            f"Нужни са поне {HOLD_MIN_GROUP} печеливши и {HOLD_MIN_GROUP} губещи сделки "
            f"(имаш {len(winners)} / {len(losers)}).",
        )
    med_w = median(p["holding_seconds"] for p in winners)
    med_l = median(p["holding_seconds"] for p in losers)
    if not (med_l >= med_w * HOLD_RATIO and med_l - med_w >= HOLD_MIN_DIFF_SECONDS):
        return _check(
            key,
            "ok",
            f"Медиана: губещи {fmt_duration(med_l)}, печеливши {fmt_duration(med_w)} — без съществена разлика.",
        )
    evidence = (
        f"Губещите сделки държиш медиана {fmt_duration(med_l)} ({len(losers)}), "
        f"а печелившите — {fmt_duration(med_w)} ({len(winners)})."
    )
    rw, rl = _r_values(winners), _r_values(losers)
    if rw and rl:
        impact = f"Средна печалба {fmt_r(mean(rw))} срещу средна загуба {fmt_r(mean(rl))}."
    else:
        impact = "Надеждата, че губещата сделка „ще се върне“, удължава загубите; печелившите се затварят твърде рано."
    finding = _finding(
        key,
        "Държиш губещите по-дълго от печелившите",
        evidence,
        impact,
        severity="warn",
        count=len(losers),
        sample=len(timed),
        positions=sorted(losers, key=lambda p: -(p["holding_seconds"] or 0)),
        data={
            "median_loser_seconds": int(med_l),
            "median_winner_seconds": int(med_w),
            "losers": len(losers),
            "winners": len(winners),
            "ratio": round(med_l / med_w, 2) if med_w else None,
        },
    )
    return _check(key, "found", evidence, finding)


def detect_no_stop(positions: list[dict]) -> dict:
    key = "no_stop"
    if not positions:
        return _check(key, "insufficient_data", "Още няма затворени сделки.")
    no_stop = [p for p in positions if p["stop"] is None]
    if not no_stop:
        return _check(key, "ok", f"Всички {len(positions)} сделки са имали stop loss при входа.")
    total = sum(p["net_pnl"] for p in no_stop)
    worst = min(p["net_pnl"] for p in no_stop)
    evidence = (
        f"{len(no_stop)} от {len(positions)} сделки ({_pct(len(no_stop), len(positions)):.0f}%) без stop loss при входа."
    )
    if worst < 0:
        impact = (
            f"Резултат на тези сделки: {fmt_money(total)}; най-голямата загуба: {worst:,.2f} USD — "
            "без стоп загубата няма граница."
        )
    else:
        impact = "Дори да са на печалба, без стоп рискът е бил неограничен — един gap стига за голяма загуба."
    finding = _finding(
        key,
        "Сделки без stop loss",
        evidence,
        impact,
        severity="high",
        count=len(no_stop),
        sample=len(positions),
        positions=no_stop,
        data={"without_stop": len(no_stop), "positions": len(positions), "net_pnl": round(total, 2),
              "worst_pnl": round(worst, 2)},
    )
    return _check(key, "found", evidence, finding)


def detect_oversized(positions: list[dict], rules: RiskRules) -> dict:
    key = "oversized_risk"
    known = [p for p in positions if p["risk_pct"] is not None]
    if not known:
        return _check(key, "insufficient_data", "Няма сделки със записан риск % при входа.")
    rule = rules.max_risk_per_trade_pct
    over = [p for p in known if p["risk_pct"] > rule + 1e-9]
    if not over:
        return _check(key, "ok", f"Всички {len(known)} сделки са в правилото до {rule:g}% риск.")
    worst = max(p["risk_pct"] for p in over)
    med = median(p["risk_pct"] for p in over)
    evidence = (
        f"{len(over)} от {len(known)} сделки с риск над правилото {rule:g}% "
        f"(най-голям {worst:.2f}%, медиана {med:.2f}%)."
    )
    total_loss = sum(p["net_pnl"] for p in positions if p["net_pnl"] < 0)
    over_loss = sum(p["net_pnl"] for p in over if p["net_pnl"] < 0)
    if total_loss < 0 and over_loss < 0:
        impact = (
            f"Те носят {over_loss / total_loss * 100:.0f}% от общата загуба ({over_loss:,.2f} от {total_loss:,.2f} USD)."
        )
    else:
        impact = f"Пет поредни загуби с такъв размер = {5 * worst:.1f}% от сметката."
    finding = _finding(
        key,
        "Рискуваш повече от правилото си",
        evidence,
        impact,
        severity="high" if worst > rules.warn_risk_pct else "warn",
        count=len(over),
        sample=len(known),
        positions=sorted(over, key=lambda p: -p["risk_pct"]),
        data={"over": len(over), "known": len(known), "rule_pct": rule, "max_risk_pct": round(worst, 3),
              "median_risk_pct": round(med, 3), "loss_share_pct": round(over_loss / total_loss * 100, 1)
              if total_loss < 0 else None},
    )
    return _check(key, "found", evidence, finding)


# ------------------------------------------------------------------ entry point
def sample_note(n: int) -> str:
    if n == 0:
        return "Още няма затворени paper сделки — моделите се търсят в твоята история от сделки."
    if n < 10:
        return f"Малка извадка ({n} сделки) — третирай находките като сигнал за наблюдение, не като присъда."
    if n < 30:
        return f"Ограничена извадка ({n} сделки) — моделите са индикация; потвърди ги с още сделки."
    return f"{n} сделки — достатъчно за ориентировъчни изводи; миналите резултати не предсказват бъдещите."


def detect_patterns(
    trades: list[dict],
    rules: RiskRules | None = None,
    *,
    replay_flags: dict[str, int] | None = None,
    journal_mistakes: list[str] | None = None,
) -> dict:
    """{findings (sorted: severity, then count), checks (every detector with status found|ok|insufficient_data),
    sample {positions, with_r, note}}."""
    rules = rules or RiskRules()
    positions = build_positions(trades)
    checks = [
        detect_entered_early(positions, replay_flags=replay_flags, journal_mistakes=journal_mistakes),
        detect_moving_stops(positions),
        detect_timeframe(positions),
        detect_volatility(positions),
        detect_overtrading_after_losses(positions),
        detect_holding_losers(positions),
        detect_no_stop(positions),
        detect_oversized(positions, rules),
    ]
    findings = [c["finding"] for c in checks if c["finding"]]
    findings.sort(key=lambda f: (SEVERITY_RANK.get(f["severity"], 3), -f["count"], CHECK_ORDER.index(f["key"])))
    return {
        "findings": findings,
        "checks": [{k: v for k, v in c.items() if k != "finding"} for c in checks],
        "sample": {
            "positions": len(positions),
            "with_r": len(_r_values(positions)),
            "note": sample_note(len(positions)),
        },
    }
