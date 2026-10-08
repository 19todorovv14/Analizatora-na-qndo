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

const TABLE = "w-full text-[12.5px]";
const THEAD = "sticky top-0 z-[1] bg-surface/95 text-left text-[10.5px] uppercase tracking-[0.05em] text-muted backdrop-blur-sm [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:py-1.5 [&_th:first-child]:pl-3";
const ROW = "border-t border-white/[0.05] [&>td]:px-2 [&>td]:py-1.5 [&>td:first-child]:pl-3";

/** Stop-loss widening (moves the stop AWAY from the price → more risk after the entry). */
export function isWideningStop(side: Position["side"], current: number | null, next: number | null): boolean {
  if (current === null || next === null || !Number.isFinite(next)) return false;
  return side === "long" ? next < current : next > current;
}

function SymbolCell({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  if (!onSelect) return <span className="font-semibold">{symbol}</span>;
  return (
    <button type="button" className="font-semibold hover:text-accent2" title={`Покажи ${symbol} на графиката`} onClick={() => onSelect(symbol)}>
      {symbol}
    </button>
  );
}

function PositionRow({ p, onChanged, beginner, cols, onSelectSymbol }: { p: Position; onChanged: () => void; beginner: boolean; cols: number; onSelectSymbol?: (s: string) => void }) {
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
  const widening = sl !== "" && isWideningStop(p.side, p.stop_loss, Number(sl));
  const noMark = p.mark_available === false;

  return (
    <>
      <tr className={ROW}>
        <td>
          <SymbolCell symbol={p.symbol} onSelect={onSelectSymbol} />
        </td>
        <td>
          <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
        </td>
        <td className="num">{p.qty}</td>
        <td className="num">{fmtPrice(p.entry_price, p.precision)}</td>
        <td className="num">{noMark ? <span className="text-faint">N/A</span> : fmtPrice(p.mark_price, p.precision)}</td>
        <td className="num">{p.stop_loss ? fmtPrice(p.stop_loss, p.precision) : <span className="text-down">няма!</span>}</td>
        <td className="num">{fmtPrice(p.take_profit, p.precision)}</td>
        <td className={cx("num whitespace-nowrap font-semibold", !noMark && pnlClass(p.unrealized_pnl))}>
          {noMark ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-warn" title="Няма пазарна цена от доставчика — P/L не се изчислява.">
              DATA NOT AVAILABLE
            </span>
          ) : (
            <>
              {fmtMoney(p.unrealized_pnl, true)} {p.unrealized_r !== null && <span className="text-xs opacity-80">({fmtR(p.unrealized_r)})</span>}
            </>
          )}
        </td>
        {!beginner && (
          <>
            <td className="num text-muted">{p.leverage}x</td>
            <td className="num text-muted">{fmtMoney(p.margin)}</td>
            <td className="num whitespace-nowrap text-muted">
              {fmtPrice(p.liquidation_price, p.precision)}
              {p.liquidation_distance_pct != null && p.liquidation_price ? <span className="text-faint"> ({p.liquidation_distance_pct.toFixed(1)}%)</span> : null}
            </td>
          </>
        )}
        <td className="whitespace-nowrap text-right">
          <Button type="button" size="sm" variant="outline" aria-expanded={edit} onClick={() => setEdit((e) => !e)}>
            SL/TP
          </Button>{" "}
          <Button type="button" size="sm" variant="down" disabled={busy} onClick={() => run(() => post(`/paper/positions/${p.id}/close`, {}))}>
            Close
          </Button>
        </td>
      </tr>
      {edit && (
        <tr className="bg-white/[0.025]">
          <td colSpan={cols} className="px-3 py-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="label">
                  <Term k="stoploss">Stop loss</Term>
                </span>
                <input className="input num h-8 w-32" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
              </label>
              <label className="text-xs">
                <span className="label">
                  <Term k="takeprofit">Take profit</Term>
                </span>
                <input className="input num h-8 w-32" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    patch(`/paper/positions/${p.id}`, {
                      ...(sl ? { stop_loss: Number(sl) } : { clear_stop: true }),
                      ...(tp ? { take_profit: Number(tp) } : { clear_target: true }),
                    }),
                  )
                }
              >
                Move SL/TP
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setSl(String(p.entry_price))}>
                SL → break-even
              </Button>
              <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />
              <label className="text-xs">
                <span className="label">Partial close (qty)</span>
                <input className="input num h-8 w-28" inputMode="decimal" value={partial} onChange={(e) => setPartial(e.target.value)} placeholder={String(p.qty / 2)} />
              </label>
              <Button
                type="button"
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
                Местиш стопа ПО-ДАЛЕЧ — това увеличава риска след входа. Платформата ще го отбележи като поведенческа грешка.
              </p>
            )}
            <ErrorText error={error} />
          </td>
        </tr>
      )}
    </>
  );
}

export function PositionsTable({
  positions,
  onChanged,
  beginner,
  onSelectSymbol,
}: {
  positions: Position[];
  onChanged: () => void;
  beginner: boolean;
  /** click on a symbol → show it on the chart */
  onSelectSymbol?: (symbol: string) => void;
}) {
  if (!positions.length) return <Empty>Няма отворени позиции. Отвори виртуална сделка от Order panel-а.</Empty>;
  const cols = beginner ? 9 : 12;
  return (
    <div className="overflow-x-auto">
      <table className={cx(TABLE, beginner ? "min-w-[640px]" : "min-w-[840px]")}>
        <thead className={THEAD}>
          <tr>
            <th>Asset</th>
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
              <>
                <th>
                  <Term k="leverage">Lev.</Term>
                </th>
                <th>
                  <Term k="margin">Margin</Term>
                </th>
                <th>
                  <Term k="liquidation">Liq. price</Term>
                </th>
              </>
            )}
            <th />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <PositionRow key={p.id} p={p} onChanged={onChanged} beginner={beginner} cols={cols} onSelectSymbol={onSelectSymbol} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CancelButton({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await del(`/paper/orders/${order.id}`);
            onChanged();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Cancel
      </Button>
      {error && <span className="max-w-48 text-[11px] text-down">{error}</span>}
    </span>
  );
}

export function OrdersTable({ orders, onChanged, onSelectSymbol }: { orders: Order[]; onChanged: () => void; onSelectSymbol?: (symbol: string) => void }) {
  if (!orders.length) return <Empty>Няма чакащи поръчки.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className={cx(TABLE, "min-w-[680px]")}>
        <thead className={THEAD}>
          <tr>
            <th>Asset</th>
            <th>Side</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Price</th>
            <th>SL / TP</th>
            <th>
              <Term k="leverage">Lev.</Term>
            </th>
            <th>Status</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className={ROW}>
              <td>
                <SymbolCell symbol={o.symbol} onSelect={onSelectSymbol} />
              </td>
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
              <td className="num text-muted">{o.effective_leverage ? `${o.effective_leverage}x` : o.leverage ? `${o.leverage}x` : "—"}</td>
              <td>
                <Badge tone="info">{o.status}</Badge>
              </td>
              <td className="whitespace-nowrap text-xs text-muted">{fmtTime(o.created_ts)}</td>
              <td className="text-right">
                <CancelButton order={o} onChanged={onChanged} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Screenshot for the journal: a data URL (sync or async), or null when the chart cannot provide one. */
export type TradeCapture = (t: Trade) => string | null | Promise<string | null>;

export function TradesTable({
  trades,
  captureScreenshot,
  onSelectSymbol,
}: {
  trades: Trade[];
  /** chart screenshot attached to "Journal this trade" (may scroll the chart to the trade first) */
  captureScreenshot?: TradeCapture | (() => string | null);
  onSelectSymbol?: (symbol: string) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [journalTrade, setJournalTrade] = useState<Trade | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);

  const openReview = async (t: Trade) => {
    setError(null);
    try {
      setReview(await api<Review>(`/paper/positions/${t.position_id}/review`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openJournal = async (t: Trade) => {
    setCapturing(t.id);
    let url: string | null = null;
    try {
      const res = captureScreenshot ? (captureScreenshot as TradeCapture)(t) : null;
      url = res instanceof Promise ? await Promise.race([res, new Promise<null>((r) => setTimeout(() => r(null), 2500))]) : res;
    } catch {
      url = null;
    }
    setCapturing(null);
    setShot(url);
    setJournalTrade(t);
  };

  if (!trades.length) return <Empty>Все още няма затворени сделки.</Empty>;
  return (
    <>
      <ErrorText error={error} />
      <div className="overflow-x-auto">
        <table className={cx(TABLE, "min-w-[760px]")}>
          <thead className={THEAD}>
            <tr>
              <th>Closed</th>
              <th>Asset</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Entry → Exit</th>
              <th>Reason</th>
              <th>Net P/L</th>
              <th>
                <Term k="r">R</Term>
              </th>
              <th>Held</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id} className={ROW}>
                <td className="whitespace-nowrap text-xs text-muted">{fmtTime(t.closed_ts)}</td>
                <td>
                  <SymbolCell symbol={t.symbol} onSelect={onSelectSymbol} />
                </td>
                <td>
                  <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                </td>
                <td className="num">{t.qty}</td>
                <td className="num whitespace-nowrap text-xs">
                  {t.entry_price} → {t.exit_price}
                </td>
                <td className="text-xs">{t.exit_reason.replace(/_/g, " ")}</td>
                <td className={cx("num font-semibold", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                <td className="num">{fmtR(t.r_multiple)}</td>
                <td className="whitespace-nowrap text-xs text-muted">{fmtDuration(t.closed_ts - t.opened_ts)}</td>
                <td className="whitespace-nowrap text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => openReview(t)}>
                    AI review
                  </Button>{" "}
                  <Button type="button" size="sm" variant="ghost" title="Journal this trade" disabled={capturing === t.id} onClick={() => openJournal(t)}>
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
