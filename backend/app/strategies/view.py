"""STRATEGY VIEW — "What would the strategy do?"

Evaluates a rule-based strategy on the latest CLOSED candle and explains every condition
(label, pass/fail, left/right values, plain-language explanation), APPLIES the strategy's
regime filter and, when a setup exists, derives a hypothetical risk plan from the
strategy's own stop / take-profit rules.

Nothing here predicts prices or places orders: the result is always one of
"POSSIBLE LONG SETUP" / "POSSIBLE SHORT SETUP" / "NO SETUP" plus the exact disclaimer
`SETUP_DISCLAIMER`. Only public functions of app.strategies.rules are used
(IndicatorCache, evaluate_block, stop_distance, target_distance, describe), so operand
types added to the DSL later are supported automatically.
"""

from __future__ import annotations

from datetime import UTC, datetime
from math import floor, log10

from app import indicators as ind
from app.analysis.signal import HARD_BLOCKERS, analyze
from app.market.base import AssetSpec, Candle
from app.strategies.rules import (
    IndicatorCache,
    StrategyDefinition,
    describe,
    evaluate_block,
    stop_distance,
    target_distance,
)

SETUP_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement."
RESULT_LONG = "POSSIBLE LONG SETUP"
RESULT_SHORT = "POSSIBLE SHORT SETUP"
RESULT_NONE = "NO SETUP"
MIN_BARS = 60

_OP_TEXT = {"<": "под", ">": "над", "<=": "под или равно на", ">=": "над или равно на"}
_LOGIC_TEXT = {"all": "всички условия (AND)", "any": "поне едно условие (OR)"}


# --------------------------------------------------------------- formatting
def _round_sig(v: float, digits: int = 4) -> float:
    if v == 0:
        return 0.0
    return round(v, max(0, digits - 1 - floor(log10(abs(v)))))


def _operand_kind(op) -> str:
    """'price' (price units), 'volume', 'ratio' (oscillators/values) or 'flag' (0/1 structure operands)."""
    if op is None:
        return "ratio"
    kind = getattr(op, "kind", None)
    if kind == "price":
        return "volume" if getattr(op, "field", None) == "volume" else "price"
    if kind == "indicator":
        name = getattr(op, "name", "") or ""
        meta = ind.INDICATOR_CATALOG.get(name) or {}
        if name == "atr" or meta.get("pane") == "price":
            return "price"
        if meta.get("pane") == "volume":
            return "volume"
        return "ratio"
    if kind == "value":
        return "ratio"
    return "flag"  # structure / pattern operands (added by DSL v2) evaluate to 1/0


def _round_value(op, v: float | None, spec: AssetSpec) -> float | None:
    if v is None:
        return None
    k = _operand_kind(op)
    if k == "price":
        return round(v, spec.price_precision)
    if k == "volume":
        return round(v, 2)
    if k == "flag":
        return round(v, 4)
    return _round_sig(v, 6) if abs(v) < 1 else round(v, 4)


def _fmt_value(op, v: float | None, spec: AssetSpec) -> str:
    if v is None:
        return "—"
    k = _operand_kind(op)
    if k == "price":
        return f"{v:,.{spec.price_precision}f}"
    if k == "volume":
        return f"{v:,.0f}"
    if k == "flag":
        return "да" if v else "не"
    if abs(v) >= 1000:
        return f"{v:,.2f}"
    if abs(v) >= 1:
        return f"{v:.2f}".rstrip("0").rstrip(".")
    return f"{_round_sig(v, 4):g}"


def _label(obj, fallback: str = "") -> str:
    try:
        return obj.label()
    except Exception:  # noqa: BLE001 - operand types added later may not implement label()
        return fallback


def _explain(cond, res: dict, spec: AssetSpec) -> str:
    label = res.get("label") or _label(cond, "условие")
    lv, rv = res.get("left"), res.get("right")
    op = getattr(cond, "op", "")
    passed = bool(res.get("passed"))
    mark = "изпълнено" if passed else "не е изпълнено"
    left, right = getattr(cond, "left", None), getattr(cond, "right", None)
    if op in ("is_true", "is_false"):
        if lv is None:
            return f"{label}: няма достатъчно данни (warm-up) → {mark}."
        state = "да" if lv else "не"
        want = "да" if op == "is_true" else "не"
        return f"{label}: текущо '{state}', правилото иска '{want}' → {mark}."
    if lv is None or rv is None:
        return f"{label}: няма достатъчно история за изчисление (warm-up на индикатора) → {mark}."
    lname, rname = _label(left, "лява страна"), _label(right, "дясна страна")
    lt, rt = _fmt_value(left, lv, spec), _fmt_value(right, rv, spec)
    if op in ("crosses_above", "crosses_below"):
        direction = "нагоре" if op == "crosses_above" else "надолу"
        if passed:
            return f"{lname} ({lt}) пресече {direction} {rname} ({rt}) на последната затворена свещ → {mark}."
        rel = "над" if lv > rv else "под" if lv < rv else "равно на"
        return (
            f"{lname} ({lt}) е {rel} {rname} ({rt}), но пресичане {direction} на последната затворена свещ "
            f"няма → {mark}."
        )
    rel = _OP_TEXT.get(op, op)
    return f"{lname} = {lt}, {rname} = {rt}; правилото иска {lname} {rel} {rname} → {mark}."


def _rows(block, ev: dict, spec: AssetSpec) -> list[dict]:
    if block is None:
        return []
    out = []
    for cond, res in zip(block.conditions, ev.get("conditions") or [], strict=False):
        out.append(
            {
                "label": res.get("label") or _label(cond, "условие"),
                "passed": bool(res.get("passed")),
                "left_value": _round_value(getattr(cond, "left", None), res.get("left"), spec),
                "right_value": _round_value(getattr(cond, "right", None), res.get("right"), spec),
                "explanation": _explain(cond, res, spec),
            }
        )
    return out


def _side_summary(name: str, block, ev: dict, rows: list[dict]) -> str:
    if block is None:
        return f"{name}: стратегията няма правила за {name}."
    met = sum(1 for r in rows if r["passed"])
    logic = ev.get("logic") or getattr(block, "logic", "all")
    need = _LOGIC_TEXT.get(logic, logic)
    if ev.get("passed"):
        return f"{name}: изпълнени {met} от {len(rows)} условия (нужни са {need}) → правилата са изпълнени."
    missing = [r["label"] for r in rows if not r["passed"]]
    tail = f" Не е изпълнено: {'; '.join(missing[:4])}." if missing else ""
    return f"{name}: изпълнени {met} от {len(rows)} условия (нужни са {need}).{tail}"


def _rule_texts(defn: StrategyDefinition) -> tuple[str, str]:
    stop_txt = target_txt = ""
    for line in describe(defn):
        if line.startswith("STOP:"):
            stop_txt = line[5:].strip()
        elif line.startswith("TAKE PROFIT:"):
            target_txt = line[12:].strip()
    return stop_txt, target_txt


def _utc(ts: int | None) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M UTC") if ts else "—"


def _levels(items: list[dict] | None, spec: AssetSpec) -> list[dict]:
    return [{"price": spec.round_price(x["price"]), "touches": x.get("touches", 1)} for x in (items or [])]


# --------------------------------------------------------------------- view
def strategy_view(
    candles: list[Candle],
    strategy: StrategyDefinition | dict,
    spec: AssetSpec,
    timeframe: str,
    *,
    info: dict | None = None,
    analysis: dict | None = None,
    source: str | None = None,
) -> dict:
    """What would `strategy` do on the latest CLOSED candle of `candles`?

    `candles` must contain closed candles only (the caller fetches with include_partial=False).
    `info` = {id, name, is_template, selected, source} is echoed back as `strategy`.
    `analysis` may be a precomputed app.analysis.signal.analyze() result for the same candles.
    """
    defn = strategy if isinstance(strategy, StrategyDefinition) else StrategyDefinition(**strategy)
    summary = describe(defn)
    stop_txt, target_txt = _rule_texts(defn)
    base = {
        "symbol": spec.symbol,
        "timeframe": timeframe,
        "strategy": {**(info or {}), "summary": summary},
        "closed_candles_only": True,
        "disclaimer": SETUP_DISCLAIMER,
    }
    required = list(defn.regime_filter)
    if len(candles) < MIN_BARS:
        return {
            **base,
            "available": False,
            "reason": f"Недостатъчно история ({len(candles)} свещи) — нужни са поне {MIN_BARS} затворени свещи.",
            "time": candles[-1].ts if candles else None,
            "price": candles[-1].close if candles else None,
            "data_source": source,
            "regime": None,
            "structure": None,
            "momentum": None,
            "volatility": None,
            "support": [],
            "resistance": [],
            "conditions": {"long": [], "short": []},
            "logic": {"long": None, "short": None},
            "long_passed": False,
            "short_passed": False,
            "regime_filter": {"required": required, "actual": None, "passed": not required},
            "result": RESULT_NONE,
            "why": ["Няма достатъчно затворени свещи за оценка на правилата — NO SETUP."],
            "warnings": [],
            "risk_plan": None,
        }

    a = analysis if analysis is not None else analyze(candles, spec=spec, timeframe=timeframe, source=source or "demo")
    last = candles[-1]
    i = len(candles) - 1
    cache = IndicatorCache(candles)
    long_ev = evaluate_block(defn.entry_long, cache, i)
    short_ev = evaluate_block(defn.entry_short, cache, i)
    long_rows = _rows(defn.entry_long, long_ev, spec)
    short_rows = _rows(defn.entry_short, short_ev, spec)

    regime = (a.get("regime") or {}).get("regime") or "UNCLEAR"
    regime_ok = not required or regime in required
    long_ok, short_ok = bool(long_ev.get("passed")), bool(short_ev.get("passed"))

    why: list[str] = [
        f"Оценката е върху последната ЗАТВОРЕНА свещ ({_utc(last.ts)}, close {last.close:,.{spec.price_precision}f})."
    ]
    why.append(_side_summary("LONG", defn.entry_long, long_ev, long_rows))
    why.append(_side_summary("SHORT", defn.entry_short, short_ev, short_rows))
    if required:
        why.append(
            f"Regime filter: позволени режими {', '.join(required)}; текущ режим {regime} → "
            + ("разрешено." if regime_ok else "БЛОКИРАНО — стратегията не търгува в този режим.")
        )
    else:
        why.append(f"Regime filter: няма (стратегията търгува във всеки режим); текущ режим {regime}.")

    side: str | None = None
    if long_ok and short_ok:
        result = RESULT_NONE
        why.append("И LONG, и SHORT правилата са изпълнени едновременно — конфликтни сигнали → NO SETUP.")
    elif (long_ok or short_ok) and not regime_ok:
        result = RESULT_NONE
        why.append(
            f"Правилата за {'LONG' if long_ok else 'SHORT'} са изпълнени, но режимът {regime} не е разрешен "
            "от regime filter-а → NO SETUP."
        )
    elif long_ok:
        result, side = RESULT_LONG, "long"
        why.append("Всички изисквания за LONG са изпълнени → POSSIBLE LONG SETUP (хипотетичен, по правилата).")
    elif short_ok:
        result, side = RESULT_SHORT, "short"
        why.append("Всички изисквания за SHORT са изпълнени → POSSIBLE SHORT SETUP (хипотетичен, по правилата).")
    else:
        result = RESULT_NONE
        why.append("Нито LONG, нито SHORT правилата са изпълнени → NO SETUP. Да не търгуваш също е решение.")

    risk_plan = None
    vol = a.get("volatility") or {}
    atr = vol.get("atr")
    if side is not None:
        entry = last.close
        d = stop_distance(defn, cache, i, "buy" if side == "long" else "sell")
        if d is None or d <= 0:
            risk_plan = {
                "side": side,
                "entry": spec.round_price(entry),
                "stop": None,
                "target": None,
                "rr": None,
                "risk_per_unit": None,
                "stop_atr": None,
                "stop_rule": stop_txt,
                "target_rule": target_txt,
                "risk_per_trade_pct": defn.risk_per_trade_pct,
                "note": "Stop правилото още няма стойност (warm-up) — без stop няма валиден план.",
            }
        else:
            stop = entry - d if side == "long" else entry + d
            t = target_distance(defn, cache, i, d)
            target = None if t is None else (entry + t if side == "long" else entry - t)
            risk_plan = {
                "side": side,
                "entry": spec.round_price(entry),
                "stop": spec.round_price(stop),
                "target": spec.round_price(target) if target is not None else None,
                "rr": round(t / d, 2) if t is not None else None,
                "risk_per_unit": spec.round_price(d),
                "stop_atr": round(d / atr, 2) if atr else None,
                "stop_rule": stop_txt,
                "target_rule": target_txt,
                "risk_per_trade_pct": defn.risk_per_trade_pct,
                "note": "Entry = close на последната затворена свещ. В backtest/bot изпълнението е на open на "
                "следващата свещ, затова реалният вход може да се различава.",
            }
            why.append(
                f"Risk plan по правилата: stop {stop_txt} → {risk_plan['stop']:,.{spec.price_precision}f}; "
                + (
                    f"target {target_txt} → {risk_plan['target']:,.{spec.price_precision}f} (R:R {risk_plan['rr']:.2f})."
                    if risk_plan["target"] is not None
                    else "без фиксирана цел."
                )
            )

    warnings = [
        {"code": r["code"], "title": r["title"], "text": r["text"]}
        for r in a.get("no_trade_reasons") or []
        if r.get("code") in HARD_BLOCKERS
    ]
    if warnings and side is not None:
        why.append(
            "Внимание (signal engine): " + "; ".join(w["title"] for w in warnings) + " — рисковите фактори остават."
        )

    st = a.get("structure") or {}
    mom = a.get("momentum") or {}
    pp = spec.price_precision
    return {
        **base,
        "available": True,
        "time": last.ts,
        "price": spec.round_price(last.close),
        "data_source": a.get("data_source") or source,
        "regime": {"regime": regime, "reasons": list((a.get("regime") or {}).get("reasons") or [])[:3]},
        "structure": {
            "trend": st.get("trend"),
            "text": st.get("text"),
            "last_high_label": st.get("last_high_label"),
            "last_low_label": st.get("last_low_label"),
            "swings": [
                {**s, "price": spec.round_price(s["price"])} for s in (st.get("swings") or [])[-10:] if "price" in s
            ],
        },
        "momentum": {
            "label": mom.get("label"),
            "rsi": round(mom["rsi"], 2) if mom.get("rsi") is not None else None,
            "macd_hist": _round_sig(mom["macd_hist"], 4) if mom.get("macd_hist") else mom.get("macd_hist"),
        },
        "volatility": {
            "label": vol.get("label"),
            "atr": round(atr, pp) if atr else None,
            "atr_pct": round(vol["atr_pct"], 3) if vol.get("atr_pct") is not None else None,
            "rank": round(vol["rank"]) if vol.get("rank") is not None else None,
        },
        "support": _levels(a.get("support"), spec),
        "resistance": _levels(a.get("resistance"), spec),
        "conditions": {"long": long_rows, "short": short_rows},
        "logic": {
            "long": defn.entry_long.logic if defn.entry_long else None,
            "short": defn.entry_short.logic if defn.entry_short else None,
        },
        "long_passed": long_ok,
        "short_passed": short_ok,
        "regime_filter": {"required": required, "actual": regime, "passed": regime_ok},
        "result": result,
        "why": why,
        "warnings": warnings,
        "risk_plan": risk_plan,
    }
