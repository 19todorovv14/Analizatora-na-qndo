"""Backtests size positions in the account currency (USD), whatever the instrument is quoted in."""

from __future__ import annotations

import pytest

from app.backtesting.engine import BacktestSettings, run_backtest
from app.market.catalog import get_asset
from app.market.demo import DemoMarketDataProvider
from app.strategies.rules import StrategyDefinition
from app.strategies.templates import TEMPLATES_BY_KEY

NOW = 1_780_000_000


def _risk_per_trade(symbol: str) -> list[float]:
    spec = get_asset(symbol)
    candles = DemoMarketDataProvider(clock=lambda: NOW).get_candles(spec, "1h", limit=1500, now=NOW, include_partial=False)
    defn = StrategyDefinition(**TEMPLATES_BY_KEY["ema_cross_trend"]["definition"])
    settings = BacktestSettings(initial_balance=10_000, risk_per_trade_pct=1.0)
    res = run_backtest(candles, spec, defn, settings, "1h", with_regimes=False)
    # r_multiple = net / risk (risk in USD) -> risk = net / r
    return [abs(t["net_pnl"] / t["r_multiple"]) for t in res["trades"] if t["r_multiple"] and t["exit_reason"] != "end_of_test"]


@pytest.mark.parametrize("symbol", ["EUR/USD", "USD/JPY", "BTC/USDT"])
def test_initial_risk_is_about_one_percent_of_equity_in_usd(symbol):
    risks = _risk_per_trade(symbol)
    assert risks, f"no trades for {symbol}"
    # 1% of a ~10k account; equity drifts during the test, so allow a wide but currency-sensitive band
    # (sizing in quote currency would make USD/JPY ~150x too small)
    assert 60 < risks[0] < 140
    assert all(30 < r < 200 for r in risks)
