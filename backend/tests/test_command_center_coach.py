"""S7 — AI COACH v2: pattern detection (app.psychology.patterns), the moving-stops fix in behavior.py, the v2
WEEKLY REVIEW (findings / NEXT LESSON / PRACTICE EXERCISE) and GET /api/ai/coach on crafted history."""

from __future__ import annotations

import pytest

from app.ai.coach import weekly_review
from app.ai.safety import sanitize
from app.models import JournalEntry, PaperTrade, ReplayDecision, ReplaySession, User
from app.psychology import patterns as pt
from app.psychology.behavior import analyze_behavior
from app.risk.engine import RiskRules
from app.services import paper_service

T0 = 1_790_000_000
HOUR = 3600


def tr(
    pid: str,
    *,
    opened: int,
    hold: int = HOUR,
    net: float = -10.0,
    risk: float | None = 10.0,
    stop: float | None = 99.0,
    side: str = "long",
    tf: str | None = "1h",
    risk_pct: float | None = 0.5,
    ctx: dict | None = None,
    widened: bool = False,
    atr_pct: float | None = None,
    slice_no: int = 0,
    qty: float = 1.0,
    entry: float = 100.0,
    symbol: str = "BTC/USDT",
    setup: str | None = None,
) -> dict:
    """A closed trade row as paper_service.trade_to_dict returns it."""
    meta: dict = {"risk_pct": risk_pct, "timeframe": tf, "stop_widened": widened}
    if ctx is not None:
        meta["entry_context"] = ctx
    if atr_pct is not None:
        meta["atr_pct"] = atr_pct
    if setup:
        meta["setup"] = setup
    has_risk = stop is not None and risk
    return {
        "id": f"{pid}-{slice_no}",
        "position_id": pid,
        "symbol": symbol,
        "side": side,
        "qty": qty,
        "entry_price": entry,
        "exit_price": entry + net / qty,
        "stop_price": stop,
        "target_price": None,
        "gross_pnl": net,
        "fees": 0.0,
        "net_pnl": net,
        "risk_amount": risk if has_risk else None,
        "r_multiple": net / risk if has_risk else None,
        "exit_reason": "manual",
        "opened_ts": opened,
        "closed_ts": opened + hold,
        "meta": meta,
    }


def series(n: int, *, start: int = T0, gap: int = 6 * HOUR, **kw) -> list[dict]:
    """n non-overlapping positions (far apart, so no re-entry pattern), ids s0..s{n-1}."""
    prefix = kw.pop("prefix", "s")
    return [tr(f"{prefix}{i}", opened=start + i * gap, **kw) for i in range(n)]


def by_key(result: dict) -> dict[str, dict]:
    return {c["key"]: c for c in result["checks"]}


# ------------------------------------------------------------------------------------------- positions
def test_build_positions_merges_partial_closes():
    rows = [
        tr("p1", opened=T0, hold=HOUR, net=10.0, risk=5.0, qty=1.0, slice_no=0),
        tr("p1", opened=T0, hold=2 * HOUR, net=-4.0, risk=5.0, qty=3.0, slice_no=1, widened=True),
    ]
    (p,) = pt.build_positions(rows)
    assert p["slices"] == 2 and p["qty"] == 4.0
    assert p["net_pnl"] == pytest.approx(6.0)
    assert p["r"] == pytest.approx(6.0 / 10.0)  # Σ net / Σ risk
    assert p["stop_widened"] is True  # widened before the LATER partial close
    assert p["holding_seconds"] == 2 * HOUR
    assert p["exit_price"] == pytest.approx((110.0 * 1 + (100 - 4 / 3) * 3) / 4)


def test_behavior_moving_stops_looks_at_every_closing_part():
    rows = [
        tr("p1", opened=T0, slice_no=0, widened=False),
        tr("p1", opened=T0, hold=2 * HOUR, slice_no=1, widened=True),  # widened only before the second close
        tr("p2", opened=T0 + 10 * HOUR),
    ]
    res = analyze_behavior(rows, RiskRules())
    moving = next(f for f in res["findings"] if f["kind"] == "moving_stops")
    assert moving["count"] == 1 and moving["trade_ids"] == ["p1"]


# ------------------------------------------------------------------------------------------- detectors
def test_entered_early_from_entry_context():
    rows = [
        tr("a", opened=T0, ctx={"decision": "WAIT", "regime": "RANGING"}, net=-10),
        tr("b", opened=T0 + 10 * HOUR, ctx={"decision": "NO TRADE"}, net=-10),
        tr("c", opened=T0 + 20 * HOUR, ctx={"decision": "POSSIBLE LONG", "structure": "bearish"}, net=-5),
        tr("d", opened=T0 + 30 * HOUR, ctx={"decision": "POSSIBLE LONG", "regime": "TRENDING_UP"}, net=20),
        tr("e", opened=T0 + 40 * HOUR, side="short", ctx={"decision": "POSSIBLE SHORT"}, net=15),
    ]
    check = pt.detect_entered_early(pt.build_positions(rows))
    assert check["status"] == "found"
    f = check["finding"]
    assert f["key"] == "entered_early" and f["severity"] == "high"  # 3 of 5 = 60% ≥ EARLY_HIGH_RATIO
    assert f["data"]["paper"] == 3 and f["data"]["known"] == 5
    assert f["data"]["reasons"] == {"unconfirmed": 2, "against_structure": 1}
    assert "3 от 5" in f["evidence"]
    assert f["lesson"]["slug"] == "market-structure" and f["lesson"]["href"].startswith("/learn/")
    assert set(f["position_ids"]) == {"a", "b", "c"}
    # early −8.33R avg vs confirmed +1.75R avg (both groups ≥ 2 positions) → the impact compares them
    assert "−" in f["impact"] or "-" in f["impact"]
    assert "+1.75R" in f["impact"]


def test_entered_early_thresholds_and_other_sources():
    few = pt.build_positions([tr("a", opened=T0, ctx={"decision": "WAIT"})])
    assert pt.detect_entered_early(few)["status"] == "insufficient_data"
    ok_rows = [tr(f"x{i}", opened=T0 + i * 10 * HOUR, ctx={"decision": "POSSIBLE LONG"}) for i in range(6)]
    ok_rows.append(tr("late", opened=T0 + 99 * HOUR, ctx={"decision": "WAIT"}))
    assert pt.detect_entered_early(pt.build_positions(ok_rows))["status"] == "ok"  # 1 of 7 is under the threshold
    replay = pt.detect_entered_early([], replay_flags={"entered_too_early": 2, "ignored_structure": 1, "chased": 9})
    assert replay["status"] == "found" and replay["finding"]["data"]["replay_flags"] == 3
    assert "Replay" in replay["finding"]["evidence"]
    journal = pt.detect_entered_early([], journal_mistakes=["Entered before confirmation", "fomo", "traded against the trend"])
    assert journal["status"] == "found" and journal["finding"]["data"]["journal_entries"] == 2


def test_moving_stops_counts_widened_positions_after_losses():
    rows = [
        tr("loss", opened=T0, hold=HOUR, net=-10),
        tr("w1", opened=T0 + 2 * HOUR, net=-25, widened=True),  # opened right after a losing position
        tr("win", opened=T0 + 10 * HOUR, net=10),
        tr("w2", opened=T0 + 20 * HOUR, net=5, widened=True),  # opened after a winner
        tr("ok", opened=T0 + 40 * HOUR, net=10),
    ]
    check = pt.detect_moving_stops(pt.build_positions(rows))
    f = check["finding"]
    assert check["status"] == "found" and f["severity"] == "high"
    assert f["data"] == {"widened": 2, "with_stop": 5, "losers": 1, "after_loss": 1}
    assert "2 от 5" in f["evidence"] and "-2.50R" in f["impact"]
    assert set(f["position_ids"]) == {"w1", "w2"}
    clean = pt.detect_moving_stops(pt.build_positions([rows[0], rows[2], rows[4]]))
    assert clean["status"] == "ok" and clean["finding"] is None
    assert pt.detect_moving_stops(pt.build_positions([tr("n", opened=T0, stop=None)]))["status"] == "insufficient_data"


def test_timeframe_performance_needs_five_trades_each():
    good = series(5, tf="1h", net=10.0, prefix="h")
    bad = series(5, start=T0 + 100 * HOUR, tf="1m", net=-10.0, prefix="m")
    check = pt.detect_timeframe(pt.build_positions(good + bad))
    assert check["status"] == "found"
    f = check["finding"]
    assert f["title"] == "По-добре се представяш на 1H, отколкото на 1m"
    assert f["data"]["best"]["timeframe"] == "1h" and f["data"]["worst"]["timeframe"] == "1m"
    assert f["data"]["diff_r"] == pytest.approx(2.0)
    assert f["severity"] == "warn"  # the worse timeframe loses on average
    assert "< 30" in f["impact"]  # small-sample caveat
    four = pt.detect_timeframe(pt.build_positions(good + bad[:4]))
    assert four["status"] == "insufficient_data" and "1m × 4" in four["detail"]
    same = series(5, start=T0 + 200 * HOUR, tf="1m", net=10.0, prefix="q")
    assert pt.detect_timeframe(pt.build_positions(good + same))["status"] == "ok"


def test_volatility_largest_losses_in_high_atr_tercile():
    rows = []
    for i, atr in enumerate([0.1, 0.2, 0.3]):
        rows.append(tr(f"lo{i}", opened=T0 + i * 10 * HOUR, atr_pct=atr, net=-5.0))
    for i, atr in enumerate([0.4, 0.5, 0.6]):
        rows.append(tr(f"mid{i}", opened=T0 + (10 + i) * 10 * HOUR, atr_pct=atr, net=8.0))
    for i, atr in enumerate([0.7, 0.8, 0.9]):
        rows.append(tr(f"hi{i}", opened=T0 + (20 + i) * 10 * HOUR, atr_pct=atr, net=-20.0))
    check = pt.detect_volatility(pt.build_positions(rows))
    assert check["status"] == "found"
    d = check["finding"]["data"]
    assert d["basis"] == "r"
    assert d["high"]["avg_loss"] == pytest.approx(2.0) and d["low"]["avg_loss"] == pytest.approx(0.5)
    assert d["top3_in_high"] == 3
    assert "3 от 3-те" in check["finding"]["evidence"]
    # ATR% derived from entry_context.atr when meta.atr_pct is missing
    (p,) = pt.build_positions([tr("x", opened=T0, ctx={"atr": 2.0}, entry=100.0)])
    assert p["atr_pct"] == pytest.approx(2.0)
    assert pt.detect_volatility(pt.build_positions(rows[:8]))["status"] == "insufficient_data"


def test_overtrading_after_losses():
    rows = [
        tr("a1", opened=T0, hold=1000, net=-10),
        tr("a2", opened=T0 + 1300, hold=700, net=-10),  # 5 min after a1 closed
        tr("a3", opened=T0 + 2300, hold=700, net=-10),
        tr("a4", opened=T0 + 3300, hold=700, net=10),
        tr("a5", opened=T0 + 4000 + 4 * HOUR, hold=700, net=10),
        tr("a6", opened=T0 + 4700 + 8 * HOUR, hold=700, net=10),
    ]
    check = pt.detect_overtrading_after_losses(pt.build_positions(rows))
    assert check["status"] == "found"
    f = check["finding"]
    assert f["severity"] == "high"
    assert f["data"]["quick_after_loss"] == 3 and f["data"]["losses_followed"] == 3
    assert f["data"]["rate_after_win_pct"] == 0.0
    assert set(f["position_ids"]) == {"a2", "a3", "a4"}
    calm = [tr(f"c{i}", opened=T0 + i * 6 * HOUR, net=-10 if i % 2 else 10) for i in range(8)]
    assert pt.detect_overtrading_after_losses(pt.build_positions(calm))["status"] == "ok"


def test_holding_losers_longer_than_winners():
    rows = [tr(f"w{i}", opened=T0 + i * 10 * HOUR, hold=600, net=10) for i in range(3)]
    rows += [tr(f"l{i}", opened=T0 + (5 + i) * 10 * HOUR, hold=2 * HOUR, net=-10) for i in range(3)]
    check = pt.detect_holding_losers(pt.build_positions(rows))
    assert check["status"] == "found"
    d = check["finding"]["data"]
    assert d["median_loser_seconds"] == 2 * HOUR and d["median_winner_seconds"] == 600 and d["ratio"] == 12.0
    assert "2ч" in check["finding"]["evidence"] and "10 мин" in check["finding"]["evidence"]
    assert pt.detect_holding_losers(pt.build_positions(rows[:5]))["status"] == "insufficient_data"


def test_no_stop_and_oversized_risk():
    rows = [
        tr("n1", opened=T0, stop=None, risk=None, net=-40),
        tr("s1", opened=T0 + 10 * HOUR, risk_pct=2.5, net=-30),
        tr("s2", opened=T0 + 20 * HOUR, risk_pct=0.5, net=-10),
    ]
    positions = pt.build_positions(rows)
    ns = pt.detect_no_stop(positions)
    assert ns["status"] == "found" and ns["finding"]["severity"] == "high"
    assert "1 от 3" in ns["finding"]["evidence"] and ns["finding"]["data"]["worst_pnl"] == -40.0
    ov = pt.detect_oversized(positions, RiskRules(max_risk_per_trade_pct=1.0))
    f = ov["finding"]
    assert ov["status"] == "found" and f["severity"] == "warn"  # 2.5% ≤ warn_risk_pct (5%)
    assert f["data"]["over"] == 1 and f["data"]["known"] == 3
    assert f["data"]["loss_share_pct"] == pytest.approx(37.5)  # 30 of 80 USD lost
    high = pt.detect_oversized(pt.build_positions([tr("x", opened=T0, risk_pct=6.0)]), RiskRules())
    assert high["finding"]["severity"] == "high"
    assert pt.detect_oversized(positions, RiskRules(max_risk_per_trade_pct=3.0))["status"] == "ok"


def test_detect_patterns_on_clean_history_has_no_findings():
    rows = [tr(f"c{i}", opened=T0 + i * 6 * HOUR, net=10.0 if i % 3 else -10.0, hold=HOUR) for i in range(12)]
    res = pt.detect_patterns(rows, RiskRules())
    assert res["findings"] == []
    checks = by_key(res)
    assert set(checks) == set(pt.CHECKS)
    assert checks["no_stop"]["status"] == "ok" and checks["moving_stops"]["status"] == "ok"
    assert checks["volatility"]["status"] == "insufficient_data"
    assert res["sample"] == {"positions": 12, "with_r": 12, "note": pt.sample_note(12)}
    assert pt.detect_patterns([], None)["sample"]["positions"] == 0


def test_findings_are_sorted_by_severity_then_count():
    rows = [tr(f"w{i}", opened=T0 + i * 6 * HOUR, widened=True) for i in range(2)]
    rows += [tr("n", opened=T0 + 50 * HOUR, stop=None, risk=None)]
    keys = [f["key"] for f in pt.detect_patterns(rows)["findings"]]
    assert keys[:2] == ["moving_stops", "no_stop"]  # both high; moving_stops has the larger count


# ------------------------------------------------------------------------------------------- weekly review
def _review(trades, **kw):
    return weekly_review(
        progress={"risk": {"completed": 1, "total": 5, "quiz_score": None}},
        week_trades=trades,
        all_trades=trades,
        behavior=analyze_behavior(trades, RiskRules()),
        journal_count=0,
        journal_emotions={},
        backtests=[],
        period={"from": 0, "to": 1},
        **kw,
    )


def test_weekly_review_v2_keeps_the_v1_shape_and_adds_findings():
    trades = [tr(f"w{i}", opened=T0 + i * 6 * HOUR, widened=True, net=-15.0) for i in range(3)]
    r = _review(trades)
    for k in ("title", "period", "summary", "strengths", "weaknesses", "week_stats", "overall_stats",
              "biggest_mistake", "next_lessons", "discipline_score", "provider", "text", "safety_removed"):
        assert k in r
    assert r["title"] == "WEEKLY REVIEW" and r["version"] == 2 and r["provider"] == "offline"
    f = r["findings"][0]
    assert {"key", "title", "evidence", "impact", "severity", "count", "sample", "lesson"} <= set(f)
    assert f["key"] == "moving_stops"
    nl = r["next_lesson"]
    assert nl["slug"] == "stop-loss-placement" and nl["href"] == "/learn/stop-loss-placement"
    assert nl["title"] and "3 от 3" in nl["why"] and nl["completed"] is False
    ex = r["practice_exercise"]
    assert ex["key"] == "moving_stops" and ex["href"] == "/replay?preset=trend"
    assert ex["title"] and ex["description"] and ex["success_criteria"]
    assert r["disclaimer"] and "не прогноза" in r["disclaimer"]
    assert any("Местиш стопа" in w for w in r["weaknesses"])


def test_weekly_review_practice_exercise_templates_are_filled():
    good = series(5, tf="4h", net=10.0, prefix="h")
    bad = series(5, start=T0 + 100 * HOUR, tf="1m", net=-10.0, prefix="m")
    r = _review(good + bad)
    assert r["findings"][0]["key"] == "timeframe_performance"
    ex = r["practice_exercise"]
    assert ex["href"] == "/replay?preset=trend&mode=predict&timeframe=4h"
    assert "4H" in ex["title"] and all("{" not in c for c in ex["success_criteria"])
    over = _review([tr("o", opened=T0, risk_pct=2.0, net=-20.0)], rules=RiskRules(max_risk_per_trade_pct=0.5))
    assert over["practice_exercise"]["key"] == "oversized_risk"
    assert "0.5%" in over["practice_exercise"]["title"]


def test_weekly_review_without_findings_uses_learning_and_completed_lessons():
    learning = {
        "next": {"type": "lesson", "slug": "high", "title": "High", "level": 1, "href": "/learn/high"},
        "weakest_skill": {"key": "structure", "title_bg": "Пазарна структура"},
    }
    r = _review([], learning=learning)
    assert r["findings"] == [] and r["next_lesson"]["slug"] == "high" and "LEVEL 1" in r["next_lesson"]["why"]
    assert r["practice_exercise"]["key"] == "skill:structure"
    assert r["practice_exercise"]["href"] == "/learn/market-structure?difficulty=easy"
    plain = _review([])
    assert plain["practice_exercise"]["key"] == "default"
    assert plain["next_lessons"] and plain["next_lesson"]["slug"] == plain["next_lessons"][0]["slug"]
    trades = [tr("n", opened=T0, stop=None, risk=None)]
    done = _review(trades, completed_lessons={"stop-order"})
    assert done["next_lesson"]["slug"] == "stop-order" and done["next_lesson"]["completed"] is True
    assert "вече е минат" in done["next_lesson"]["why"]


def test_coach_text_never_promises_results():
    trades = [tr(f"w{i}", opened=T0 + i * 6 * HOUR, widened=True) for i in range(3)]
    r = _review(trades)
    blob = " ".join([r["text"], *(f["evidence"] + f["impact"] for f in r["findings"])])
    clean, removed = sanitize(blob)
    assert removed == [] and clean
    for bad in ("guarantee", "гарантира печалба", "BUY NOW", "100% win", "risk-free"):
        assert bad.lower() not in blob.lower()


# ------------------------------------------------------------------------------------------- API
def _user(db, client) -> User:
    db.expire_all()
    return db.get(User, client.get("/api/auth/me").json()["id"])


def _seed_trades(db, user: User, rows: list[dict]) -> None:
    acc = paper_service.get_manual_account(db, user)
    for t in rows:
        db.add(PaperTrade(**{**t, "id": f"{user.id}x{t['id']}", "position_id": f"{user.id}x{t['position_id']}"},
                          account_id=acc.id))
    db.commit()


def test_coach_api_fresh_guest_keeps_next_lessons(guest):
    r = guest.get("/api/ai/coach").json()
    assert r["title"] == "WEEKLY REVIEW" and r["next_lessons"]
    assert r["findings"] == [] and r["sample"]["positions"] == 0
    assert r["practice_exercise"]["href"].startswith("/")
    assert r["next_lesson"] and r["next_lesson"]["href"].startswith("/learn/")


def test_coach_api_uses_trades_replay_flags_and_journal(guest, db):
    user = _user(db, guest)
    rows = [tr(f"w{i}", opened=T0 + i * 6 * HOUR, widened=True, net=-12.0) for i in range(2)]
    rows.append(tr("n1", opened=T0 + 30 * HOUR, stop=None, risk=None, net=-30.0))
    _seed_trades(db, user, rows)
    acc = paper_service.get_manual_account(db, user)
    s = ReplaySession(user_id=user.id, account_id=acc.id, symbol="BTC/USDT", timeframe="1h", start_ts=T0,
                      cursor_ts=T0, end_ts=T0 + 100 * HOUR, status="finished", score=55.0)
    db.add(s)
    db.commit()
    for i in range(2):
        db.add(ReplayDecision(session_id=s.id, user_id=user.id, bar_ts=T0 + i * HOUR, action="long",
                              outcome={"status": "stop", "meta": {"flags": [{"key": "entered_too_early"},
                                                                          {"key": "ignored_structure"}]}}))
    db.add(JournalEntry(user_id=user.id, mistakes=["entered before confirmation"]))
    db.commit()

    r = guest.get("/api/ai/coach").json()
    keys = [f["key"] for f in r["findings"]]
    assert {"moving_stops", "no_stop", "entered_early"} <= set(keys)
    early = next(f for f in r["findings"] if f["key"] == "entered_early")
    assert early["data"]["replay_flags"] == 4 and early["data"]["journal_entries"] == 1
    assert r["next_lesson"]["slug"] in {"stop-loss-placement", "stop-order"}
    assert r["practice_exercise"]["key"] == keys[0]
    assert r["sample"]["positions"] == 3
    checks = {c["key"]: c["status"] for c in r["checks"]}
    assert checks["timeframe_performance"] == "insufficient_data"
