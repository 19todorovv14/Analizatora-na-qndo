"""Signal Engine.

    Market data → Indicators → Market structure → Strategy rules → Risk engine → Signal

The output is a deterministic, explainable JSON analysis. Every number in it comes from
the candles; the AI layer only *explains* this object and can never invent a level or
a signal. Signals are LONG SETUP / SHORT SETUP / WAIT / NO TRADE — never "buy now".
"""

from __future__ import annotations

from statistics import mean

from app import indicators as ind
from app.analysis import candles as cdl
from app.analysis.regime import classify
from app.analysis.structure import find_swings, levels, nearest_levels, structure_trend
from app.market.base import AssetSpec, Candle
from app.market.timeframes import tf_seconds
from app.strategies.rules import IndicatorCache, StrategyDefinition, evaluate

CONFIDENCE_NOTE = "Confidence НЕ означава вероятност за печалба — показва само колко фактора съвпадат."
DISCLAIMER = (
    "Образователен анализ върху исторически данни. Не е финансов съвет и не е гаранция за бъдещо движение. "
    "Всички сделки в платформата са виртуални (paper)."
)
HARD_BLOCKERS = {"low_liquidity", "high_volatility", "spread_too_high", "news_risk", "conflicting_signals", "poor_rr"}

NO_TRADE_TEXT = {
    "low_liquidity": "Low liquidity",
    "high_volatility": "High volatility",
    "no_structure": "No clear structure",
    "poor_rr": "Poor risk/reward",
    "conflicting_signals": "Conflicting signals",
    "spread_too_high": "Spread too high",
    "news_risk": "News risk",
    "strategy_not_satisfied": "Strategy conditions not satisfied",
    "insufficient_data": "Insufficient data",
}


def _fmt(v: float | None, p: int) -> str:
    return "—" if v is None else f"{v:,.{p}f}"


def analyze(
    candles: list[Candle],
    *,
    spec: AssetSpec,
    timeframe: str,
    strategy: StrategyDefinition | None = None,
    news_risk: bool = False,
    min_rr: float = 1.5,
    price: float | None = None,
    source: str = "demo",
) -> dict:
    p = spec.price_precision
    base = {
        "market": spec.symbol,
        "timeframe": timeframe,
        "data_source": source,
        "confidence_note": CONFIDENCE_NOTE,
        "disclaimer": DISCLAIMER,
    }
    if len(candles) < 60:
        return {
            **base,
            "time": candles[-1].ts if candles else None,
            "price": candles[-1].close if candles else None,
            "decision": "NO TRADE",
            "signal": "NO TRADE",
            "confidence": "LOW",
            "no_trade_reasons": [
                {
                    "code": "insufficient_data",
                    "title": NO_TRADE_TEXT["insufficient_data"],
                    "text": "Нужни са поне 60 свещи за надежден анализ.",
                }
            ],
            "observation": [],
            "analysis": [],
            "hypothesis": [],
            "teach_me_why": [],
            "pipeline": [],
        }

    last = candles[-1]
    prev = candles[-2]
    price = price if price is not None else last.close
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    vols = [c.volume for c in candles]

    # ---------------------------------------------------------------- indicators
    ema20 = ind.ema(closes, 20)
    ema50 = ind.ema(closes, 50)
    ema200 = ind.ema(closes, 200)
    rsi = ind.rsi(closes, 14)
    macd_l, macd_s, macd_h = ind.macd(closes)
    bb_u, bb_m, bb_lo = ind.bollinger(closes)
    atr_s = ind.atr(highs, lows, closes, 14)
    adx_s = ind.adx(highs, lows, closes, 14)
    vwap_s = ind.vwap(candles)
    vol_sma = ind.sma(vols, 20)
    atr = atr_s[-1] or (last.high - last.low) or price * 0.01
    values = {
        "ema20": ema20[-1],
        "ema50": ema50[-1],
        "ema200": ema200[-1],
        "rsi": rsi[-1],
        "macd": macd_l[-1],
        "macd_signal": macd_s[-1],
        "macd_hist": macd_h[-1],
        "bb_upper": bb_u[-1],
        "bb_middle": bb_m[-1],
        "bb_lower": bb_lo[-1],
        "atr": atr,
        "adx": adx_s[-1],
        "vwap": vwap_s[-1],
        "volume_sma": vol_sma[-1],
        "volume": last.volume,
    }

    # ------------------------------------------------------- structure & regime
    swings = find_swings(candles, 3, 3)
    st = structure_trend(swings)
    regime = classify(candles)
    reg = regime["regime"]
    lvls = levels(candles, swings, atr)
    supports, resistances = nearest_levels(lvls, price)

    rsi_v, rsi_prev = rsi[-1] or 50.0, rsi[-2] or 50.0
    hist, hist_prev = macd_h[-1] or 0.0, macd_h[-2] or 0.0
    if rsi_v >= 60 and hist > 0:
        mom_label = "Strong bullish" if hist > hist_prev else "Moderate bullish"
    elif rsi_v <= 40 and hist < 0:
        mom_label = "Strong bearish" if hist < hist_prev else "Moderate bearish"
    elif hist > 0 or rsi_v > 52:
        mom_label = "Moderate bullish" if hist > 0 and rsi_v > 50 else "Weak / mixed"
    elif hist < 0 or rsi_v < 48:
        mom_label = "Moderate bearish" if hist < 0 and rsi_v < 50 else "Weak / mixed"
    else:
        mom_label = "Neutral"

    atr_pct = atr / price * 100
    rank = ind.percentile_rank([a / c * 100 if a else None for a, c in zip(atr_s, closes, strict=True)], atr_pct) or 50
    vol_label = "Extreme" if rank >= 95 else "High" if rank >= 80 else "Low" if rank <= 20 else "Normal"
    vol_ratio = last.volume / vol_sma[-1] if vol_sma[-1] else None
    long_avg = mean(vols[-200:])
    short_avg = mean(vols[-20:])
    liquidity_ratio = short_avg / long_avg if long_avg else 1.0

    if reg == "TRENDING_UP" or (st["trend"] == "bullish" and values["ema50"] and price > values["ema50"]):
        trend = "Uptrend"
    elif reg == "TRENDING_DOWN" or (st["trend"] == "bearish" and values["ema50"] and price < values["ema50"]):
        trend = "Downtrend"
    elif reg == "RANGING":
        trend = "Sideways"
    else:
        trend = "Unclear"

    pats = cdl.patterns(last, prev, atr)

    # ------------------------------------------------------------ setup search
    candidate: dict | None = None
    wait_reason: str | None = None
    strategy_eval: dict | None = None
    strategy_score = 0.0
    if strategy is not None:
        cache = IndicatorCache(candles)
        strategy_eval = evaluate(strategy, cache, len(candles) - 1)
        allowed = not strategy.regime_filter or reg in strategy.regime_filter
        el, es = strategy_eval["entry_long"], strategy_eval["entry_short"]
        strategy_score = max(el["score"], es["score"])
        if el["passed"] and es["passed"]:
            candidate = None
        elif el["passed"] and allowed:
            candidate = {"side": "long", "name": "Strategy: LONG conditions met"}
        elif es["passed"] and allowed:
            candidate = {"side": "short", "name": "Strategy: SHORT conditions met"}
        elif (el["passed"] or es["passed"]) and not allowed:
            wait_reason = f"Условията са изпълнени, но режимът {reg} не е разрешен от филтъра на стратегията."
    else:
        e20, e50 = values["ema20"] or price, values["ema50"] or price
        near_sup = bool(supports) and price - supports[0]["price"] <= 1.0 * atr
        near_res = bool(resistances) and resistances[0]["price"] - price <= 1.0 * atr
        bullish_trigger = rsi_v > rsi_prev or "hammer" in pats or "bullish_engulfing" in pats
        bearish_trigger = rsi_v < rsi_prev or "shooting_star" in pats or "bearish_engulfing" in pats
        if trend == "Uptrend":
            if price > e20 + 1.5 * atr:
                wait_reason = (
                    "Трендът е нагоре, но цената е разтеглена (> 1.5 ATR над EMA 20). Влизане тук е "
                    "'chasing' — по-добре изчакай pullback."
                )
            elif (
                (near_sup or abs(price - e20) <= 0.7 * atr or abs(price - e50) <= 0.7 * atr)
                and 38 <= rsi_v <= 65
                and bullish_trigger
            ):
                candidate = {"side": "long", "name": "Trend pullback (продължение на uptrend)"}
            else:
                wait_reason = "Uptrend, но още няма pullback към support/EMA с потвърждение."
        elif trend == "Downtrend":
            if price < e20 - 1.5 * atr:
                wait_reason = (
                    "Трендът е надолу, но цената е разтеглена (> 1.5 ATR под EMA 20). Shortване тук е "
                    "'chasing' — изчакай отскок."
                )
            elif (
                (near_res or abs(price - e20) <= 0.7 * atr or abs(price - e50) <= 0.7 * atr)
                and 35 <= rsi_v <= 62
                and bearish_trigger
            ):
                candidate = {"side": "short", "name": "Trend pullback (продължение на downtrend)"}
            else:
                wait_reason = "Downtrend, но още няма отскок към resistance/EMA с потвърждение."
        elif trend == "Sideways":
            if near_sup and rsi_v < 45:
                candidate = {"side": "long", "name": "Range: отскок от support"}
            elif near_res and rsi_v > 55:
                candidate = {"side": "short", "name": "Range: отхвърляне от resistance"}
            else:
                wait_reason = "Пазарът е в range, а цената е в средата му — там R:R обикновено е лош."

    # --------------------------------------------------------------- trade plan
    if candidate:
        recent = candles[-30:]
        if candidate["side"] == "long":
            refs = [x["price"] for x in supports if x["price"] < price]
            refs += [s.price for s in swings[-10:] if s.kind == "low" and s.price < price]
            inv = (max(refs) - 0.25 * atr) if refs else price - 2 * atr
            if price - inv > 3 * atr:
                inv = price - 2 * atr
            if price - inv < 0.5 * atr:
                inv = min(inv, price - 0.75 * atr, min(c.low for c in recent[-3:]) - 0.1 * atr)
            tgts = [r["price"] for r in resistances if r["price"] - price >= 0.5 * atr]
            target = tgts[0] if tgts else price + 2 * (price - inv)
            target_note = "най-близката resistance" if tgts else "проекция 2R (няма ясна resistance)"
        else:
            refs = [x["price"] for x in resistances if x["price"] > price]
            refs += [s.price for s in swings[-10:] if s.kind == "high" and s.price > price]
            inv = (min(refs) + 0.25 * atr) if refs else price + 2 * atr
            if inv - price > 3 * atr:
                inv = price + 2 * atr
            if inv - price < 0.5 * atr:
                inv = max(inv, price + 0.75 * atr, max(c.high for c in recent[-3:]) + 0.1 * atr)
            tgts = [s["price"] for s in supports if price - s["price"] >= 0.5 * atr]
            target = tgts[0] if tgts else price - 2 * (inv - price)
            target_note = "най-близкият support" if tgts else "проекция 2R (няма ясен support)"
        risk_u = abs(price - inv)
        reward_u = abs(target - price)
        candidate.update(
            {
                "entry": spec.round_price(price),
                "invalidation": spec.round_price(inv),
                "target": spec.round_price(target),
                "target_note": target_note,
                "reward_risk": round(reward_u / risk_u, 2) if risk_u else None,
                "risk_per_unit": risk_u,
                "risk_text": f"Ако цената {'падне под' if candidate['side'] == 'long' else 'се качи над'} "
                f"{_fmt(inv, p)}, идеята е невалидна (риск {_fmt(risk_u, p)} на единица, "
                f"{risk_u / atr:.1f} ATR).",
                "reward_text": f"Цел {_fmt(target, p)} ({target_note}), потенциал {_fmt(reward_u, p)} на единица.",
            }
        )

    # ---------------------------------------------------------- no-trade checks
    reasons: list[dict] = []

    def add(code: str, text: str) -> None:
        reasons.append({"code": code, "title": NO_TRADE_TEXT[code], "text": text})

    if liquidity_ratio < 0.35:
        add(
            "low_liquidity",
            f"Обемът на последните 20 свещи е само {liquidity_ratio * 100:.0f}% от обичайния — "
            "спредът и slippage-ът често растат.",
        )
    if rank >= 95 or (last.high - last.low) > 3 * atr:
        add(
            "high_volatility",
            f"Волатилността е екстремна (ATR ранг {rank:.0f}/100 или свещ > 3 ATR). "
            "Стоповете трябва да са широки, а размерът — малък.",
        )
    if reg == "UNCLEAR" and st["trend"] in ("mixed", "unknown") and not candidate:
        add("no_structure", "Няма ясен тренд или range — структурата е смесена.")
    if candidate and candidate.get("reward_risk") is not None and candidate["reward_risk"] < min_rr:
        add("poor_rr", f"Reward:Risk {candidate['reward_risk']:.2f} е под минимума {min_rr:g}.")
    if candidate:
        if candidate["side"] == "long" and hist < 0 and hist < hist_prev and rsi_v < 45:
            add("conflicting_signals", "Setup-ът е LONG, но momentum (MACD хистограма и RSI) продължава да отслабва.")
        if candidate["side"] == "short" and hist > 0 and hist > hist_prev and rsi_v > 55:
            add("conflicting_signals", "Setup-ът е SHORT, но momentum продължава да се засилва нагоре.")
    if strategy_eval and strategy_eval["entry_long"]["passed"] and strategy_eval["entry_short"]["passed"]:
        add("conflicting_signals", "И LONG, и SHORT правилата на стратегията са изпълнени едновременно.")
    spread_cost = price * spec.spread_bps / 1e4
    if spread_cost > 0.25 * atr:
        add(
            "spread_too_high",
            f"Спредът ({_fmt(spread_cost, p)}) е {spread_cost / atr * 100:.0f}% от ATR — "
            "на този timeframe разходите изяждат голяма част от движението.",
        )
    if news_risk:
        add("news_risk", "Предстои важно събитие/новина — движенията могат да са резки и непредвидими.")
    if strategy is not None and not candidate:
        if strategy_score < 0.5:
            add("strategy_not_satisfied", f"Изпълнени са {strategy_score * 100:.0f}% от условията на стратегията.")

    hard = [r for r in reasons if r["code"] in HARD_BLOCKERS]
    if candidate and not hard:
        decision = "POSSIBLE LONG" if candidate["side"] == "long" else "POSSIBLE SHORT"
        signal = "LONG SETUP" if candidate["side"] == "long" else "SHORT SETUP"
    elif candidate and hard:
        decision = signal = "NO TRADE"
    elif any(r["code"] in ("no_structure", "strategy_not_satisfied") for r in reasons) or hard:
        decision = signal = "NO TRADE"
    else:
        decision = signal = "WAIT"

    # --------------------------------------------------------------- confidence
    score = 0
    factors: list[str] = []
    if candidate:
        long_side = candidate["side"] == "long"
        if (long_side and trend == "Uptrend") or (not long_side and trend == "Downtrend") or trend == "Sideways":
            score += 1
            factors.append("режимът подкрепя посоката")
        if (long_side and st["trend"] == "bullish") or (not long_side and st["trend"] == "bearish"):
            score += 1
            factors.append("структурата (swings) подкрепя посоката")
        if (long_side and hist > hist_prev) or (not long_side and hist < hist_prev):
            score += 1
            factors.append("momentum се обръща в посоката на setup-а")
        if (long_side and supports and price - supports[0]["price"] <= atr) or (
            not long_side and resistances and resistances[0]["price"] - price <= atr
        ):
            score += 1
            factors.append("цената е близо до ключово ниво")
        if vol_ratio and vol_ratio > 1.1:
            score += 1
            factors.append("обемът е над средния")
        if candidate.get("reward_risk") and candidate["reward_risk"] >= 2:
            score += 1
            factors.append("R:R ≥ 2")
        if vol_label in ("High", "Extreme"):
            score -= 1
        score -= 2 * len(hard)
        confidence = "HIGH" if score >= 5 else "MEDIUM" if score >= 3 else "LOW"
        if vol_label in ("High", "Extreme") and confidence == "HIGH":
            confidence = "MEDIUM"
    else:
        confidence = "MEDIUM" if trend != "Unclear" and not hard else "LOW"

    # ------------------------------------------------------------- explanations
    observation = [
        f"Цена {_fmt(price, p)}; последна затворена свещ: O {_fmt(last.open, p)} H {_fmt(last.high, p)} "
        f"L {_fmt(last.low, p)} C {_fmt(last.close, p)}.",
        f"EMA 20 {_fmt(values['ema20'], p)}, EMA 50 {_fmt(values['ema50'], p)}, EMA 200 {_fmt(values['ema200'], p)}.",
        f"RSI(14) {rsi_v:.1f}; MACD хистограма {hist:+.{p}f} ({'расте' if hist > hist_prev else 'намалява'}).",
        f"ATR(14) {_fmt(atr, p)} ({atr_pct:.2f}% от цената, ранг {rank:.0f}/100); ADX {values['adx'] or 0:.0f}.",
        f"Обем на последната свещ: {vol_ratio:.2f}× средния." if vol_ratio else "Няма данни за обем.",
        f"Swing структура: последен връх {st['last_high_label'] or '—'}, последно дъно {st['last_low_label'] or '—'}.",
    ]
    if supports:
        observation.append("Support: " + ", ".join(f"{_fmt(s['price'], p)} ({s['touches']} докосв.)" for s in supports))
    if resistances:
        observation.append(
            "Resistance: " + ", ".join(f"{_fmt(r['price'], p)} ({r['touches']} докосв.)" for r in resistances)
        )
    if pats:
        observation.append("Свещни модели на последната свещ: " + ", ".join(pats))

    analysis = [
        f"Режим: {reg} — " + " ".join(regime["reasons"]),
        st["text"],
        f"Momentum: {mom_label}.",
        f"Волатилност: {vol_label}.",
    ]
    if values["ema200"]:
        analysis.append(
            f"Цената е {'НАД' if price > values['ema200'] else 'ПОД'} EMA 200 — дългосрочният контекст е "
            f"{'бичи' if price > values['ema200'] else 'мечи'}."
        )
    if values["rsi"] and values["rsi"] > 70:
        analysis.append(
            "RSI е висок. Това НЕ означава автоматично, че цената трябва да падне — в силен тренд "
            "RSI може да остане високо дълго."
        )
    elif values["rsi"] and values["rsi"] < 30:
        analysis.append(
            "RSI е нисък. Това НЕ означава автоматично отскок — в силен downtrend RSI може да остане ниско."
        )

    hypothesis: list[str] = []
    alternative = ""
    if candidate:
        side_bg = "покачване" if candidate["side"] == "long" else "спад"
        hypothesis.append(
            f"Possible setup: {candidate['name']}. Условията подсказват възможно {side_bg} към "
            f"{_fmt(candidate['target'], p)}."
        )
        hypothesis.append(f"Invalidation: {_fmt(candidate['invalidation'], p)}. {candidate['risk_text']}")
        alternative = (
            f"Алтернативен сценарий: цената пробива {_fmt(candidate['invalidation'], p)} — тогава setup-ът "
            "е невалиден и пазарът вероятно продължава в обратна посока или влиза в range."
        )
    else:
        hypothesis.append(wait_reason or "Няма setup, който да отговаря на критериите. Да не търгуваш също е решение.")
        if resistances and supports:
            alternative = (
                f"Наблюдавай реакцията при {_fmt(supports[0]['price'], p)} (support) и "
                f"{_fmt(resistances[0]['price'], p)} (resistance) — пробив с обем би променил картината."
            )
    if alternative:
        hypothesis.append(alternative)

    teach: list[str] = []
    if values["ema200"]:
        teach.append(f"Price is {'above' if price > values['ema200'] else 'below'} EMA 200 → дългосрочен контекст.")
    teach.append(f"Market structure: {st['text']}")
    if vol_ratio:
        teach.append(
            f"Volume {'increased' if vol_ratio > 1.1 else 'is average' if vol_ratio > 0.8 else 'is low'} "
            f"({vol_ratio:.2f}× средния)."
        )
    if candidate and candidate["side"] == "long" and supports:
        teach.append(f"Price is near support {_fmt(supports[0]['price'], p)}.")
    if candidate and candidate["side"] == "short" and resistances:
        teach.append(f"Price is near resistance {_fmt(resistances[0]['price'], p)}.")
    teach.append(f"Momentum: {mom_label} (RSI {rsi_v:.0f}).")
    if candidate and candidate.get("reward_risk") is not None:
        ok = candidate["reward_risk"] >= min_rr
        teach.append(f"Risk/reward is {'acceptable' if ok else 'poor'}: {candidate['reward_risk']:.2f}.")
    if vol_label in ("High", "Extreme"):
        teach.append("However, volatility is high → по-широк стоп и по-малка позиция.")
    for r in reasons:
        teach.append(f"However: {r['title']} — {r['text']}")
    if decision.startswith("POSSIBLE"):
        conclusion = "Possible setup, not a guaranteed trade."
    elif decision == "WAIT":
        conclusion = "Wait — условията още не са подредени. Търпението е част от стратегията."
    else:
        conclusion = "No trade — добрият trader не е постоянно в позиция."

    pipeline = [
        {"stage": "Market data", "detail": f"{len(candles)} свещи {timeframe} ({source})"},
        {"stage": "Indicators", "detail": f"EMA, RSI {rsi_v:.0f}, MACD, ATR {_fmt(atr, p)}, ADX, VWAP, BB"},
        {"stage": "Market structure", "detail": f"{st['trend']} · режим {reg}"},
        {"stage": "Strategy rules", "detail": (candidate or {}).get("name") or wait_reason or "няма setup"},
        {"stage": "Risk engine", "detail": f"R:R {candidate.get('reward_risk')}" if candidate else "—"},
        {"stage": "Signal", "detail": signal},
    ]

    return {
        **base,
        "time": last.ts,
        "price": price,
        "regime": regime,
        "trend": trend,
        "structure": {**st, "swings": [s.to_dict() for s in swings[-10:]]},
        "momentum": {"label": mom_label, "rsi": rsi_v, "macd_hist": hist},
        "volatility": {"label": vol_label, "atr": atr, "atr_pct": atr_pct, "rank": rank},
        "volume": {"ratio": vol_ratio, "liquidity_ratio": liquidity_ratio},
        "support": supports,
        "resistance": resistances,
        "indicators": values,
        "candle": {"patterns": pats, "explanation": cdl.explain_candle(last, prev, atr, p)},
        "setup": candidate,
        "wait_reason": wait_reason,
        "strategy_eval": strategy_eval,
        "no_trade_reasons": reasons,
        "decision": decision,
        "signal": signal,
        "confidence": confidence,
        "confidence_factors": factors,
        "observation": observation,
        "analysis": analysis,
        "hypothesis": hypothesis,
        "teach_me_why": teach,
        "conclusion": conclusion,
        "pipeline": pipeline,
        "bar_seconds": tf_seconds(timeframe),
    }
