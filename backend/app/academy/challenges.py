"""Skill challenges. They reward process (defined stops, small risk, patience), never
profit or trade count for its own sake."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import time

from app.academy.scenarios import SCENARIOS, build
from app.config import get_settings

CHALLENGES: list[dict] = [
    {
        "key": "identify_trend",
        "title": "Identify trend",
        "kind": "interactive",
        "xp": 30,
        "target": 4,
        "description": "Разпознай тренда на 5 графики (uptrend / downtrend / range). Нужни са 4 верни отговора.",
        "lesson": "trend",
    },
    {
        "key": "find_support",
        "title": "Find support",
        "kind": "interactive",
        "xp": 30,
        "target": 3,
        "description": "Кликни върху support зоната на 4 графики. Нужни са 3 точни попадения.",
        "lesson": "support",
    },
    {
        "key": "trade_breakout",
        "title": "Trade a breakout",
        "kind": "auto",
        "xp": 40,
        "target": 1,
        "description": "Затвори paper или replay сделка със setup 'breakout', с предварително зададен stop loss.",
        "lesson": "pa-breakout",
    },
    {
        "key": "risk_1pct",
        "title": "Risk 1% or less",
        "kind": "auto",
        "xp": 50,
        "target": 10,
        "description": "10 поредни paper сделки с риск ≤ 1% от сметката.",
        "lesson": "risk-per-trade",
    },
    {
        "key": "no_overtrade",
        "title": "Do not overtrade",
        "kind": "auto",
        "xp": 50,
        "target": 5,
        "description": "5 дни с търговия, в които правиш между 1 и 3 сделки на ден.",
        "lesson": "overtrading",
    },
    {
        "key": "twenty_with_stop",
        "title": "Complete 20 trades with a defined stop",
        "kind": "auto",
        "xp": 80,
        "target": 20,
        "description": "20 затворени paper сделки, всяка със stop loss, зададен при влизането.",
        "lesson": "stop-loss-placement",
    },
    {
        "key": "journal_5",
        "title": "Journal 5 trades",
        "kind": "auto",
        "xp": 30,
        "target": 5,
        "description": "Запиши 5 сделки в журнала с причина, емоция и урок.",
        "lesson": "discipline",
    },
    {
        "key": "first_backtest",
        "title": "Backtest with a real sample",
        "kind": "auto",
        "xp": 40,
        "target": 1,
        "description": "Пусни backtest, който генерира поне 30 сделки, и прочети validation панела.",
        "lesson": "sample-size",
    },
    {
        "key": "safe_bot",
        "title": "Paper bot with guard rails",
        "kind": "auto",
        "xp": 40,
        "target": 1,
        "description": "Създай paper бот с daily loss limit ≤ 3% и риск ≤ 1% на сделка и го стартирай.",
        "lesson": "daily-loss-limit",
    },
]
CHALLENGES_BY_KEY = {c["key"]: c for c in CHALLENGES}


def _sign(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    mac = hmac.new(get_settings().secret_key.encode(), raw, hashlib.sha256).hexdigest()[:24]
    return base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + mac


def verify_token(token: str) -> dict | None:
    try:
        body, mac = token.rsplit(".", 1)
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    except (ValueError, TypeError):
        return None
    good = hmac.new(get_settings().secret_key.encode(), raw, hashlib.sha256).hexdigest()[:24]
    if not hmac.compare_digest(good, mac):
        return None
    payload = json.loads(raw)
    if payload.get("exp", 0) < time.time():
        return None
    return payload


def _scaled(candles: list[dict], factor: float) -> list[dict]:
    return [{**c, **{k: round(c[k] * factor, 2) for k in ("open", "high", "low", "close")}} for c in candles]


def new_rounds(key: str, seed: int | None = None) -> list[dict]:
    rng = random.Random(seed if seed is not None else time.time_ns())
    exp = int(time.time()) + 3600
    rounds = []
    if key == "identify_trend":
        pool = [
            ("uptrend", "uptrend"),
            ("downtrend", "downtrend"),
            ("range", "range"),
            ("retest", "uptrend"),
            ("support_bounce", "range"),
            ("trend_reversal", "downtrend"),
        ]
        picks = rng.sample(pool, 5)
        for i, (scenario, answer) in enumerate(picks):
            factor = rng.uniform(0.6, 3.0)
            candles = _scaled(build(SCENARIOS[scenario], seed=rng.randint(1, 10_000)), factor)
            if scenario == "trend_reversal":
                candles = candles[30:]  # show only the new downtrend part
            rounds.append(
                {
                    "index": i,
                    "candles": candles,
                    "options": ["uptrend", "downtrend", "range"],
                    "token": _sign({"k": key, "i": i, "a": answer, "exp": exp}),
                }
            )
    elif key == "find_support":
        pool = [("range", 100.0), ("support_bounce", 100.0), ("liquidity_sweep", 100.0), ("fakeout", 103.0)]
        rng.shuffle(pool)
        for i, (scenario, level) in enumerate(pool):
            factor = rng.uniform(0.5, 4.0)
            candles = _scaled(build(SCENARIOS[scenario], seed=rng.randint(1, 10_000)), factor)
            rounds.append(
                {
                    "index": i,
                    "candles": candles,
                    "token": _sign(
                        {"k": key, "i": i, "a": round(level * factor, 4), "tol": round(1.6 * factor, 4), "exp": exp}
                    ),
                }
            )
    else:
        raise KeyError(key)
    return rounds


def grade(key: str, answers: list[dict]) -> dict:
    """answers: [{"token": ..., "answer": "uptrend" | price}]"""
    results = []
    for a in answers:
        payload = verify_token(a.get("token", ""))
        if not payload or payload.get("k") != key:
            results.append({"correct": False, "explanation": "Невалиден или изтекъл рунд."})
            continue
        if key == "identify_trend":
            ok = str(a.get("answer")).lower() == payload["a"]
            expl = {
                "uptrend": "Higher highs и higher lows.",
                "downtrend": "Lower highs и lower lows.",
                "range": "Цената осцилира между две хоризонтални нива.",
            }[payload["a"]]
            results.append({"correct": ok, "expected": payload["a"], "explanation": expl})
        else:
            try:
                price = float(a.get("answer"))
            except (TypeError, ValueError):
                price = float("nan")
            ok = abs(price - payload["a"]) <= payload["tol"]
            results.append(
                {
                    "correct": ok,
                    "expected": payload["a"],
                    "explanation": f"Support зоната е около {payload['a']:.2f} — там цената многократно е спирала спада.",
                }
            )
    correct = sum(r["correct"] for r in results)
    target = CHALLENGES_BY_KEY[key]["target"]
    return {"correct": correct, "total": len(results), "passed": correct >= target, "results": results}
