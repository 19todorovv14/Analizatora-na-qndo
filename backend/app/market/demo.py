"""Deterministic synthetic market data (clearly labelled DEMO everywhere in the UI).

Design goals
------------
* **Consistent across timeframes.** Daily candles are generated first (regime-switching
  random walk with fat tails). Every intraday candle is generated *inside* its parent
  (1d → 4h → 1h → 30m → 15m → 5m → 1m → 5s) with a Brownian bridge whose extremes are
  mapped exactly onto the parent's high/low. Aggregating children always reproduces the
  parent, so a 1H chart and a 5m chart tell the same story.
* **Deterministic.** Every candle is a pure function of (symbol, timeframe, time), so
  tests are reproducible and the "live" demo feed is identical for every user.
* **No future leakage.** Only candles that have opened before `now` are returned; the
  forming candle is built from already-elapsed 5-second ticks.
"""

from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from app.market.base import (
    AssetSpec,
    Candle,
    DataNotAvailableError,
    DataSource,
    MarketDataError,
    MarketDataProvider,
    Ticker,
)
from app.market.catalog import get_asset
from app.market.timeframes import align, tf_seconds

GENESIS = 1514764800  # 2018-01-01 00:00 UTC (Monday)
ANCHOR_TS = 1767225600  # 2026-01-01 00:00 UTC — prices are scaled so the close here = anchor_price
HORIZON_DAYS = 365 * 12 + 3
HORIZON_END = GENESIS + HORIZON_DAYS * 86400  # 2030-01-01 00:00 UTC: no demo data from here on
_HORIZON_MESSAGE = "DEMO data is generated only for 2018-01-01 … 2029-12-31 (no synthetic data outside that range)."

CHILDREN: dict[str, tuple[str, int]] = {
    "1d": ("4h", 6),
    "4h": ("1h", 4),
    "1h": ("30m", 2),
    "30m": ("15m", 2),
    "15m": ("5m", 3),
    "5m": ("1m", 5),
    "1m": ("5s", 12),
}
PARENT: dict[str, str] = {child: parent for parent, (child, _) in CHILDREN.items()}

# name, drift (in units of daily vol), vol multiplier, volume multiplier
_REGIMES = [
    ("bull", 0.10, 1.00, 1.0),
    ("bear", -0.10, 1.10, 1.1),
    ("range", 0.0, 0.80, 0.85),
    ("volatile", 0.0, 1.80, 1.5),
    ("calm", 0.0, 0.55, 0.7),
]
_REGIME_P = np.array([0.28, 0.22, 0.25, 0.10, 0.15])
_P_STAY = 0.965

# 4h volume profile inside a UTC day (index 0 = 00:00-04:00)
_PROFILES = {
    "crypto": [0.9, 1.0, 1.1, 1.1, 1.0, 0.9],
    "forex": [0.6, 1.0, 1.3, 1.3, 0.9, 0.6],
    "commodity": [0.6, 0.9, 1.2, 1.5, 1.1, 0.7],
    "index": [0.4, 0.5, 0.9, 1.6, 1.8, 0.8],
    "stock": [0.3, 0.4, 0.8, 1.7, 2.0, 0.8],
    "etf": [0.3, 0.4, 0.8, 1.7, 2.0, 0.8],  # same as stock
}

DEMO_SOURCE = DataSource(
    id="demo",
    name="Demo data (synthetic)",
    is_live=False,
    disclaimer=(
        "Синтетични, детерминистично генерирани данни за обучение. Не са реални пазарни цени "
        "и не трябва да се използват за реални решения."
    ),
    status="demo",
)


def _seed(*parts: object) -> int:
    h = hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8)
    return int.from_bytes(h.digest(), "little")


@dataclass(slots=True)
class _Daily:
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray  # noqa: E741
    c: np.ndarray
    v: np.ndarray
    regime: np.ndarray


@lru_cache(maxsize=512)  # ≥ curated catalog size, so a sweep over all instruments never thrashes
def _daily(symbol: str) -> _Daily:
    spec = get_asset(symbol)
    rng = np.random.default_rng(_seed(symbol, "daily-v1"))
    n = HORIZON_DAYS
    vol = spec.daily_vol
    close_log = np.empty(n)
    rets = np.empty(n)
    regimes = np.empty(n, dtype=np.int8)
    x = 0.0
    anchor = 0.0
    r = 2
    t_scale = 1 / math.sqrt(2.0)  # Student-t(4) has variance 2
    for t in range(n):
        if t > 0 and rng.random() > _P_STAY:
            r = int(rng.choice(len(_REGIMES), p=_REGIME_P))
            anchor = x
        name, mu_k, vol_k, _ = _REGIMES[r]
        shock = rng.standard_t(4) * t_scale
        ret = spec.drift + mu_k * vol + vol * vol_k * shock
        if name == "range":
            ret += -0.15 * (x - anchor)
        ret += -0.003 * (x - spec.drift * t)  # keep long history in a sensible band
        x += ret
        close_log[t] = x
        rets[t] = ret
        regimes[t] = r

    c = np.exp(close_log)
    o = np.empty(n)
    o[0] = 1.0
    if spec.asset_class == "crypto":
        o[1:] = c[:-1]
    else:  # small overnight gaps for traditional markets
        o[1:] = c[:-1] * np.exp(rng.standard_normal(n - 1) * vol * 0.15)
    vol_k = np.array([_REGIMES[i][2] for i in regimes])
    up = np.abs(rng.standard_normal(n)) * vol * 0.45 * vol_k
    dn = np.abs(rng.standard_normal(n)) * vol * 0.45 * vol_k
    h = np.maximum(o, c) * np.exp(up)
    l = np.minimum(o, c) * np.exp(-dn)  # noqa: E741

    anchor_idx = (ANCHOR_TS - GENESIS) // 86400
    k = spec.anchor_price / c[anchor_idx]
    p = spec.price_precision
    o, h, l, c = (np.round(a * k, p) for a in (o, h, l, c))  # noqa: E741
    if spec.asset_class == "crypto":
        o[1:] = c[:-1]
    h = np.maximum(h, np.maximum(o, c))
    l = np.minimum(l, np.minimum(o, c))  # noqa: E741

    vol_mult = np.array([_REGIMES[i][3] for i in regimes])
    base_units = spec.daily_volume_usd / spec.anchor_price
    v = base_units * np.exp(rng.standard_normal(n) * 0.25) * (1 + 0.8 * np.abs(rets) / vol) * vol_mult
    v = np.round(v, 4)
    return _Daily(o, h, l, c, v, regimes)


def _interp_map(lo_src: float, lo_oc: float, hi_oc: float, hi_src: float, low: float, high: float):
    xs = [lo_src, lo_oc, hi_oc, hi_src]
    ys = [low, lo_oc, hi_oc, high]
    kx, ky = [xs[0]], [ys[0]]
    for xv, yv in zip(xs[1:], ys[1:], strict=True):
        if xv > kx[-1]:
            kx.append(xv)
            ky.append(yv)
    return np.asarray(kx), np.asarray(ky)


@lru_cache(maxsize=250_000)
def _children(symbol: str, parent_tf: str, parent: tuple) -> tuple[tuple, ...]:
    """Split a parent candle into children whose aggregate reproduces it exactly."""
    spec = get_asset(symbol)
    child_tf, k = CHILDREN[parent_tf]
    ts, o, h, l, c, v = parent  # noqa: E741
    sec = tf_seconds(child_tf)
    rng = np.random.default_rng(_seed(symbol, parent_tf, ts))

    if parent_tf == "1d":
        profile = np.asarray(_PROFILES.get(spec.asset_class, _PROFILES["crypto"]))
    else:
        profile = np.ones(k)
    weights = rng.dirichlet(profile * 4.0)
    vols = [round(float(v * w), 6) for w in weights]

    span = h - l
    if span <= 0:
        return tuple((ts + i * sec, o, o, o, o, vols[i]) for i in range(k))

    lin = np.linspace(0.0, 1.0, k + 1)
    walk = np.concatenate([[0.0], np.cumsum(rng.standard_normal(k))])
    bridge = walk - lin * walk[-1]
    ptp = float(np.ptp(bridge)) or 1.0
    path = o + (c - o) * lin + bridge * (span * rng.uniform(0.25, 0.75) / ptp)
    path[0], path[-1] = o, c
    co, cc = path[:-1], path[1:]
    wick = span / math.sqrt(k) * 0.25
    ch = np.maximum(co, cc) + np.abs(rng.standard_normal(k)) * wick + span * 1e-6
    cl = np.minimum(co, cc) - np.abs(rng.standard_normal(k)) * wick - span * 1e-6

    kx, ky = _interp_map(float(cl.min()), min(o, c), max(o, c), float(ch.max()), l, h)
    p = spec.price_precision
    co, cc, ch, cl = (np.round(np.interp(a, kx, ky), p) for a in (co, cc, ch, cl))
    return tuple((ts + i * sec, float(co[i]), float(ch[i]), float(cl[i]), float(cc[i]), vols[i]) for i in range(k))


def _aggregate(parts: list[tuple]) -> tuple:
    return (
        parts[0][0],
        parts[0][1],
        max(p[2] for p in parts),
        min(p[3] for p in parts),
        parts[-1][4],
        round(sum(p[5] for p in parts), 6),
    )


class DemoMarketDataProvider(MarketDataProvider):
    source = DEMO_SOURCE

    def __init__(self, clock=time.time):
        self._clock = clock

    def supports(self, asset: AssetSpec) -> bool:
        # Curated instruments all carry demo parameters; synced ones don't (→ DATA_NOT_AVAILABLE in demo mode).
        return asset.demo_capable

    def _check(self, asset: AssetSpec) -> None:
        if not asset.demo_capable:
            raise DataNotAvailableError(
                f"Demo data is not available for {asset.symbol} (no demo parameters)", symbol=asset.symbol
            )

    # ------------------------------------------------------------------ series
    def _daily_tuple(self, symbol: str, idx: int) -> tuple:
        d = _daily(symbol)
        return (
            GENESIS + idx * 86400,
            float(d.o[idx]),
            float(d.h[idx]),
            float(d.l[idx]),
            float(d.c[idx]),
            float(d.v[idx]),
        )

    def _series(self, symbol: str, tf: str, start: int, end: int) -> list[tuple]:
        """Complete candles with open time in [start, end]."""
        start = max(start, GENESIS)
        if end < start:
            return []
        if tf == "1d":
            i0 = (start - GENESIS + 86399) // 86400
            i1 = min((end - GENESIS) // 86400, HORIZON_DAYS - 1)
            return [self._daily_tuple(symbol, i) for i in range(i0, i1 + 1)]
        if tf == "1w":
            w0 = (start - GENESIS + 604799) // 604800
            w1 = (end - GENESIS) // 604800
            out = []
            for w in range(w0, w1 + 1):
                days = [self._daily_tuple(symbol, w * 7 + j) for j in range(7) if w * 7 + j < HORIZON_DAYS]
                if days:
                    out.append(_aggregate(days))
            return out
        parent_tf = PARENT[tf]
        parents = self._series(symbol, parent_tf, align(start, parent_tf), end)
        out: list[tuple] = []
        for p in parents:
            for ch in _children(symbol, parent_tf, p):
                if start <= ch[0] <= end:
                    out.append(ch)
        return out

    def _child_list(self, symbol: str, tf: str, full: tuple) -> tuple[str, tuple]:
        if tf == "1w":
            first = (full[0] - GENESIS) // 86400
            days = tuple(self._daily_tuple(symbol, first + j) for j in range(7) if first + j < HORIZON_DAYS)
            return "1d", days
        child_tf, _ = CHILDREN[tf]
        return child_tf, _children(symbol, tf, full)

    def _partial(self, symbol: str, tf: str, open_ts: int, now: int) -> tuple | None:
        """The still-forming candle, built only from already elapsed sub-candles."""
        full = self._series(symbol, tf, open_ts, open_ts)
        if not full:
            return None
        if tf == "5s":
            return full[0] if open_ts + 5 <= now else None
        child_tf, kids = self._child_list(symbol, tf, full[0])
        csec = tf_seconds(child_tf)
        parts: list[tuple] = []
        for ch in kids:
            if ch[0] + csec <= now:
                parts.append(ch)
            elif ch[0] <= now:
                p = self._partial(symbol, child_tf, ch[0], now)
                if p is not None:
                    parts.append(p)
                break
            else:
                break
        return _aggregate(parts) if parts else None

    # ------------------------------------------------------------- public API
    def get_candles(
        self,
        asset: AssetSpec,
        timeframe: str,
        *,
        start: int | None = None,
        end: int | None = None,
        limit: int = 500,
        now: int | None = None,
        include_partial: bool = True,
    ) -> list[Candle]:
        self._check(asset)
        now = int(now if now is not None else self._clock())
        sec = tf_seconds(timeframe)
        end = now if end is None else min(end, now)
        current_open = align(now, timeframe)
        last_closed = current_open - sec
        closed_end = min(align(end, timeframe), last_closed)
        if start is None:
            start = closed_end - (limit - 1) * sec
        if start >= HORIZON_END:
            raise MarketDataError(_HORIZON_MESSAGE)
        rows = self._series(asset.symbol, timeframe, start, closed_end)
        if include_partial and start <= current_open <= end:
            part = self._partial(asset.symbol, timeframe, current_open, now)
            if part is not None:
                rows.append(part)
        if len(rows) > limit and limit > 0:
            rows = rows[-limit:]
        return [Candle(*r) for r in rows]

    def get_ticker(self, asset: AssetSpec, *, now: int | None = None) -> Ticker:
        self._check(asset)
        now = int(now if now is not None else self._clock())
        last = self.get_candles(asset, "1m", limit=2, now=now)
        if not last:
            raise MarketDataError(_HORIZON_MESSAGE)
        price = last[-1].close
        prev = self.get_candles(asset, "1m", limit=1, end=now - 86400, now=now, include_partial=False)
        change = (price / prev[-1].close - 1) * 100 if prev else None
        hourly = self.get_candles(asset, "1h", limit=25, now=now)
        vol24 = sum(c.volume for c in hourly[-24:])
        return Ticker(
            symbol=asset.symbol,
            price=price,
            ts=now,
            change_24h_pct=round(change, 3) if change is not None else None,
            volume_24h=round(vol24, 4),
            source=self.source.id,
        )

    def regime_label(self, asset: AssetSpec, ts: int) -> str:
        """Ground-truth generator regime for a day (used only by tests/education)."""
        idx = (ts - GENESIS) // 86400
        return _REGIMES[int(_daily(asset.symbol).regime[idx])][0]
