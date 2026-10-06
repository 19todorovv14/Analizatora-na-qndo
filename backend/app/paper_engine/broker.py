"""PaperBroker — the simulated execution engine.

It is pure Python (no DB, no network) and is shared by manual paper trading, market
replay, bots and the backtester, so every part of the platform fills orders the same way.

Price model
-----------
Candles are MID prices. bid = mid − half_spread, ask = mid + half_spread.
Buys fill on the ask, sells on the bid.

Intrabar path
-------------
A bullish bar is assumed to travel O → L → H → C and a bearish one O → H → L → C.
Resting orders and stops trigger in the order the path reaches them. With
`intrabar_policy="worst_case"` a position whose stop-loss AND take-profit are both
inside the same bar is assumed to hit the stop first (conservative).
"""

from __future__ import annotations

import math
import random
from collections.abc import Mapping
from dataclasses import dataclass

from app.market.base import AssetSpec
from app.paper_engine.models import (
    BUY,
    EPS,
    LIMIT,
    LONG,
    MARKET,
    SELL,
    SHORT,
    STOP,
    AccountState,
    Bar,
    Event,
    ExecutionConfig,
    Order,
    Position,
    Trade,
    new_id,
)

_UNSET = object()


@dataclass
class Quote:
    mid: float
    bid: float
    ask: float
    half_spread: float


@dataclass
class _Trigger:
    dist: float
    at_start: bool
    kind: str  # order | sl | tp
    obj_id: str
    threshold: float


class PaperBroker:
    def __init__(
        self,
        state: AccountState,
        specs: Mapping[str, AssetSpec],
        config: ExecutionConfig | None = None,
        seed: int | str = 0,
    ):
        self.s = state
        self.specs = specs
        self.cfg = config or ExecutionConfig()
        self.seed = seed
        self.events: list[Event] = []
        self.new_trades: list[Trade] = []
        self.marks: dict[str, float] = {}
        self.last_bar: dict[str, Bar] = {}
        self.slippage_total = 0.0

    # ------------------------------------------------------------------ helpers
    def _rng(self) -> random.Random:
        self.s.rng_counter += 1
        return random.Random(f"{self.seed}:{self.s.rng_counter}")

    def _event(self, ts: int, type_: str, message: str, **data) -> None:
        self.events.append(Event(ts=ts, type=type_, message=message, data=data))

    def set_mark(self, symbol: str, mid: float) -> None:
        self.marks[symbol] = mid

    def half_spread(self, symbol: str, mid: float) -> float:
        if not self.cfg.spread_enabled:
            return 0.0
        return mid * self.specs[symbol].spread_bps * self.cfg.spread_multiplier / 2 / 1e4

    def quote(self, symbol: str, mid: float | None = None) -> Quote:
        mid = mid if mid is not None else self.marks.get(symbol)
        if mid is None:
            raise ValueError(f"No market price for {symbol}")
        hs = self.half_spread(symbol, mid)
        return Quote(mid=mid, bid=mid - hs, ask=mid + hs, half_spread=hs)

    def _fee_rate(self, symbol: str, liquidity: str) -> float:
        if not self.cfg.fees_enabled:
            return 0.0
        spec = self.specs[symbol]
        return spec.maker_fee if liquidity == "maker" else spec.taker_fee

    def _bar_range_frac(self, symbol: str) -> float:
        bar = self.last_bar.get(symbol)
        if bar and bar.close > 0:
            return max((bar.high - bar.low) / bar.close, 1e-6)
        # fallback: typical 1-minute range from the asset's daily volatility
        return self.specs[symbol].daily_vol / math.sqrt(1440) * 2.5

    def _slippage_bps(self, symbol: str, qty: float, rng: random.Random) -> float:
        if not self.cfg.slippage_enabled:
            return 0.0
        bps = self.cfg.base_slippage_bps
        bps += rng.random() * self.cfg.volatility_slippage * self._bar_range_frac(symbol) * 1e4
        bar = self.last_bar.get(symbol)
        if bar and bar.volume > 0:
            bps += self.cfg.impact_bps_per_pct_volume * (qty / bar.volume * 100)
        return bps

    def _capacity(self, symbol: str, remaining: float, bar: Bar | None, touch_only: bool = False) -> float:
        spec = self.specs[symbol]
        if not self.cfg.partial_fills_enabled or bar is None or bar.volume <= 0:
            return remaining
        cap = self.cfg.participation_rate * bar.volume
        if touch_only:
            cap *= self.cfg.touch_fill_ratio
        cap = spec.round_qty(cap)
        if remaining <= spec.min_qty + EPS:
            return remaining
        return min(remaining, max(cap, spec.min_qty))

    def leverage_for(self, symbol: str) -> float:
        return max(1.0, min(self.s.leverage, self.specs[symbol].max_leverage))

    # ------------------------------------------------------------ account maths
    def position_upnl(self, p: Position) -> float:
        mark = self.marks.get(p.symbol, p.entry_price)
        hs = self.half_spread(p.symbol, mark)
        exit_px = mark - hs if p.side == LONG else mark + hs
        return (exit_px - p.entry_price) * p.qty * p.sign

    def open_positions(self, symbol: str | None = None) -> list[Position]:
        return [p for p in self.s.positions.values() if p.is_open and (symbol is None or p.symbol == symbol)]

    def active_orders(self, symbol: str | None = None) -> list[Order]:
        return [
            o
            for o in self.s.orders.values()
            if o.is_active and not o.reduce_only and (symbol is None or o.symbol == symbol)
        ]

    def snapshot(self) -> dict:
        positions = self.open_positions()
        upnl = sum(self.position_upnl(p) for p in positions)
        equity = self.s.cash + upnl
        used = sum(p.qty * p.entry_price / p.leverage for p in positions)
        exposure = sum(p.qty * self.marks.get(p.symbol, p.entry_price) for p in positions)
        return {
            "balance": self.s.cash,
            "equity": equity,
            "unrealized_pnl": upnl,
            "realized_pnl": self.s.realized_pnl,
            "fees_paid": self.s.fees_paid,
            "used_margin": used,
            "free_margin": equity - used,
            "margin_level": (equity / used) if used > 0 else None,
            "exposure": exposure,
            "exposure_pct": (exposure / equity * 100) if equity > 0 else None,
            "open_positions": len(positions),
        }

    def liquidation_price(self, p: Position) -> float | None:
        """Approximate price at which this position alone would trigger a stop-out."""
        snap = self.snapshot()
        used = snap["used_margin"]
        if used <= 0 or p.qty <= 0:
            return None
        mark = self.marks.get(p.symbol, p.entry_price)
        # equity moves 1:1 with this position's P/L: solve equity + qty*dp*sign = level*used
        slack = snap["equity"] - self.cfg.stop_out_level * used
        dp = slack / p.qty
        price = mark - dp if p.side == LONG else mark + dp
        return price if price > 0 else None

    # ------------------------------------------------------------------ orders
    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        type: str = MARKET,  # noqa: A002
        qty: float,
        ts: int,
        price: float | None = None,
        stop_loss: float | None = None,
        take_profit: float | None = None,
        fill_mode: str = "immediate",
        active_from_ts: int | None = None,
        meta: dict | None = None,
        sl_offset: float | None = None,
        tp_offset: float | None = None,
    ) -> Order:
        spec = self.specs[symbol]
        order = Order(
            id=new_id(),
            symbol=symbol,
            side=side,
            type=type,
            qty=spec.round_qty(qty),
            price=price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            fill_mode=fill_mode,
            active_from_ts=active_from_ts if active_from_ts is not None else ts,
            created_ts=ts,
            updated_ts=ts,
            meta=dict(meta or {}),
        )
        if sl_offset is not None:
            order.meta["sl_offset"] = sl_offset
        if tp_offset is not None:
            order.meta["tp_offset"] = tp_offset
        self.s.orders[order.id] = order

        problem = self._validate(order)
        if problem:
            order.status = "rejected"
            order.reject_reason = problem
            self._event(ts, "order_rejected", f"Поръчката е отхвърлена: {problem}", order_id=order.id)
            return order

        if fill_mode == "next_bar":
            order.status = "pending" if type == MARKET else "open"
            self._event(
                ts,
                "order_accepted",
                f"{side.upper()} {type} {order.qty} {symbol} чака следващата свещ.",
                order_id=order.id,
            )
            return order

        q = self.quote(symbol)
        marketable = (
            type == MARKET
            or (type == LIMIT and ((side == BUY and price >= q.ask) or (side == SELL and price <= q.bid)))
            or (type == STOP and ((side == BUY and q.ask >= price) or (side == SELL and q.bid <= price)))
        )
        if marketable:
            self._fill_now(order, ts)
        else:
            order.status = "open"
            self._event(
                ts,
                "order_accepted",
                f"{type.capitalize()} поръчка {side.upper()} {order.qty} {symbol} @ {price} е активна.",
                order_id=order.id,
            )
        return order

    def _validate(self, o: Order) -> str | None:
        spec = self.specs[o.symbol]
        if o.side not in (BUY, SELL):
            return "Невалидна посока."
        if o.type not in (MARKET, LIMIT, STOP):
            return "Невалиден тип поръчка."
        if o.qty < spec.min_qty - EPS:
            return f"Минималното количество за {o.symbol} е {spec.min_qty}."
        if o.type in (LIMIT, STOP) and (o.price is None or o.price <= 0):
            return "Limit/Stop поръчка изисква цена."
        mark = self.marks.get(o.symbol)
        if mark is None:
            return "Няма пазарна цена за инструмента."
        q = self.quote(o.symbol)
        entry = o.price if o.type in (LIMIT, STOP) else (q.ask if o.side == BUY else q.bid)
        is_long = o.side == BUY
        if o.stop_loss is not None:
            if o.stop_loss <= 0:
                return "Stop loss трябва да е положителна цена."
            if is_long and o.stop_loss >= entry:
                return "При LONG stop loss трябва да е ПОД цената на влизане."
            if not is_long and o.stop_loss <= entry:
                return "При SHORT stop loss трябва да е НАД цената на влизане."
        if o.take_profit is not None:
            if is_long and o.take_profit <= entry:
                return "При LONG take profit трябва да е НАД цената на влизане."
            if not is_long and o.take_profit >= entry:
                return "При SHORT take profit трябва да е ПОД цената на влизане."
        lev = self.leverage_for(o.symbol)
        need = o.qty * entry / lev + o.qty * entry * self._fee_rate(o.symbol, "taker")
        free = self.snapshot()["free_margin"]
        if need > free + EPS:
            return (
                f"Недостатъчен свободен margin: нужни са ~{need:,.2f}, свободни {free:,.2f} "
                f"(leverage {lev:g}x). Намали размера на позицията."
            )
        return None

    def _fill_now(self, order: Order, ts: int) -> None:
        """Execute a marketable order against the current quote (live mode)."""
        rng = self._rng()
        q = self.quote(order.symbol)
        sign = 1 if order.side == BUY else -1
        base = q.ask if order.side == BUY else q.bid
        px = base
        if self.cfg.latency_enabled and self.cfg.latency_ms > 0:
            sigma_sec = self._bar_range_frac(order.symbol) / 2.5 / math.sqrt(60)
            px *= 1 + rng.gauss(0.0, sigma_sec * math.sqrt(self.cfg.latency_ms / 1000))
        fill_qty = self._capacity(order.symbol, order.remaining, self.last_bar.get(order.symbol))
        px *= 1 + sign * self._slippage_bps(order.symbol, fill_qty, rng) / 1e4
        if order.type == LIMIT and order.price is not None:  # never worse than the limit
            px = min(px, order.price) if order.side == BUY else max(px, order.price)
        self._apply_fill(order, fill_qty, self.specs[order.symbol].round_price(px), ts, "taker", base)
        if order.status == "partially_filled":
            order.type = MARKET  # remainder keeps executing as market on next bars
            order.meta["remainder"] = True

    def cancel_order(self, order_id: str, ts: int) -> Order:
        o = self.s.orders[order_id]
        if o.is_active:
            o.status = "cancelled"
            o.updated_ts = ts
            self._event(ts, "order_cancelled", f"Поръчка {o.side.upper()} {o.symbol} е отменена.", order_id=o.id)
        return o

    # ------------------------------------------------------------ fills & exits
    def _apply_fill(self, order: Order, qty: float, price: float, ts: int, liquidity: str, reference: float) -> None:
        if qty <= EPS:
            return
        fee = qty * price * self._fee_rate(order.symbol, liquidity)
        self.s.cash -= fee
        self.s.fees_paid += fee
        order.fees += fee
        order.slippage_cost += abs(price - reference) * qty
        self.slippage_total += abs(price - reference) * qty
        prev = order.filled_qty
        order.avg_fill_price = price if not prev else (order.avg_fill_price * prev + price * qty) / (prev + qty)
        order.filled_qty = prev + qty
        order.status = "filled" if order.remaining <= EPS else "partially_filled"
        order.updated_ts = ts

        if order.reduce_only:
            pos = self.s.positions[order.position_id]
            self._reduce(pos, qty, price, ts, order.meta.get("reason", "manual"), fee)
            return

        pos = self.s.positions.get(order.position_id) if order.position_id else None
        if pos is not None and pos.is_open:
            total = pos.qty + qty
            pos.entry_price = (pos.entry_price * pos.qty + price * qty) / total
            pos.qty = total
            pos.initial_qty += qty
            pos.fees += fee
        else:
            sign = 1 if order.side == BUY else -1
            sl, tp = order.stop_loss, order.take_profit
            if sl is None and order.meta.get("sl_offset"):
                sl = self.specs[order.symbol].round_price(price - sign * order.meta["sl_offset"])
            if tp is None and order.meta.get("tp_offset"):
                tp = self.specs[order.symbol].round_price(price + sign * order.meta["tp_offset"])
            pos = Position(
                id=new_id(),
                symbol=order.symbol,
                side=LONG if order.side == BUY else SHORT,
                qty=qty,
                entry_price=price,
                stop_loss=sl,
                take_profit=tp,
                initial_stop=sl,
                initial_qty=qty,
                leverage=self.leverage_for(order.symbol),
                fees=fee,
                opened_ts=ts,
                active_from_ts=order.meta.get("position_active_from", ts),
                sl_history=[{"ts": ts, "sl": sl, "source": "entry"}] if sl is not None else [],
                meta={k: v for k, v in order.meta.items() if k not in ("sl_offset", "tp_offset", "remainder")},
            )
            self.s.positions[pos.id] = pos
            order.position_id = pos.id
        kind = "order_filled" if order.status == "filled" else "partial_fill"
        self._event(
            ts,
            kind,
            f"{'Изпълнена' if kind == 'order_filled' else 'Частично изпълнена'}: {order.side.upper()} "
            f"{qty:g} {order.symbol} @ {price:,.{self.specs[order.symbol].price_precision}f} (такса {fee:,.2f})",
            order_id=order.id,
            position_id=order.position_id,
            qty=qty,
            price=price,
            fee=fee,
        )

    def _exit(
        self,
        pos: Position,
        qty: float,
        price: float,
        ts: int,
        reason: str,
        liquidity: str,
        reference: float,
        order_type: str = MARKET,
        level: float | None = None,
    ) -> Order:
        order = Order(
            id=new_id(),
            symbol=pos.symbol,
            side=SELL if pos.side == LONG else BUY,
            type=order_type,
            qty=qty,
            price=level,
            status="pending",
            reduce_only=True,
            position_id=pos.id,
            active_from_ts=ts,
            created_ts=ts,
            updated_ts=ts,
            meta={"reason": reason},
        )
        self.s.orders[order.id] = order
        self._apply_fill(order, qty, price, ts, liquidity, reference)
        return order

    def _reduce(self, pos: Position, qty: float, price: float, ts: int, reason: str, exit_fee: float) -> None:
        qty = min(qty, pos.qty)
        gross = (price - pos.entry_price) * qty * pos.sign
        alloc = pos.fees * (qty / pos.qty) if pos.qty > 0 else 0.0
        pos.fees -= alloc
        fees = alloc + exit_fee
        net = gross - fees
        self.s.cash += gross
        self.s.realized_pnl += net
        pos.realized_pnl += net
        pos.qty = max(pos.qty - qty, 0.0)
        risk = abs(pos.entry_price - pos.initial_stop) * qty if pos.initial_stop is not None else None
        closed = pos.qty <= EPS
        exit_reason = reason if (closed or reason != "manual") else "partial"
        trade = Trade(
            id=new_id(),
            position_id=pos.id,
            symbol=pos.symbol,
            side=pos.side,
            qty=qty,
            entry_price=pos.entry_price,
            exit_price=price,
            stop_price=pos.initial_stop,
            target_price=pos.take_profit,
            gross_pnl=gross,
            fees=fees,
            net_pnl=net,
            risk_amount=risk,
            r_multiple=(net / risk) if risk else None,
            exit_reason=exit_reason,
            opened_ts=pos.opened_ts,
            closed_ts=ts,
            meta={
                **pos.meta,
                "mfe": pos.mfe,
                "mae": pos.mae,
                "sl_moves": max(len(pos.sl_history) - 1, 0),
                "stop_widened": any(h.get("widened") for h in pos.sl_history),
            },
        )
        self.new_trades.append(trade)
        if closed:
            pos.status = "closed"
            pos.closed_ts = ts
        labels = {
            "stop_loss": "Stop loss задейства",
            "take_profit": "Take profit е достигнат",
            "liquidation": "ЛИКВИДАЦИЯ (stop-out)",
            "manual": "Позицията е затворена",
            "partial": "Частично затваряне",
            "exit_signal": "Изход по правило на стратегията",
            "end_of_test": "Затваряне в края на теста",
        }
        event_type = {"partial": "partial_close", "manual": "position_closed"}.get(exit_reason, exit_reason)
        self._event(
            ts,
            event_type,
            f"{labels.get(exit_reason, exit_reason)}: {pos.symbol} {pos.side.upper()} {qty:g} @ {price:,.6g} "
            f"→ нетен P/L {net:+,.2f}",
            position_id=pos.id,
            trade_id=trade.id,
            net_pnl=net,
        )

    def close_position(
        self,
        position_id: str,
        *,
        ts: int,
        qty: float | None = None,
        reason: str = "manual",
        fill_mode: str = "immediate",
    ) -> Order | None:
        pos = self.s.positions.get(position_id)
        if pos is None or not pos.is_open:
            return None
        spec = self.specs[pos.symbol]
        qty = pos.qty if qty is None else min(spec.round_qty(qty), pos.qty)
        if qty <= EPS:
            return None
        if pos.qty - qty < spec.min_qty - EPS:  # avoid dust positions
            qty = pos.qty
        if fill_mode == "next_bar":
            order = Order(
                id=new_id(),
                symbol=pos.symbol,
                side=SELL if pos.side == LONG else BUY,
                type=MARKET,
                qty=qty,
                status="pending",
                reduce_only=True,
                position_id=pos.id,
                fill_mode="next_bar",
                active_from_ts=ts,
                created_ts=ts,
                updated_ts=ts,
                meta={"reason": reason},
            )
            self.s.orders[order.id] = order
            return order
        rng = self._rng()
        q = self.quote(pos.symbol)
        base = q.bid if pos.side == LONG else q.ask
        px = base
        if self.cfg.latency_enabled and self.cfg.latency_ms > 0:
            sigma_sec = self._bar_range_frac(pos.symbol) / 2.5 / math.sqrt(60)
            px *= 1 + rng.gauss(0.0, sigma_sec * math.sqrt(self.cfg.latency_ms / 1000))
        px *= 1 - pos.sign * self._slippage_bps(pos.symbol, qty, rng) / 1e4
        return self._exit(pos, qty, spec.round_price(px), ts, reason, "taker", base)

    def modify_position(self, position_id: str, *, ts: int, stop_loss=_UNSET, take_profit=_UNSET) -> str | None:
        """Change SL/TP. Returns an error message or None."""
        pos = self.s.positions.get(position_id)
        if pos is None or not pos.is_open:
            return "Позицията не е отворена."
        q = self.quote(pos.symbol)
        exit_px = q.bid if pos.side == LONG else q.ask
        if stop_loss is not _UNSET and stop_loss is not None:
            if pos.side == LONG and stop_loss >= exit_px:
                return "Stop loss на LONG трябва да е под текущата bid цена."
            if pos.side == SHORT and stop_loss <= exit_px:
                return "Stop loss на SHORT трябва да е над текущата ask цена."
        if take_profit is not _UNSET and take_profit is not None:
            if pos.side == LONG and take_profit <= exit_px:
                return "Take profit на LONG трябва да е над текущата цена."
            if pos.side == SHORT and take_profit >= exit_px:
                return "Take profit на SHORT трябва да е под текущата цена."
        if stop_loss is not _UNSET and stop_loss != pos.stop_loss:
            prev = pos.stop_loss
            widened = (
                prev is not None
                and stop_loss is not None
                and ((pos.side == LONG and stop_loss < prev) or (pos.side == SHORT and stop_loss > prev))
            )
            removed = prev is not None and stop_loss is None
            pos.stop_loss = stop_loss
            if pos.initial_stop is None and stop_loss is not None:
                pos.initial_stop = stop_loss
            pos.sl_history.append({"ts": ts, "sl": stop_loss, "prev": prev, "widened": widened or removed})
            self._event(
                ts,
                "stop_moved",
                f"Stop loss {pos.symbol}: {prev} → {stop_loss}"
                + (" (рискът се УВЕЛИЧИ)" if widened or removed else ""),
                position_id=pos.id,
                widened=widened or removed,
            )
        if take_profit is not _UNSET and take_profit != pos.take_profit:
            prev_tp = pos.take_profit
            pos.take_profit = take_profit
            self._event(ts, "target_moved", f"Take profit {pos.symbol}: {prev_tp} → {take_profit}", position_id=pos.id)
        return None

    # -------------------------------------------------------------- bar engine
    def process_bar(self, symbol: str, bar: Bar) -> None:
        """Advance the simulation through one closed bar of `symbol`."""
        self.last_bar[symbol] = bar
        spec = self.specs[symbol]
        hs = self.half_spread(symbol, bar.open)

        # 1) market orders waiting for this bar: next-bar entries, partial-fill remainders, triggered stops
        for o in list(self.s.orders.values()):
            if o.symbol != symbol or not o.is_active or o.active_from_ts > bar.ts:
                continue
            if not (o.type == MARKET or o.meta.get("triggered")):
                continue
            rng = self._rng()
            sign = 1 if o.side == BUY else -1
            base = bar.open + sign * hs
            if o.reduce_only:
                pos = self.s.positions.get(o.position_id)
                if pos is None or not pos.is_open:
                    o.status = "cancelled"
                    continue
                qty = min(o.remaining, pos.qty)
                px = base * (1 + sign * self._slippage_bps(symbol, qty, rng) / 1e4)
                o.status = "filled"
                o.filled_qty = o.qty
                o.avg_fill_price = spec.round_price(px)
                fee = qty * px * self._fee_rate(symbol, "taker")
                self.s.cash -= fee
                self.s.fees_paid += fee
                o.fees += fee
                self.slippage_total += abs(px - base) * qty
                self._reduce(pos, qty, spec.round_price(px), bar.ts, o.meta.get("reason", "manual"), fee)
                continue
            qty = self._capacity(symbol, o.remaining, bar)
            px = base * (1 + sign * self._slippage_bps(symbol, qty, rng) / 1e4)
            if not self._margin_ok(o.symbol, qty, px):
                o.status = "rejected"
                o.reject_reason = "Недостатъчен margin в момента на изпълнение."
                self._event(bar.ts, "order_rejected", o.reject_reason, order_id=o.id)
                continue
            o.meta.setdefault("position_active_from", bar.ts)
            self._apply_fill(o, qty, spec.round_price(px), bar.ts, "taker", base)

        # 2) walk the intrabar path
        path = (
            [bar.open, bar.low, bar.high, bar.close]
            if bar.close >= bar.open
            else [bar.open, bar.high, bar.low, bar.close]
        )
        for i in range(3):
            a, b = path[i], path[i + 1]
            seg_ts = bar.ts + int(bar.duration * (i + 1) / 4)
            for trig in self._triggers(symbol, bar, a, b, hs):
                self._execute_trigger(trig, symbol, bar, a, hs, seg_ts)

        # 3) excursions
        for p in self.open_positions(symbol):
            if p.active_from_ts > bar.ts:
                continue
            if p.side == LONG:
                p.mfe = max(p.mfe, bar.high - p.entry_price)
                p.mae = max(p.mae, p.entry_price - bar.low)
            else:
                p.mfe = max(p.mfe, p.entry_price - bar.low)
                p.mae = max(p.mae, bar.high - p.entry_price)

        self.marks[symbol] = bar.close
        self.check_liquidation(bar.ts + bar.duration)

    def _margin_ok(self, symbol: str, qty: float, price: float) -> bool:
        need = qty * price / self.leverage_for(symbol)
        return need <= self.snapshot()["free_margin"] + EPS

    @staticmethod
    def _cross(threshold: float, direction: str, a: float, b: float) -> tuple[float, bool] | None:
        """Does the move a→b reach `threshold`? direction 'down': price <= t, 'up': price >= t."""
        if direction == "down":
            if a <= threshold:
                return 0.0, True
            if b <= threshold:
                return a - threshold, False
        else:
            if a >= threshold:
                return 0.0, True
            if b >= threshold:
                return threshold - a, False
        return None

    def _triggers(self, symbol: str, bar: Bar, a: float, b: float, hs: float) -> list[_Trigger]:
        out: list[_Trigger] = []
        for o in self.active_orders(symbol):
            if o.type not in (LIMIT, STOP) or o.meta.get("triggered") or o.active_from_ts > bar.ts:
                continue
            if o.type == LIMIT:
                direction, thr = ("down", o.price - hs) if o.side == BUY else ("up", o.price + hs)
            else:
                direction, thr = ("up", o.price - hs) if o.side == BUY else ("down", o.price + hs)
            hit = self._cross(thr, direction, a, b)
            if hit:
                out.append(_Trigger(hit[0], hit[1], "order", o.id, thr))
        for p in self.open_positions(symbol):
            if p.active_from_ts > bar.ts:
                continue
            sl_thr = None
            if p.stop_loss is not None:
                direction, sl_thr = ("down", p.stop_loss + hs) if p.side == LONG else ("up", p.stop_loss - hs)
                hit = self._cross(sl_thr, direction, a, b)
                if hit:
                    out.append(_Trigger(hit[0], hit[1], "sl", p.id, sl_thr))
            if p.take_profit is not None:
                if self.cfg.intrabar_policy == "worst_case" and sl_thr is not None and bar.low <= sl_thr <= bar.high:
                    continue  # both inside this bar → assume the stop was hit first
                direction, thr = ("up", p.take_profit + hs) if p.side == LONG else ("down", p.take_profit - hs)
                hit = self._cross(thr, direction, a, b)
                if hit:
                    out.append(_Trigger(hit[0], hit[1], "tp", p.id, thr))
        out.sort(key=lambda t: (t.dist, 0 if t.kind == "sl" else 1))
        return out

    def _execute_trigger(self, t: _Trigger, symbol: str, bar: Bar, a: float, hs: float, ts: int) -> None:
        spec = self.specs[symbol]
        rng = self._rng()
        if t.kind == "order":
            o = self.s.orders.get(t.obj_id)
            if o is None or not o.is_active:
                return
            sign = 1 if o.side == BUY else -1
            if o.type == LIMIT:
                touch_only = (
                    (bar.low >= t.threshold - hs * 0.1) if o.side == BUY else (bar.high <= t.threshold + hs * 0.1)
                )
                qty = self._capacity(symbol, o.remaining, bar, touch_only=touch_only and not t.at_start)
                px = (a + sign * hs) if t.at_start else o.price  # gaps fill at the better open price
                if not self._margin_ok(symbol, qty, px):
                    o.status = "rejected"
                    o.reject_reason = "Недостатъчен margin в момента на изпълнение."
                    self._event(ts, "order_rejected", o.reject_reason, order_id=o.id)
                    return
                o.meta.setdefault("position_active_from", bar.ts)
                self._apply_fill(o, qty, spec.round_price(px), ts, "maker", o.price)
            else:  # stop entry → becomes a market order
                qty = self._capacity(symbol, o.remaining, bar)
                ref = (a + sign * hs) if t.at_start else o.price
                px = ref * (1 + sign * self._slippage_bps(symbol, qty, rng) / 1e4)
                if not self._margin_ok(symbol, qty, px):
                    o.status = "rejected"
                    o.reject_reason = "Недостатъчен margin в момента на изпълнение."
                    self._event(ts, "order_rejected", o.reject_reason, order_id=o.id)
                    return
                o.meta["triggered"] = True
                o.meta.setdefault("position_active_from", bar.ts)
                self._apply_fill(o, qty, spec.round_price(px), ts, "taker", o.price)
            return

        pos = self.s.positions.get(t.obj_id)
        if pos is None or not pos.is_open:
            return
        exit_sign = -pos.sign  # selling a long, buying back a short
        if t.kind == "sl":
            ref = (a + exit_sign * hs) if t.at_start else pos.stop_loss
            px = ref * (1 + exit_sign * self._slippage_bps(symbol, pos.qty, rng) / 1e4)
            self._exit(pos, pos.qty, spec.round_price(px), ts, "stop_loss", "taker", pos.stop_loss, STOP, pos.stop_loss)
        else:
            px = (a + exit_sign * hs) if t.at_start else pos.take_profit
            self._exit(
                pos, pos.qty, spec.round_price(px), ts, "take_profit", "maker", pos.take_profit, LIMIT, pos.take_profit
            )

    def check_liquidation(self, ts: int) -> None:
        if not self.cfg.liquidation_enabled:
            return
        for _ in range(50):
            snap = self.snapshot()
            if snap["used_margin"] <= 0 or snap["equity"] >= self.cfg.stop_out_level * snap["used_margin"]:
                return
            worst = min(self.open_positions(), key=self.position_upnl)
            q = self.quote(worst.symbol)
            base = q.bid if worst.side == LONG else q.ask
            px = base * (1 - worst.sign * self._slippage_bps(worst.symbol, worst.qty, self._rng()) / 1e4)
            self._event(
                ts,
                "margin_call",
                f"Margin level {snap['equity'] / snap['used_margin'] * 100:.0f}% < "
                f"{self.cfg.stop_out_level * 100:.0f}% — принудително затваряне на {worst.symbol}.",
                position_id=worst.id,
            )
            self._exit(worst, worst.qty, self.specs[worst.symbol].round_price(px), ts, "liquidation", "taker", base)
