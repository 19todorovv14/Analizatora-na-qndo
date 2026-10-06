"""S6 — Bot Lab v2: max positions, per-bar evaluation statistics, BOT AI COACH, light list / no sync runs."""

from __future__ import annotations

import secrets
from types import SimpleNamespace

import pytest

from app.bots import coach as bot_coach_mod
from app.bots import stats as bot_stats
from app.market.timeframes import last_closed_open
from app.models import Bot
from app.services import bot_service, market_service, paper_service, user_service
from app.strategies.templates import TEMPLATES_BY_KEY

NOW = 1_780_000_000
HOUR = 3600

ALWAYS_LONG = {
    "entry_long": {
        "logic": "all",
        "conditions": [
            {"left": {"kind": "price", "field": "close"}, "op": ">", "right": {"kind": "value", "value": 0}}
        ],
    },
    "stop": {"type": "atr", "value": 3},
    "take_profit": {"type": "r_multiple", "value": 3},
}


@pytest.fixture
def user(client, db):  # `client` makes sure the app (DB schema + seed) is initialised
    return user_service.create_user(
        db, email=f"s6-{secrets.token_hex(4)}@test.local", password=None, display_name="S6", is_guest=True
    )


def _strategy(db, user, definition, name="S6 test"):
    return user_service.save_strategy(
        db, user, name=name, description="", symbol="BTC/USDT", timeframe="1h", definition=definition
    )


def _bot(db, user, definition, *, max_positions=None, config=None, name="S6 bot", symbol="BTC/USDT", tf="1h"):
    s = _strategy(db, user, definition)
    data = {
        "name": name,
        "symbol": symbol,
        "timeframe": tf,
        "strategy_id": s.id,
        "run_mode": "warm_start",
        "config": {"warm_start_days": 10, "daily_loss_limit_pct": 100, "risk_per_trade_pct": 0.5, **(config or {})},
    }
    if max_positions is not None:
        data["max_positions"] = max_positions
    return bot_service.create_bot(db, user, data)


def _max_concurrent(db, bot: Bot) -> int:
    trades = paper_service.closed_trades(db, [bot.paper_account_id])
    spans: dict[str, list[float]] = {}
    for t in trades:
        a, b = spans.get(t["position_id"], [t["opened_ts"], t["closed_ts"]])
        spans[t["position_id"]] = [min(a, t["opened_ts"]), max(b, t["closed_ts"])]
    acc = db.get(paper_service.PaperAccount, bot.paper_account_id)
    for p in paper_service.load_broker(db, acc).open_positions():
        spans[p.id] = [p.opened_ts, float("inf")]
    events = sorted(
        [(a, 1) for a, _ in spans.values()] + [(b, -1) for _, b in spans.values()], key=lambda e: (e[0], e[1])
    )
    cur = best = 0
    for _, delta in events:
        cur += delta
        best = max(best, cur)
    return best


# ------------------------------------------------------------------ max positions
@pytest.mark.parametrize("limit", [1, 3])
def test_run_bot_enforces_max_open_positions(db, user, limit):
    bot = _bot(db, user, ALWAYS_LONG, max_positions=limit)
    assert bot.config["max_open_positions"] == limit
    bot_service.start_bot(db, bot, NOW)
    processed = bot_service.run_bot(db, bot, NOW)
    assert processed > 200
    concurrent = _max_concurrent(db, bot)
    assert concurrent == limit  # reached (the entry rule is always true) but never exceeded
    stats = bot_service.evaluation_stats(bot)
    assert stats["rejected_by_filters"]["max_positions"] > 0
    # sizing is capped by FREE margin, so extra positions are not rejected by the paper broker
    assert stats["rejected_by_filters"]["margin"] == 0
    trades = paper_service.closed_trades(db, [bot.paper_account_id])
    open_now = len(
        paper_service.load_broker(db, db.get(paper_service.PaperAccount, bot.paper_account_id)).open_positions()
    )
    assert stats["entries"] >= len({t["position_id"] for t in trades}) + open_now


def test_old_config_key_still_works_and_view_exposes_max_positions(db, user):
    bot = _bot(db, user, ALWAYS_LONG, config={"max_open_positions": 2})
    assert bot.config["max_open_positions"] == 2
    view = bot_service.bot_view(db, bot, NOW)
    assert view["max_positions"] == 2 and view["config"]["max_open_positions"] == 2
    assert view["evaluation_stats"]["bars_evaluated"] == 0
    assert view["drawdown_curve"] == [] and view["coach_headline"]


# ------------------------------------------------------------------ evaluation statistics
def test_runtime_stats_are_consistent_and_bounded(db, user):
    tpl = TEMPLATES_BY_KEY["trend_momentum_structure"]["definition"]
    bot = _bot(db, user, tpl, config={"warm_start_days": 20})
    bot_service.start_bot(db, bot, NOW)
    first = bot_service.run_bot(db, bot, NOW - 5 * 24 * HOUR)
    second = bot_service.run_bot(db, bot, NOW)  # continues; stats must survive the daily runtime reset
    db.refresh(bot)
    st = bot.runtime["stats"]
    assert st["bars_evaluated"] == first + second
    assert st["setups_generated"] == st["all_conditions_met"] + st["rejected"]
    assert st["setups_generated"] > 0 and st["rejected"] > 0
    assert st["entries"] <= st["all_conditions_met"]
    assert sum(st["rejected_by_condition"].values()) >= st["rejected"]
    assert set(st["rejected_by_condition"]) <= {
        "Close > EMA(200)",
        "RSI(14) > 50",
        "Higher High",
        "Volume > VOLUME_SMA(20)",
    }
    assert set(st["rejected_by_filters"]) == set(bot_stats.FILTER_KEYS)
    assert st["by_side"]["long"]["setups"] == st["setups_generated"] and st["by_side"]["short"]["setups"] == 0
    assert bot.runtime["day"] and bot.runtime["start_equity"]  # daily-loss bookkeeping kept
    # every bot trade carries the context at entry
    trades = paper_service.closed_trades(db, [bot.paper_account_id])
    assert trades
    for t in trades:
        assert t["meta"]["regime"] and t["meta"]["atr_pct"] > 0 and t["meta"]["signal_ts"]
        assert t["meta"]["entry_context"]["regime"] == t["meta"]["regime"]


def test_record_bar_counts_trigger_setups_and_blockers():
    st = bot_stats.empty_stats()

    def block(*passed, logic="all"):
        conds = [{"label": f"C{i + 1}", "passed": p} for i, p in enumerate(passed)]
        ok = all(passed) if logic == "all" else any(passed)
        return {"active": True, "logic": logic, "passed": ok, "conditions": conds}

    inactive = {"active": False, "passed": False, "conditions": []}
    bot_stats.record_bar(st, {"entry_long": block(True, True), "entry_short": inactive}, 1)
    bot_stats.record_bar(st, {"entry_long": block(True, False), "entry_short": inactive}, 2)
    bot_stats.record_bar(st, {"entry_long": block(False, True), "entry_short": inactive}, 3)  # no trigger → no setup
    bot_stats.record_bar(st, {"entry_long": block(False, True, logic="any"), "entry_short": inactive}, 4)
    assert (st["bars_evaluated"], st["setups_generated"], st["all_conditions_met"], st["rejected"]) == (4, 3, 2, 1)
    assert st["rejected_by_condition"] == {"C2": 1}
    both = {"entry_long": block(True, False), "entry_short": block(True, False)}
    met = bot_stats.record_bar(st, both, 5)
    assert met == {"long": False, "short": False}
    assert st["rejected_by_condition"] == {"C2": 1, "LONG: C2": 1, "SHORT: C2": 1}
    bot_stats.record_filter(st, "regime")
    bot_stats.record_entry(st, "long")
    bot_stats.record_entry(st, "long")
    bot_stats.record_order_rejected(st, "long")  # broker rejected one of them → not an entry, counted as "margin"
    assert st["entries"] == 1 and st["by_side"]["long"]["entries"] == 1
    assert st["rejected_by_filters"]["margin"] == 1
    top = bot_stats.top_blockers(st)
    assert top[0]["count"] == 1 and {b["kind"] for b in top} == {"condition", "filter"}
    assert {b.get("key") for b in top if b["kind"] == "filter"} == {"regime", "margin"}
    assert bot_stats.headline(st) == "5 setups → 2 с изпълнени условия → 1 сделки"
    # bounded: labels beyond the cap are not added
    room = bot_stats.MAX_CONDITION_LABELS - len(st["rejected_by_condition"])
    st["rejected_by_condition"].update({f"x{i}": 1 for i in range(room)})
    bot_stats.record_bar(st, {"entry_long": {**block(True, False), "conditions": [
        {"label": "C1", "passed": True}, {"label": "brand new", "passed": False}]}, "entry_short": inactive}, 6)  # fmt: skip
    assert len(st["rejected_by_condition"]) == bot_stats.MAX_CONDITION_LABELS
    assert bot_stats.normalise(None) == bot_stats.empty_stats()
    assert bot_stats.normalise({"setups_generated": 3})["rejected_by_filters"]["regime"] == 0


# ------------------------------------------------------------------ coach analytics on crafted trades
def _ct(side, regime, r, atr, hour):
    ts = NOW - NOW % 86400 + hour * HOUR
    return {
        "side": side,
        "r_multiple": r,
        "net_pnl": r * 100,
        "opened_ts": ts,
        "closed_ts": ts + HOUR,
        "meta": {"regime": regime, "atr_pct": atr},
    }


def test_breakdowns_and_main_losing_condition():
    trades = (
        [_ct("long", "TRENDING_UP", 1.5, 0.5 + i * 0.01, 9) for i in range(4)]
        + [_ct("long", "RANGING", -1.0, 1.0 + i * 0.01, 14) for i in range(3)]
        + [_ct("short", "RANGING", -0.2, 0.8, 2), _ct("short", "TRENDING_UP", 0.5, 0.7, 3)]
    )
    groups = bot_coach_mod.breakdowns(trades)
    assert {r["value"] for r in groups["side"]} == {"long", "short"}
    assert {r["value"] for r in groups["volatility"]} <= {"low", "mid", "high"} and groups["volatility"]
    losing = bot_coach_mod.main_losing_condition(groups)
    assert losing["attribute"] in ("regime", "session", "volatility")
    assert losing["average_r"] < 0 and losing["trades"] >= 3
    worst, best = bot_coach_mod._regime_extremes(groups["regime"])
    assert worst["regime"] == "RANGING" and best["regime"] == "TRENDING_UP"
    assert worst["average_r"] == pytest.approx((-3 - 0.2) / 4)
    # all regimes losing → there is no "best" regime; all winning → no "worst"
    losers = [_ct("long", r, -0.5, 1.0, 9) for r in ("RANGING", "UNCLEAR") for _ in range(3)]
    w, b = bot_coach_mod._regime_extremes(bot_coach_mod.breakdowns(losers)["regime"])
    assert w is not None and b is None
    w, b = bot_coach_mod._regime_extremes(bot_coach_mod.breakdowns(trades[:4])["regime"])
    assert w is None and b["regime"] == "TRENDING_UP"
    # only winners → no "losing" context
    assert bot_coach_mod.main_losing_condition(bot_coach_mod.breakdowns(trades[:4])) is None
    # a single group (all LONG) is not a "condition"
    assert bot_coach_mod.main_losing_condition({"side": [{"value": "long", "label": "LONG", "trades": 9,
                                                          "average_r": -1.0, "win_rate": 0, "net_pnl": -9}]}) is None  # fmt: skip


# ------------------------------------------------------------------ coach end-to-end
COACH_KEYS = {
    "title",
    "source",
    "source_label",
    "period",
    "headline",
    "setups_generated",
    "all_conditions_met",
    "rejected",
    "entries",
    "rejected_by_condition",
    "rejected_by_filters",
    "top_blockers",
    "trades",
    "win_rate",
    "average_r",
    "main_losing_condition",
    "worst_regime",
    "best_regime",
    "breakdowns",
    "insights",
    "next_steps",
    "disclaimer",
}


def test_coach_after_warm_start_run(db, user):
    tpl = TEMPLATES_BY_KEY["trend_momentum_structure"]["definition"]
    bot = _bot(db, user, tpl, config={"warm_start_days": 30})
    bot_service.start_bot(db, bot, NOW)
    bot_service.run_bot(db, bot, NOW)
    c = bot_coach_mod.bot_coach(db, bot, NOW)
    assert COACH_KEYS <= set(c)
    assert c["title"] == "BOT AI COACH" and c["source"] == "bot"
    assert c["disclaimer"] == "Analysis of past simulated behaviour, not a guarantee."
    assert c["setups_generated"] == c["all_conditions_met"] + c["rejected"] > 0
    assert c["insights"][0] == (
        f"Стратегията генерира {c['setups_generated']} setups. {c['all_conditions_met']} изпълниха всички условия. "
        f"{c['rejected']} бяха отхвърлени."
    )
    assert c["top_blockers"] and c["top_blockers"][0]["count"] >= c["top_blockers"][-1]["count"]
    assert c["trades"] == len(paper_service.closed_trades(db, [bot.paper_account_id]))
    hrefs = [s["href"] for s in c["next_steps"]]
    assert hrefs[0].startswith(f"/backtesting?strategy={bot.strategy_id}&symbol=BTC%2FUSDT&timeframe=1h")
    assert "/journal" in hrefs and any(h.startswith("/learn/") for h in hrefs)
    for key in ("main_losing_condition", "worst_regime", "best_regime"):
        v = c[key]
        assert v is None or (v["trades"] >= 3 and v["average_r"] is not None)
    text = " ".join(c["insights"]).lower()
    for banned in ("guarantee", "гарант", "buy now", "100%", "risk-free"):
        assert banned not in text


def test_coach_estimates_stats_for_a_bot_that_never_ran(db, user):
    bot = _bot(db, user, TEMPLATES_BY_KEY["trend_momentum_structure"]["definition"], config={"warm_start_days": 15})
    c = bot_coach_mod.bot_coach(db, bot, NOW)
    assert c["source"] == "estimate" and "ОЦЕНКА" in c["source_label"]
    assert c["period"]["bars_evaluated"] == 15 * 24
    assert c["setups_generated"] > 0 and c["entries"] == 0 and c["trades"] == 0
    assert c["insights"][0].startswith("Оценка върху историята: Стратегията генерира")
    assert c["main_losing_condition"] is None and c["worst_regime"] is None
    db.refresh(bot)
    assert not (bot.runtime or {}).get("stats")  # the estimate is not stored as the bot's own statistics


def test_coach_estimate_applies_static_filters(db, user):
    d = {**ALWAYS_LONG, "regime_filter": ["LOW_VOLATILITY"]}
    bot = _bot(
        db, user, d, config={"warm_start_days": 5, "trading_hours": {"start": 8, "end": 16, "days": [0, 1, 2, 3, 4]}}
    )
    c = bot_coach_mod.bot_coach(db, bot, NOW)
    f = c["rejected_by_filters"]
    assert c["setups_generated"] == c["all_conditions_met"] == 5 * 24
    assert f["trading_hours"] > 0 and f["regime"] > 0
    assert f["trading_hours"] + f["regime"] <= c["all_conditions_met"]


# ------------------------------------------------------------------ API
def _api_strategy(guest, definition=ALWAYS_LONG):
    r = guest.post(
        "/api/strategies",
        json={"name": "S6 api", "symbol": "BTC/USDT", "timeframe": "1h", "definition": definition},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_bot_api_max_positions_coach_and_list(guest):
    sid = _api_strategy(guest)
    created = guest.post(
        "/api/bots",
        json={"name": "API bot", "symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": sid, "run_mode": "warm_start",
              "max_positions": 2, "config": {"warm_start_days": 3, "daily_loss_limit_pct": 50}},
    )  # fmt: skip
    assert created.status_code == 200, created.text
    bot = created.json()
    assert bot["max_positions"] == 2 and bot["config"]["max_open_positions"] == 2
    assert bot["drawdown_curve"] == [] and "evaluation_stats" in bot
    started = guest.post(f"/api/bots/{bot['id']}/start").json()
    assert started["evaluation_stats"]["bars_evaluated"] > 0
    assert len(started["drawdown_curve"]) == len(started["equity_curve"])
    coach = guest.get(f"/api/bots/{bot['id']}/coach")
    assert coach.status_code == 200
    assert COACH_KEYS <= set(coach.json()) and coach.json()["source"] == "bot"
    rows = guest.get("/api/bots").json()["bots"]
    row = next(r for r in rows if r["id"] == bot["id"])
    for k in ("id", "name", "symbol", "timeframe", "status", "pause_reason", "equity", "pnl", "drawdown_pct", "regime",
              "last_signal", "run_mode", "trades", "win_rate"):  # fmt: skip
        assert k in row, k  # v1 list keys
    assert row["max_positions"] == 2 and row["coach_headline"] and row["setups_generated"] > 0
    assert guest.post("/api/bots", json={**{"name": "x", "symbol": "BTC/USDT", "timeframe": "1h"}, "strategy_id": sid,
                                         "max_positions": 0}).status_code == 422  # fmt: skip


def test_coach_is_private(guest):
    sid = _api_strategy(guest)
    bot = guest.post(
        "/api/bots", json={"name": "Mine", "symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": sid}
    ).json()
    from fastapi.testclient import TestClient

    from app.main import app

    other = TestClient(app)
    other.post("/api/auth/guest", headers={"x-ta-client": "web"})
    other.headers.update({"x-ta-client": "web"})
    assert other.get(f"/api/bots/{bot['id']}/coach").status_code == 404
    assert TestClient(app).get(f"/api/bots/{bot['id']}/coach").status_code in (401, 403)  # anonymous


def test_reads_do_not_run_bots_when_celery_runs_them(guest, monkeypatch):
    sid = _api_strategy(guest)
    bot = guest.post(
        "/api/bots", json={"name": "Celery", "symbol": "BTC/USDT", "timeframe": "1h", "strategy_id": sid}
    ).json()
    import app.api.strategies as api

    def boom(*_a, **_k):
        raise AssertionError("run_bot must not be called by GET when Celery runs the bots")

    monkeypatch.setattr(api, "get_settings", lambda: SimpleNamespace(use_celery=True))
    monkeypatch.setattr(bot_service, "run_bot", boom)
    assert guest.get("/api/bots").status_code == 200
    assert guest.get(f"/api/bots/{bot['id']}").status_code == 200


def test_run_bot_skips_fetch_without_a_new_closed_candle(db, user, monkeypatch):
    bot = _bot(db, user, ALWAYS_LONG)
    bot_service.start_bot(db, bot, NOW)
    bot_service.run_bot(db, bot, NOW)
    assert bot.last_processed_ts == last_closed_open(NOW, "1h")

    def boom(*_a, **_k):
        raise AssertionError("no candle fetch expected")

    monkeypatch.setattr(market_service, "candles", boom)
    assert bot_service.has_new_candle(bot, NOW + 60) is False
    assert bot_service.run_bot(db, bot, NOW + 60) == 0
    assert bot_service.has_new_candle(bot, NOW + HOUR) is True
