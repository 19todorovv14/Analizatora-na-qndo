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
}


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
