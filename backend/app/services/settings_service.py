"""Per-user settings with defaults (risk rules, execution realism, onboarding flags)."""

from __future__ import annotations

import copy
import math

from sqlalchemy.orm import Session

from app.models import User
from app.paper_engine.models import ExecutionConfig
from app.risk.engine import RiskRules

DEFAULTS: dict = {
    "risk_rules": RiskRules().to_dict(),
    "execution": ExecutionConfig().to_dict(),
    "tour_done": False,
    "default_symbol": "BTC/USDT",
    "default_timeframe": "1h",
    "news_risk": False,  # manual "important event soon" flag used by the no-trade system
    "max_trades_per_day": 8,
    # v2 (S7): default workspace (LEARN / TRADE) and the default of the explain mode (<Term> tooltips)
    "app_mode": "learn",
    "explain_mode": True,  # beginners see WHAT IT IS / WHY IT MATTERS / COMMON MISTAKE tips until they turn it off
}
APP_MODES = ("learn", "trade")


# top-level scalar settings: type / range (the dict-valued keys are validated by their dataclasses)
_SCALARS: dict[str, tuple] = {
    "tour_done": ("bool",),
    "news_risk": ("bool",),
    "explain_mode": ("bool",),
    "max_trades_per_day": ("int", 1, 100),
    "app_mode": ("choice", APP_MODES),
    "default_symbol": ("str",),
    "default_timeframe": ("str",),
}


def _scalar_ok(value, spec: tuple) -> bool:
    kind = spec[0]
    if kind == "bool":
        return isinstance(value, bool)
    if kind == "str":
        return isinstance(value, str) and 0 < len(value) <= 40
    if kind == "choice":
        return isinstance(value, str) and value in spec[1]
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value == int(value)
        and spec[1] <= value <= spec[2]
    )


def validate_patch(patch: dict) -> None:
    """ValueError for an invalid value of any known key (wrong type, out of range). Before W4a only app_mode /
    explain_mode were checked, so e.g. {"max_trades_per_day": null} was stored and broke /dashboard with a 500."""
    if "app_mode" in patch and patch["app_mode"] not in APP_MODES:
        raise ValueError(f"app_mode must be one of {', '.join(APP_MODES)}")
    if "explain_mode" in patch and not isinstance(patch["explain_mode"], bool):
        raise ValueError("explain_mode must be true or false")
    for key, spec in _SCALARS.items():
        if key in patch and not _scalar_ok(patch[key], spec):
            if spec[0] == "int":
                raise ValueError(f"{key} must be a whole number between {spec[1]} and {spec[2]}")
            raise ValueError(f"{key} has an invalid value")
    if "risk_rules" in patch:
        RiskRules.from_dict(patch["risk_rules"], strict=True)
    if "execution" in patch:
        ExecutionConfig.from_dict(patch["execution"], strict=True)


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def user_settings(user: User) -> dict:
    """Stored settings over the defaults; a stored value of the wrong type (saved before validation existed)
    reads as its default, so it can never crash the engines that use it."""
    merged = _merge(DEFAULTS, user.settings if isinstance(user.settings, dict) else {})
    for key, spec in _SCALARS.items():
        if not _scalar_ok(merged.get(key), spec):
            merged[key] = copy.deepcopy(DEFAULTS[key])
    for key in ("risk_rules", "execution"):
        if not isinstance(merged.get(key), dict):
            merged[key] = copy.deepcopy(DEFAULTS[key])
    return merged


def risk_rules(user: User) -> RiskRules:
    return RiskRules.from_dict(user_settings(user)["risk_rules"])


def execution_config(user: User) -> ExecutionConfig:
    return ExecutionConfig.from_dict(user_settings(user)["execution"])


def update_settings(db: Session, user: User, patch: dict) -> dict:
    merged = _merge(user_settings(user), patch)
    # validate through the dataclasses so unknown/invalid keys are dropped
    merged["risk_rules"] = RiskRules.from_dict(merged["risk_rules"]).to_dict()
    merged["execution"] = ExecutionConfig.from_dict(merged["execution"]).to_dict()
    user.settings = merged
    db.commit()
    return merged
