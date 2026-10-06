"use client";

import { useState } from "react";

import { JournalForm } from "@/components/journal/JournalForm";
import { TradeReviewCard } from "@/components/trading/TradeReviewCard";
import { Badge, Button, Empty, ErrorText, Modal, Stat, Term } from "@/components/ui";
import { api, del, errorMessage, patch, post } from "@/lib/api";
import { cx, fmtDuration, fmtMoney, fmtPct, fmtPrice, fmtR, fmtTime, pnlClass } from "@/lib/format";
import type { AccountView, Order, Position, Review, Trade } from "@/lib/types";

export function AccountMetrics({ view, beginner }: { view: AccountView; beginner: boolean }) {
  const m = view.metrics;
  const rr = m.average_win && m.average_loss ? m.average_win / Math.abs(m.average_loss) : null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Stat label="Balance" term="balance" value={fmtMoney(view.balance)} />
      <Stat label="Equity" term="equity" value={fmtMoney(view.equity)} />
      <Stat label="Unrealized P/L" term="unrealized" value={fmtMoney(view.unrealized_pnl, true)} tone={pnlClass(view.unrealized_pnl)} />
      <Stat label="Realized P/L" term="realized" value={fmtMoney(view.realized_pnl, true)} tone={pnlClass(view.realized_pnl)} />
      <Stat label="Win rate" term="winrate" value={fmtPct(m.win_rate, 0)} sub={`${m.total_trades} trades`} />
      <Stat label="Max drawdown" term="drawdown" value={fmtPct(view.max_drawdown_pct)} />
      <Stat label="Average win" term="avgwin" value={fmtMoney(m.average_win)} tone="text-up" />
      <Stat label="Average loss" term="avgloss" value={fmtMoney(m.average_loss)} tone="text-down" />
      <Stat label="Profit factor" term="profitfactor" value={m.profit_factor ? (m.profit_factor > 1e6 ? "∞" : m.profit_factor.toFixed(2)) : "—"} />
      <Stat label="Risk/Reward" term="rr" value={rr ? `1 : ${rr.toFixed(2)}` : "—"} sub="avg win / avg loss" />
      <Stat label="Number of trades" value={m.total_trades} />
      <Stat label="Day P/L" value={fmtMoney(view.day_pnl, true)} tone={pnlClass(view.day_pnl)} />
      {!beginner && (
        <>
          <Stat label="Free margin" term="freemargin" value={fmtMoney(view.free_margin)} />
          <Stat label="Used margin" term="margin" value={fmtMoney(view.used_margin)} />
          <Stat label="Margin level" term="marginlevel" value={view.margin_level ? fmtPct(view.margin_level * 100, 0) : "—"} />
          <Stat label="Exposure" term="exposure" value={fmtMoney(view.exposure)} />
          <Stat label="Expectancy" term="expectancy" value={fmtR(m.expectancy_r)} sub={fmtMoney(m.expectancy)} />
          <Stat label="Fees paid" term="fees" value={fmtMoney(view.fees_paid)} />
        </>
      )}
    </div>
  );
}

function PositionRow({ p, onChanged, beginner }: { p: Position; onChanged: () => void; beginner: boolean }) {
  const [edit, setEdit] = useState(false);
  const [sl, setSl] = useState(p.stop_loss?.toString() ?? "");
  const [tp, setTp] = useState(p.take_profit?.toString() ?? "");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      setEdit(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const widening =
    sl && p.stop_loss && ((p.side === "long" && Number(sl) < p.stop_loss) || (p.side === "short" && Number(sl) > p.stop_loss));

  return (
    <>
      <tr className="border-t border-line">
        <td className="py-2 font-semibold">{p.symbol}</td>
        <td>
          <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
        </td>
        <td className="num">{p.qty}</td>
        <td className="num">{fmtPrice(p.entry_price, p.precision)}</td>
        <td className="num">{fmtPrice(p.mark_price, p.precision)}</td>
        <td className="num">{p.stop_loss ? fmtPrice(p.stop_loss, p.precision) : <span className="text-down">няма!</span>}</td>
        <td className="num">{fmtPrice(p.take_profit, p.precision)}</td>
        <td className={cx("num font-semibold", pnlClass(p.unrealized_pnl))}>
          {fmtMoney(p.unrealized_pnl, true)} {p.unrealized_r !== null && <span className="text-xs opacity-80">({fmtR(p.unrealized_r)})</span>}
        </td>
        {!beginner && <td className="num text-muted">{fmtPrice(p.liquidation_price, p.precision)}</td>}
        <td className="whitespace-nowrap text-right">
          <Button size="sm" variant="outline" onClick={() => setEdit((e) => !e)}>
            SL/TP
          </Button>{" "}
          <Button size="sm" variant="down" disabled={busy} onClick={() => run(() => post(`/paper/positions/${p.id}/close`, {}))}>
            Close
          </Button>
        </td>
      </tr>
      {edit && (
        <tr className="bg-panel2">
          <td colSpan={beginner ? 9 : 10} className="p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="label">Stop loss</span>
                <input className="input num w-32" value={sl} onChange={(e) => setSl(e.target.value)} />
              </label>
              <label className="text-xs">
                <span className="label">Take profit</span>
                <input className="input num w-32" value={tp} onChange={(e) => setTp(e.target.value)} />
              </label>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    patch(`/paper/positions/${p.id}`, {
                      ...(sl ? { stop_loss: Number(sl) } : {}),
                      ...(tp ? { take_profit: Number(tp) } : { clear_target: true }),
                    }),
                  )
                }
              >
                Move SL/TP
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setSl(String(p.entry_price))}>
                SL → break-even
              </Button>
              <span className="mx-2 h-6 w-px bg-line" />
              <label className="text-xs">
                <span className="label">Partial close (qty)</span>
                <input className="input num w-28" value={partial} onChange={(e) => setPartial(e.target.value)} placeholder={String(p.qty / 2)} />
              </label>
              <Button
                size="sm"
                variant="warn"
                disabled={busy}
                onClick={() => run(() => post(`/paper/positions/${p.id}/close`, { qty: Number(partial) || p.qty / 2 }))}
              >
                Partial close
              </Button>
            </div>
            {widening && (
              <p className="mt-2 text-xs text-warn">
                ⚠ Местиш стопа ПО-ДАЛЕЧ — това увеличава риска след входа. Платформата ще го отбележи като поведенческа грешка.
              </p>
            )}
            <ErrorText error={error} />
          </td>
        </tr>
      )}
    </>
  );
}

export function PositionsTable({ positions, onChanged, beginner }: { positions: Position[]; onChanged: () => void; beginner: boolean }) {
  if (!positions.length) return <Empty>Няма отворени позиции. Отвори виртуална сделка от Order panel-а.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1.5">Asset</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Mark</th>
            <th>SL</th>
            <th>TP</th>
            <th>
              <Term k="unrealized">Unrealized</Term>
            </th>
            {!beginner && (
              <th>
                <Term k="liquidation">Liq. price</Term>
              </th>
            )}
            <th />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <PositionRow key={p.id} p={p} onChanged={onChanged} beginner={beginner} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrdersTable({ orders, onChanged }: { orders: Order[]; onChanged: () => void }) {
  if (!orders.length) return <Empty>Няма чакащи поръчки.</Empty>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="py-1.5">Asset</th>
          <th>Side</th>
          <th>Type</th>
          <th>Qty</th>
          <th>Price</th>
          <th>SL / TP</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-t border-line">
            <td className="py-2 font-semibold">{o.symbol}</td>
            <td>
              <Badge tone={o.side === "buy" ? "up" : "down"}>{o.side}</Badge>
            </td>
            <td className="uppercase">{o.type}</td>
            <td className="num">
              {o.filled_qty}/{o.qty}
            </td>
            <td className="num">{o.price ?? "—"}</td>
            <td className="num text-xs">
              {o.stop_loss ?? "—"} / {o.take_profit ?? "—"}
            </td>
            <td>
              <Badge tone="info">{o.status}</Badge>
            </td>
            <td className="text-right">
              <Button size="sm" variant="outline" onClick={() => del(`/paper/orders/${o.id}`).then(onChanged)}>
                Cancel
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TradesTable({ trades, captureScreenshot }: { trades: Trade[]; captureScreenshot?: () => string | null }) {
  const [review, setReview] = useState<Review | null>(null);
  const [journalTrade, setJournalTrade] = useState<Trade | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openReview = async (t: Trade) => {
    setError(null);
    try {
      setReview(await api<Review>(`/paper/positions/${t.position_id}/review`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!trades.length) return <Empty>Все още няма затворени сделки.</Empty>;
  return (
    <>
      <ErrorText error={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1.5">Closed</th>
              <th>Asset</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Entry → Exit</th>
              <th>Reason</th>
              <th>Net P/L</th>
              <th>R</th>
              <th>Held</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="py-2 text-xs text-muted">{fmtTime(t.closed_ts)}</td>
                <td className="font-semibold">{t.symbol}</td>
                <td>
                  <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                </td>
                <td className="num">{t.qty}</td>
                <td className="num text-xs">
                  {t.entry_price} → {t.exit_price}
                </td>
                <td className="text-xs">{t.exit_reason.replace("_", " ")}</td>
                <td className={cx("num font-semibold", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                <td className="num">{fmtR(t.r_multiple)}</td>
                <td className="text-xs text-muted">{fmtDuration(t.closed_ts - t.opened_ts)}</td>
                <td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={() => openReview(t)}>
                    AI review
                  </Button>{" "}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShot(captureScreenshot ? captureScreenshot() : null);
                      setJournalTrade(t);
                    }}
                  >
                    📓
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!review} onClose={() => setReview(null)} title="TRADE REVIEW" wide>
        {review && <TradeReviewCard review={review} />}
      </Modal>
      <Modal open={!!journalTrade} onClose={() => setJournalTrade(null)} title="Journal this trade" wide>
        {journalTrade && (
          <JournalForm
            initial={{ trade_id: journalTrade.id, symbol: journalTrade.symbol, side: journalTrade.side, setup: String(journalTrade.meta.setup ?? ""), screenshot: shot }}
            onSaved={() => setJournalTrade(null)}
          />
        )}
      </Modal>
    </>
  );
}
