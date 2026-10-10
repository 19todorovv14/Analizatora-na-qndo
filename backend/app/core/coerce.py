"""Type/range coercion for the per-user settings dataclasses (risk rules, execution realism).

Those settings are stored as JSON and reach the engines through `from_dict`. Without checks a value such as
`null`, `"abc"`, `-5` or `Infinity` sent by a client was stored as-is and later crashed every request that
uses it (permanent 500s on /paper/account, /dashboard, order placement…). `coerce_fields` is used two ways:

* strict=True  (API input)      → ValueError naming the first invalid field (the endpoint answers 400/422);
* strict=False (stored values)  → an invalid value falls back to the field default, a number outside its range
                                  is clamped — data saved before validation existed can never crash an engine.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import MISSING, fields
from typing import Any

# spec per field: ("bool",) | ("float", lo, hi) | ("int", lo, hi) | ("choice", (allowed, ...))
FieldSpec = tuple


def _default(f) -> Any:
    if f.default is not MISSING:
        return f.default
    if f.default_factory is not MISSING:  # pragma: no cover - not used by the settings dataclasses
        return f.default_factory()
    return None


def _coerce(name: str, value: Any, spec: FieldSpec, strict: bool, default: Any) -> Any:
    kind = spec[0]
    if kind == "bool":
        if isinstance(value, bool):
            return value
        if strict:
            raise ValueError(f"{name} трябва да е true или false.")
        return default
    if kind == "choice":
        if isinstance(value, str) and value in spec[1]:
            return value
        if strict:
            raise ValueError(f"{name} трябва да е една от стойностите: {', '.join(spec[1])}.")
        return default
    lo, hi = spec[1], spec[2]
    number_ok = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
    if not number_ok:
        if strict:
            raise ValueError(f"{name} трябва да е число между {lo:g} и {hi:g}.")
        return default
    if not lo <= value <= hi:
        if strict:
            raise ValueError(f"{name} трябва да е между {lo:g} и {hi:g}.")
        value = min(max(value, lo), hi)
    return int(round(value)) if kind == "int" else float(value)


def coerce_fields(cls, data: Mapping | None, specs: Mapping[str, FieldSpec], *, strict: bool = False) -> dict:
    """{field: value} for the dataclass `cls` from `data` (unknown keys dropped, see the module doc)."""
    if data is None:
        data = {}
    if not isinstance(data, Mapping):
        if strict:
            raise ValueError("Очаква се обект (JSON object).")
        data = {}
    out: dict = {}
    for f in fields(cls):
        if f.name not in data:
            continue
        spec = specs.get(f.name)
        value = data[f.name]
        out[f.name] = value if spec is None else _coerce(f.name, value, spec, strict, _default(f))
    return out
