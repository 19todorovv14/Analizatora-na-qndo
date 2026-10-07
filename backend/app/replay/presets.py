"""Period presets for replay: a deterministic PAST window whose revealed part matches a market regime.

The window is chosen from the session timeframe's own history with app.analysis.regime (each bar is
classified with data up to that bar only). Rules:
  * the window always ends at least FUTURE_GAP_BARS before the last closed candle (never "the last bars"),
  * the user always has at least MIN_WINDOW_BARS candles to reveal,
  * the user sees HISTORY_BARS of context before the start, and the regime classifier gets its warm-up.
The choice is deterministic for the same (user, symbol, timeframe, preset, seed); a different seed (by default the
number of the user's previous sessions) gives another period. The matched regime/direction is kept for the final
review only — the active session shows just the preset name, so the setup never hints at the future.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import dataclass

from app.analysis.regime import RegimeInputs, classify_at
from app.market.base import Candle

PRESETS: dict[str, dict] = {
    "random": {"label": "Random", "label_bg": "Случаен период", "description": "Произволен минал период."},
    "trend": {
        "label": "Trend",
        "label_bg": "Тренд",
        "description": "Период с ясен тренд (посоката не се казва предварително).",
    },
    "range": {"label": "Range", "label_bg": "Диапазон", "description": "Цената се движи странично в диапазон."},
    "high_volatility": {
        "label": "High volatility",
        "label_bg": "Висока волатилност",
        "description": "Големи свещи и резки движения — тест за stop и размер.",
    },
    "breakout": {
        "label": "Breakout",
        "label_bg": "Пробив",
        "description": "Консолидация, последвана от пробив (кога и накъде — откриваш сам).",
    },
}
PRESET_KEYS = tuple(PRESETS)

MIN_WINDOW_BARS = 60
FUTURE_GAP_BARS = 60
HISTORY_BARS = 150
REGIME_WARMUP_BARS = 260
SCAN_BARS = 1500
FOCUS_BARS = 100  # the part of the window that must show the regime (what most users actually replay)
TOP_K = 8


class PresetError(ValueError):
    pass


@dataclass
class Candidate:
    index: int  # index of the start candle (cursor at creation) in the scanned series
    score: float
    matched: bool
    info: dict


def fetch_span(bars: int) -> int:
    """How many candles to request (ending at the last closed candle) for the scan."""
    return SCAN_BARS + bars + FUTURE_GAP_BARS + REGIME_WARMUP_BARS


def _efficiency(closes: Sequence[float], a: int, b: int) -> float:
    path = sum(abs(closes[i] - closes[i - 1]) for i in range(a + 1, b + 1))
    return abs(closes[b] - closes[a]) / path if path > 0 else 0.0


def _frac(regs: Sequence[str], a: int, b: int, names: tuple[str, ...]) -> float:
    n = b - a + 1
    return sum(1 for r in regs[a : b + 1] if r in names) / n if n > 0 else 0.0


def _evaluate(
    preset: str, candles: Sequence[Candle], regs: Sequence[str], atr: Sequence[float | None], s: int, focus: int
):
    """(score 0..1, matched, info) for the window whose first revealed candle is s + 1."""
    a, b = s + 1, s + focus
    closes = [c.close for c in candles]
    atr_s = atr[s] or 0.0
    if atr_s <= 0:
        return 0.0, False, {}
    net_atr = (closes[b] - closes[s]) / atr_s
    er = _efficiency(closes, s, b)
    if preset == "random":
        return 1.0, True, {"net_atr": round(net_atr, 2)}
    if preset == "trend":
        up = _frac(regs, a, b, ("TRENDING_UP",))
        down = _frac(regs, a, b, ("TRENDING_DOWN",))
        direction = "up" if up >= down else "down"
        dir_frac = max(up, down)
        agrees = (net_atr > 0) == (direction == "up")
        score = 0.6 * dir_frac + 0.4 * min(1.0, er / 0.35)
        matched = dir_frac >= 0.25 and er >= 0.15 and abs(net_atr) >= 3 and agrees
        return (
            score,
            matched,
            {
                "direction": direction,
                "trend_fraction": round(dir_frac, 3),
                "efficiency": round(er, 3),
                "net_atr": round(net_atr, 2),
            },
        )
    if preset == "range":
        rng = _frac(regs, a, b, ("RANGING",)) + 0.5 * _frac(regs, a, b, ("LOW_VOLATILITY",))
        trend = _frac(regs, a, b, ("TRENDING_UP", "TRENDING_DOWN"))
        score = 0.6 * min(1.0, rng / 0.5) + 0.4 * (1 - min(1.0, er / 0.3))
        matched = rng >= 0.2 and trend <= 0.25 and er <= 0.12 and abs(net_atr) <= 3
        return (
            score,
            matched,
            {"range_fraction": round(rng, 3), "efficiency": round(er, 3), "net_atr": round(net_atr, 2)},
        )
    if preset == "high_volatility":
        hv = _frac(regs, a, b, ("HIGH_VOLATILITY",))
        return hv, hv >= 0.3, {"high_volatility_fraction": round(hv, 3), "net_atr": round(net_atr, 2)}
    if preset == "breakout":
        box_from = max(0, s - 30)
        pre = _frac(regs, box_from, s, ("RANGING", "LOW_VOLATILITY"))
        box_high = max(c.high for c in candles[box_from : s + 1])
        box_low = min(c.low for c in candles[box_from : s + 1])
        width_atr = (box_high - box_low) / atr_s
        brk = None
        for i in range(s + 5, s + int(focus * 0.7) + 1):
            if closes[i] > box_high + 0.3 * atr_s:
                brk = (i, "up")
                break
            if closes[i] < box_low - 0.3 * atr_s:
                brk = (i, "down")
                break
        if brk is None:
            return (
                0.25 * min(1.0, pre / 0.6),
                False,
                {"pre_range_fraction": round(pre, 3), "box_width_atr": round(width_atr, 2)},
            )
        i, direction = brk
        follow = candles[i : min(i + 11, b + 1)]
        if direction == "up":
            ext = (max(c.high for c in follow) - box_high) / atr_s
        else:
            ext = (box_low - min(c.low for c in follow)) / atr_s
        score = 0.5 * min(1.0, pre / 0.6) + 0.5 * min(1.0, ext / 2.0)
        matched = pre >= 0.3 and width_atr <= 8 and ext >= 1.0
        return (
            score,
            matched,
            {
                "direction": direction,
                "pre_range_fraction": round(pre, 3),
                "box_high": box_high,
                "box_low": box_low,
                "box_width_atr": round(width_atr, 2),
                "breakout_ts": candles[i].ts,
                "bars_to_breakout": i - s,
                "extension_atr": round(ext, 2),
            },
        )
    raise PresetError(f"Непознат preset '{preset}'. Позволени: {', '.join(PRESET_KEYS)}.")


def choose_window(candles: Sequence[Candle], preset: str, bars: int, *, seed_key: str) -> dict:
    """Pick the start index for a preset. `candles` = closed candles ending at the LAST closed candle.

    Returns {index, start_ts, end_index, matched, score, info, candidates, matching}.
    The window is candles[index] (cursor at start) … candles[index + bars]; there are always at least
    FUTURE_GAP_BARS candles after its end.
    """
    if preset not in PRESETS:
        raise PresetError(f"Непознат preset '{preset}'. Позволени: {', '.join(PRESET_KEYS)}.")
    n = len(candles)
    bars = max(int(bars), MIN_WINDOW_BARS)
    focus = min(bars, FOCUS_BARS)
    lo = max(REGIME_WARMUP_BARS, HISTORY_BARS, 31)
    hi = n - 1 - FUTURE_GAP_BARS - bars  # last allowed start index
    if hi < lo:
        raise PresetError(
            "Недостатъчно история за preset на този timeframe — избери по-малък timeframe или по-малко свещи (bars)."
        )
    x = RegimeInputs.from_candles(list(candles))
    regs = [classify_at(x, i)["regime"] for i in range(n)]
    stride = max(1, focus // 10)
    cands: list[Candidate] = []
    for s in range(hi, lo - 1, -stride):  # anchored at the most recent allowed start → stable across calls
        score, matched, info = _evaluate(preset, candles, regs, x.atr, s, focus)
        cands.append(Candidate(s, score, matched, info))
    rng = random.Random(f"replay-preset:{seed_key}:{preset}")
    matching = [c for c in cands if c.matched]
    if preset == "random":
        pick = rng.choice(cands)
    elif matching:
        pool = sorted(matching, key=lambda c: (-c.score, -c.index))[:TOP_K]
        pick = rng.choice(pool)
    else:
        pool = sorted(cands, key=lambda c: (-c.score, -c.index))[:3]
        pick = rng.choice(pool)
    s = pick.index
    a, b = s + 1, s + focus
    mix: dict[str, int] = {}
    for r in regs[a : b + 1]:
        mix[r] = mix.get(r, 0) + 1
    return {
        "index": s,
        "start_ts": candles[s].ts,
        "end_index": s + bars,
        "bars": bars,
        "matched": pick.matched,
        "score": round(pick.score, 3),
        "info": pick.info,
        "regime_mix": dict(sorted(mix.items(), key=lambda kv: -kv[1])),
        "focus_bars": focus,
        "candidates": len(cands),
        "matching": len(matching),
    }
