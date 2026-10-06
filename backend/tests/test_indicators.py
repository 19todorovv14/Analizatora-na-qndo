import math

import pytest

from app import indicators as ind
from app.market.base import Candle


def test_sma_basic():
    assert ind.sma([1, 2, 3, 4, 5], 3) == [None, None, 2, 3, 4]


def test_ema_seeded_with_sma_and_converges():
    vals = [10.0] * 30
    e = ind.ema(vals, 10)
    assert e[:9] == [None] * 9
    assert e[9] == pytest.approx(10.0)
    assert e[-1] == pytest.approx(10.0)
    rising = list(range(1, 51))
    er = ind.ema(rising, 10)
    assert er[-1] < rising[-1]  # EMA lags price in a trend
    assert er[-1] > ind.sma(rising, 10)[-1] - 1  # but reacts faster than a long SMA


def test_ema_formula():
    vals = [1, 2, 3, 4, 5, 6]
    e = ind.ema(vals, 3)
    k = 2 / 4
    expected = 2.0  # SMA(1,2,3)
    expected = 4 * k + expected * (1 - k)
    assert e[3] == pytest.approx(expected)


def test_rsi_extremes_and_bounds():
    up = [float(i) for i in range(1, 40)]
    assert ind.rsi(up, 14)[-1] == pytest.approx(100.0)
    down = [float(i) for i in range(40, 1, -1)]
    assert ind.rsi(down, 14)[-1] == pytest.approx(0.0)
    zigzag = [100 + (1 if i % 2 else -1) * (i % 5) for i in range(100)]
    vals = [v for v in ind.rsi(zigzag, 14) if v is not None]
    assert all(0 <= v <= 100 for v in vals)
    assert ind.rsi([1.0] * 5, 14) == [None] * 5


def test_macd_relationship():
    closes = [100 + math.sin(i / 5) * 5 + i * 0.1 for i in range(120)]
    line, sig, hist = ind.macd(closes)
    for a, b, h in zip(line, sig, hist, strict=True):
        if h is not None:
            assert h == pytest.approx(a - b)
    assert line[24] is None and line[25] is not None


def test_bollinger_symmetric_and_flat():
    closes = [100 + math.sin(i) for i in range(50)]
    u, m, lo = ind.bollinger(closes, 20, 2)
    assert u[-1] - m[-1] == pytest.approx(m[-1] - lo[-1])
    flat_u, flat_m, flat_l = ind.bollinger([5.0] * 25, 20, 2)
    assert flat_u[-1] == flat_m[-1] == flat_l[-1] == 5.0


def test_atr_constant_range():
    highs = [11.0] * 30
    lows = [9.0] * 30
    closes = [10.0] * 30
    a = ind.atr(highs, lows, closes, 14)
    assert a[13] == pytest.approx(2.0)
    assert a[-1] == pytest.approx(2.0)


def test_true_range_uses_gaps():
    tr = ind.true_range([10, 20], [9, 19], [9.5, 19.5])
    assert tr[1] == pytest.approx(20 - 9.5)


def test_vwap_resets_daily():
    day = 86400
    candles = [Candle(0, 10, 10, 10, 10, 1), Candle(60, 20, 20, 20, 20, 3), Candle(day, 50, 50, 50, 50, 1)]
    v = ind.vwap(candles)
    assert v[1] == pytest.approx((10 * 1 + 20 * 3) / 4)
    assert v[2] == pytest.approx(50)


def test_highest_lowest_exclude_current_bar():
    vals = [1, 5, 3, 9, 2]
    h = ind.highest(vals, 2)
    assert h[2] == 5 and h[4] == 9
    assert h[3] == 5  # current bar (9) is not included → no lookahead
    lo = ind.lowest(vals, 2)
    assert lo[4] == 3


def test_adx_range():
    n = 120
    highs = [100 + i * 0.5 + 1 for i in range(n)]
    lows = [100 + i * 0.5 - 1 for i in range(n)]
    closes = [100 + i * 0.5 for i in range(n)]
    a = [v for v in ind.adx(highs, lows, closes, 14) if v is not None]
    assert a and all(0 <= v <= 100 for v in a)
    assert a[-1] > 25  # steady trend → strong ADX


def test_compute_dispatch_and_unknown():
    candles = [Candle(i * 60, 10 + i, 11 + i, 9 + i, 10.5 + i, 100) for i in range(60)]
    out = ind.compute("macd", candles)
    assert set(out) == {"macd", "signal", "hist"}
    with pytest.raises(ValueError):
        ind.compute("magic", candles)
