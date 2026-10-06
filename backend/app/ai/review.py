"""TRADE REVIEW — direct, process-focused feedback after every paper trade."""

from __future__ import annotations

import json
import logging

from app.ai.prompts import REVIEW_SYSTEM
from app.ai.providers import LLMError, LLMProvider
from app.ai.safety import sanitize
from app.risk.engine import RiskRules

log = logging.getLogger(__name__)


EXIT_LABELS = {
    "stop_loss": "stop loss",
    "take_profit": "take profit",
    "manual": "ръчно затваряне",
    "partial": "частично затваряне",
    "liquidation": "ликвидация",
    "exit_signal": "изход по правило",
}


def _fmt(v: float | None, p: int) -> str:
    return "—" if v is None else f"{v:,.{p}f}"


def review_position(
    position: dict,
    trades: list[dict],
    *,
    rules: RiskRules,
    precision: int = 2,
    previous_trades: list[dict] | None = None,
) -> dict:
    """`position`: symbol, side, entry_price, initial_stop, take_profit, initial_qty, opened_ts, closed_ts,
    sl_history, mfe, mae, meta. `trades`: closed slices of this position."""
    p = precision
    side = position["side"]
    entry = position["entry_price"]
    stop = position.get("initial_stop")
    tp = position.get("take_profit")
    qty = position.get("initial_qty") or sum(t["qty"] for t in trades)
    meta = position.get("meta") or {}
    ctx = meta.get("entry_context") or {}
    net = sum(t["net_pnl"] for t in trades)
    gross = sum(t["gross_pnl"] for t in trades)
    fees = sum(t["fees"] for t in trades)
    closed_qty = sum(t["qty"] for t in trades) or qty
    avg_exit = sum(t["exit_price"] * t["qty"] for t in trades) / closed_qty if trades else None
    final_reason = trades[-1]["exit_reason"] if trades else "open"
    risk_unit = abs(entry - stop) if stop is not None else None
    r = net / (risk_unit * qty) if risk_unit else None
    mfe_r = position.get("mfe", 0) / risk_unit if risk_unit else None
    mae_r = position.get("mae", 0) / risk_unit if risk_unit else None
    risk_pct = meta.get("risk_pct")
    planned_rr = abs(tp - entry) / risk_unit if (tp is not None and risk_unit) else None
    duration_min = (
        ((position.get("closed_ts") or trades[-1]["closed_ts"]) - position["opened_ts"]) / 60 if trades else 0
    )

    well: list[str] = []
    poorly: list[tuple[int, str, str | None]] = []  # (priority, text, lesson)

    if stop is None:
        poorly.append(
            (
                1,
                "You entered without a defined invalidation point. — Без stop loss загубата нямаше граница.",
                "stop-order",
            )
        )
    else:
        well.append(f"You defined your invalidation before entering (stop {_fmt(stop, p)}).")

    if risk_pct is not None:
        if risk_pct > rules.warn_risk_pct:
            poorly.append(
                (
                    2,
                    f"This trade risked an unusually large portion of your account ({risk_pct:.1f}%). "
                    "— Пет такива загуби подред биха били катастрофа.",
                    "risk-per-trade",
                )
            )
        elif risk_pct > rules.max_risk_per_trade_pct:
            poorly.append(
                (
                    3,
                    f"Your position size was too large for the stop distance ({risk_pct:.2f}% risk vs "
                    f"{rules.max_risk_per_trade_pct:g}% rule).",
                    "position-sizing",
                )
            )
        else:
            well.append(f"Risk was {risk_pct:.2f}% — within your {rules.max_risk_per_trade_pct:g}% rule.")

    if planned_rr is not None:
        if planned_rr >= 2:
            well.append(f"Planned reward:risk was {planned_rr:.2f} — асиметрията е на твоя страна.")
        elif planned_rr < 1:
            poorly.append(
                (7, f"Planned reward:risk was only {planned_rr:.2f}. — Нужен е много висок win rate.", "reward-risk")
            )
    elif tp is None:
        poorly.append(
            (8, "No take profit — the exit plan was undefined. — Реши предварително къде излизаш.", "reward-risk")
        )

    widened = any(h.get("widened") for h in position.get("sl_history") or [])
    if widened:
        poorly.append(
            (
                3,
                "You moved your stop further away after entry — this increased your risk mid-trade.",
                "stop-loss-placement",
            )
        )
    elif len(position.get("sl_history") or []) > 1:
        well.append("You managed the trade by tightening/trailing the stop, not widening it.")

    if final_reason == "liquidation":
        poorly.append(
            (1, "The position was liquidated — leverage and size were too large for the move.", "liquidation")
        )
    elif final_reason == "stop_loss" and r is not None:
        if r >= -1.3:
            well.append(f"You respected your stop — the loss stayed close to the planned 1R ({r:+.2f}R).")
        else:
            poorly.append(
                (
                    6,
                    f"The loss was {r:+.2f}R — larger than planned because of gap/slippage/fees. "
                    "— Помисли за буфер и по-малък размер при волатилни пазари.",
                    "fees",
                )
            )
    elif final_reason == "take_profit":
        well.append("You followed your plan to the target.")
    elif final_reason in ("manual", "partial"):
        if r is not None and net > 0 and r < 0.5 and mfe_r is not None and mfe_r >= 1.5:
            poorly.append(
                (
                    6,
                    f"You exited early: price moved {mfe_r:.1f}R in your favour, but you took only {r:.2f}R.",
                    "loss-aversion",
                )
            )
        if r is not None and r < -1.2:
            poorly.append((4, f"You held the loser beyond your planned risk ({r:+.2f}R).", "loss-aversion"))

    decision = ctx.get("decision")
    if decision == "NO TRADE":
        reasons = ", ".join(ctx.get("no_trade_reasons") or []) or "условията не бяха изпълнени"
        poorly.append((5, f"You entered while the analysis said NO TRADE ({reasons}).", "overtrading"))
    elif decision in ("POSSIBLE LONG", "POSSIBLE SHORT"):
        aligned = (decision == "POSSIBLE LONG") == (side == "long")
        if aligned:
            well.append(f"Your entry was aligned with the analysed setup ({decision}).")
        else:
            poorly.append((5, f"You traded against the analysed setup ({decision}).", "trend"))
    regime = ctx.get("regime")
    if (regime == "TRENDING_DOWN" and side == "long") or (regime == "TRENDING_UP" and side == "short"):
        poorly.append(
            (
                6,
                f"You traded against the market regime ({regime}). — Търговията срещу тренда изисква по-силна причина.",
                "trend",
            )
        )
    if ctx.get("chasing"):
        poorly.append(
            (
                5,
                f"You chased the entry — price was {ctx.get('ema20_distance_atr', 0):.1f} ATR away from EMA 20.",
                "fomo",
            )
        )

    if previous_trades:
        losers = [
            t for t in previous_trades if t["net_pnl"] < 0 and 0 <= position["opened_ts"] - t["closed_ts"] <= 15 * 60
        ]
        if losers:
            prev = losers[-1]
            prev_risk = (prev.get("meta") or {}).get("risk_pct") or 0
            if (risk_pct or 0) > prev_risk * 1.3:
                poorly.append(
                    (2, "This looks like revenge trading: a bigger position right after a loss.", "revenge-trading")
                )

    if gross and fees > abs(gross):
        poorly.append(
            (
                9,
                "Fees and spread were larger than the price move itself. — Сделката беше твърде кратка/малка "
                "спрямо разходите.",
                "fees",
            )
        )
    elif gross and fees > 0.3 * abs(gross):
        poorly.append(
            (
                9,
                f"Fees consumed {fees / abs(gross) * 100:.0f}% of the gross result. — При малки движения "
                "разходите тежат много.",
                "fees",
            )
        )

    poorly.sort(key=lambda x: x[0])
    if poorly:
        main = poorly[0][1]
    elif net < 0:
        main = (
            "Good process, bad outcome. A loss with defined risk is a normal cost of trading. — Не променяй "
            "правилата заради една загуба."
        )
    else:
        main = "Good process and a positive result — repeat the process, not the outcome."

    severe = sum(1 for pr, _, _ in poorly if pr <= 3)
    minor = len(poorly) - severe
    score = max(0, 100 - 25 * severe - 10 * minor)
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 55 else "D"

    path = []
    if mfe_r is not None:
        path.append(f"в полза стигна до +{mfe_r:.1f}R, срещу теб до −{mae_r:.1f}R")
    exit_label = EXIT_LABELS.get(final_reason, final_reason)
    what = (
        f"{side.upper()} {position['symbol']} от {_fmt(entry, p)}, изход ~{_fmt(avg_exit, p)} ({exit_label}) "
        f"след {duration_min:.0f} мин." + (f" По пътя цената {path[0]}." if path else "")
    )

    return {
        "title": "TRADE REVIEW",
        "position_id": position.get("id"),
        "symbol": position["symbol"],
        "side": side,
        "entry": f"{side.upper()} {qty:g} @ {_fmt(entry, p)} (stop {_fmt(stop, p)} · target {_fmt(tp, p)})",
        "exit": f"@ {_fmt(avg_exit, p)} — {final_reason}",
        "result": f"{net:+,.2f}" + (f" ({r:+.2f}R)" if r is not None else " (R: n/a — no stop)"),
        "net_pnl": net,
        "r_multiple": r,
        "risk_pct": risk_pct,
        "planned_rr": planned_rr,
        "what_happened": what,
        "did_well": well,
        "did_poorly": [t for _, t, _ in poorly],
        "main_lesson": main,
        "process_score": score,
        "grade": grade,
        "lessons": list(dict.fromkeys(lesson for _, _, lesson in poorly if lesson))[:3],
    }


def narrate(review: dict, llm: LLMProvider | None) -> dict:
    """Optional LLM narrative on top of the rule-based review."""
    if llm is None:
        return review
    try:
        text = llm.complete(
            REVIEW_SYSTEM,
            [{"role": "user", "content": json.dumps(review, ensure_ascii=False, default=str)}],
            max_tokens=1500,
        )
        clean, _ = sanitize(text)
        return {**review, "narrative": clean, "provider": llm.name}
    except LLMError as exc:
        log.warning("LLM review failed: %s", exc)
        return review
