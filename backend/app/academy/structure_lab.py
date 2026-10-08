"""Market Structure Lab (S3b): label swings on a real/demo chart window and get a deterministic, explained check.

Exercise
--------
A random past window of 80–140 CLOSED candles from a pool of instruments (demo or live data, whatever the
configured provider serves). The window is chosen by difficulty:
  easy   — clean trend: ≥ 4 labelled swings, ≥ 85 % of them in one direction (HH/HL or LH/LL) and the window's net
           move ≥ 50 % of its high–low range in that direction;
  hard   — range with a fakeout: ≥ 6 labelled swings, structure verdict "range", |net move| ≤ 35 % of the range and
           at least one FAKEOUT event;
  medium — everything else with ≥ 6 labelled swings and at least one breakout/retest/fakeout event.
The token (HMAC: symbol, timeframe, start, end, bars, difficulty, nonce, expiry) pins the window, so the check
re-reads exactly the same closed candles and recomputes the same reference answer.

Reference answer (all rules use only the window's candles)
----------------------------------------------------------
* Swings: app.analysis.structure.find_swings(window, PIVOT, PIVOT) — confirmed pivots: a swing high is a candle
  whose High is the highest of PIVOT candles before and after it (later highs strictly lower). Each swing is
  labelled against the PREVIOUS swing of the same type inside the window: high > previous high → HH, else LH;
  low > previous low → HL, else LL. The first swing high and the first swing low have no previous one: they are
  ANCHORS (given in the exercise, not scored).
* Structure: share of HH+HL among all labels ≥ 65 % → uptrend; share of LH+LL ≥ 65 % → downtrend; else range.
* Events: a swing level becomes known PIVOT bars after its pivot. BREAKOUT at bar i = the first close beyond the
  most recent known swing high (or below the most recent known swing low) while the previous close was not; each
  swing level can break once. If a close back on the other side of the level happens within FAKEOUT_BARS bars,
  the break is a FAKEOUT instead. A break in the last FAKEOUT_BARS bars of the window cannot be judged yet
  ("undetermined": BREAKOUT or FAKEOUT are both accepted, never counted as missed). RETEST = the first bar within
  RETEST_BARS bars after a (non-fake) breakout whose Low (High for a downside break) comes back to within
  RETEST_ATR × ATR of the level while the bar closes on the breakout side of the level.
* ATR = average true range of the window; matching tolerance = ±MATCH_BARS bars and ≤ MATCH_ATR × ATR in price
  (events: ≤ tolerance from the level OR inside the marked bar's High/Low ± tolerance).

Score (0–100) = 60 % swings + 25 % structure + 15 % events, where
  swings = clamp((correct − 0.5 × wrong swing marks) / reference swings),
  events = clamp((event TYPES found − 0.5 × wrong event marks) / event types present) — the task is to mark "a
           breakout, a retest and a fakeout if present", so one correct mark per type present earns full credit
           (no events present: 1 − 0.5 × wrong event marks),
  structure = 1 when the chosen structure matches.
Explanations are deterministic ("AI проверява" = this checker); an optional LLM polish of the summary is
safety-filtered and dropped if it changes any number.
"""

from __future__ import annotations

import bisect
import random
import re
import secrets
import time
from dataclasses import dataclass, field

from app.academy.patterns import read_lab_token, sign_lab_token
from app.analysis.structure import find_swings
from app.market.base import Candle, DataNotAvailableError, MarketDataError
from app.market.timeframes import tf_seconds

PIVOT = 5
MATCH_BARS = 2
MATCH_ATR = 0.35
FAKEOUT_BARS = 3
RETEST_BARS = 10
RETEST_ATR = 0.35
TREND_SHARE = 0.65
EASY_SHARE = 0.85
EASY_NET = 0.5
HARD_NET = 0.35
MIN_BARS, MAX_BARS = 80, 140
WINDOW_LENGTHS: tuple[int, ...] = (80, 100, 120, 140)
WINDOW_STEP = 10
HISTORY_BARS = 700
TOKEN_TTL = 6 * 3600
WEIGHTS = {"swings": 0.60, "structure": 0.25, "events": 0.15}
WRONG_MARK_PENALTY = 0.5
DIFFICULTIES: tuple[str, ...] = ("easy", "medium", "hard")
SWING_LABELS: tuple[str, ...] = ("HH", "HL", "LH", "LL")
EVENT_LABELS: tuple[str, ...] = ("BREAKOUT", "RETEST", "FAKEOUT")
LABELS: tuple[str, ...] = SWING_LABELS + EVENT_LABELS
STRUCTURES: tuple[str, ...] = ("uptrend", "downtrend", "range")
VERDICTS: tuple[str, ...] = ("CORRECT", "INCORRECT", "NOT A SWING", "REFERENCE")
CANDIDATES: tuple[tuple[str, str], ...] = (
    ("BTC/USDT", "1h"),
    ("ETH/USDT", "4h"),
    ("EUR/USD", "1h"),
    ("XAU/USD", "4h"),
    ("AAPL", "1d"),
    ("SOL/USDT", "1h"),
    ("GBP/USD", "4h"),
    ("NDX", "1d"),
)
TASKS = [
    "Mark every swing high/low as HH, HL, LH or LL",
    "What is the structure: uptrend / downtrend / range?",
    "Mark a breakout, a retest and a fakeout if present",
]
TASKS_BG = [
    "Маркирай всеки swing high и swing low като HH, HL, LH или LL (първите връх и дъно са дадени като отправна точка).",
    "Каква е структурата: uptrend, downtrend или range?",
    "Маркирай breakout, retest и fakeout, ако има такива.",
]
RULES_BG = [
    f"Swing high: свещ, чийто High е най-високият сред {PIVOT} свещи преди и {PIVOT} след нея; swing low — "
    "аналогично с Low.",
    "HH / LH: върхът е над / не е над предходния swing high. HL / LL: дъното е над / не е над предходното swing low.",
    f"Uptrend: ≥ {TREND_SHARE:.0%} от етикетите са HH/HL. Downtrend: ≥ {TREND_SHARE:.0%} са LH/LL. Иначе — range.",
    "Breakout: първото затваряне над последния потвърден swing high (или под последния swing low).",
    f"Fakeout: breakout, след който до {FAKEOUT_BARS} свещи цената затваря обратно от другата страна на нивото.",
    f"Retest: до {RETEST_BARS} свещи след breakout цената се връща до нивото и затваря от страната на пробива.",
    f"Толеранс при проверката: ±{MATCH_BARS} свещи и до {MATCH_ATR} ATR по цена.",
]
DISCLAIMER = "Упражнение върху минали затворени свещи — описание на структурата, не прогноза."
STORE_NOTE_DUPLICATE = "Този exercise вече е проверен — резултатът от повторната проверка не се записва."

AI_SYSTEM = (
    "Ти си спокоен преподавател по trading. Пренапиши обобщението на проверката на упражнение за пазарна "
    "структура на български (английските термини HH, HL, LH, LL, breakout, retest, fakeout остават). Максимум 3 "
    "изречения. Запази ВСИЧКИ числа точно както са. Не давай съвети за покупка или продажба и не прогнозирай цени."
)


class StructureTokenError(ValueError):
    """Invalid or expired exercise token (→ 400)."""


@dataclass
class RefSwing:
    index: int
    time: int
    price: float
    kind: str  # high | low
    label: str | None  # HH | LH | HL | LL; None for the anchors
    prev_price: float | None = None
    prev_time: int | None = None

    @property
    def anchor(self) -> bool:
        return self.label is None

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "time": self.time,
            "price": self.price,
            "kind": self.kind,
            "label": self.label,
            "anchor": self.anchor,
            "prev_price": self.prev_price,
            "prev_time": self.prev_time,
        }


@dataclass
class RefEvent:
    type: str  # BREAKOUT | RETEST | FAKEOUT
    index: int
    time: int
    price: float  # the swing level
    direction: str  # up | down
    level_time: int  # time of the swing that formed the level
    end_index: int
    end_time: int
    close: float
    undetermined: bool = False
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "index": self.index,
            "time": self.time,
            "price": self.price,
            "direction": self.direction,
            "level_time": self.level_time,
            "end_index": self.end_index,
            "end_time": self.end_time,
            "close": self.close,
            "undetermined": self.undetermined,
        }


@dataclass
class Reference:
    swings: list[RefSwing]
    events: list[RefEvent]
    atr: float
    tol: float
    structure: dict


# ------------------------------------------------------------------------------------------- reference
def window_atr(candles: list[Candle]) -> float:
    """Average true range over the window (first bar: High − Low)."""
    if not candles:
        return 0.0
    trs = [candles[0].high - candles[0].low]
    for prev, c in zip(candles, candles[1:]):
        trs.append(max(c.high - c.low, abs(c.high - prev.close), abs(c.low - prev.close)))
    return sum(trs) / len(trs)


def reference_swings(candles: list[Candle]) -> list[RefSwing]:
    out: list[RefSwing] = []
    last: dict[str, RefSwing | None] = {"high": None, "low": None}
    for s in find_swings(candles, PIVOT, PIVOT):
        prev = last[s.kind]
        out.append(
            RefSwing(
                index=s.index,
                time=s.ts,
                price=s.price,
                kind=s.kind,
                label=s.label,
                prev_price=prev.price if prev else None,
                prev_time=prev.time if prev else None,
            )
        )
        last[s.kind] = out[-1]
    return out


def structure_verdict(swings: list[RefSwing]) -> dict:
    labels = [s.label for s in swings if s.label]
    counts = {lab: labels.count(lab) for lab in SWING_LABELS}
    up = counts["HH"] + counts["HL"]
    down = counts["LH"] + counts["LL"]
    n = up + down
    up_share = up / n if n else 0.0
    down_share = down / n if n else 0.0
    if n and up_share >= TREND_SHARE:
        expected = "uptrend"
    elif n and down_share >= TREND_SHARE:
        expected = "downtrend"
    else:
        expected = "range"
    last_high = next((s for s in reversed(swings) if s.kind == "high" and s.label), None)
    last_low = next((s for s in reversed(swings) if s.kind == "low" and s.label), None)
    return {
        "expected": expected,
        "counts": counts,
        "labelled": n,
        "up_share": round(up_share, 4),
        "down_share": round(down_share, 4),
        "last_high_label": last_high.label if last_high else None,
        "last_low_label": last_low.label if last_low else None,
    }


def detect_events(candles: list[Candle], swings: list[RefSwing], atr: float) -> list[RefEvent]:
    """BREAKOUT / FAKEOUT / RETEST events of the window (rules in the module docstring)."""
    n = len(candles)
    confirmed_at: dict[int, list[RefSwing]] = {}
    for s in swings:
        confirmed_at.setdefault(s.index + PIVOT, []).append(s)
    last: dict[str, RefSwing | None] = {"high": None, "low": None}
    used: set[tuple[str, int]] = set()  # levels that had a genuine breakout (a level breaks once)
    blocked_until: dict[tuple[str, int], int] = {}  # after a fakeout the level re-arms once price is back
    events: list[RefEvent] = []
    retest_tol = RETEST_ATR * atr
    for i in range(1, n):
        for s in confirmed_at.get(i, ()):
            last[s.kind] = s
        for kind, d in (("high", 1), ("low", -1)):
            s = last[kind]
            if s is None or (kind, s.index) in used or i <= blocked_until.get((kind, s.index), -1):
                continue
            level = s.price
            close, prev_close = candles[i].close, candles[i - 1].close
            if not (d * (close - level) > 0 and d * (prev_close - level) <= 0):
                continue
            direction = "up" if d > 0 else "down"
            back = next(
                (j for j in range(i + 1, min(n, i + 1 + FAKEOUT_BARS)) if d * (candles[j].close - level) < 0),
                None,
            )
            if back is not None:
                blocked_until[(kind, s.index)] = back
                events.append(
                    RefEvent(
                        "FAKEOUT",
                        i,
                        candles[i].ts,
                        level,
                        direction,
                        s.time,
                        back,
                        candles[back].ts,
                        close,
                        detail={"back_close": candles[back].close, "bars_back": back - i},
                    )
                )
                continue
            used.add((kind, s.index))
            undetermined = i + FAKEOUT_BARS >= n
            events.append(
                RefEvent("BREAKOUT", i, candles[i].ts, level, direction, s.time, i, candles[i].ts, close, undetermined)
            )
            if undetermined:
                continue
            for k in range(i + 1, min(n, i + 1 + RETEST_BARS)):
                c = candles[k]
                touch = c.low <= level + retest_tol if d > 0 else c.high >= level - retest_tol
                holds = d * (c.close - level) > 0
                if touch and holds:
                    events.append(
                        RefEvent(
                            "RETEST",
                            k,
                            c.ts,
                            level,
                            direction,
                            s.time,
                            k,
                            c.ts,
                            c.close,
                            detail={"touch": c.low if d > 0 else c.high, "breakout_time": candles[i].ts},
                        )
                    )
                    break
                if not holds:
                    break  # closed back through the level after the fakeout window → no retest of this break
    events.sort(key=lambda e: (e.index, e.type))
    return events


def analyze(candles: list[Candle]) -> Reference:
    swings = reference_swings(candles)
    atr = window_atr(candles)
    return Reference(
        swings=swings,
        events=detect_events(candles, swings, atr),
        atr=atr,
        tol=MATCH_ATR * atr,
        structure=structure_verdict(swings),
    )


def classify_window(candles: list[Candle], ref: Reference) -> str | None:
    """'easy' | 'hard' | 'medium' | None (rules in the module docstring)."""
    st = ref.structure
    n_lab = st["labelled"]
    if n_lab < 4 or not candles:
        return None
    rng = max(c.high for c in candles) - min(c.low for c in candles)
    net = (candles[-1].close - candles[0].close) / rng if rng > 0 else 0.0
    if st["expected"] == "uptrend" and st["up_share"] >= EASY_SHARE and net >= EASY_NET:
        return "easy"
    if st["expected"] == "downtrend" and st["down_share"] >= EASY_SHARE and net <= -EASY_NET:
        return "easy"
    if n_lab < 6:
        return None
    judged = [e for e in ref.events if not e.undetermined]
    if st["expected"] == "range" and abs(net) <= HARD_NET and any(e.type == "FAKEOUT" for e in judged):
        return "hard"
    if judged:
        return "medium"
    return None


# -------------------------------------------------------------------------------------------- exercise
def _history(symbol: str, timeframe: str, now: int) -> list[Candle]:
    from app.services import market_service

    sec = tf_seconds(timeframe)
    rows = market_service.candles(symbol, timeframe, limit=HISTORY_BARS, now=now, include_partial=False)
    return [c for c in rows if c.ts + sec <= now]


def _windows(history: list[Candle]):
    for length in WINDOW_LENGTHS:
        for start in range(0, len(history) - length + 1, WINDOW_STEP):
            yield history[start : start + length]


def pick_window(
    difficulty: str,
    *,
    now: int,
    rng: random.Random,
    symbol: str | None = None,
    timeframe: str | None = None,
) -> tuple[str, str, list[Candle], Reference, bool]:
    """(symbol, timeframe, window, reference, difficulty_matched). Raises DataNotAvailableError without data."""
    from app.market.catalog import get_asset
    from app.market.registry import availability

    if symbol:
        pool = [(symbol, timeframe or "1h")]
    else:
        pool = [(s, timeframe or tf) for s, tf in CANDIDATES if availability(get_asset(s))["available"]]
        rng.shuffle(pool)
    fallback: tuple[str, str, list[Candle], Reference] | None = None
    last_error: MarketDataError | None = None
    for sym, tf in pool:
        try:
            history = _history(sym, tf, now)
        except MarketDataError as exc:
            last_error = exc
            continue
        matches = []
        for win in _windows(history):
            ref = analyze(win)
            kind = classify_window(win, ref)
            if kind == difficulty:
                matches.append((win, ref))
            elif fallback is None and ref.structure["labelled"] >= 4:
                fallback = (sym, tf, win, ref)
        if matches:
            win, ref = rng.choice(matches)
            return sym, tf, win, ref, True
    if fallback is not None:
        return (*fallback, False)
    if last_error is not None:
        raise last_error
    raise DataNotAvailableError("Няма достатъчно затворени свещи за упражнение по пазарна структура.")


def exercise(
    difficulty: str = "medium",
    *,
    now: int | None = None,
    symbol: str | None = None,
    timeframe: str | None = None,
    seed: int | None = None,
) -> dict:
    """GET /api/learn/structure/exercise."""
    from app.services import market_service

    if difficulty not in DIFFICULTIES:
        raise ValueError(f"difficulty must be one of {', '.join(DIFFICULTIES)}")
    now = int(time.time()) if now is None else int(now)
    rng = random.Random(seed if seed is not None else secrets.randbits(64))
    sym, tf, win, ref, matched = pick_window(difficulty, now=now, rng=rng, symbol=symbol, timeframe=timeframe)
    exp = now + TOKEN_TTL
    token = sign_lab_token(
        {
            "k": "sl",
            "s": sym,
            "tf": tf,
            "a": win[0].ts,
            "b": win[-1].ts,
            "nb": len(win),
            "d": difficulty,
            "n": f"{rng.getrandbits(64):016x}",
            "exp": exp,
        }
    )
    spec = market_service.spec(sym)
    scored = [s for s in ref.swings if not s.anchor]
    return {
        "token": token,
        "symbol": sym,
        "timeframe": tf,
        "difficulty": difficulty,
        "difficulty_matched": matched,
        "precision": spec.price_precision,
        "source": market_service.source_of(sym),
        "start": win[0].ts,
        "end": win[-1].ts,
        "bars": len(win),
        "candles": [c.to_dict() for c in win],
        "anchors": [{"time": s.time, "price": s.price, "kind": s.kind} for s in ref.swings if s.anchor],
        "tasks": TASKS,
        "tasks_bg": TASKS_BG,
        "labels": list(LABELS),
        "structures": list(STRUCTURES),
        "pivot": {"left": PIVOT, "right": PIVOT},
        "atr": ref.atr,
        "tolerance": {"bars": MATCH_BARS, "atr_mult": MATCH_ATR, "price": ref.tol},
        "hint": f"В прозореца има {len(scored)} swing-а за етикетиране (без двете отправни точки)."
        if difficulty == "easy"
        else None,
        "rules": RULES_BG,
        "expires_ts": exp,
        "disclaimer": DISCLAIMER,
    }


# ----------------------------------------------------------------------------------------------- check
def _fmt(precision: int):
    return lambda v: f"{v:,.{precision}f}"


def swing_text(s: RefSwing, fmt) -> str:
    what = "връх" if s.kind == "high" else "дъно"
    if s.anchor:
        prev = "предходен връх" if s.kind == "high" else "предходно дъно"
        return (
            f"Първият swing {s.kind} в прозореца ({fmt(s.price)}) — отправна точка без етикет: няма {prev}, с "
            "което да се сравни."
        )
    p, q = fmt(s.price), fmt(s.prev_price)
    if s.kind == "high":
        rel = "над" if s.label == "HH" else ("равен на" if s.price == s.prev_price else "под")
        name = "Higher High" if s.label == "HH" else "Lower High"
        return f"Това е {name}, защото върхът {p} е {rel} предходния връх {q}."
    rel = "над" if s.label == "HL" else ("равно на" if s.price == s.prev_price else "под")
    name = "Higher Low" if s.label == "HL" else "Lower Low"
    return f"Това е {name}, защото {what}то {p} е {rel} предходното дъно {q}."


def event_text(e: RefEvent, fmt) -> str:
    lvl = fmt(e.price)
    side = "над" if e.direction == "up" else "под"
    back = "под" if e.direction == "up" else "над"
    swing = "swing high" if e.direction == "up" else "swing low"
    if e.type == "FAKEOUT":
        return (
            f"Fakeout: свещта затваря {side} {swing} {lvl} ({fmt(e.close)}), но след {e.detail.get('bars_back', 1)} "
            f"свещ(и) цената затваря обратно {back} нивото ({fmt(e.detail.get('back_close', e.close))})."
        )
    if e.type == "RETEST":
        touch = "Low" if e.direction == "up" else "High"
        return (
            f"Retest: след breakout-а {side} {lvl} цената се връща до нивото ({touch} "
            f"{fmt(e.detail.get('touch', e.price))}) и затваря {side} него ({fmt(e.close)})."
        )
    if e.undetermined:
        return (
            f"Breakout {side} {swing} {lvl} (затваряне {fmt(e.close)}) в края на прозореца — още няма "
            f"{FAKEOUT_BARS} свещи след него, затова и breakout, и fakeout се приемат."
        )
    return (
        f"Breakout: първото затваряне {side} последния потвърден {swing} {lvl} ({fmt(e.close)}); следващите "
        f"{FAKEOUT_BARS} свещи остават {side} нивото."
    )


def structure_text(st: dict, answer: str | None) -> str:
    c = st["counts"]
    up, down, n = c["HH"] + c["HL"], c["LH"] + c["LL"], st["labelled"]
    exp = st["expected"]
    base = (
        f"{up} от {n} етикета са HH/HL ({st['up_share']:.0%}), {down} са LH/LL ({st['down_share']:.0%}). "
        f"Правило: ≥ {TREND_SHARE:.0%} HH/HL → uptrend, ≥ {TREND_SHARE:.0%} LH/LL → downtrend, иначе range."
    )
    last = ""
    if st["last_high_label"] and st["last_low_label"]:
        last = f" Последният връх е {st['last_high_label']}, последното дъно е {st['last_low_label']}."
    if answer is None:
        return f"Не избра структура. Правилният отговор е {exp}. {base}{last}"
    if answer == exp:
        return f"Вярно — {exp}. {base}{last}"
    return f"Не е {answer} — структурата е {exp}. {base}{last}"


def _bar_of(times: list[int], t: int, sec: int) -> int | None:
    if not times or t < times[0] - MATCH_BARS * sec or t > times[-1] + MATCH_BARS * sec:
        return None
    i = bisect.bisect_left(times, t)
    if i == 0:
        return 0
    if i >= len(times):
        return len(times) - 1
    return i if times[i] - t < t - times[i - 1] else i - 1


def _event_price_ok(e: RefEvent, bar: Candle, price: float, tol: float) -> bool:
    """A mark matches an event in price when it is near the level or inside the marked bar's range (± tol)."""
    return abs(price - e.price) <= tol or bar.low - tol <= price <= bar.high + tol


def _accepts(e: RefEvent, label: str) -> bool:
    return e.type == label or (e.undetermined and label in ("BREAKOUT", "FAKEOUT"))


def _mark_dict(m) -> dict:
    if isinstance(m, dict):
        return {"time": int(m["time"]), "price": float(m["price"]), "label": str(m["label"])}
    return {"time": int(m.time), "price": float(m.price), "label": str(m.label)}


def grade(
    candles: list[Candle],
    ref: Reference,
    marks: list,
    structure: str | None,
    *,
    precision: int = 2,
    timeframe_seconds: int | None = None,
) -> dict:
    """Pure grading of `marks` ([{time, price, label}]) and the chosen structure against the reference."""
    fmt = _fmt(precision)
    times = [c.ts for c in candles]
    sec = timeframe_seconds or (times[1] - times[0] if len(times) > 1 else 60)
    tol = ref.tol
    matched_s: set[int] = set()
    matched_e: set[int] = set()
    results = []
    marks = [_mark_dict(m) for m in marks]
    for m in marks:
        label = m["label"]
        idx = _bar_of(times, m["time"], sec)
        row = {
            "time": m["time"],
            "price": m["price"],
            "label": label,
            "verdict": "NOT A SWING",
            "expected_label": None,
            "matched_swing": None,
            "scored": True,
            "kind": "swing" if label in SWING_LABELS else "event",
            "explanation": "",
        }
        if label not in LABELS:
            row.update(verdict="INCORRECT", explanation=f"Непознат етикет: {label}.")
            results.append(row)
            continue
        if idx is None:
            row.update(
                verdict="NOT A SWING" if label in SWING_LABELS else "INCORRECT",
                explanation="Маркировката е извън прозореца на упражнението.",
            )
            results.append(row)
            continue
        if label in SWING_LABELS:
            implied = "high" if label in ("HH", "LH") else "low"
            cands = [
                k
                for k, s in enumerate(ref.swings)
                if abs(s.index - idx) <= MATCH_BARS and abs(s.price - m["price"]) <= tol
            ]
            free = [k for k in cands if k not in matched_s]
            if not cands:
                same = [s for s in ref.swings if s.kind == implied]
                near = min(same, key=lambda s: abs(s.index - idx), default=None)
                what = "swing high (връх)" if implied == "high" else "swing low (дъно)"
                text = (
                    f"Тук няма потвърден {what}: свещта трябва да е с най-{'висок High' if implied == 'high' else 'нисък Low'}"
                    f" сред {PIVOT} свещи преди и {PIVOT} след нея (толеранс ±{MATCH_BARS} свещи и "
                    f"{fmt(tol)} по цена)."
                )
                if near is not None:
                    d = near.index - idx
                    where = f"{abs(d)} свещи {'по-късно' if d > 0 else 'по-рано'}" if d else "на същата свещ"
                    text += f" Най-близкият {what} е {fmt(near.price)} ({where})."
                row.update(verdict="NOT A SWING", explanation=text)
            elif not free:
                s = ref.swings[cands[0]]
                row.update(
                    verdict="INCORRECT",
                    expected_label=s.label,
                    matched_swing={"time": s.time, "price": s.price, "kind": s.kind, "label": s.label},
                    explanation="Този swing вече е маркиран — всеки swing се етикетира веднъж.",
                )
            else:
                best = min(
                    free,
                    key=lambda k: (
                        ref.swings[k].kind != implied,
                        abs(ref.swings[k].index - idx),
                        abs(ref.swings[k].price - m["price"]),
                    ),
                )
                s = ref.swings[best]
                matched_s.add(best)
                row["matched_swing"] = {"time": s.time, "price": s.price, "kind": s.kind, "label": s.label}
                if s.anchor:
                    row.update(verdict="REFERENCE", scored=False, explanation=swing_text(s, fmt))
                elif s.label == label:
                    row.update(verdict="CORRECT", expected_label=s.label, explanation=swing_text(s, fmt))
                else:
                    note = ""
                    if s.kind != implied:
                        note = (
                            " Това е swing low (дъно), не връх."
                            if s.kind == "low"
                            else " Това е swing high (връх), не дъно."
                        )
                    row.update(
                        verdict="INCORRECT",
                        expected_label=s.label,
                        explanation=f"Не е {label}.{note} {swing_text(s, fmt)}",
                    )
        else:
            bar = candles[idx]
            cands = [
                k
                for k, e in enumerate(ref.events)
                if e.index - MATCH_BARS <= idx <= e.end_index + MATCH_BARS and _event_price_ok(e, bar, m["price"], tol)
            ]
            free = [k for k in cands if k not in matched_e]
            if not free:
                rule = {
                    "BREAKOUT": "Breakout е първото затваряне над последния потвърден swing high или под последния "
                    "swing low.",
                    "FAKEOUT": f"Fakeout е breakout, след който до {FAKEOUT_BARS} свещи цената затваря обратно от "
                    "другата страна на нивото.",
                    "RETEST": f"Retest е връщане до пробитото ниво до {RETEST_BARS} свещи след breakout, при което "
                    "свещта затваря от страната на пробива.",
                }[label]
                text = (
                    "Това събитие вече е маркирано."
                    if cands
                    else f"Тук няма {label} по правилата на проверката. {rule}"
                )
                row.update(verdict="INCORRECT", explanation=text)
            else:
                best = min(free, key=lambda k: (not _accepts(ref.events[k], label), abs(ref.events[k].index - idx)))
                e = ref.events[best]
                matched_e.add(best)
                row["matched_swing"] = {"time": e.time, "price": e.price, "kind": e.type.lower(), "label": e.type}
                text = event_text(e, fmt)
                if _accepts(e, label):
                    row.update(verdict="CORRECT", expected_label=label if e.undetermined else e.type, explanation=text)
                else:
                    row.update(verdict="INCORRECT", expected_label=e.type, explanation=f"Не е {label}. {text}")
        results.append(row)

    ref_swings = [k for k, s in enumerate(ref.swings) if not s.anchor]
    ref_events = [k for k, e in enumerate(ref.events) if not e.undetermined]
    swing_rows = [r for r in results if r["kind"] == "swing" and r["scored"]]
    event_rows = [r for r in results if r["kind"] == "event"]
    s_ok = sum(1 for r in swing_rows if r["verdict"] == "CORRECT")
    s_bad = len(swing_rows) - s_ok
    e_ok = sum(1 for r in event_rows if r["verdict"] == "CORRECT")
    e_bad = len(event_rows) - e_ok
    s_part = max(0.0, min(1.0, (s_ok - WRONG_MARK_PENALTY * s_bad) / max(1, len(ref_swings))))
    types_present = sorted({ref.events[k].type for k in ref_events}, key=EVENT_LABELS.index)
    found = {r["expected_label"] for r in event_rows if r["verdict"] == "CORRECT"}
    types_found = [t for t in types_present if t in found]
    if types_present:
        e_part = max(0.0, min(1.0, (len(types_found) - WRONG_MARK_PENALTY * e_bad) / len(types_present)))
    else:
        e_part = max(0.0, 1.0 - WRONG_MARK_PENALTY * e_bad)
    st = ref.structure
    answer = structure if structure in STRUCTURES else None
    st_ok = answer == st["expected"]
    score = round(100 * (WEIGHTS["swings"] * s_part + WEIGHTS["structure"] * st_ok + WEIGHTS["events"] * e_part))
    missed = [
        {
            "time": ref.swings[k].time,
            "price": ref.swings[k].price,
            "kind": ref.swings[k].kind,
            "label": ref.swings[k].label,
            "explanation": swing_text(ref.swings[k], fmt),
        }
        for k in ref_swings
        if k not in matched_s
    ]
    missed_events = [
        {
            "type": ref.events[k].type,
            "time": ref.events[k].time,
            "price": ref.events[k].price,
            "direction": ref.events[k].direction,
            "explanation": event_text(ref.events[k], fmt),
        }
        for k in ref_events
        if k not in matched_e
    ]
    summary_parts = [
        f"Резултат {score}/100.",
        f"Swing-ове: {s_ok} верни от {len(ref_swings)}"
        + (f", {s_bad} грешни маркировки" if s_bad else "")
        + (f", {len(missed)} пропуснати" if missed else "")
        + ".",
        f"Структура: {'вярно' if st_ok else 'грешно'} — {st['expected']}.",
        (
            f"Breakout/retest/fakeout: открити {len(types_found)} от {len(types_present)} типа"
            f" ({', '.join(types_present)})"
            if types_present
            else "Breakout/retest/fakeout: в прозореца няма такива събития"
        )
        + (f", {e_bad} грешни маркировки" if e_bad else "")
        + ".",
    ]
    return {
        "marks": results,
        "missed": missed,
        "missed_events": missed_events,
        "structure": {
            "answer": answer,
            "expected": st["expected"],
            "correct": st_ok,
            "counts": st["counts"],
            "up_share": st["up_share"],
            "down_share": st["down_share"],
            "explanation": structure_text(st, answer),
        },
        "score": score,
        "components": {
            "swings": round(s_part * 100, 1),
            "structure": 100.0 if st_ok else 0.0,
            "events": round(e_part * 100, 1),
            "weights": WEIGHTS,
        },
        "counts": {
            "reference_swings": len(ref_swings),
            "reference_events": len(ref_events),
            "event_types_present": types_present,
            "event_types_found": types_found,
            "correct_swings": s_ok,
            "wrong_swing_marks": s_bad,
            "correct_events": e_ok,
            "wrong_event_marks": e_bad,
        },
        "summary": " ".join(summary_parts),
        "reference": {
            "swings": [s.to_dict() for s in ref.swings],
            "events": [e.to_dict() for e in ref.events],
            "structure": st["expected"],
            "atr": ref.atr,
            "tolerance": {"bars": MATCH_BARS, "atr_mult": MATCH_ATR, "price": tol},
        },
    }


def _polish(summary: str) -> str | None:
    """Optional LLM rewording of the summary (safety-filtered; dropped if a number changes)."""
    from app.ai.providers import LLMError, get_llm
    from app.ai.safety import sanitize

    llm = get_llm()
    if llm is None:
        return None
    try:
        text = llm.complete(AI_SYSTEM, [{"role": "user", "content": summary}], max_tokens=300)
    except LLMError:
        return None
    clean, removed = sanitize(text or "")
    clean = clean.strip()
    if removed or not clean:
        return None
    nums = re.findall(r"\d+(?:[.,]\d+)?", summary)
    if any(n not in clean for n in nums):
        return None
    return clean


def load_window(payload: dict, now: int) -> list[Candle]:
    from app.services import market_service

    sym, tf, a, b, nb = payload["s"], payload["tf"], int(payload["a"]), int(payload["b"]), int(payload["nb"])
    sec = tf_seconds(tf)
    rows = market_service.candles(sym, tf, start=a, end=b, limit=nb + 5, now=now, include_partial=False)
    win = [c for c in rows if a <= c.ts <= b and c.ts + sec <= now]
    if len(win) < max(10, int(0.9 * nb)):
        raise DataNotAvailableError(
            f"Доставчикът върна {len(win)} от {nb} свещи за този прозорец — проверката не е възможна.", symbol=sym
        )
    return win


def read_exercise_token(token: str, now: float | None = None) -> dict:
    payload = read_lab_token(token, "sl", now)
    if payload is None or not all(k in payload for k in ("s", "tf", "a", "b", "nb", "n")):
        raise StructureTokenError("Невалиден или изтекъл exercise token — зареди ново упражнение.")
    return payload


def check(
    db,
    user,
    *,
    token: str,
    marks: list,
    structure: str | None,
    now: int | None = None,
    polish: bool = False,
) -> dict:
    """POST /api/learn/structure/check — grade, explain and store the attempt (once per exercise token)."""
    from sqlalchemy import select

    from app.models import StructureAttempt
    from app.services import market_service

    now = int(time.time()) if now is None else int(now)
    payload = read_exercise_token(token, now)
    candles = load_window(payload, now)
    ref = analyze(candles)
    spec = market_service.spec(payload["s"])
    graded = grade(
        candles,
        ref,
        marks,
        structure,
        precision=spec.price_precision,
        timeframe_seconds=tf_seconds(payload["tf"]),
    )
    existing = db.scalars(
        select(StructureAttempt).where(
            StructureAttempt.user_id == user.id,
            StructureAttempt.symbol == payload["s"],
            StructureAttempt.timeframe == payload["tf"],
            StructureAttempt.start_ts == candles[0].ts,
            StructureAttempt.end_ts == candles[-1].ts,
        )
    ).all()
    duplicate = any(isinstance(a.result, dict) and a.result.get("nonce") == payload["n"] for a in existing)
    attempt_id = None
    if not duplicate:
        row = StructureAttempt(
            user_id=user.id,
            symbol=payload["s"],
            timeframe=payload["tf"],
            start_ts=candles[0].ts,
            end_ts=candles[-1].ts,
            marks=[_mark_dict(m) for m in marks],
            score=float(graded["score"]),
            result={
                "nonce": payload["n"],
                "difficulty": payload.get("d"),
                "structure": {k: graded["structure"][k] for k in ("answer", "expected", "correct")},
                "components": graded["components"],
                "counts": graded["counts"],
                "summary": graded["summary"],
            },
        )
        db.add(row)
        db.commit()
        attempt_id = row.id
    return {
        "symbol": payload["s"],
        "timeframe": payload["tf"],
        "difficulty": payload.get("d"),
        "start": candles[0].ts,
        "end": candles[-1].ts,
        **graded,
        "ai_summary": _polish(graded["summary"]) if polish else None,
        "checker": "deterministic",
        "stored": not duplicate,
        "attempt_id": attempt_id,
        "note": STORE_NOTE_DUPLICATE if duplicate else None,
        "disclaimer": DISCLAIMER,
    }


def history(db, user, *, limit: int = 20) -> dict:
    """GET /api/learn/structure/history — last attempts + best / average score (overall and per difficulty)."""
    from sqlalchemy import select

    from app.models import StructureAttempt

    rows = list(
        db.scalars(
            select(StructureAttempt)
            .where(StructureAttempt.user_id == user.id)
            .order_by(StructureAttempt.created_ts.desc(), StructureAttempt.id.desc())
        )
    )

    def stats(items: list) -> dict:
        scores = [float(r.score) for r in items]
        return {
            "count": len(scores),
            "best_score": max(scores) if scores else None,
            "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        }

    by_diff = {d: stats([r for r in rows if (r.result or {}).get("difficulty") == d]) for d in DIFFICULTIES}
    overall = stats(rows)
    return {
        "attempts": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "timeframe": r.timeframe,
                "difficulty": (r.result or {}).get("difficulty"),
                "start": r.start_ts,
                "end": r.end_ts,
                "score": r.score,
                "structure": (r.result or {}).get("structure"),
                "marks": len(r.marks or []),
                "summary": (r.result or {}).get("summary"),
                "created_ts": r.created_ts,
            }
            for r in rows[: max(1, min(limit, 100))]
        ],
        **overall,
        "last_score": rows[0].score if rows else None,
        "by_difficulty": by_diff,
    }
