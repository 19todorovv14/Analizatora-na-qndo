"""Deterministic, annotated chart scenarios for lessons (animated candle by candle).

A scenario is a list of waypoints (bar index, price). The path between waypoints is a
noisy bridge that hits every waypoint exactly, so annotations (HH, support, breakout…)
are always in the right place.
"""

from __future__ import annotations

import math
import random

START_TS = 1704067200  # 2024-01-01, synthetic time axis
BAR = 3600


def _path(waypoints: list[tuple[int, float]], noise: float, rng: random.Random) -> list[float]:
    prices: list[float] = []
    for (i0, p0), (i1, p1) in zip(waypoints, waypoints[1:], strict=False):
        n = i1 - i0
        walk = [0.0]
        for _ in range(n):
            walk.append(walk[-1] + rng.gauss(0, 1))
        for k in range(n):
            t = k / n
            bridge = walk[k] - t * walk[-1]
            prices.append(p0 + (p1 - p0) * t + bridge * noise * math.sin(math.pi * t) ** 0.5)
    prices.append(waypoints[-1][1])
    return prices


def build(spec: dict, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    wps = spec["waypoints"]
    noise = spec.get("noise", 0.35)
    path = _path(wps, noise, rng)
    wp_index = {i: p for i, p in wps}
    vol_events = spec.get("volume", {})
    wick = spec.get("wick", 0.45)
    candles = []
    for i in range(1, len(path)):
        o, c = path[i - 1], path[i]
        hi = max(o, c) + abs(rng.gauss(0, wick))
        lo = min(o, c) - abs(rng.gauss(0, wick))
        if i in wp_index:  # make swing points the true extremes of their bar
            prev_p = path[i - 1]
            nxt = path[i + 1] if i + 1 < len(path) else c
            if c >= prev_p and c >= nxt:
                hi = c + abs(rng.gauss(0, wick * 0.4))
            if c <= prev_p and c <= nxt:
                lo = c - abs(rng.gauss(0, wick * 0.4))
        for ev_i, (wk_hi, wk_lo) in spec.get("wicks", {}).items():
            if i == ev_i:
                hi = max(hi, max(o, c) + wk_hi)
                lo = min(lo, min(o, c) - wk_lo)
        base_vol = 1000 * (1 + 0.3 * rng.random())
        vol = base_vol * vol_events.get(i, 1.0)
        candles.append(
            {
                "time": START_TS + i * BAR,
                "open": round(o, 2),
                "high": round(hi, 2),
                "low": round(lo, 2),
                "close": round(c, 2),
                "volume": round(vol, 1),
            }
        )
    return candles


def _m(index: int, text: str, position: str = "above", color: str = "#e2e8f0") -> dict:
    return {"type": "marker", "index": index, "text": text, "position": position, "color": color}


def _line(price: float, label: str, color: str = "#38bdf8", style: str = "dashed") -> dict:
    return {"type": "line", "price": price, "label": label, "color": color, "style": style}


def _zone(low: float, high: float, label: str, color: str = "rgba(56,189,248,0.12)") -> dict:
    return {"type": "zone", "low": low, "high": high, "label": label, "color": color}


SCENARIOS: dict[str, dict] = {
    "uptrend": {
        "title": "Uptrend: Higher Highs и Higher Lows",
        "waypoints": [(0, 100), (10, 108), (16, 104), (28, 115), (34, 110), (47, 122), (53, 117), (66, 129)],
        "annotations": [
            _m(10, "HH"),
            _m(16, "HL", "below"),
            _m(28, "HH"),
            _m(34, "HL", "below"),
            _m(47, "HH"),
            _m(53, "HL", "below"),
        ],
        "steps": [
            {"at": 10, "text": "Първи връх. Още не знаем дали е тренд."},
            {"at": 16, "text": "Pullback, който спира ПО-ВИСОКО от началото → Higher Low."},
            {"at": 28, "text": "Нов връх над предишния → Higher High. Структурата е бича."},
            {"at": 53, "text": "Докато всяко дъно е по-високо, uptrend-ът е непокътнат."},
        ],
    },
    "downtrend": {
        "title": "Downtrend: Lower Highs и Lower Lows",
        "waypoints": [(0, 130), (10, 121), (16, 125), (28, 114), (34, 119), (47, 107), (53, 112), (66, 100)],
        "annotations": [
            _m(10, "LL", "below"),
            _m(16, "LH"),
            _m(28, "LL", "below"),
            _m(34, "LH"),
            _m(47, "LL", "below"),
            _m(53, "LH"),
        ],
        "steps": [
            {"at": 16, "text": "Отскокът спира под предишния връх → Lower High."},
            {"at": 28, "text": "Ново по-ниско дъно → Lower Low. Продавачите контролират."},
            {"at": 53, "text": "Всеки отскок е по-слаб — това е downtrend."},
        ],
    },
    "range": {
        "title": "Range: цената между support и resistance",
        "waypoints": [(0, 105), (8, 110), (16, 100.4), (25, 109.7), (33, 100.2), (42, 109.9), (50, 100.5), (60, 106)],
        "annotations": [_line(110, "Resistance", "#f87171"), _line(100, "Support", "#4ade80")],
        "steps": [
            {"at": 8, "text": "Цената спира около 110 — продавачите са активни там."},
            {"at": 16, "text": "Около 100 купувачите влизат — support."},
            {"at": 42, "text": "Многократни докосвания = range. В средата R:R е лош."},
        ],
    },
    "breakout": {
        "title": "Breakout с обем",
        "waypoints": [
            (0, 104),
            (8, 109.8),
            (15, 103),
            (23, 109.9),
            (30, 104),
            (38, 109.7),
            (42, 108.5),
            (46, 114),
            (55, 118),
        ],
        "volume": {44: 2.6, 45: 3.1, 46: 2.4},
        "annotations": [_line(110, "Resistance", "#f87171"), _m(45, "Breakout", "above", "#facc15")],
        "steps": [
            {"at": 38, "text": "Трети тест на 110. Натрупване под resistance."},
            {"at": 45, "text": "Затваряне над 110 с голям обем — breakout."},
            {"at": 55, "text": "Обемът потвърждава интерес. Но breakout-ите не винаги успяват."},
        ],
    },
    "fakeout": {
        "title": "Fakeout (фалшив пробив)",
        "waypoints": [
            (0, 104),
            (8, 109.8),
            (15, 103),
            (23, 109.8),
            (30, 105),
            (36, 109.5),
            (38, 111.6),
            (41, 106),
            (50, 101.5),
        ],
        "volume": {38: 1.3},
        "wicks": {38: (1.4, 0.2)},
        "annotations": [_line(110, "Resistance", "#f87171"), _m(38, "Fakeout", "above", "#f87171")],
        "steps": [
            {"at": 38, "text": "Цената излиза над 110... но обемът е слаб."},
            {"at": 41, "text": "Връща се обратно в range — купувачите, гонили пробива, са 'хванати'."},
            {"at": 50, "text": "Затова чакаме затваряне + обем, и винаги имаме стоп."},
        ],
    },
    "retest": {
        "title": "Retest: старата resistance става support",
        "waypoints": [(0, 103), (9, 109.8), (16, 104), (24, 109.8), (28, 113.5), (34, 110.3), (38, 112), (48, 119)],
        "volume": {27: 2.4, 28: 2.0},
        "annotations": [_line(110, "Ниво 110", "#facc15"), _m(28, "Breakout"), _m(34, "Retest", "below", "#4ade80")],
        "steps": [
            {"at": 28, "text": "Пробив над 110."},
            {"at": 34, "text": "Връщане до 110 отгоре — бившата resistance задържа като support."},
            {"at": 48, "text": "Retest-ът дава по-ясна invalidation точка: под 110."},
        ],
    },
    "consolidation": {
        "title": "Consolidation (свиване на волатилността)",
        "waypoints": [
            (0, 100),
            (10, 112),
            (15, 108),
            (20, 111),
            (25, 108.8),
            (30, 110.6),
            (35, 109.3),
            (40, 110.2),
            (44, 109.6),
            (52, 116),
        ],
        "noise": 0.2,
        "volume": {48: 2.2, 49: 2.0},
        "annotations": [_zone(108.5, 111.2, "Consolidation")],
        "steps": [
            {"at": 25, "text": "След силно движение пазарът 'почива' — свещите се свиват."},
            {"at": 44, "text": "Все по-тесен диапазон: енергията се натрупва."},
            {"at": 52, "text": "Излизане от консолидацията — посоката не е известна предварително."},
        ],
    },
    "support_bounce": {
        "title": "Support bounce",
        "waypoints": [(0, 112), (10, 100.3), (18, 107), (27, 100.1), (29, 102.5), (40, 110)],
        "wicks": {27: (0.2, 1.5)},
        "annotations": [_line(100, "Support", "#4ade80"), _m(27, "Hammer", "below", "#4ade80")],
        "steps": [
            {"at": 27, "text": "Повторно тестване на support с дълъг долен wick — купувачите отхвърлят по-ниски цени."},
            {"at": 29, "text": "Потвърждение: следващата свещ затваря по-високо."},
            {"at": 40, "text": "Стопът логично е под support — там идеята е грешна."},
        ],
    },
    "resistance_rejection": {
        "title": "Resistance rejection",
        "waypoints": [(0, 98), (10, 109.7), (18, 103), (27, 109.9), (29, 107.5), (40, 100)],
        "wicks": {27: (1.6, 0.2)},
        "annotations": [_line(110, "Resistance", "#f87171"), _m(27, "Shooting star", "above", "#f87171")],
        "steps": [
            {"at": 27, "text": "Цената опитва над 110, но затваря доста по-ниско — дълъг горен wick."},
            {"at": 29, "text": "Следващата свещ потвърждава отхвърлянето."},
        ],
    },
    "trend_reversal": {
        "title": "Trend reversal (смяна на структурата)",
        "waypoints": [(0, 100), (10, 110), (15, 106), (25, 116), (31, 111), (38, 114), (45, 105), (51, 109), (60, 99)],
        "annotations": [
            _m(25, "HH"),
            _m(31, "HL", "below"),
            _m(38, "LH", "above", "#f87171"),
            _m(45, "LL (пробив на HL)", "below", "#f87171"),
            _m(51, "LH", "above", "#f87171"),
        ],
        "steps": [
            {"at": 38, "text": "Първи предупреждение: връх ПОД предишния (Lower High)."},
            {"at": 45, "text": "Пробив под последния Higher Low — структурата се счупи."},
            {"at": 51, "text": "Нов Lower High потвърждава: вече е downtrend."},
        ],
    },
    "momentum": {
        "title": "Momentum: силни свещи в една посока",
        "waypoints": [(0, 100), (20, 103), (24, 104), (32, 118), (36, 116), (45, 124)],
        "volume": {25: 1.8, 26: 2.2, 27: 2.4, 28: 2.0, 29: 1.8},
        "noise": 0.2,
        "annotations": [_m(27, "Momentum", "above", "#facc15")],
        "steps": [
            {"at": 24, "text": "Тихо... после поредица от големи бичи свещи с растящ обем."},
            {"at": 32, "text": "Силният momentum често продължава, но влизане след 5 големи свещи е 'chasing'."},
        ],
    },
    "high_volatility": {
        "title": "Висока волатилност",
        "waypoints": [(0, 100), (5, 108), (9, 97), (13, 111), (17, 95), (22, 109), (27, 96), (32, 106)],
        "noise": 1.2,
        "wick": 1.6,
        "steps": [
            {"at": 9, "text": "Огромни свещи в двете посоки."},
            {"at": 22, "text": "Тесен стоп тук ще бъде 'изваден' от шума. Нужен е по-широк стоп и по-малка позиция."},
        ],
    },
    "low_volatility": {
        "title": "Ниска волатилност",
        "waypoints": [(0, 100), (10, 101), (20, 100.2), (30, 101.1), (40, 100.4), (50, 100.9)],
        "noise": 0.12,
        "wick": 0.12,
        "steps": [
            {"at": 30, "text": "Малки свещи, малко движение. Спредът и таксите стават голяма част от потенциала."}
        ],
    },
    "liquidity_sweep": {
        "title": "Liquidity sweep (изчистване на стопове)",
        "waypoints": [
            (0, 106),
            (9, 100.4),
            (16, 105),
            (24, 100.3),
            (31, 104.6),
            (36, 100.6),
            (37, 99.2),
            (39, 103),
            (50, 110),
        ],
        "wicks": {37: (0.2, 1.8)},
        "volume": {37: 2.8},
        "annotations": [_line(100, "Равни дъна (стопове под тях)", "#facc15"), _m(37, "Sweep", "below", "#facc15")],
        "steps": [
            {"at": 36, "text": "Много трейдъри държат стопове точно под равните дъна при 100."},
            {"at": 37, "text": "Бърз удар под 100 задейства стоповете (ликвидност), после рязко връщане."},
            {"at": 50, "text": "Затова стопът не се слага точно на очевидното ниво, а с буфер според ATR."},
        ],
    },
    "volume_spike": {
        "title": "Обемът потвърждава движението",
        "waypoints": [(0, 100), (15, 102), (18, 101.5), (20, 108), (30, 111)],
        "volume": {19: 3.0, 20: 3.4},
        "annotations": [_m(20, "Голям обем", "above", "#facc15")],
        "steps": [{"at": 20, "text": "Движение с 3× обичайния обем показва реален интерес, не само шум."}],
    },
}


def get_scenario(key: str) -> dict:
    spec = SCENARIOS[key]
    candles = build(spec)
    return {
        "key": key,
        "title": spec["title"],
        "candles": candles,
        "annotations": [
            {**a, "time": candles[a["index"] - 1]["time"]} if a["type"] == "marker" else a
            for a in spec.get("annotations", [])
        ],
        "steps": spec.get("steps", []),
    }
