"""Leverage maths for the Leverage Academy simulator — pure functions, no I/O, consistent with the paper broker.

Model (exactly the one `app.paper_engine.broker.PaperBroker` uses for a single position on a flat account,
cross margin, prices in the account currency, no spread):

    notional        N = margin × L            (or margin M = N / L when the position size is given)
    units             = N / entry_price
    entry fee         = N × fee_rate          (paid from the account at the fill, like the broker's cash)
    equity₀           = equity − entry fee
    required margin M = N / L                  free margin = equity₀ − M      margin level = equity₀ / M
    maintenance       = maintenance_ratio × M  (maintenance_ratio = ExecutionConfig.stop_out_level = 0.5)
    CROSS liquidation (the broker's stop-out): equity₀ + uPnL(P) = maintenance
        →  P_liq = entry − sign × (equity₀ − maintenance) / units
        None when that price would be ≤ 0 (a long whose whole notional is smaller than the buffer cannot be
        liquidated — the loss is still real); P_liq = entry when equity₀ ≤ maintenance (cannot even open).
    ISOLATED comparison (only M stands behind the position): M + uPnL = maintenance → distance = (1 − ratio) / L
    P/L at a straight move of m %: gross = sign × N × m / 100, exit fee = units × P_m × fee_rate. When the move
        passes P_liq the position is closed AT P_liq (stop-out) and the loss stops there.

Risk level = cross liquidation distance measured in typical daily moves of the asset (daily_vol_pct; when unknown
the broker's DEFAULT_DAILY_VOL, 2 %): < 1 day → extreme, < 3 → high, < 8 → elevated, otherwise low (also low when
the position cannot be liquidated). The simulator never recommends a leverage value.
"""

from __future__ import annotations

import math

from app.paper_engine.broker import DEFAULT_DAILY_VOL
from app.paper_engine.models import ExecutionConfig

MAINTENANCE_RATIO: float = ExecutionConfig().stop_out_level  # 0.5 — the paper broker's stop-out margin level
DEFAULT_EQUITY = 10_000.0
DEFAULT_ENTRY_PRICE = 100.0
DEFAULT_NOTIONAL = 2_000.0
MAX_LEVERAGE = 100.0  # same upper bound as the paper order API (422 above 100)
LEVERAGE_SET: tuple[int, ...] = (1, 2, 5, 10, 20, 50, 100)
CURVE_RANGE_PCT = 20
CURVE_STEP_PCT = 1
MARGIN_MODE = "cross"
LEVERAGE_WARNING = "Higher leverage magnifies exposure and liquidation risk."
VIRTUAL_NOTICE = "Симулация с виртуална сметка — няма реални пари и няма реална поръчка."
RISK_LEVELS: tuple[str, ...] = ("low", "elevated", "high", "extreme")
# (upper bound of the liquidation distance in typical daily moves, level) — checked in order
RISK_THRESHOLDS: tuple[tuple[float, str], ...] = ((1.0, "extreme"), (3.0, "high"), (8.0, "elevated"))
SCENARIO_LEVERAGES: tuple[int, ...] = (1, 5, 20)
_EPS = 1e-9


class LeverageInputError(ValueError):
    """Invalid simulator input (message in Bulgarian, shown to the user)."""


def _sign(side: str) -> int:
    s = (side or "").lower()
    if s in ("long", "buy"):
        return 1
    if s in ("short", "sell"):
        return -1
    raise LeverageInputError("Посоката трябва да е long или short.")


def _usd(v: float) -> str:
    sign = "−" if v < 0 else ""
    a = abs(v)
    return f"{sign}${a:,.0f}" if abs(a - round(a)) < 0.005 or a >= 1000 else f"{sign}${a:,.2f}"


def _pct(v: float, digits: int = 2) -> str:
    text = f"{v:.{digits}f}".rstrip("0").rstrip(".") if digits else f"{v:.0f}"
    return f"{text}%"


def _lev(v: float) -> str:
    return f"{v:g}x"


def tidy(obj):
    """Round every float to 10 significant digits (removes binary noise such as -22.499999999999996)."""
    if isinstance(obj, float):
        return float(f"{obj:.10g}") if math.isfinite(obj) else obj
    if isinstance(obj, dict):
        return {k: tidy(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [tidy(v) for v in obj]
    return obj


def cross_liquidation_price(
    *, side: str, entry_price: float, units: float, equity_after_fees: float, maintenance: float
):
    """Price where equity + uPnL reaches the maintenance margin (the broker's stop-out), all else equal.

    Returns None when no positive price reaches it (long positions smaller than the buffer)."""
    sign = _sign(side)
    if units <= 0:
        return None
    slack = equity_after_fees - maintenance
    if slack <= 0:
        return entry_price
    price = entry_price - sign * slack / units
    return price if price > 0 else None


def isolated_liquidation_distance_pct(leverage: float, maintenance_ratio: float = MAINTENANCE_RATIO) -> float:
    """Move against an ISOLATED position (only its margin at stake) that reaches the maintenance level: (1 − r) / L."""
    return (1 - maintenance_ratio) / leverage * 100


def risk_level(distance_pct: float | None, daily_vol_pct: float) -> str:
    """'low' | 'elevated' | 'high' | 'extreme' from the liquidation distance in typical daily moves."""
    if distance_pct is None:
        return "low"
    if daily_vol_pct <= 0:
        return "extreme" if distance_pct <= 0 else "low"
    ratio = distance_pct / daily_vol_pct
    for bound, level in RISK_THRESHOLDS:
        if ratio < bound:
            return level
    return "low"


def _outcome(
    *,
    sign: int,
    entry: float,
    units: float,
    equity: float,
    equity0: float,
    entry_fee: float,
    fee_rate: float,
    margin: float,
    liquidation: float | None,
    move_pct: float,
) -> dict:
    """P/L when the price moves straight by `move_pct` (stop-out at the liquidation price is applied)."""
    moved = entry * (1 + move_pct / 100)
    liquidated = liquidation is not None and sign * (moved - liquidation) <= _EPS * max(1.0, entry)
    exit_px = liquidation if liquidated else moved
    gross = sign * units * (exit_px - entry)
    exit_fee = units * exit_px * fee_rate
    pnl = gross - entry_fee - exit_fee
    return {
        "price": moved,
        "exit_price": exit_px,
        "gross_pnl": gross,
        "exit_fee": exit_fee,
        "pnl": pnl,
        "equity_after": equity + pnl,
        "pnl_pct_of_equity": pnl / equity * 100,
        "pnl_pct_of_margin": pnl / margin * 100 if margin > 0 else None,
        "liquidated": liquidated,
        "margin_level_pct": None if liquidated else (equity0 + gross) / margin * 100 if margin > 0 else None,
    }


def _validate(equity, leverage, entry_price, maintenance_ratio, fee_rate, price_move_pct) -> None:
    if not (math.isfinite(equity) and equity > 0):
        raise LeverageInputError("Сметката (equity) трябва да е положително число.")
    if not (math.isfinite(leverage) and 1 - _EPS <= leverage <= MAX_LEVERAGE + _EPS):
        raise LeverageInputError(f"Leverage трябва да е между 1x и {MAX_LEVERAGE:g}x.")
    if not (math.isfinite(entry_price) and entry_price > 0):
        raise LeverageInputError("Цената на влизане трябва да е положителна.")
    if not (0 <= maintenance_ratio < 1):
        raise LeverageInputError("Maintenance ratio трябва да е между 0 и 1.")
    if not (math.isfinite(fee_rate) and 0 <= fee_rate < 1):
        raise LeverageInputError("Таксата трябва да е между 0 и 1 (дял от notional).")
    if not (math.isfinite(price_move_pct) and price_move_pct > -100):
        raise LeverageInputError("Движението на цената трябва да е над −100%.")


def simulate(
    *,
    leverage: float,
    equity: float = DEFAULT_EQUITY,
    position_notional: float | None = None,
    margin: float | None = None,
    entry_price: float = DEFAULT_ENTRY_PRICE,
    side: str = "long",
    price_move_pct: float = 0.0,
    maintenance_ratio: float = MAINTENANCE_RATIO,
    fee_rate: float = 0.0,
    daily_vol_pct: float | None = None,
) -> dict:
    """One leveraged position on a flat virtual account (see the module docstring for every formula).

    Give the position size (`position_notional`) OR the margin you put up (`margin`, notional = margin × L);
    with neither the default $2,000 notional is used."""
    _validate(equity, leverage, entry_price, maintenance_ratio, fee_rate, price_move_pct)
    sign = _sign(side)
    if position_notional is not None and margin is not None:
        raise LeverageInputError("Задай или размер на позицията, или margin — не и двете.")
    if margin is not None:
        if not (math.isfinite(margin) and margin > 0):
            raise LeverageInputError("Margin трябва да е положително число.")
        basis, notional = "margin", margin * leverage
    else:
        notional = DEFAULT_NOTIONAL if position_notional is None else position_notional
        if not (math.isfinite(notional) and notional > 0):
            raise LeverageInputError("Размерът на позицията трябва да е положително число.")
        basis = "notional"
    vol_source = "given"
    if daily_vol_pct is None or not (math.isfinite(daily_vol_pct) and daily_vol_pct > 0):
        daily_vol_pct, vol_source = DEFAULT_DAILY_VOL * 100, "default"

    req_margin = notional / leverage
    units = notional / entry_price
    entry_fee = notional * fee_rate
    equity0 = equity - entry_fee
    maintenance = maintenance_ratio * req_margin
    can_open = req_margin + entry_fee <= equity * (1 + _EPS)
    liq = cross_liquidation_price(
        side=side, entry_price=entry_price, units=units, equity_after_fees=equity0, maintenance=maintenance
    )
    liq_dist = abs(entry_price - liq) / entry_price * 100 if liq is not None else None
    iso_dist = isolated_liquidation_distance_pct(leverage, maintenance_ratio)
    iso_price = entry_price * (1 - sign * iso_dist / 100)
    out = _outcome(
        sign=sign,
        entry=entry_price,
        units=units,
        equity=equity,
        equity0=equity0,
        entry_fee=entry_fee,
        fee_rate=fee_rate,
        margin=req_margin,
        liquidation=liq,
        move_pct=price_move_pct,
    )
    level = risk_level(liq_dist, daily_vol_pct)
    result = {
        "equity": equity,
        "leverage": float(leverage),
        "side": "long" if sign > 0 else "short",
        "basis": basis,
        "margin_mode": MARGIN_MODE,
        "entry_price": entry_price,
        "position_notional": notional,
        "units": units,
        "required_margin": req_margin,
        "entry_fee": entry_fee,
        "fee_rate": fee_rate,
        "free_margin": equity0 - req_margin,
        "margin_level_pct": equity0 / req_margin * 100,
        "maintenance_ratio": maintenance_ratio,
        "maintenance_margin": maintenance,
        "effective_leverage": notional / equity,
        "can_open": can_open,
        "cannot_open_reason": None
        if can_open
        else (
            f"Недостатъчен свободен margin: нужни са {_usd(req_margin + entry_fee)}, сметката е {_usd(equity)}. "
            "Paper брокерът би отхвърлил тази поръчка."
        ),
        "price_move_pct": price_move_pct,
        "price_after_move": out["price"],
        "price_change": out["price"] - entry_price,
        "exit_price": out["exit_price"],
        "gross_pnl_at_move": out["gross_pnl"],
        "exit_fee": out["exit_fee"],
        "pnl_at_move": out["pnl"],
        "pnl_pct_of_equity": out["pnl_pct_of_equity"],
        "pnl_pct_of_margin": out["pnl_pct_of_margin"],
        "equity_after": out["equity_after"],
        "liquidated_at_move": out["liquidated"],
        "margin_level_at_move_pct": out["margin_level_pct"],
        "liquidation_price": liq,
        "liquidation_reachable": liq is not None,
        "liquidation_distance_pct": liq_dist,
        "liquidation_move_pct": (liq / entry_price - 1) * 100 if liq is not None else None,
        "isolated_liquidation_price": iso_price if iso_price > 0 else None,
        "isolated_liquidation_distance_pct": iso_dist,
        "daily_vol_pct": daily_vol_pct,
        "daily_vol_source": vol_source,
        "liquidation_distance_daily_moves": liq_dist / daily_vol_pct if liq_dist is not None else None,
        "risk_level": level,
        "isolated_risk_level": risk_level(iso_dist, daily_vol_pct),
        "risk_levels": list(RISK_LEVELS),
    }
    result["notes"] = _notes(result)
    result["warning"] = _warning(result)
    result["virtual_notice"] = VIRTUAL_NOTICE
    return tidy(result)


def _warning(r: dict) -> str:
    d, v = r["liquidation_distance_pct"], r["daily_vol_pct"]
    if not r["can_open"]:
        tail = "Позицията не може да бъде отворена с тази сметка — margin-ът не стига."
    elif d is None:
        tail = (
            "При cross margin тази позиция не може да бъде ликвидирана: дори цена 0 не изяжда буфера на сметката. "
            "Загубата при движение срещу теб обаче остава реална."
        )
    elif r["risk_level"] == "extreme":
        tail = f"Ликвидацията е само на {_pct(d)} — по-малко от едно типично дневно движение (~{_pct(v, 1)})."
    elif r["risk_level"] == "high":
        tail = f"Ликвидацията е на {_pct(d)} — колкото няколко типични дневни движения (~{_pct(v, 1)} всяко)."
    elif r["risk_level"] == "elevated":
        tail = f"Ликвидацията е на {_pct(d)} — голямо, но напълно възможно движение срещу теб."
    else:
        tail = f"Ликвидацията е далеч ({_pct(d)}), но загубата при движение срещу теб остава реална."
    return f"{LEVERAGE_WARNING} {tail}"


def _notes(r: dict) -> list[str]:
    side = "long" if r["side"] == "long" else "short"
    notes = [
        f"Позиция {_usd(r['position_notional'])} ({side}) при {_lev(r['leverage'])}: блокира margin "
        f"{_usd(r['required_margin'])} = {_usd(r['position_notional'])} / {_lev(r['leverage'])}.",
        f"Експозицията е {r['effective_leverage']:.2f}x от сметката (effective leverage) — това определя колко силно "
        "движението на цената влияе на equity.",
    ]
    move = r["price_move_pct"]
    if move:
        notes.append(
            f"Движение {move:+.2f}% → P/L {_usd(r['pnl_at_move'])} ({r['pnl_pct_of_equity']:+.2f}% от сметката"
            + (f", {r['pnl_pct_of_margin']:+.1f}% от margin-а" if r["pnl_pct_of_margin"] is not None else "")
            + ")."
        )
    if r["liquidated_at_move"]:
        notes.append(
            f"При това движение позицията е ликвидирана (stop-out) на {r['liquidation_price']:,.4g} — загубата спира "
            f"там, но от сметката остават {_usd(r['equity_after'])}."
        )
    if r["liquidation_price"] is not None and r["liquidation_distance_pct"]:
        notes.append(
            f"Cross margin: ликвидация при {r['liquidation_price']:,.6g} ({r['liquidation_move_pct']:+.2f}%), когато "
            f"equity падне до maintenance margin {_usd(r['maintenance_margin'])} "
            f"({r['maintenance_ratio'] * 100:.0f}% от използвания margin)."
        )
    notes.append(
        f"Isolated margin (за сравнение): само margin-ът стои зад позицията → ликвидация след "
        f"~{_pct(r['isolated_liquidation_distance_pct'])} движение срещу теб."
    )
    if r["fee_rate"]:
        notes.append(f"Такси: {_usd(r['entry_fee'])} при влизане + {_usd(r['exit_fee'])} при излизане.")
    return notes


def _curve_series(
    *,
    leverage: float,
    notional: float,
    equity: float,
    entry_price: float,
    sign: int,
    maintenance_ratio: float,
    fee_rate: float,
    daily_vol_pct: float,
    moves: list[float],
) -> dict:
    side = "long" if sign > 0 else "short"
    m = notional / leverage
    units = notional / entry_price
    entry_fee = notional * fee_rate
    equity0 = equity - entry_fee
    liq = cross_liquidation_price(
        side=side,
        entry_price=entry_price,
        units=units,
        equity_after_fees=equity0,
        maintenance=maintenance_ratio * m,
    )
    liq_move = (liq / entry_price - 1) * 100 if liq is not None else None
    grid = list(moves)
    lo, hi = min(moves), max(moves)
    if liq_move is not None and lo < liq_move < hi and all(abs(liq_move - x) > 1e-9 for x in grid):
        grid.append(liq_move)
        grid.sort()
    points = []
    for mv in grid:
        o = _outcome(
            sign=sign,
            entry=entry_price,
            units=units,
            equity=equity,
            equity0=equity0,
            entry_fee=entry_fee,
            fee_rate=fee_rate,
            margin=m,
            liquidation=liq,
            move_pct=mv,
        )
        points.append(
            {
                "move_pct": round(mv, 6),
                "pnl": o["pnl"],
                "equity": o["equity_after"],
                "pnl_pct_of_equity": o["pnl_pct_of_equity"],
                "liquidated": o["liquidated"],
                "at_liquidation": liq_move is not None and abs(mv - liq_move) <= 1e-9,
            }
        )
    liq_dist = abs(liq_move) if liq_move is not None else None
    return {
        "leverage": float(leverage),
        "position_notional": notional,
        "required_margin": m,
        "can_open": m + entry_fee <= equity * (1 + _EPS),
        "liquidation_price": liq,
        "liquidation_move_pct": liq_move,
        "isolated_liquidation_move_pct": -sign * isolated_liquidation_distance_pct(leverage, maintenance_ratio),
        "risk_level": risk_level(liq_dist, daily_vol_pct),
        "points": points,
    }


def curves(
    *,
    basis: str,
    amount: float,
    equity: float = DEFAULT_EQUITY,
    entry_price: float = DEFAULT_ENTRY_PRICE,
    side: str = "long",
    maintenance_ratio: float = MAINTENANCE_RATIO,
    fee_rate: float = 0.0,
    daily_vol_pct: float | None = None,
    leverages: tuple[int, ...] | list[float] = LEVERAGE_SET,
    range_pct: float = CURVE_RANGE_PCT,
    step_pct: float = CURVE_STEP_PCT,
) -> dict:
    """Equity vs price move (−range…+range %) for every leverage in `leverages`.

    basis 'margin': the same `amount` of margin at every leverage (notional = amount × L) — shows how leverage grows
    the exposure; basis 'notional': the same position size `amount` (margin = amount / L) — shows that leverage
    alone does not change the P/L, only the margin blocked and the liquidation point."""
    if basis not in ("margin", "notional"):
        raise LeverageInputError("basis трябва да е margin или notional.")
    if not (math.isfinite(amount) and amount > 0):
        raise LeverageInputError("Сумата за кривите трябва да е положителна.")
    sign = _sign(side)
    vol = daily_vol_pct if daily_vol_pct and daily_vol_pct > 0 else DEFAULT_DAILY_VOL * 100
    n_steps = int(round(2 * range_pct / step_pct))
    moves = [round(-range_pct + i * step_pct, 6) for i in range(n_steps + 1)]
    series = [
        _curve_series(
            leverage=float(lev),
            notional=amount * lev if basis == "margin" else amount,
            equity=equity,
            entry_price=entry_price,
            sign=sign,
            maintenance_ratio=maintenance_ratio,
            fee_rate=fee_rate,
            daily_vol_pct=vol,
            moves=moves,
        )
        for lev in leverages
    ]
    return tidy(
        {
            "basis": basis,
            "margin": amount if basis == "margin" else None,
            "position_notional": amount if basis == "notional" else None,
            "equity": equity,
            "side": "long" if sign > 0 else "short",
            "moves_pct": moves,
            "series": series,
        }
    )


def simulate_with_curves(*, include_curves: bool = True, **kwargs) -> dict:
    """simulate() + both curve families for the chart (same margin as this position / same position size).

    The curves do not depend on `price_move_pct`, so a UI can skip them (include_curves=False) while a slider moves."""
    r = simulate(**kwargs)
    if not include_curves:
        r["curves"] = r["curves_same_notional"] = None
        return r
    common = dict(
        equity=r["equity"],
        entry_price=r["entry_price"],
        side=r["side"],
        maintenance_ratio=r["maintenance_ratio"],
        fee_rate=r["fee_rate"],
        daily_vol_pct=r["daily_vol_pct"],
    )
    r["curves"] = curves(basis="margin", amount=r["required_margin"], **common)
    r["curves_same_notional"] = curves(basis="notional", amount=r["position_notional"], **common)
    return r


def scenario(
    *,
    stake: float = DEFAULT_NOTIONAL,
    move_pct: float = -5.0,
    equity: float = DEFAULT_EQUITY,
    leverages: tuple[int, ...] = SCENARIO_LEVERAGES,
    side: str = "long",
) -> dict:
    """Guided walkthrough: the same `stake` of margin at 1x → 5x → 20x and one move against the position."""
    if not (math.isfinite(stake) and stake > 0):
        raise LeverageInputError("Сумата трябва да е положителна.")
    steps = []
    for lev in leverages:
        r = simulate(leverage=float(lev), equity=equity, margin=stake, side=side, price_move_pct=move_pct)
        text = (
            f"{_lev(lev)}: {_usd(stake)} margin → позиция {_usd(r['position_notional'])}. При {move_pct:+g}% P/L е "
            f"{_usd(r['pnl_at_move'])} ({r['pnl_pct_of_equity']:+.1f}% от сметката, "
            f"{r['pnl_pct_of_margin']:+.0f}% от margin-а)."
        )
        if r["liquidated_at_move"]:
            text += " Позицията е ликвидирана преди да стигне това движение."
        elif r["pnl_at_move"] <= -stake + 1e-9:
            text += " Целият margin е изгубен."
        text += (
            f" При isolated margin ликвидацията би била след ~{_pct(r['isolated_liquidation_distance_pct'])} "
            "движение срещу теб."
        )
        steps.append(
            {
                "leverage": float(lev),
                "margin": stake,
                "position_notional": r["position_notional"],
                "pnl": r["pnl_at_move"],
                "pnl_pct_of_equity": r["pnl_pct_of_equity"],
                "pnl_pct_of_margin": r["pnl_pct_of_margin"],
                "equity_after": r["equity_after"],
                "liquidated": r["liquidated_at_move"],
                "liquidation_move_pct": r["liquidation_move_pct"],
                "isolated_liquidation_move_pct": -_sign(side) * r["isolated_liquidation_distance_pct"],
                "risk_level": r["risk_level"],
                "text": text,
            }
        )
    same = simulate(
        leverage=float(leverages[-1]), equity=equity, position_notional=stake, side=side, price_move_pct=move_pct
    )
    return tidy(
        {
            "title": f"{_usd(stake)} при {' → '.join(_lev(x) for x in leverages)}",
            "stake": stake,
            "equity": equity,
            "move_pct": move_pct,
            "side": "long" if _sign(side) > 0 else "short",
            "steps": steps,
            "same_notional": {
                "position_notional": stake,
                "pnl": same["pnl_at_move"],
                "text": (
                    f"Ако размерът на позицията остане {_usd(stake)} (а се смени само leverage-ът), P/L при "
                    f"{move_pct:+g}% е {_usd(same['pnl_at_move'])} при всеки leverage — leverage-ът сменя само "
                    "блокирания margin, не резултата на сделката."
                ),
            },
            "takeaways": [
                "Leverage не променя посоката на пазара — променя колко голяма е позицията спрямо парите ти.",
                f"Едно и също движение от {move_pct:+g}% струва "
                + ", ".join(f"{abs(s['pnl_pct_of_equity']):.0f}% от сметката при {_lev(s['leverage'])}" for s in steps)
                + ".",
                "Leverage не подобрява стратегията: win rate и expectancy в R остават същите, растат само колебанията.",
                LEVERAGE_WARNING,
            ],
            "warning": LEVERAGE_WARNING,
            "virtual_notice": VIRTUAL_NOTICE,
        }
    )
