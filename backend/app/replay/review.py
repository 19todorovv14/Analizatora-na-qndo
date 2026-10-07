"""AI HISTORY REVIEW of a finished replay session.

Offline and deterministic: every number comes from the candles of the replayed window, the user's decisions
(resolved by app.replay.outcomes, scored by app.replay.scoring) and the backtest of a rule-based strategy over the
SAME window (app.replay.comparison). The review describes the PAST — the period is over and fully revealed — so it
never forecasts what price will do next.

An optional LLM (AI_PROVIDER=anthropic) may only re-word the six teacher sections. Its answer goes through the
numeric grounding check of app.ai.modes (every price/decimal must exist in the engine data) and the safety filter;
any error, refusal or ungrounded section falls back to the offline text.
"""

from __future__ import annotations

import json
import logging
import time
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime

from app.academy.content import LESSONS_BY_SLUG
from app.academy.levels import lesson_href
from app.ai.providers import get_llm
from app.ai.safety import SAFETY_NOTE, STANDARD_DISCLAIMER, sanitize_lines
from app.analysis.regime import RegimeInputs, classify_at
from app.analysis.structure import find_swings, structure_trend
from app.market.base import Candle
from app.replay.comparison import SENTENCE, SETUP_DISCLAIMER
from app.replay.outcomes import PREDICTION_HORIZON, WAIT_HORIZON, WAIT_MOVE_ATR
from app.replay.presets import PRESETS
from app.replay.scoring import CHASE_EMA_ATR, FLAGS, NOISE_STOP_ATR, RR_BAD, RR_GOOD, STRUCTURE_ATR, grade

log = logging.getLogger(__name__)

SECTIONS: tuple[tuple[str, str], ...] = (
    ("observation", "OBSERVATION"),
    ("rules", "RULES"),
    ("scenario", "SCENARIO"),
    ("invalidation", "INVALIDATION"),
    ("risk", "RISK"),
    ("alternative", "ALTERNATIVE SCENARIO"),
)
SECTION_KEYS = tuple(k for k, _ in SECTIONS)
DISCLAIMER = f"{SETUP_DISCLAIMER} {STANDARD_DISCLAIMER}"
MAX_LESSONS = 5
MIN_SEGMENT_BARS = 5
KEY_SWINGS = 6
MAX_LINES = 8
LLM_MAX_TOKENS = 1800
REVIEW_VERSION = 1

# lessons for outcomes that have no entry flag (a stop can be hit even when every rule was respected)
STOPPED_LESSON = "stop-loss-placement"
DEFAULT_LESSON = "review-and-improve"

ACTION_LABEL = {"long": "LONG", "short": "SHORT", "wait": "WAIT"}


# ------------------------------------------------------------------------------------------------ helpers
def _fmt(v: float | None, precision: int) -> str:
    return "—" if v is None else f"{v:,.{precision}f}"


def _when(ts: int | None, timeframe: str) -> str:
    if ts is None:
        return "—"
    dt = datetime.fromtimestamp(ts, UTC)
    return dt.strftime("%Y-%m-%d") if timeframe in ("1d", "1w") else dt.strftime("%Y-%m-%d %H:%M UTC")


def _pct(a: float, b: float) -> float | None:
    return (b / a - 1) * 100 if a else None


def _r(v: float | None, nd: int = 2) -> float | None:
    return None if v is None else round(v, nd)


def lesson_ref(slug: str, reason: str, **extra) -> dict | None:
    lesson = LESSONS_BY_SLUG.get(slug)
    if lesson is None:
        return None
    return {"slug": slug, "title": lesson["title"], "reason": reason, "href": lesson_href(slug), **extra}


def _segments(regs: Sequence[str], rows: Sequence[Candle]) -> list[dict]:
    """Consecutive regime runs; runs shorter than MIN_SEGMENT_BARS are absorbed into a neighbour."""
    runs: list[list] = []
    for i, r in enumerate(regs):
        if runs and runs[-1][0] == r:
            runs[-1][2] = i
        else:
            runs.append([r, i, i])
    merged: list[list] = []
    for r in runs:
        if merged and (r[2] - r[1] + 1 < MIN_SEGMENT_BARS or merged[-1][0] == r[0]):
            merged[-1][2] = r[2]
        else:
            merged.append(list(r))
    if len(merged) > 1 and merged[0][2] - merged[0][1] + 1 < MIN_SEGMENT_BARS:
        merged[1][1] = merged[0][1]
        merged.pop(0)
    out: list[list] = []
    for r in merged:  # absorption can leave equal neighbours
        if out and out[-1][0] == r[0]:
            out[-1][2] = r[2]
        else:
            out.append(r)
    return [{"regime": r, "start_ts": rows[a].ts, "end_ts": rows[b].ts, "bars": b - a + 1} for r, a, b in out]


# ------------------------------------------------------------------------------------------------ what happened
def what_happened(
    history: Sequence[Candle],
    start_ts: int,
    cursor_ts: int,
    next_bars: Sequence[Candle],
    *,
    timeframe: str,
    precision: int = 2,
    setup: dict | None = None,
) -> dict:
    """Path summary of the replayed window. `history` = closed candles up to the cursor, warm-up first."""
    p = precision
    rows = [c for c in history if c.ts <= cursor_ts]
    w0 = next((i for i, c in enumerate(rows) if c.ts >= start_ts), None)
    if w0 is None:
        return {
            "available": False,
            "reason": "Няма свещи за избрания период — DATA NOT AVAILABLE.",
            "text": ["DATA NOT AVAILABLE — няма свещи за избрания период."],
        }
    win = rows[w0:]
    first, last = win[0], win[-1]
    start_price, end_price = first.close, last.close
    after = win[1:] or win
    hi_c = max(after, key=lambda c: c.high)
    lo_c = min(after, key=lambda c: c.low)
    x = RegimeInputs.from_candles(rows)
    atr0 = x.atr[w0]
    regs = [classify_at(x, i)["regime"] for i in range(w0, len(rows))]
    counts = Counter(regs)
    mix = [
        {"regime": r, "bars": n, "pct": round(n / len(regs) * 100, 1)}
        for r, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    segments = _segments(regs, win)
    all_swings = find_swings(rows)
    st = structure_trend(all_swings)
    key_swings = [s.to_dict() for s in all_swings if s.index >= w0][-KEY_SWINGS:]
    change_pct = _pct(start_price, end_price)
    up_pct = _pct(start_price, hi_c.high)
    down_pct = _pct(start_price, lo_c.low)
    out: dict = {
        "available": True,
        "start_ts": first.ts,
        "end_ts": last.ts,
        "bars": len(win),
        "revealed_bars": len(win) - 1,
        "start_price": start_price,
        "end_price": end_price,
        "change_pct": _r(change_pct),
        "change_atr": _r((end_price - start_price) / atr0) if atr0 else None,
        "high": {"price": hi_c.high, "time": hi_c.ts, "pct_from_start": _r(up_pct)},
        "low": {"price": lo_c.low, "time": lo_c.ts, "pct_from_start": _r(down_pct)},
        "max_up_pct": _r(up_pct),
        "max_down_pct": _r(down_pct),
        "max_up_atr": _r((hi_c.high - start_price) / atr0) if atr0 else None,
        "max_down_atr": _r((start_price - lo_c.low) / atr0) if atr0 else None,
        "atr_at_start": atr0,
        "regime_start": regs[0],
        "regime_end": regs[-1],
        "regimes": mix,
        "regime_segments": segments,
        "key_swings": key_swings,
        "structure_end": {"trend": st["trend"], "text": st["text"]},
        "next": None,
        "setup": None,
    }
    text = [
        f"{len(win)} свещи {timeframe.upper()} ({_when(first.ts, timeframe)} → {_when(last.ts, timeframe)}): цената "
        f"тръгна от {_fmt(start_price, p)} и завърши на {_fmt(end_price, p)} ({change_pct:+.2f}%).",
        f"Максимално нагоре: {_fmt(hi_c.high, p)} ({up_pct:+.2f}%); максимално надолу: {_fmt(lo_c.low, p)} "
        f"({down_pct:+.2f}%) спрямо началото.",
    ]
    top = mix[0]
    if regs[0] == regs[-1]:
        text.append(f"Режим: {regs[0]} в началото и в края; най-често {top['regime']} ({top['pct']:.0f}% от свещите).")
    else:
        text.append(
            f"Режим: {regs[0]} в началото, {regs[-1]} в края; най-често {top['regime']} ({top['pct']:.0f}% от свещите)."
        )
    labelled = [s for s in key_swings if s["label"]]
    if labelled:
        text.append(
            "Ключови swing точки: " + " · ".join(f"{s['label']} {_fmt(s['price'], p)}" for s in labelled[-4:]) + "."
        )
    text.append(f"Структура в края: {st['text']}")
    if next_bars:
        nb = list(next_bars)
        n_chg = _pct(end_price, nb[-1].close)
        n_hi = max(c.high for c in nb)
        n_lo = min(c.low for c in nb)
        out["next"] = {
            "bars": len(nb),
            "end_ts": nb[-1].ts,
            "end_price": nb[-1].close,
            "change_pct": _r(n_chg),
            "high": n_hi,
            "low": n_lo,
        }
        text.append(
            f"След края на сесията (следващите {len(nb)} свещи, вече минало): {n_chg:+.2f}%, "
            f"между {_fmt(n_lo, p)} и {_fmt(n_hi, p)}."
        )
    reveal = _setup_reveal(setup, timeframe, p)
    if reveal is not None:
        out["setup"] = reveal
        text.append(reveal["text"])
    out["text"] = text
    return out


def _setup_reveal(setup: dict | None, timeframe: str, p: int) -> dict | None:
    """What the preset actually picked — revealed only now that the period is over."""
    if not setup or not setup.get("preset"):
        return None
    key = setup["preset"]
    meta = PRESETS.get(key, {})
    info = setup.get("info") or {}
    label = meta.get("label", key)
    if key == "trend":
        word = "нагоре" if info.get("direction") == "up" else "надолу"
        reg = "TRENDING_UP" if info.get("direction") == "up" else "TRENDING_DOWN"
        frac = (info.get("trend_fraction") or 0) * 100
        text = f"Периодът „{label}“ беше тренд {word}: {reg} в {frac:.0f}% от първите {setup.get('focus_bars', 100)} свещи."
    elif key == "range":
        frac = (info.get("range_fraction") or 0) * 100
        text = (
            f"Периодът „{label}“ беше диапазон: малко нетно движение ({info.get('net_atr', 0):+.1f} ATR) "
            f"и RANGING/LOW_VOLATILITY в около {frac:.0f}% от свещите."
        )
    elif key == "high_volatility":
        frac = (info.get("high_volatility_fraction") or 0) * 100
        text = f"Периодът „{label}“: HIGH_VOLATILITY в {frac:.0f}% от първите {setup.get('focus_bars', 100)} свещи."
    elif key == "breakout":
        if info.get("breakout_ts"):
            word = "нагоре" if info.get("direction") == "up" else "надолу"
            text = (
                f"Периодът „{label}“: консолидация {_fmt(info.get('box_low'), p)}–{_fmt(info.get('box_high'), p)}, "
                f"после пробив {word} на {_when(info.get('breakout_ts'), timeframe)} "
                f"({info.get('bars_to_breakout')} свещи след старта, разширение {info.get('extension_atr', 0):.1f} ATR)."
            )
        else:
            text = f"Периодът „{label}“: консолидация без ясен пробив в първите свещи."
    else:
        text = f"Периодът беше избран случайно („{label}“) от миналото на {timeframe.upper()} графиката."
    if key != "random" and not setup.get("matched", True):
        text += " (В историята нямаше период, който напълно да отговаря на условието — избран е най-близкият.)"
    return {
        "preset": key,
        "label": label,
        "label_bg": meta.get("label_bg"),
        "matched": bool(setup.get("matched", True)),
        "info": info,
        "regime_mix": setup.get("regime_mix") or {},
        "text": text,
    }


# ------------------------------------------------------------------------------------------------ decisions
def _status_word(o: dict) -> str:
    return {
        "target": "target",
        "stop": "stop",
        "expired": f"без stop/target за {o.get('horizon', PREDICTION_HORIZON)} свещи",
        "open": "още отворена",
    }.get(o.get("status") or "open", o.get("status") or "")


def decision_comment(d: dict, precision: int = 2) -> str:
    """One-line explanation of a decision and its outcome."""
    p = precision
    o = d.get("outcome") or {}
    act = ACTION_LABEL.get(d["action"], d["action"].upper())
    if d["action"] == "wait":
        base = f"WAIT при {_fmt(d.get('entry_price'), p)}: {o.get('explanation') or 'оценява се.'}"
    else:
        r = o.get("r_result")
        r_txt = f"{r:+.2f}R" if r is not None else "—"
        status = o.get("status")
        if status == "target":
            base = f"{act} @ {_fmt(d.get('entry_price'), p)} → target за {o.get('bars_held')} свещи ({r_txt})."
        elif status == "stop":
            base = f"{act} @ {_fmt(d.get('entry_price'), p)} → stop за {o.get('bars_held')} свещи ({r_txt})."
            if o.get("same_bar_stop_and_target"):
                base += " Stop и target бяха в една свещ — броим stop първо (worst case)."
            if o.get("gap"):
                base += " Свещта отвори отвъд stop-а (gap) — загубата е по-голяма от 1R."
        elif status == "expired":
            base = f"{act} @ {_fmt(d.get('entry_price'), p)} → {_status_word(o)}; резултат на затваряне {r_txt}."
        else:
            base = (
                f"{act} @ {_fmt(d.get('entry_price'), p)} → още отворена след {o.get('bars_held', 0)} свещи "
                f"({r_txt} на последната разкрита свещ)."
            )
    flags = [f for f in d.get("flags") or [] if f.get("severity") == "warning"] or list(d.get("flags") or [])
    if flags:
        base += f" Основна забележка: {flags[0]['label']}."
    return base


def _compact(d: dict, precision: int) -> dict:
    o = d.get("outcome") or {}
    return {
        "id": d.get("id"),
        "bar_ts": d["bar_ts"],
        "action": d["action"],
        "entry_price": d.get("entry_price"),
        "status": o.get("status"),
        "r_result": o.get("r_result"),
        "right_to_wait": o.get("right_to_wait"),
        "score": d.get("score"),
        "text": decision_comment(d, precision),
    }


def _flag_items(decisions: Sequence[dict], key: str, precision: int) -> list[dict]:
    out = []
    for d in decisions:
        for f in d.get("flags") or []:
            if f["key"] == key:
                out.append(
                    {
                        "id": d.get("id"),
                        "bar_ts": d["bar_ts"],
                        "action": d["action"],
                        "entry_price": d.get("entry_price"),
                        "text": f["text"],
                        "level": f.get("level"),
                        "lesson": f.get("lesson"),
                    }
                )
    return out


def invalidation_levels(decisions: Sequence[dict], precision: int = 2) -> list[dict]:
    """For every LONG/SHORT: where the idea was wrong (the stop) and the structural level behind it."""
    p = precision
    out = []
    for d in decisions:
        if d["action"] not in ("long", "short"):
            continue
        o = d.get("outcome") or {}
        ctx = d.get("context") or {}
        long = d["action"] == "long"
        swing = ctx.get("swing_low_below") if long else ctx.get("swing_high_above")
        swing_word = "swing low" if long else "swing high"
        side_word = "под" if long else "над"
        hit = o.get("status") == "stop"
        text = f"{ACTION_LABEL[d['action']]} @ {_fmt(d.get('entry_price'), p)}: идеята е грешна {side_word} {_fmt(d.get('stop'), p)} (твоят stop)"
        if swing:
            text += f"; структурно — {side_word} последния {swing_word} {_fmt(swing['price'], p)}"
        text += " → беше достигнато." if hit else " → не беше достигнато."
        out.append(
            {
                "id": d.get("id"),
                "bar_ts": d["bar_ts"],
                "action": d["action"],
                "entry_price": d.get("entry_price"),
                "stop": d.get("stop"),
                "level": d.get("stop"),
                "structural_level": swing["price"] if swing else None,
                "structural_label": swing_word if swing else None,
                "hit": hit,
                "hit_ts": o.get("exit_ts") if hit else None,
                "text": text,
            }
        )
    return out


def rr_assessment(decisions: Sequence[dict]) -> dict:
    trades = [d for d in decisions if d["action"] in ("long", "short")]
    rrs = [d["planned_rr"] for d in trades if d.get("planned_rr") is not None]
    no_target = sum(1 for d in trades if d.get("planned_rr") is None)
    good = sum(1 for r in rrs if r >= RR_GOOD)
    low = sum(1 for r in rrs if RR_BAD <= r < RR_GOOD)
    poor = sum(1 for r in rrs if r < RR_BAD)
    realized = [
        (d.get("outcome") or {}).get("r_result")
        for d in trades
        if d.get("score_final") and (d.get("outcome") or {}).get("r_result") is not None
    ]
    total_r = round(sum(realized), 3) if realized else None
    avg_rr = round(sum(rrs) / len(rrs), 2) if rrs else None
    if not trades:
        verdict = "n/a"
        text = ["Нямаше LONG/SHORT прогнози — планираният R:R на прогнозите не се оценява."]
    else:
        if poor * 2 >= len(trades) or no_target * 2 >= len(trades):
            verdict = "poor"
        elif avg_rr is not None and avg_rr >= RR_GOOD and poor == 0 and no_target == 0:
            verdict = "good"
        else:
            verdict = "mixed"
        text = []
        if rrs:
            text.append(
                f"Планиран R:R: средно {avg_rr:.2f} (от {min(rrs):.2f} до {max(rrs):.2f}); ≥ {RR_GOOD:g}: {good}, "
                f"{RR_BAD:g}–{RR_GOOD:g}: {low}, под {RR_BAD:g}: {poor}."
            )
        if no_target:
            text.append(f"{no_target} решения без target — изходът при успех не беше планиран.")
        if total_r is not None:
            text.append(
                f"Реален резултат на оценените прогнози: {total_r:+.2f}R общо ({len(realized)} решения, "
                f"средно {total_r / len(realized):+.2f}R)."
            )
        text.append(
            {
                "good": f"Планът имаше добра асиметрия (R:R ≥ {RR_GOOD:g}): един target покрива повече от един stop.",
                "mixed": f"Смесено: целта е всеки setup да има R:R поне {RR_GOOD:g}.",
                "poor": "R:R беше слаб: дори при висок win rate малките цели трудно покриват загубите.",
            }[verdict]
        )
    return {
        "decisions": len(trades),
        "with_target": len(rrs),
        "without_target": no_target,
        "avg_planned_rr": avg_rr,
        "min_planned_rr": round(min(rrs), 2) if rrs else None,
        "max_planned_rr": round(max(rrs), 2) if rrs else None,
        "good": good,
        "low": low,
        "poor": poor,
        "total_r": total_r,
        "resolved": len(realized),
        "verdict": verdict,
        "text": text,
    }


def flags_summary(decisions: Sequence[dict]) -> list[dict]:
    counts: Counter = Counter()
    for d in decisions:
        for f in d.get("flags") or []:
            counts[f["key"]] += 1
    return [
        {
            "key": k,
            "label": FLAGS[k]["label"],
            "severity": FLAGS[k]["severity"],
            "count": n,
            "lesson": FLAGS[k]["lesson"],
        }
        for k, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        if k in FLAGS
    ]


def recommended_lessons(
    decisions: Sequence[dict], trade_reviews: Sequence[dict] = (), *, limit: int = MAX_LESSONS
) -> list[dict]:
    """Flags → academy lessons (most frequent first), then lessons from the paper-trade reviews."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(slug: str | None, reason: str, **extra) -> None:
        if not slug or slug in seen or len(out) >= limit:
            return
        item = lesson_ref(slug, reason, **extra)
        if item:
            seen.add(slug)
            out.append(item)

    per_lesson: dict[str, list[dict]] = {}
    for d in decisions:
        for f in d.get("flags") or []:
            slug = f.get("lesson") or FLAGS.get(f["key"], {}).get("lesson")
            if slug:
                per_lesson.setdefault(slug, []).append(f)
    ranked = sorted(
        per_lesson.items(),
        key=lambda kv: (-sum(2 if f.get("severity") == "warning" else 1 for f in kv[1]), kv[0]),
    )
    for slug, items in ranked:
        f = items[0]
        n = len(items)
        add(slug, f"{f['label']} ×{n}: {f['text']}", flag=f["key"], count=n)
    stopped = [d for d in decisions if (d.get("outcome") or {}).get("status") == "stop" and not d.get("flags")]
    if stopped:
        add(
            STOPPED_LESSON,
            f"{len(stopped)} прогнози удариха stop без нарушено правило — провери дали stop-ът е там, където идеята "
            "наистина е грешна.",
            count=len(stopped),
        )
    for r in trade_reviews:
        for slug in r.get("lessons") or []:
            add(slug, "Препоръка от прегледа на paper сделката.")
    if not out:
        add(DEFAULT_LESSON, "Без нарушени правила — продължи цикъла review → journal → coach.")
    return out


# ------------------------------------------------------------------------------------------------ sections
def _rules_lines(flags: list[dict], comparison: dict, has_decisions: bool) -> list[str]:
    lines = [
        "Всяко решение е оценено (0–100) по едни и същи, обясними правила:",
        f"Stop зад последния swing low/high и поне {NOISE_STOP_ATR:g} ATR от входа (не в шума); R:R ≥ {RR_GOOD:g}.",
        f"Без гонене: вход до {CHASE_EMA_ATR:g} ATR от EMA 20 след голяма свещ; LONG чак след пробит LH/LL "
        "(SHORT — след HH/HL).",
        f"Място до нивото: поне {STRUCTURE_ATR:g} ATR до resistance (LONG) / support (SHORT); посоката спрямо режима.",
        f"WAIT е правилен, когато в следващите {WAIT_HORIZON} свещи няма чисто движение ≥ {WAIT_MOVE_ATR:g} ATR.",
    ]
    strat = comparison.get("strategy") or {}
    rules = comparison.get("rules") or []
    if strat.get("name"):
        lines.append(f"Стратегия за сравнение „{strat['name']}“" + (f": {rules[0]}" if rules else "."))
    if flags:
        lines.append("Нарушени правила: " + ", ".join(f"{f['label']} ×{f['count']}" for f in flags) + ".")
    elif has_decisions:
        lines.append("В прогнозите ти не е отбелязано нарушено правило.")
    else:
        lines.append("Няма LONG / SHORT / WAIT прогнози за оценка по тези правила.")
    return lines


def _scenario_lines(wh: dict, decisions: Sequence[dict], timeframe: str, precision: int) -> list[str]:
    p = precision
    lines: list[str] = []
    if not wh.get("available"):
        return wh.get("text") or ["DATA NOT AVAILABLE."]
    segs = wh.get("regime_segments") or []
    if segs:
        lines.append(
            "Как се разви периодът: " + " → ".join(f"{s['regime']} ({s['bars']} свещи)" for s in segs[:6]) + "."
        )
    lines.append(
        f"Най-високо {_fmt(wh['high']['price'], p)} на {_when(wh['high']['time'], timeframe)}, "
        f"най-ниско {_fmt(wh['low']['price'], p)} на {_when(wh['low']['time'], timeframe)}."
    )
    scored = [d for d in decisions if d.get("score") is not None and d.get("score_final")]
    if scored:
        best = max(scored, key=lambda d: (d["score"], d["bar_ts"]))
        worst = min(scored, key=lambda d: (d["score"], -d["bar_ts"]))
        lines.append(
            f"Най-добро решение ({_when(best['bar_ts'], timeframe)}, score {best['score']:.0f}): "
            + decision_comment(best, p)
        )
        if worst is not best:
            lines.append(
                f"Най-слабо решение ({_when(worst['bar_ts'], timeframe)}, score {worst['score']:.0f}): "
                + decision_comment(worst, p)
            )
    elif decisions:
        lines.append("Решенията ти още нямат окончателен резултат (твърде малко разкрити свещи след тях).")
    else:
        lines.append("Не взе LONG / SHORT / WAIT решение — сценарият мина без твоя прогноза.")
    nxt = wh.get("next")
    if nxt:
        lines.append(
            f"След края: следващите {nxt['bars']} свещи {nxt['change_pct']:+.2f}% — това е минал факт, не прогноза."
        )
    return lines


def _risk_lines(decisions: Sequence[dict], rr: dict, trade_metrics: dict | None) -> list[str]:
    lines = list(rr["text"])
    trades = [d for d in decisions if d["action"] in ("long", "short")]
    noise = sum(1 for d in trades for f in d.get("flags") or [] if f["key"] == "stop_in_noise")
    behind = sum(1 for d in trades if ((d.get("components") or {}).get("stop") or {}).get("score") == 100)
    if trades:
        lines.append(f"Stop зад последния swing: {behind} от {len(trades)} решения.")
    if noise:
        lines.append(f"Stop в шума (< {NOISE_STOP_ATR:g} ATR): {noise} — нормалното колебание стига до такъв stop.")
    if trade_metrics and trade_metrics.get("total_trades"):
        lines.append(
            f"Paper сделки: {trade_metrics['total_trades']}, нетно {trade_metrics['net_pnl']:+,.2f}, "
            f"win rate {trade_metrics['win_rate']:.0f}%."
        )
    lines.append("Размерът на позицията се определя от риска до stop-а (напр. 1% от капитала), не от leverage.")
    return lines


def _alternative_lines(decisions: Sequence[dict], comparison: dict) -> list[str]:
    lines = list(comparison.get("text") or [SENTENCE])
    if not lines or lines[0] != SENTENCE:
        lines.insert(0, SENTENCE)
    stopped = [d for d in decisions if (d.get("outcome") or {}).get("status") == "stop"]
    if stopped:
        saved = -sum((d.get("outcome") or {}).get("r_result") or 0 for d in stopped)
        lines.append(f"Алтернатива: WAIT вместо {len(stopped)} прогнози, които удариха stop, би спестил {saved:.2f}R.")
    missed = [d for d in decisions if d["action"] == "wait" and (d.get("outcome") or {}).get("right_to_wait") is False]
    if missed:
        lines.append(
            f"Алтернатива: при {len(missed)} WAIT решения имаше чисто движение ≥ {WAIT_MOVE_ATR:g} ATR — "
            "провери кой setup би го хванал с ясен stop."
        )
    return lines


def _invalidation_lines(levels: list[dict]) -> list[str]:
    if not levels:
        return [
            "Нямаше LONG/SHORT решения, затова няма invalidation нива. При WAIT рискът е нула — invalidation "
            "е самото решение да не влизаш."
        ]
    lines = [lv["text"] for lv in levels[:6]]
    if len(levels) > 6:
        lines.append(f"… и още {len(levels) - 6} нива (виж таблицата с прогнозите).")
    return lines


# ------------------------------------------------------------------------------------------------ LLM narration
def _narrate(llm, offline: dict[str, list[str]], data: dict) -> tuple[dict[str, list[str]], list[str]]:
    """LLM re-wording of the six sections. Returns ({key: lines} accepted, [rejected keys]). Raises on failure."""
    from app.ai.modes import grounding_corpus, parse_llm_sections, ungrounded_numbers
    from app.ai.prompts import TEACHER_V2_SYSTEM

    system = (
        TEACHER_V2_SYSTEM
        + "\nСега пишеш AI HISTORY REVIEW на replay сесия: минал период, който вече е напълно разкрит. Обясняваш какво "
        "се случи и как се представиха решенията на потребителя спрямо правилата. Не прогнозираш бъдещата цена.\n"
        f"Ключове за този отговор (точно тези): {', '.join(SECTION_KEYS)}\n"
    )
    dump = json.dumps(data, ensure_ascii=False, default=str)[:12000]
    draft = json.dumps(offline, ensure_ascii=False)[:9000]
    content = f"<review_data>{dump}</review_data>\n<engine_draft>{draft}</engine_draft>\n" + (
        'Върни само JSON обекта {"sections": {...}}.'
    )
    text = llm.complete(system, [{"role": "user", "content": content}], max_tokens=LLM_MAX_TOKENS)
    parsed = parse_llm_sections(text, list(SECTION_KEYS))
    corpus = grounding_corpus(data, offline)
    accepted: dict[str, list[str]] = {}
    rejected: list[str] = []
    for key, lines in parsed.items():
        if ungrounded_numbers(lines, corpus):
            rejected.append(key)
        else:
            accepted[key] = lines[:MAX_LINES]
    return accepted, rejected


# ------------------------------------------------------------------------------------------------ build
def build_history_review(
    *,
    symbol: str,
    timeframe: str,
    precision: int,
    mode: str,
    setup: dict | None,
    history: Sequence[Candle],
    start_ts: int,
    cursor_ts: int,
    next_bars: Sequence[Candle],
    decisions: Sequence[dict],
    score: float | None,
    score_basis: str | None,
    comparison: dict,
    trade_reviews: Sequence[dict] = (),
    trade_metrics: dict | None = None,
    use_llm: bool = True,
) -> dict:
    p = precision
    decisions = sorted(decisions, key=lambda d: d["bar_ts"])
    wh = what_happened(history, start_ts, cursor_ts, next_bars, timeframe=timeframe, precision=p, setup=setup)
    predictions = []
    for d in decisions:
        predictions.append(
            {
                "id": d.get("id"),
                "bar_ts": d["bar_ts"],
                "action": d["action"],
                "entry_price": d.get("entry_price"),
                "stop": d.get("stop"),
                "target": d.get("target"),
                "planned_rr": d.get("planned_rr"),
                "note": d.get("note"),
                "outcome": d.get("outcome"),
                "score": d.get("score"),
                "grade": grade(d.get("score")) if d.get("score_final") else None,
                "score_final": bool(d.get("score_final")),
                "correct": d.get("correct"),
                "flags": d.get("flags") or [],
                "comment": decision_comment(d, p),
            }
        )
    correct = [_compact(d, p) for d in decisions if d.get("correct") is True]
    wrong = [_compact(d, p) for d in decisions if d.get("correct") is False]
    undetermined = [_compact(d, p) for d in decisions if d.get("correct") is None]
    flags = flags_summary(decisions)
    rr = rr_assessment(decisions)
    levels = invalidation_levels(decisions, p)
    lessons = recommended_lessons(decisions, trade_reviews)

    n_long = sum(1 for d in decisions if d["action"] == "long")
    n_short = sum(1 for d in decisions if d["action"] == "short")
    n_wait = sum(1 for d in decisions if d["action"] == "wait")
    observation = list(wh.get("text") or [])[:6]
    if decisions:
        observation.append(
            f"Твоите решения: {n_long} LONG, {n_short} SHORT, {n_wait} WAIT — {len(correct)} верни, {len(wrong)} грешни"
            + (f", {len(undetermined)} без окончателен резултат." if undetermined else ".")
        )
    else:
        observation.append("Не взе нито едно LONG / SHORT / WAIT решение в тази сесия.")
    offline = {
        "observation": observation,
        "rules": _rules_lines(flags, comparison, bool(decisions)),
        "scenario": _scenario_lines(wh, decisions, timeframe, p),
        "invalidation": _invalidation_lines(levels),
        "risk": _risk_lines(decisions, rr, trade_metrics),
        "alternative": _alternative_lines(decisions, comparison),
    }
    provider, provider_label, fallback, rejected = "offline", "OFFLINE", False, []
    body = dict(offline)
    llm = get_llm() if use_llm else None
    if llm is not None:
        data = {
            "symbol": symbol,
            "timeframe": timeframe,
            "score": score,
            "what_happened": {k: v for k, v in wh.items() if k != "text"},
            "decisions": [_compact(d, p) for d in decisions],
            "flags": flags,
            "rr_assessment": rr,
            "invalidation_levels": levels,
            "strategy_comparison": {k: comparison.get(k) for k in ("strategy", "metrics", "text")},
        }
        try:
            accepted, rejected = _narrate(llm, offline, data)
            if accepted:
                body.update(accepted)
                provider, provider_label = getattr(llm, "name", "llm"), "Claude"
        except Exception as exc:  # noqa: BLE001 - any LLM failure falls back to the offline review
            log.info("replay review narration failed: %s", exc)
            fallback = True

    removed: list[str] = []
    sections = []
    for key, title in SECTIONS:
        clean, rem = sanitize_lines(body.get(key) or offline[key])
        removed.extend(rem)
        if not clean:  # everything was filtered → the offline text (already safe) is shown
            clean, _ = sanitize_lines(offline[key])
        sections.append({"key": key, "title": title, "body": clean[:MAX_LINES]})

    g = grade(score)
    summary = []
    if score is not None:
        summary.append(f"Replay score: {score:.0f}/100 ({g}).")
    else:
        summary.append("Replay score: няма оценени решения в тази сесия.")
    if lessons:
        summary.append(f"Следващ урок: {lessons[0]['title']} — {lessons[0]['reason']}")
    if comparison.get("text"):
        summary.append(" ".join(comparison["text"][:2]))
    summary, rem = sanitize_lines(summary)
    removed.extend(rem)
    for item in predictions:  # engine text inside the structured parts goes through the filter too
        clean, rem = sanitize_lines([item["comment"]])
        removed.extend(rem)
        item["comment"] = clean[0] if clean else ""

    return {
        "version": REVIEW_VERSION,
        "generated_ts": int(time.time()),
        "symbol": symbol,
        "timeframe": timeframe,
        "mode": mode,
        "precision": precision,
        "score": score,
        "grade": g,
        "score_basis": score_basis,
        "what_happened": wh,
        "predictions": predictions,
        "correct": correct,
        "wrong": wrong,
        "undetermined": undetermined,
        "entered_too_early": _flag_items(decisions, "entered_too_early", p),
        "chased": _flag_items(decisions, "chased", p),
        "ignored_structure": _flag_items(decisions, "ignored_structure", p),
        "flags_summary": flags,
        "rr_assessment": rr,
        "invalidation_levels": levels,
        "strategy_comparison": comparison,
        "lessons": lessons,
        "sections": sections,
        "summary": summary,
        "provider": provider,
        "provider_label": provider_label,
        "fallback": fallback,
        "llm_rejected_sections": rejected,
        "safety_removed": removed,
        "safety_note": SAFETY_NOTE if removed else None,
        "disclaimer": DISCLAIMER,
    }
