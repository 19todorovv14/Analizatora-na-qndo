"""Leverage maths for the Leverage Academy simulator and the Trade Simulator — pure functions, no I/O, consistent
with the paper broker.

Model — exactly `app.paper_engine.broker.PaperBroker.order_estimate` for ONE new position on a flat account (cross
margin, prices in the account currency; for instruments quoted in another currency use POST /api/paper/orders/preview,
which converts with real FX rates):

    entry_price     = the fill price (the ask for a long, the bid for a short); half spread hs(p) = p × spread_bps / 20 000
    mid₀            = entry − sign × hs(entry)                    (= entry when there is no spread)
    notional N      = units × entry  (or margin × L when the margin is given; units = N / entry)
    margin M        = N / L            entry fee = N × fee_rate         spread cost = 2 × hs(entry) × units
    equity₀         = equity − entry fee − spread cost                 free margin = equity₀ − M
    margin level    = equity₀ / M      maintenance = maintenance_ratio × M
                      (maintenance_ratio = ExecutionConfig.stop_out_level = 0.5, the broker's stop-out margin level)
    CROSS liquidation (the broker's stop-out, all else equal) — the MID price where equity₀ + ΔP/L = maintenance:
        P_liq = mid₀ − sign × (equity₀ − maintenance) / units
        None when that price would be ≤ 0 (a long smaller than the account's buffer cannot be liquidated — the loss
        is still real); mid₀ when equity₀ ≤ maintenance (such an order could not even be opened).
    ISOLATED comparison (only M stands behind the position): M + uPnL = maintenance → distance ≈ (1 − ratio) / L.
    A price move of m % moves the MID: P_m = mid₀ × (1 + m / 100). The position closes at P_m − sign × hs(P_m)
        (the bid for a long): gross = sign × units × (exit − entry), exit fee = units × exit × fee_rate,
        P/L = gross − entry fee − exit fee. A move past P_liq is stopped out AT P_liq (the loss stops there).
    Stop / target (optional): P/L when the position exits exactly at that price, fees included (as the broker's
        risk_per_unit). A stop at or beyond the liquidation price is never reached — the stop-out comes first.
    Size by risk (optional, needs a stop): units = equity × risk_pct / 100 / (|entry − stop| + fee_rate × (entry + stop)).

Risk level = cross liquidation distance measured in typical daily moves of the asset (daily_vol_pct; when unknown
the broker's DEFAULT_DAILY_VOL, 2 %): < 1 → extreme, < 3 → high, < 8 → elevated, otherwise low (also low when the
position cannot be liquidated). The simulator never recommends a leverage value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.paper_engine.broker import DEFAULT_DAILY_VOL
from app.paper_engine.models import ExecutionConfig

MAINTENANCE_RATIO: float = ExecutionConfig().stop_out_level  # 0.5 — the paper broker's stop-out margin level
DEFAULT_EQUITY = 10_000.0
DEFAULT_ENTRY_PRICE = 100.0
DEFAULT_NOTIONAL = 2_000.0
MAX_LEVERAGE = 100.0  # same upper bound as the paper order API (422 above 100)
MAX_SPREAD_BPS = 1_000.0
LEVERAGE_SET: tuple[int, ...] = (1, 2, 5, 10, 20, 50, 100)
CURVE_RANGE_PCT = 20
CURVE_STEP_PCT = 1
DEFAULT_SCENARIO_MOVES: tuple[float, ...] = (-10.0, -5.0, -2.0, -1.0, 1.0, 2.0, 5.0, 10.0)
MAX_SCENARIO_MOVES = 25
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


def _price(v: float) -> str:
    return f"{v:,.6g}"


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
) -> float | None:
    """MID price where equity + uPnL reaches the maintenance margin (the broker's stop-out), all else equal.

    `entry_price` is the mid price at entry. Returns None when no positive price reaches it (long positions smaller
    than the account's buffer); `entry_price` when the account is already at/below maintenance."""
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


# ------------------------------------------------------------------------------------------- position model
@dataclass(frozen=True, slots=True)
class _Pos:
    sign: int
    leverage: float
    entry: float  # fill price
    mid: float  # mid price at entry
    hs_rate: float  # half spread as a fraction of the price (spread_bps / 20 000)
    units: float
    notional: float
    margin: float
    fee_rate: float
    entry_fee: float
    spread_cost: float
    equity: float
    equity0: float  # equity right after the fill (fees and spread paid)
    maintenance: float
    liquidation: float | None  # cross-margin stop-out MID price

    @property
    def side(self) -> str:
        return "long" if self.sign > 0 else "short"

    def exit_price(self, mid: float) -> float:
        """The price the position closes at when the mid is `mid` (bid for a long, ask for a short)."""
        return mid - self.sign * mid * self.hs_rate

    def can_open(self) -> bool:
        """The broker's free-margin check for a market order: margin + taker fee ≤ free margin (= equity, flat)."""
        return self.margin + self.entry_fee <= self.equity * (1 + _EPS)


def _position(
    *,
    sign: int,
    leverage: float,
    notional: float,
    equity: float,
    entry_price: float,
    maintenance_ratio: float,
    fee_rate: float,
    spread_bps: float,
) -> _Pos:
    hs_rate = spread_bps / 20_000
    hs = entry_price * hs_rate
    mid = entry_price - sign * hs
    units = notional / entry_price
    margin = notional / leverage
    entry_fee = notional * fee_rate
    spread_cost = 2 * hs * units
    equity0 = equity - entry_fee - spread_cost
    maintenance = maintenance_ratio * margin
    liq = cross_liquidation_price(
        side="long" if sign > 0 else "short",
        entry_price=mid,
        units=units,
        equity_after_fees=equity0,
        maintenance=maintenance,
    )
    return _Pos(
        sign=sign,
        leverage=float(leverage),
        entry=entry_price,
        mid=mid,
        hs_rate=hs_rate,
        units=units,
        notional=notional,
        margin=margin,
        fee_rate=fee_rate,
        entry_fee=entry_fee,
        spread_cost=spread_cost,
        equity=equity,
        equity0=equity0,
        maintenance=maintenance,
        liquidation=liq,
    )


def _close_at(pos: _Pos, exit_px: float) -> tuple[float, float, float]:
    """(gross, exit fee, net P/L) when the position closes at `exit_px`."""
    gross = pos.sign * pos.units * (exit_px - pos.entry)
    exit_fee = pos.units * exit_px * pos.fee_rate
    return gross, exit_fee, gross - pos.entry_fee - exit_fee


def _outcome(pos: _Pos, move_pct: float) -> dict:
    """P/L when the MID moves straight by `move_pct` from mid₀ (the stop-out at the liquidation price is applied)."""
    moved = pos.mid * (1 + move_pct / 100)
    liq = pos.liquidation
    liquidated = liq is not None and pos.sign * (moved - liq) <= _EPS * max(1.0, pos.mid)
    exit_px = pos.exit_price(liq if liquidated else moved)
    gross, exit_fee, pnl = _close_at(pos, exit_px)
    equity_open = pos.equity - pos.entry_fee + gross  # account equity while the position is still open
    return {
        "price": moved,
        "exit_price": exit_px,
        "gross_pnl": gross,
        "exit_fee": exit_fee,
        "pnl": pnl,
        "equity_after": pos.equity + pnl,
        "pnl_pct_of_equity": pnl / pos.equity * 100,
        "pnl_pct_of_margin": pnl / pos.margin * 100,
        "liquidated": liquidated,
        "margin_level_pct": None if liquidated else equity_open / pos.margin * 100,
    }


def _validate(equity, leverage, entry_price, maintenance_ratio, fee_rate, price_move_pct, spread_bps) -> None:
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
    if not (math.isfinite(spread_bps) and 0 <= spread_bps <= MAX_SPREAD_BPS):
        raise LeverageInputError(f"Spread-ът трябва да е между 0 и {MAX_SPREAD_BPS:g} bps.")
    if not (math.isfinite(price_move_pct) and price_move_pct > -100):
        raise LeverageInputError("Движението на цената трябва да е над −100%.")


def _check_levels(sign: int, entry: float, stop: float | None, target: float | None) -> None:
    side = "LONG" if sign > 0 else "SHORT"
    if stop is not None:
        if not (math.isfinite(stop) and stop > 0):
            raise LeverageInputError("Stop цената трябва да е положителна.")
        if sign * (entry - stop) <= 0:
            where = "ПОД" if sign > 0 else "НАД"
            raise LeverageInputError(f"При {side} stop loss трябва да е {where} цената на влизане.")
    if target is not None:
        if not (math.isfinite(target) and target > 0):
            raise LeverageInputError("Target цената трябва да е положителна.")
        if sign * (target - entry) <= 0:
            where = "НАД" if sign > 0 else "ПОД"
            raise LeverageInputError(f"При {side} take profit трябва да е {where} цената на влизане.")


def _scenario_rows(pos: _Pos, moves) -> list[dict]:
    rows = []
    for mv in moves:
        o = _outcome(pos, float(mv))
        rows.append(
            {
                "move_pct": float(mv),
                "price": o["price"],
                "pnl": o["pnl"],
                "pnl_pct_of_equity": o["pnl_pct_of_equity"],
                "pnl_pct_of_margin": o["pnl_pct_of_margin"],
                "equity_after": o["equity_after"],
                "liquidated": o["liquidated"],
            }
        )
    return rows


def _plan(pos: _Pos, stop: float | None, target: float | None) -> dict | None:
    """P/L at the stop and the target (exit exactly at the price, fees included) + R:R."""
    if stop is None and target is None:
        return None
    liq = pos.liquidation
    out: dict = {
        "stop_price": stop,
        "target_price": target,
        "stop_distance_pct": abs(pos.entry - stop) / pos.entry * 100 if stop is not None else None,
        "target_distance_pct": abs(target - pos.entry) / pos.entry * 100 if target is not None else None,
        "reward_risk": (abs(target - pos.entry) / abs(pos.entry - stop))
        if stop is not None and target is not None
        else None,
        "liquidation_before_stop": bool(stop is not None and liq is not None and pos.sign * (stop - liq) <= 0),
        "pnl_at_stop": None,
        "risk_amount": None,
        "risk_pct_of_equity": None,
        "pnl_at_target": None,
        "pnl_at_target_pct_of_equity": None,
        "reward_risk_net": None,
    }
    if stop is not None:
        if out["liquidation_before_stop"]:
            pnl = _close_at(pos, pos.exit_price(liq))[2]  # the stop-out happens first
        else:
            pnl = _close_at(pos, stop)[2]
        out["pnl_at_stop"] = pnl
        out["risk_amount"] = max(0.0, -pnl)
        out["risk_pct_of_equity"] = max(0.0, -pnl) / pos.equity * 100
    if target is not None:
        pnl_t = _close_at(pos, target)[2]
        out["pnl_at_target"] = pnl_t
        out["pnl_at_target_pct_of_equity"] = pnl_t / pos.equity * 100
        if out["risk_amount"]:
            out["reward_risk_net"] = pnl_t / out["risk_amount"]
    return out


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
    spread_bps: float = 0.0,
    daily_vol_pct: float | None = None,
    stop_price: float | None = None,
    target_price: float | None = None,
    risk_pct: float | None = None,
    scenario_moves: list[float] | tuple[float, ...] | None = DEFAULT_SCENARIO_MOVES,
) -> dict:
    """One leveraged position on a flat virtual account (see the module docstring for every formula).

    Size it with ONE of: `position_notional` (position size), `margin` (notional = margin × L) or `risk_pct` of the
    equity lost at `stop_price` (fees included); with none the default $2,000 notional is used."""
    _validate(equity, leverage, entry_price, maintenance_ratio, fee_rate, price_move_pct, spread_bps)
    sign = _sign(side)
    _check_levels(sign, entry_price, stop_price, target_price)
    given = [
        name for name, v in (("notional", position_notional), ("margin", margin), ("risk", risk_pct)) if v is not None
    ]
    if len(given) > 1:
        raise LeverageInputError("Задай само едно от: размер на позицията, margin или risk %.")
    if margin is not None:
        if not (math.isfinite(margin) and margin > 0):
            raise LeverageInputError("Margin трябва да е положително число.")
        basis, notional = "margin", margin * leverage
    elif risk_pct is not None:
        if not (math.isfinite(risk_pct) and 0 < risk_pct <= 100):
            raise LeverageInputError("Risk % трябва да е между 0 и 100.")
        if stop_price is None:
            raise LeverageInputError("За размер по риск е нужен stop loss.")
        per_unit = sign * (entry_price - stop_price) + fee_rate * (entry_price + stop_price)
        basis, notional = "risk", equity * risk_pct / 100 / per_unit * entry_price
    else:
        notional = DEFAULT_NOTIONAL if position_notional is None else position_notional
        if not (math.isfinite(notional) and notional > 0):
            raise LeverageInputError("Размерът на позицията трябва да е положително число.")
        basis = "notional"
    moves = list(DEFAULT_SCENARIO_MOVES if scenario_moves is None else scenario_moves)
    if len(moves) > MAX_SCENARIO_MOVES or any(not (math.isfinite(float(m)) and float(m) > -100) for m in moves):
        raise LeverageInputError(f"Сценариите са до {MAX_SCENARIO_MOVES} движения, всяко над −100%.")
    vol_source = "given"
    if daily_vol_pct is None or not (math.isfinite(daily_vol_pct) and daily_vol_pct > 0):
        daily_vol_pct, vol_source = DEFAULT_DAILY_VOL * 100, "default"

    pos = _position(
        sign=sign,
        leverage=leverage,
        notional=notional,
        equity=equity,
        entry_price=entry_price,
        maintenance_ratio=maintenance_ratio,
        fee_rate=fee_rate,
        spread_bps=spread_bps,
    )
    liq = pos.liquidation
    liq_dist = abs(pos.mid - liq) / pos.mid * 100 if liq is not None else None
    iso_dist = isolated_liquidation_distance_pct(leverage, maintenance_ratio)
    iso_price = pos.mid * (1 - sign * iso_dist / 100)
    out = _outcome(pos, price_move_pct)
    can_open = pos.can_open()
    round_trip = pos.entry_fee + pos.units * pos.entry * fee_rate + pos.spread_cost
    result = {
        "equity": equity,
        "leverage": float(leverage),
        "side": pos.side,
        "basis": basis,
        "risk_pct": risk_pct,
        "margin_mode": MARGIN_MODE,
        "entry_price": entry_price,
        "mid_price": pos.mid,
        "position_notional": notional,
        "units": pos.units,
        "required_margin": pos.margin,
        "entry_fee": pos.entry_fee,
        "fee_rate": fee_rate,
        "spread_bps": spread_bps,
        "spread_cost": pos.spread_cost,
        "round_trip_cost": round_trip,
        "free_margin": pos.equity0 - pos.margin,
        "margin_level_pct": pos.equity0 / pos.margin * 100,
        "maintenance_ratio": maintenance_ratio,
        "maintenance_margin": pos.maintenance,
        "effective_leverage": notional / equity,
        "can_open": can_open,
        "cannot_open_reason": None
        if can_open
        else (
            f"Недостатъчен свободен margin: нужни са {_usd(pos.margin + pos.entry_fee)}, сметката е {_usd(equity)}. "
            "Paper брокерът би отхвърлил тази поръчка."
        ),
        "price_move_pct": price_move_pct,
        "price_after_move": out["price"],
        "price_change": out["price"] - pos.mid,
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
        "liquidation_move_pct": (liq / pos.mid - 1) * 100 if liq is not None else None,
        "isolated_liquidation_price": iso_price if iso_price > 0 else None,
        "isolated_liquidation_distance_pct": iso_dist,
        "daily_vol_pct": daily_vol_pct,
        "daily_vol_source": vol_source,
        "liquidation_distance_daily_moves": liq_dist / daily_vol_pct if liq_dist is not None else None,
        "risk_level": risk_level(liq_dist, daily_vol_pct),
        "isolated_risk_level": risk_level(iso_dist, daily_vol_pct),
        "risk_levels": list(RISK_LEVELS),
        "scenarios": _scenario_rows(pos, moves),
        "plan": _plan(pos, stop_price, target_price),
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
    plan = r["plan"]
    if plan and plan["liquidation_before_stop"]:
        tail += " Stop loss-ът е отвъд цената на ликвидация — ликвидацията ще дойде преди него."
    return f"{LEVERAGE_WARNING} {tail}"


def _notes(r: dict) -> list[str]:
    notes = [
        f"Позиция {_usd(r['position_notional'])} ({r['side']}) при {_lev(r['leverage'])}: блокира margin "
        f"{_usd(r['required_margin'])} = {_usd(r['position_notional'])} / {_lev(r['leverage'])}.",
        f"Експозицията е {r['effective_leverage']:.2f}x от сметката (effective leverage) — това определя колко силно "
        "движението на цената влияе на equity.",
    ]
    if r["basis"] == "risk":
        notes.insert(
            0,
            f"Размерът е изчислен по риска: {_pct(r['risk_pct'])} от сметката при stop {_price(r['plan']['stop_price'])} "
            "(с таксите). Leverage-ът не променя този размер — променя само блокирания margin.",
        )
    move = r["price_move_pct"]
    if move:
        notes.append(
            f"Движение {move:+.2f}% → P/L {_usd(r['pnl_at_move'])} ({r['pnl_pct_of_equity']:+.2f}% от сметката, "
            f"{r['pnl_pct_of_margin']:+.1f}% от margin-а)."
        )
    if r["liquidated_at_move"]:
        notes.append(
            f"При това движение позицията е ликвидирана (stop-out) на {_price(r['liquidation_price'])} — загубата "
            f"спира там, но от сметката остават {_usd(r['equity_after'])}."
        )
    if r["liquidation_price"] is not None and r["liquidation_distance_pct"]:
        notes.append(
            f"Cross margin: ликвидация при {_price(r['liquidation_price'])} ({r['liquidation_move_pct']:+.2f}%), когато "
            f"equity падне до maintenance margin {_usd(r['maintenance_margin'])} "
            f"({r['maintenance_ratio'] * 100:.0f}% от използвания margin)."
        )
    notes.append(
        f"Isolated margin (за сравнение): само margin-ът стои зад позицията → ликвидация след "
        f"~{_pct(r['isolated_liquidation_distance_pct'])} движение срещу теб."
    )
    if r["fee_rate"] or r["spread_cost"]:
        exit_fee_estimate = r["position_notional"] * r["fee_rate"]
        notes.append(
            f"Разходи: такса {_usd(r['entry_fee'])} при влизане и ~{_usd(exit_fee_estimate)} при излизане, spread "
            f"~{_usd(r['spread_cost'])} — общо ~{_usd(r['round_trip_cost'])} за отваряне и затваряне."
        )
    plan = r["plan"]
    if plan and plan["pnl_at_stop"] is not None:
        notes.append(
            f"При stop {_price(plan['stop_price'])}: P/L {_usd(plan['pnl_at_stop'])} "
            f"({-plan['risk_pct_of_equity']:+.2f}% от сметката)."
        )
    if plan and plan["pnl_at_target"] is not None:
        notes.append(
            f"При target {_price(plan['target_price'])}: P/L {_usd(plan['pnl_at_target'])} "
            f"({plan['pnl_at_target_pct_of_equity']:+.2f}% от сметката)."
            + (f" R:R {plan['reward_risk']:.2f}." if plan["reward_risk"] is not None else "")
        )
    return notes


# ------------------------------------------------------------------------------------------------ curves
def _curve_series(
    *,
    leverage: float,
    notional: float,
    equity: float,
    entry_price: float,
    sign: int,
    maintenance_ratio: float,
    fee_rate: float,
    spread_bps: float,
    daily_vol_pct: float,
    moves: list[float],
) -> dict:
    pos = _position(
        sign=sign,
        leverage=leverage,
        notional=notional,
        equity=equity,
        entry_price=entry_price,
        maintenance_ratio=maintenance_ratio,
        fee_rate=fee_rate,
        spread_bps=spread_bps,
    )
    liq = pos.liquidation
    liq_move = (liq / pos.mid - 1) * 100 if liq is not None else None
    grid = list(moves)
    lo, hi = min(moves), max(moves)
    if liq_move is not None and lo < liq_move < hi and all(abs(liq_move - x) > 1e-9 for x in grid):
        grid.append(liq_move)
        grid.sort()
    points = []
    for mv in grid:
        o = _outcome(pos, mv)
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
    return {
        "leverage": float(leverage),
        "position_notional": notional,
        "required_margin": pos.margin,
        "can_open": pos.can_open(),
        "liquidation_price": liq,
        "liquidation_move_pct": liq_move,
        "isolated_liquidation_move_pct": -sign * isolated_liquidation_distance_pct(leverage, maintenance_ratio),
        "risk_level": risk_level(abs(liq_move) if liq_move is not None else None, daily_vol_pct),
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
    spread_bps: float = 0.0,
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
            spread_bps=spread_bps,
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
    """simulate() + both curve families for the chart: `curves` = the SAME MARGIN as this position at every
    leverage (notional grows with L), `curves_same_notional` = the SAME POSITION SIZE (only margin/liquidation change).

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
        spread_bps=r["spread_bps"],
        daily_vol_pct=r["daily_vol_pct"],
    )
    r["curves"] = curves(basis="margin", amount=r["required_margin"], **common)
    r["curves_same_notional"] = curves(basis="notional", amount=r["position_notional"], **common)
    return r


# ------------------------------------------------------------------------------------------ guided scenario
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
                "can_open": r["can_open"],
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
