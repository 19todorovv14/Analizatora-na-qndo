"""Strategy validation — why a positive backtest is NOT proof of an edge.

Checks: sample size, market-regime coverage, drawdown, transaction costs, slippage
stress, in-sample vs out-of-sample, and parameter sensitivity (overfitting).
V2 adds an explicit overfitting-risk assessment (LOW / MEDIUM / HIGH + score + reasons), an
in-sample vs out-of-sample comparison table and a walk-forward evaluation of the FIXED rules over
consecutive windows (no re-optimisation).
The verdict text never claims that a strategy "is profitable".
"""

from __future__ import annotations

import copy
from collections import Counter, defaultdict

from app.analysis.regime import regime_series
from app.backtesting.engine import BacktestSettings, run_backtest
from app.backtesting.metrics import INFINITE_PF
from app.market.base import AssetSpec, Candle
from app.strategies.rules import StrategyDefinition

PAST_PERFORMANCE = "Past backtest performance does not guarantee future results."
WALK_FORWARD_METHOD = "walk-forward evaluation of fixed rules"
WF_MAX_WINDOWS = 4
WF_MIN_WINDOW_BARS = 50

COMPARISON_ROWS = (
    ("total_trades", "Trades"),
    ("win_rate", "Win rate %"),
    ("profit_factor", "Profit factor"),
    ("expectancy_r", "Expectancy (R)"),
    ("net_pnl", "Net P/L"),
    ("return_pct", "Return %"),
    ("max_drawdown_pct", "Max drawdown %"),
)


def _summary(m: dict) -> dict:
    keys = ("total_trades", "net_pnl", "win_rate", "profit_factor", "expectancy_r", "max_drawdown_pct", "return_pct")
    return {k: m.get(k) for k in keys}


def _variants(defn: StrategyDefinition) -> list[tuple[str, StrategyDefinition]]:
    """Small parameter perturbations: thresholds ±10%, stop/target ±25%."""
    out: list[tuple[str, StrategyDefinition]] = []
    data = defn.model_dump()
    # numeric thresholds in conditions
    for block_name in ("entry_long", "entry_short"):
        block = data.get(block_name)
        if not block:
            continue
        for ci, cond in enumerate(block["conditions"]):
            if cond["op"] in ("is_true", "is_false"):
                continue  # boolean structure checks: the right operand is ignored, nothing to perturb
            for side in ("left", "right"):
                op = cond[side]
                if op["kind"] == "value" and op["value"]:
                    for f in (0.9, 1.1):
                        d = copy.deepcopy(data)
                        d[block_name]["conditions"][ci][side]["value"] = op["value"] * f
                        out.append(
                            (
                                f"{block_name} условие {ci + 1}: {op['value']:g} → {op['value'] * f:g}",
                                StrategyDefinition(**d),
                            )
                        )
                elif op["kind"] == "indicator" and "period" in op["params"]:
                    per = op["params"]["period"]
                    for f in (0.8, 1.2):
                        d = copy.deepcopy(data)
                        d[block_name]["conditions"][ci][side]["params"]["period"] = max(2, round(per * f))
                        out.append(
                            (
                                f"{block_name} условие {ci + 1}: период {per:g} → {max(2, round(per * f))}",
                                StrategyDefinition(**d),
                            )
                        )
    for f in (0.75, 1.25):
        d = copy.deepcopy(data)
        d["stop"]["value"] = data["stop"]["value"] * f
        out.append((f"Stop × {f:g}", StrategyDefinition(**d)))
    if data["take_profit"]["type"] != "none":
        for f in (0.75, 1.25):
            d = copy.deepcopy(data)
            d["take_profit"]["value"] = data["take_profit"]["value"] * f
            out.append((f"Target × {f:g}", StrategyDefinition(**d)))
    # keep the run time bounded: at most 8 variants, spread across the list
    if len(out) > 8:
        step = len(out) / 8
        out = [out[int(i * step)] for i in range(8)]
    return out


def validate(
    candles: list[Candle],
    spec: AssetSpec,
    defn: StrategyDefinition,
    settings: BacktestSettings,
    timeframe: str,
    base_result: dict,
) -> dict:
    m = base_result["metrics"]
    trades = base_result["trades"]
    n = m["total_trades"]
    warnings: list[dict] = []

    def warn(code: str, severity: str, text: str) -> None:
        warnings.append({"code": code, "severity": severity, "text": text})

    # 1) sample size
    if n < 30:
        sample = {
            "trades": n,
            "verdict": "insufficient",
            "text": f"Само {n} сделки — твърде малка извадка; резултатът може да е чиста случайност.",
        }
        warn("sample_size", "high", sample["text"])
    elif n < 100:
        sample = {
            "trades": n,
            "verdict": "limited",
            "text": f"{n} сделки — ограничена извадка. Доверителният интервал на win rate е широк.",
        }
        warn("sample_size", "warn", sample["text"])
    else:
        sample = {"trades": n, "verdict": "adequate", "text": f"{n} сделки — приемлива извадка за първоначална оценка."}

    # 2) regimes: coverage of the test period and results per regime
    regimes = regime_series(candles, step=4)
    counts = Counter(regimes[settings.warmup_bars :] or regimes)
    total = sum(counts.values()) or 1
    distribution = {k: round(v / total * 100, 1) for k, v in counts.most_common()}
    per_regime: dict[str, dict] = defaultdict(lambda: {"trades": 0, "net_pnl": 0.0, "wins": 0})
    for t in trades:
        r = t.get("regime") or "UNKNOWN"
        per_regime[r]["trades"] += 1
        per_regime[r]["net_pnl"] += t["net_pnl"]
        per_regime[r]["wins"] += 1 if t["net_pnl"] > 0 else 0
    by_regime = [
        {
            "regime": k,
            "trades": v["trades"],
            "net_pnl": v["net_pnl"],
            "win_rate": v["wins"] / v["trades"] * 100 if v["trades"] else None,
        }
        for k, v in sorted(per_regime.items(), key=lambda kv: -kv[1]["trades"])
    ]
    top_regime, top_share = counts.most_common(1)[0] if counts else ("UNCLEAR", 0)
    if top_share / total > 0.6:
        warn(
            "regime_bias",
            "warn",
            f"{top_share / total * 100:.0f}% от периода е {top_regime}. Стратегията е тествана "
            "основно в един тип пазар — в друг режим може да се държи различно.",
        )

    # 3) drawdown
    dd = m.get("max_drawdown_pct") or 0
    if dd > 35:
        warn("drawdown", "high", f"Максимален drawdown {dd:.1f}% — психологически и финансово много тежко.")
    elif dd > 20:
        warn("drawdown", "warn", f"Максимален drawdown {dd:.1f}% — трябва да си готов да го понесеш многократно.")

    # 4) transaction costs
    gross = sum(t["gross_pnl"] for t in trades)
    fees = m.get("fees_total") or 0.0
    slip = m.get("slippage_cost_est") or 0.0
    costs = {"fees": fees, "slippage_est": slip, "gross_pnl_before_fees": gross, "net_pnl": m["net_pnl"]}
    if gross > 0 and fees + slip > 0.5 * gross:
        warn(
            "costs",
            "high",
            f"Разходите (такси + slippage ≈ {fees + slip:,.2f}) изяждат над половината от брутната печалба.",
        )
    elif gross > 0 >= m["net_pnl"]:
        warn("costs", "high", "Стратегията е положителна ПРЕДИ разходите, но отрицателна след тях.")

    # 5) slippage / spread stress test
    stress_settings = BacktestSettings(
        **{
            **settings.to_dict(),
            "slippage_bps": settings.slippage_bps * 3 + 1,
            "spread_multiplier": settings.spread_multiplier * 2,
        }
    )
    stress = run_backtest(candles, spec, defn, stress_settings, timeframe, with_regimes=False)["metrics"]
    if m["net_pnl"] > 0 and stress["net_pnl"] <= 0:
        warn("slippage", "high", "При по-лошо изпълнение (3× slippage, 2× spread) резултатът става отрицателен.")

    # 6) in-sample vs out-of-sample (70/30 split in time)
    split = int(len(candles) * 0.7)
    warm = settings.warmup_bars
    oos = None
    oos_pair: tuple[float | None, float | None] = (None, None)
    if split > warm + 50 and len(candles) - split > 50:
        is_res = run_backtest(candles[:split], spec, defn, settings, timeframe, with_regimes=False)["metrics"]
        oos_res = run_backtest(candles[max(0, split - warm) :], spec, defn, settings, timeframe, with_regimes=False)[
            "metrics"
        ]
        oos = {"in_sample": _summary(is_res), "out_of_sample": _summary(oos_res), "split_ts": candles[split].ts}
        oos.update(_is_oos_details(candles, split, warm, is_res, oos_res))
        ie, oe = is_res.get("expectancy_r"), oos_res.get("expectancy_r")
        oos_pair = (ie, oe)
        if ie is not None and oe is not None:
            if ie > 0 and oe <= 0:
                warn(
                    "out_of_sample",
                    "high",
                    "Положителна in-sample, но отрицателна out-of-sample — класически признак "
                    "на overfitting или смяна на режима.",
                )
            elif ie > 0 and oe < ie * 0.5:
                warn("out_of_sample", "warn", "Out-of-sample резултатът е с над 50% по-слаб от in-sample.")
        if (oos_res.get("total_trades") or 0) < 15:
            warn("out_of_sample_size", "warn", "Out-of-sample периодът има твърде малко сделки за заключение.")
    else:
        warn("out_of_sample", "warn", "Периодът е твърде кратък за out-of-sample проверка.")

    # 7) parameter sensitivity (overfitting)
    sens = []
    for label, var in _variants(defn):
        vm = run_backtest(candles, spec, var, settings, timeframe, with_regimes=False)["metrics"]
        sens.append({"variant": label, **_summary(vm)})
    if sens:
        signs = [1 if (s["net_pnl"] or 0) > 0 else -1 for s in sens]
        base_sign = 1 if m["net_pnl"] > 0 else -1
        flips = sum(1 for s in signs if s != base_sign)
        if base_sign > 0 and flips >= max(2, len(signs) // 3):
            warn(
                "overfitting",
                "high",
                f"{flips} от {len(signs)} малки промени в параметрите обръщат резултата в загуба — "
                "стратегията е крехка (вероятен overfitting).",
            )
    # 8) walk-forward evaluation of the same (fixed) rules — one extra full pass
    wf = walk_forward(candles, spec, defn, settings, timeframe, m.get("warmup_bars"))

    complexity = defn.condition_count()
    if complexity >= 5 and n < 100:
        warn(
            "complexity",
            "warn",
            f"{complexity} условия при само {n} сделки — много правила върху малко данни лесно 'напасват' шума.",
        )

    # verdict — never "profitable"
    if n == 0:
        headline = "Стратегията не генерира сделки в този период."
    elif m["net_pnl"] > 0:
        headline = (
            f"На тази извадка резултатът е положителен ({m['net_pnl']:+,.2f}), но това НЕ доказва, "
            "че стратегията има реално предимство."
        )
    else:
        headline = f"На тази извадка резултатът е отрицателен ({m['net_pnl']:+,.2f})."
    high = [w for w in warnings if w["severity"] == "high"]
    if n and m["net_pnl"] > 0 and not high:
        robustness = "Няма сериозни червени флагове в тези проверки — следващата стъпка е forward test (paper bot)."
    elif high:
        robustness = f"{len(high)} сериозни предупреждения — третирай резултата като непотвърден."
    else:
        robustness = "Резултатът не подкрепя използване на стратегията без промени."
    return {
        "headline": headline,
        "robustness": robustness,
        "disclaimer": PAST_PERFORMANCE,
        "sample_size": sample,
        "regime_distribution": distribution,
        "results_by_regime": by_regime,
        "costs": costs,
        "stress_test": _summary(stress),
        "out_of_sample": oos,
        "sensitivity": sens,
        "complexity": {"conditions": complexity, "parameters": defn.numeric_parameters()},
        "warnings": warnings,
        # v2 (additive)
        "overfitting": overfitting_assessment(defn, m, oos_pair, sens, wf),
        "walk_forward": wf,
    }


def _is_oos_details(candles: list[Candle], split: int, warm: int, is_m: dict, oos_m: dict) -> dict:
    """Comparison table + degradation verdict for the existing 70/30 split (additive keys)."""
    rows = []
    for key, label in COMPARISON_ROWS:
        a, b = is_m.get(key), oos_m.get(key)
        delta = b - a if isinstance(a, int | float) and isinstance(b, int | float) else None
        if delta is not None and (abs(a) >= INFINITE_PF or abs(b) >= INFINITE_PF):
            delta = None
        rows.append({"key": key, "label": label, "in_sample": a, "out_of_sample": b, "delta": delta})
    ie, oe = is_m.get("expectancy_r"), oos_m.get("expectancy_r")
    if ie is None or oe is None:
        verdict, text = "n/a", "Няма достатъчно сделки в единия период за сравнение."
    elif ie > 0 and oe <= 0:
        verdict, text = "reversed", "Out-of-sample резултатът обръща знака — правилата не се пренасят върху нови данни."
    elif ie > 0 and oe < ie * 0.5:
        verdict, text = "much_weaker", "Out-of-sample expectancy е под половината от in-sample — силно влошаване."
    elif oe < ie:
        verdict, text = "weaker", "Out-of-sample е по-слаб от in-sample — нормално до известна степен; следи разликата."
    else:
        verdict, text = "similar_or_better", "Out-of-sample не е по-слаб от in-sample на тази извадка."
    is_start = min(int(is_m.get("warmup_bars") or 0), split - 1)
    oos_start = min(max(0, split - warm) + int(oos_m.get("warmup_bars") or 0), len(candles) - 1)
    return {
        # trading periods (each run uses the bars before its start only as indicator warm-up)
        "in_sample_period": {"start_ts": candles[is_start].ts, "end_ts": candles[split - 1].ts},
        "out_of_sample_period": {"start_ts": candles[oos_start].ts, "end_ts": candles[-1].ts},
        "comparison": rows,
        "degradation": {"verdict": verdict, "text": text},
    }


def walk_forward(
    candles: list[Candle],
    spec: AssetSpec,
    defn: StrategyDefinition,
    settings: BacktestSettings,
    timeframe: str,
    warmup: int | None = None,
) -> dict:
    """Split the tested period (after warm-up) into up to 4 consecutive windows and evaluate the SAME rules on
    each one (no optimisation). Costs one extra full pass: indicators use the whole history, open positions are
    closed at every window end so trades never straddle windows."""
    base = {
        "method": WALK_FORWARD_METHOD,
        "note": "Правилата НЕ се оптимизират за всеки прозорец — едни и същи фиксирани правила се оценяват "
        "последователно върху няколко периода, за да се види дали резултатът е стабилен във времето.",
        "disclaimer": PAST_PERFORMANCE,
    }
    if warmup is None:
        warmup = min(settings.warmup_bars, max(len(candles) // 4, 30))
    test_bars = len(candles) - warmup
    k = min(WF_MAX_WINDOWS, test_bars // WF_MIN_WINDOW_BARS)
    if k < 2:
        return {
            **base,
            "available": False,
            "k": 0,
            "windows": [],
            "windows_with_trades": 0,
            "profitable_windows": 0,
            "profitable_fraction": None,
            "verdict": "insufficient",
            "text": f"Периодът е твърде кратък за walk-forward (нужни са поне {2 * WF_MIN_WINDOW_BARS} свещи "
            "след warm-up).",
        }
    size = test_bars // k
    segments = [warmup + w * size for w in range(1, k)]
    res = run_backtest(candles, spec, defn, settings, timeframe, with_regimes=False, segments=segments)
    windows = res.get("windows") or []
    with_trades = [w for w in windows if w["trades"] > 0]
    profitable = sum(1 for w in windows if w["profitable"])
    fraction = profitable / len(windows) if windows else None
    if len(with_trades) < 2:
        verdict = "insufficient"
        text = "Твърде малко прозорци със сделки — стабилността във времето не може да се оцени."
    else:
        pos_share = sum(1 for w in with_trades if w["net_pnl"] > 0) / len(with_trades)
        if pos_share >= 0.75:
            verdict = "consistent"
            text = (
                f"Последователно: {profitable} от {len(windows)} прозореца са положителни при едни и същи правила. "
                "Това е по-добър знак от един общ резултат, но не е гаранция."
            )
        elif pos_share <= 0.25:
            verdict = "consistent"
            text = (
                f"Последователно отрицателен резултат: само {profitable} от {len(windows)} прозореца са положителни — "
                "правилата не показват предимство в нито един от периодите."
            )
        else:
            verdict = "inconsistent"
            text = (
                f"Нестабилно: {profitable} от {len(windows)} прозореца са положителни — резултатът сменя знака "
                "между периодите и вероятно зависи от пазарния режим."
            )
    return {
        **base,
        "available": True,
        "k": len(windows),
        "windows": windows,
        "windows_with_trades": len(with_trades),
        "profitable_windows": profitable,
        "profitable_fraction": fraction,
        "verdict": verdict,
        "text": text,
    }


def overfitting_assessment(
    defn: StrategyDefinition,
    m: dict,
    oos_pair: tuple[float | None, float | None],
    sensitivity: list[dict],
    wf: dict | None = None,
) -> dict:
    """OVERFITTING RISK: LOW / MEDIUM / HIGH with a 0–100 score and the reasons behind it.

    Points: parameter count (numeric parameters + conditions) up to 25 and < 10 trades per parameter 10;
    sample size (< 30 trades 60 → always HIGH, < 100 trades 15); extreme performance (profit factor > 3, win rate
    > 80 %, Sharpe-like > 3: 15 each); out-of-sample much worse than in-sample (reversal 25, < 50 % 15);
    sensitivity instability (≥ 1/3 of the small parameter changes flip the sign 20, very wide expectancy spread
    10); inconsistent walk-forward windows 10. Score ≥ 60 → HIGH, ≥ 30 → MEDIUM, else LOW.
    """
    factors: list[dict] = []

    def add(key: str, points: int, text: str) -> None:
        factors.append({"key": key, "points": points, "text": text})

    n = m.get("total_trades") or 0
    params = defn.numeric_parameters()
    conds = defn.condition_count()
    degrees = params + conds
    if degrees >= 16:
        add("parameters", 25, f"{params} числови параметъра и {conds} условия — много степени на свобода за напасване.")
    elif degrees >= 11:
        add("parameters", 15, f"{params} числови параметъра и {conds} условия — сравнително сложна стратегия.")
    elif degrees >= 8:
        add("parameters", 5, f"{params} числови параметъра и {conds} условия — умерена сложност.")
    if 0 < n < 10 * params:
        add("trades_per_parameter", 10, f"Само {n / params:.1f} сделки на параметър (желателно е поне 10).")

    if n < 30:
        add("sample_size", 60, f"Само {n} сделки — под 30 сделки резултатът е статистически ненадежден.")
    elif n < 100:
        add("sample_size", 15, f"{n} сделки — ограничена извадка.")

    pf, wr, sh = m.get("profit_factor"), m.get("win_rate"), m.get("sharpe_like")
    if pf is not None and pf > 3:
        add(
            "extreme_profit_factor",
            15,
            "Няма губещи сделки (profit factor ∞) — нереалистично гладък резултат."
            if pf >= INFINITE_PF
            else f"Profit factor {pf:.2f} > 3 — необичайно висок; често признак на напасване към шума.",
        )
    if wr is not None and wr > 80:
        add("extreme_win_rate", 15, f"Win rate {wr:.0f}% > 80% — необичайно висок за правилова стратегия.")
    if sh is not None and sh > 3:
        add("extreme_sharpe", 15, f"Sharpe-like {sh:.2f} > 3 — твърде гладка крива на капитала за реални пазари.")

    ie, oe = oos_pair
    if ie is not None and oe is not None:
        if ie > 0 and oe <= 0:
            add("out_of_sample", 25, "In-sample е положителен, out-of-sample — отрицателен (класически overfitting).")
        elif ie > 0 and oe < ie * 0.5:
            add("out_of_sample", 15, "Out-of-sample expectancy е с над 50% по-слаб от in-sample.")

    flips = 0
    if sensitivity:
        base_sign = 1 if (m.get("net_pnl") or 0) > 0 else -1
        flips = sum(1 for s in sensitivity if (1 if (s.get("net_pnl") or 0) > 0 else -1) != base_sign)
        if flips >= max(1, len(sensitivity) / 3):
            add(
                "sensitivity",
                20,
                f"{flips} от {len(sensitivity)} малки промени в параметрите обръщат знака на резултата — крехка стратегия.",
            )
        exps = [s["expectancy_r"] for s in sensitivity if s.get("expectancy_r") is not None]
        base_exp = m.get("expectancy_r")
        if base_exp is not None and len(exps) >= 2:
            spread = max([*exps, base_exp]) - min([*exps, base_exp])
            if spread > max(2 * abs(base_exp), 0.3):
                add(
                    "sensitivity_spread",
                    10,
                    f"Expectancy варира от {min([*exps, base_exp]):+.2f}R до {max([*exps, base_exp]):+.2f}R "
                    "при малки промени — резултатът зависи силно от точните параметри.",
                )

    if wf and wf.get("verdict") == "inconsistent":
        add("walk_forward", 10, "Walk-forward прозорците дават противоположни резултати — нестабилност във времето.")

    score = min(100, sum(f["points"] for f in factors))
    risk = "HIGH" if score >= 60 or n < 30 else "MEDIUM" if score >= 30 else "LOW"
    reasons = [f["text"] for f in factors]
    if not reasons:
        reasons = ["Няма силни признаци на overfitting в тези проверки — това не доказва реално предимство."]
    text = {
        "HIGH": "Висок риск от overfitting — резултатът вероятно не е надежден за бъдещи данни.",
        "MEDIUM": "Умерен риск от overfitting — нужни са още проверки (повече данни, forward test).",
        "LOW": "Нисък риск от overfitting по тези проверки — следващата стъпка е forward test (paper bot).",
    }[risk]
    return {
        "risk": risk,
        "score": score,
        "reasons": reasons,
        "factors": factors,
        "text": text,
        "inputs": {
            "parameters": params,
            "conditions": conds,
            "trades": n,
            "profit_factor": pf,
            "win_rate": wr,
            "sharpe_like": sh,
            "in_sample_expectancy_r": ie,
            "out_of_sample_expectancy_r": oe,
            "sensitivity_flips": flips,
            "sensitivity_variants": len(sensitivity),
        },
        "disclaimer": PAST_PERFORMANCE,
    }
