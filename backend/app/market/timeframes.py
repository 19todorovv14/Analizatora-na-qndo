"""Timeframe helpers. API timeframe codes are lowercase: 1m 5m 15m 30m 1h 4h 1d 1w."""

from __future__ import annotations

TIMEFRAMES: dict[str, int] = {
    "5s": 5,  # internal only (demo tick level)
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
}

PUBLIC_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]

# 1970-01-05 00:00 UTC was a Monday; weekly candles open on Monday (exchange convention).
_MONDAY_EPOCH = 4 * 86400


class TimeframeError(ValueError):
    pass


def tf_seconds(tf: str) -> int:
    try:
        return TIMEFRAMES[tf]
    except KeyError as exc:  # pragma: no cover - validated at API layer
        raise TimeframeError(f"Unsupported timeframe: {tf}") from exc


def validate_timeframe(tf: str) -> str:
    tf = tf.lower()
    if tf not in PUBLIC_TIMEFRAMES:
        raise TimeframeError(f"Unsupported timeframe '{tf}'. Use one of {', '.join(PUBLIC_TIMEFRAMES)}")
    return tf


def align(ts: int, tf: str) -> int:
    """Open time of the candle of timeframe `tf` that contains `ts`."""
    sec = tf_seconds(tf)
    if tf == "1w":
        return ts - ((ts - _MONDAY_EPOCH) % sec)
    return ts - (ts % sec)


def last_closed_open(now: int, tf: str) -> int:
    """Open time of the most recent fully closed candle."""
    return align(now, tf) - tf_seconds(tf)
