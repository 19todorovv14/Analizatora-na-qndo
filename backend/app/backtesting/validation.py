"""Strategy validation — why a positive backtest is NOT proof of an edge.

Checks: sample size, market-regime coverage, drawdown, transaction costs, slippage
stress, in-sample vs out-of-sample, and parameter sensitivity (overfitting).
The verdict text never claims that a strategy "is profitable".
"""

from __future__ import annotations

import copy
from collections import Counter, defaultdict

from app.analysis.regime import regime_series
from app.backtesting.engine import BacktestSettings, run_backtest
from app.market.base import AssetSpec, Candle
from app.strategies.rules import StrategyDefinition

PAST_PERFORMANCE = "Past backtest performance does not guarantee future results."


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
    if split > warm + 50 and len(candles) - split > 50:
        is_res = run_backtest(candles[:split], spec, defn, settings, timeframe, with_regimes=False)["metrics"]
        oos_res = run_backtest(candles[max(0, split - warm) :], spec, defn, settings, timeframe, with_regimes=False)[
            "metrics"
        ]
        oos = {"in_sample": _summary(is_res), "out_of_sample": _summary(oos_res), "split_ts": candles[split].ts}
        ie, oe = is_res.get("expectancy_r"), oos_res.get("expectancy_r")
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
    }
