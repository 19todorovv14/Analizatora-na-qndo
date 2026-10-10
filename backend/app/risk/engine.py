"""Central Risk Engine.

Pure functions used by the order panel, the position-size calculator, bots and the
backtester. For manual paper trades findings are *educational warnings* (the trade is
not blocked); bots enforce them as hard limits.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields

from app.core.coerce import coerce_fields
from app.market.base import AssetSpec

UNUSUALLY_LARGE_MESSAGE = "This trade risks an unusually large portion of your account."


@dataclass
class RiskRules:
    max_risk_per_trade_pct: float = 1.0
    warn_risk_pct: float = 5.0  # above this the "unusually large" warning is shown
    max_daily_loss_pct: float = 3.0
    max_open_positions: int = 3
    max_portfolio_exposure_pct: float = 300.0  # total notional / equity
    min_reward_risk: float = 1.5
    require_stop_loss: bool = True

    @classmethod
    def from_dict(cls, data: dict | None, *, strict: bool = False) -> RiskRules:
        """Known keys only. strict=True (API input) raises ValueError for a wrong type / out-of-range value;
        otherwise such a value falls back to the default (or is clamped) so stored data never breaks a check."""
        return cls(**coerce_fields(cls, data, RISK_RULE_FIELDS, strict=strict))

    def to_dict(self) -> dict:
        return asdict(self)


# type / range of every RiskRules field (app.core.coerce) — the same bounds PUT /api/risk/rules always enforced
_PCT = ("float", 0.001, 10_000.0)
RISK_RULE_FIELDS: dict[str, tuple] = {
    "max_risk_per_trade_pct": _PCT,
    "warn_risk_pct": _PCT,
    "max_daily_loss_pct": _PCT,
    "max_open_positions": ("int", 1, 100),
    "max_portfolio_exposure_pct": _PCT,
    "min_reward_risk": _PCT,
    "require_stop_loss": ("bool",),
}
assert set(RISK_RULE_FIELDS) == {f.name for f in fields(RiskRules)}


@dataclass
class RiskFinding:
    kind: str
    severity: str  # info | warn | high
    message: str
    explanation: str

    def to_dict(self) -> dict:
        return asdict(self)


def position_size(
    *,
    balance: float,
    risk_pct: float,
    entry: float,
    stop: float,
    spec: AssetSpec | None = None,
    leverage: float = 1.0,
    fee_rate: float = 0.0,
) -> dict:
    """How many units can I buy so that hitting the stop loses ~risk_pct of the balance?"""
    if balance <= 0 or entry <= 0 or stop <= 0:
        raise ValueError("Balance, entry and stop must be positive.")
    if risk_pct <= 0:
        raise ValueError("Risk % must be positive.")
    stop_distance = abs(entry - stop)
    if stop_distance == 0:
        raise ValueError("Stop loss cannot equal the entry price.")
    risk_amount = balance * risk_pct / 100
    per_unit = stop_distance + (entry + stop) * fee_rate  # round-trip fees per unit
    raw_qty = risk_amount / per_unit
    qty = spec.round_qty(raw_qty) if spec else raw_qty
    notes: list[str] = []
    max_qty = balance * leverage / entry
    if spec:
        max_qty = spec.round_qty(max_qty * 0.98)
    if qty > max_qty:
        notes.append(
            f"Размерът е ограничен от наличния margin (leverage {leverage:g}x). Рискът ще е по-малък от целевия."
        )
        qty = max_qty
    if spec and qty < spec.min_qty:
        notes.append(f"Изчисленото количество е под минималното ({spec.min_qty}). Стопът е твърде далеч за този риск.")
    notional = qty * entry
    loss = qty * stop_distance + qty * (entry + stop) * fee_rate
    return {
        "qty": qty,
        "risk_amount": risk_amount,
        "stop_distance": stop_distance,
        "stop_distance_pct": stop_distance / entry * 100,
        "notional": notional,
        "margin_required": notional / leverage,
        "effective_leverage": notional / balance,
        "potential_loss": loss,
        "potential_loss_pct": loss / balance * 100,
        "notes": notes,
    }


def trade_plan(
    *,
    side: str,
    entry: float,
    stop: float | None,
    take_profit: float | None,
    qty: float,
    balance: float,
    fee_rate: float = 0.0,
) -> dict:
    """Potential loss/profit and reward:risk for a planned trade (fees included)."""
    is_long = side in ("buy", "long")
    fees_entry = qty * entry * fee_rate
    out: dict = {
        "notional": qty * entry,
        "risk_pct": None,
        "potential_loss": None,
        "potential_profit": None,
        "reward_risk": None,
    }
    if stop is not None:
        loss = (entry - stop if is_long else stop - entry) * qty
        loss = loss + fees_entry + qty * stop * fee_rate
        out["potential_loss"] = loss
        out["risk_pct"] = loss / balance * 100 if balance > 0 else None
    if take_profit is not None:
        gain = (take_profit - entry if is_long else entry - take_profit) * qty
        out["potential_profit"] = gain - fees_entry - qty * take_profit * fee_rate
    if stop is not None and take_profit is not None and stop != entry:
        out["reward_risk"] = abs(take_profit - entry) / abs(entry - stop)
    return out


def evaluate_trade(
    *,
    rules: RiskRules,
    equity: float,
    plan: dict,
    has_stop: bool,
    open_positions: int,
    exposure: float,
    new_notional: float,
    day_pnl: float,
) -> list[RiskFinding]:
    findings: list[RiskFinding] = []
    if not has_stop:
        findings.append(
            RiskFinding(
                "no_stop",
                "high",
                "You entered without a defined invalidation point.",
                "Без stop loss няма предварително определена максимална загуба. Реши ПРЕДИ влизане къде идеята ти "
                "е грешна и постави стопа там.",
            )
        )
    risk_pct = plan.get("risk_pct")
    if risk_pct is not None:
        if risk_pct > rules.warn_risk_pct:
            findings.append(
                RiskFinding(
                    "oversized",
                    "high",
                    f"WARNING: {UNUSUALLY_LARGE_MESSAGE}",
                    f"Рискуваш {risk_pct:.1f}% от сметката в една сделка. Серия от 5 такива загуби би изтрила "
                    f"~{(1 - (1 - risk_pct / 100) ** 5) * 100:.0f}% от капитала.",
                )
            )
        elif risk_pct > rules.max_risk_per_trade_pct:
            findings.append(
                RiskFinding(
                    "oversized",
                    "warn",
                    f"Рискът {risk_pct:.2f}% надвишава твоето правило ({rules.max_risk_per_trade_pct:g}%).",
                    "Намали количеството или премести стопа на логично ниво с по-малко разстояние.",
                )
            )
    rr = plan.get("reward_risk")
    if rr is not None and rr < rules.min_reward_risk:
        findings.append(
            RiskFinding(
                "poor_rr",
                "warn",
                f"Reward:Risk е {rr:.2f} (правило ≥ {rules.min_reward_risk:g}).",
                "При нисък R:R ти трябва много висок win rate, за да си на печалба.",
            )
        )
    if open_positions >= rules.max_open_positions:
        findings.append(
            RiskFinding(
                "max_positions",
                "warn",
                f"Вече имаш {open_positions} отворени позиции (лимит {rules.max_open_positions}).",
                "Повече позиции = повече корелиран риск и по-трудно управление.",
            )
        )
    if equity > 0:
        exp_pct = (exposure + new_notional) / equity * 100
        if exp_pct > rules.max_portfolio_exposure_pct:
            findings.append(
                RiskFinding(
                    "exposure",
                    "warn",
                    f"Общата експозиция ще стане {exp_pct:.0f}% от equity (лимит {rules.max_portfolio_exposure_pct:g}%).",
                    "Голямата експозиция означава, че малко движение на пазара променя сметката много.",
                )
            )
        if day_pnl < 0 and -day_pnl / equity * 100 >= rules.max_daily_loss_pct:
            findings.append(
                RiskFinding(
                    "daily_loss",
                    "high",
                    f"Дневната загуба ({day_pnl:,.2f}) е достигнала лимита от {rules.max_daily_loss_pct:g}%.",
                    "Професионалистите спират за деня след лимита — това предпазва от revenge trading.",
                )
            )
        lev = new_notional / equity
        if lev > 5:
            findings.append(
                RiskFinding(
                    "leverage",
                    "info",
                    f"Ефективен leverage на сделката: {lev:.1f}x.",
                    "Leverage увеличава и печалбите, и загубите. Риска определя разстоянието до стопа × размера.",
                )
            )
    return findings


def max_drawdown(equity: list[float]) -> tuple[float, float]:
    """Largest peak-to-trough decline: (absolute, percent)."""
    peak = None
    dd_abs = dd_pct = 0.0
    for v in equity:
        if peak is None or v > peak:
            peak = v
        if peak and peak > 0:
            drop = peak - v
            if drop > dd_abs:
                dd_abs = drop
            dd_pct = max(dd_pct, drop / peak * 100)
    return dd_abs, dd_pct


def risk_of_ruin_table(risk_pct: float, losses: tuple[int, ...] = (3, 5, 10, 20)) -> list[dict]:
    """How much of the account is left after N consecutive losses."""
    return [
        {
            "losses": n,
            "remaining_pct": (1 - risk_pct / 100) ** n * 100,
            "needed_gain_to_recover_pct": ((1 / (1 - risk_pct / 100) ** n) - 1) * 100,
        }
        for n in losses
    ]
