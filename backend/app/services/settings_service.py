"""Per-user settings with defaults (risk rules, execution realism, onboarding flags)."""

from __future__ import annotations

import copy

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
    "explain_mode": False,
}
APP_MODES = ("learn", "trade")


def validate_patch(patch: dict) -> None:
    """ValueError for invalid values of the v2 keys (the dataclass-backed keys are validated in update_settings)."""
    if "app_mode" in patch and patch["app_mode"] not in APP_MODES:
        raise ValueError(f"app_mode must be one of {', '.join(APP_MODES)}")
    if "explain_mode" in patch and not isinstance(patch["explain_mode"], bool):
        raise ValueError("explain_mode must be true or false")


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def user_settings(user: User) -> dict:
    return _merge(DEFAULTS, user.settings or {})


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
