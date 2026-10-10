"use client";

/*
 * Trade mode: the classic replay order panel (BUY / SELL market orders that fill on the next candle's open,
 * optional SL / TP), risk findings, the replay account, open positions (Close), pending orders (Cancel) and
 * the event log. Everything is PAPER — a dedicated virtual replay account.
 */
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { defaultQty, num } from "@/components/replay/model";
import type { ReplayEvent } from "@/components/replay/types";
import type { OrderRequest } from "@/components/replay/useReplaySession";
import { Badge, Button, PaperBadge, Term } from "@/components/ui";
import { cx, fmtMoney, fmtPrice, fmtTime, pnlClass } from "@/lib/format";
import type { AccountView, RiskFinding } from "@/lib/types";

export function TradePanel({
  account,
  events,
  price,
  precision,
  findings,
  busy,
  active,
  onOrder,
  onClose,
  onCancel,
}: {
  account: AccountView;
  events: ReplayEvent[];
  price: number | null;
  precision: number;
  findings: RiskFinding[];
  busy: boolean;
  active: boolean;
  onOrder: (req: OrderRequest) => void;
  onClose: (positionId: string) => void;
  onCancel: (orderId: string) => void;
}) {
  const [qty, setQty] = useState<string | null>(null);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const qtyValue = qty ?? defaultQty(price, account.equity);
  const q = num(qtyValue);
  const pending = account.orders.filter((o) => o.status === "pending" || o.status === "open");
  const place = (side: "buy" | "sell") => {
    if (!q || q <= 0) return;
    onOrder({ side, qty: q, stop_loss: num(sl), take_profit: num(tp) });
  };

  return (
    <>
      <section className="card min-w-0" aria-label="Paper поръчка">
        <header className="flex min-h-11 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2">
          <h2 className="text-[13px] font-semibold text-text">Paper поръчка</h2>
          <PaperBadge compact />
        </header>
        <div className="space-y-2.5 p-3.5">
          <div className="grid grid-cols-3 gap-2">
            <label className="min-w-0 text-[11px] font-medium text-muted">
              Qty
              <input className="input num mt-1 !px-2" inputMode="decimal" value={qtyValue} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="min-w-0 text-[11px] font-medium text-muted">
              <Term k="stoploss">SL</Term>
              <input className="input num mt-1 !px-2" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="—" />
            </label>
            <label className="min-w-0 text-[11px] font-medium text-muted">
              <Term k="takeprofit">TP</Term>
              <input className="input num mt-1 !px-2" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="—" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="up" onClick={() => place("buy")} disabled={!active || busy || !q}>
              BUY
            </Button>
            <Button variant="down" onClick={() => place("sell")} disabled={!active || busy || !q}>
              SELL
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-faint">
            <Term k="market_order">Market</Term> поръчката се изпълнява на OPEN на следващата свещ — както в реалността след затваряне.
          </p>
          {findings.map((f) => (
            <div
              key={f.kind}
              className={cx(
                "flex gap-2 rounded-lg border px-2.5 py-2 text-xs",
                f.severity === "high" ? "border-down/30 bg-down/[0.07]" : f.severity === "warn" ? "border-warn/30 bg-warn/[0.07]" : "border-info/25 bg-info/[0.06]",
              )}
            >
              <AlertTriangle size={13} className={cx("mt-0.5 shrink-0", f.severity === "high" ? "text-down" : f.severity === "warn" ? "text-warn" : "text-info")} aria-hidden />
              <div className="min-w-0">
                <div className="font-semibold leading-snug text-text">{f.message}</div>
                <p className="mt-0.5 leading-snug text-muted">{f.explanation}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card min-w-0" aria-label="Replay сметка">
        <header className="flex min-h-11 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2">
          <h2 className="text-[13px] font-semibold text-text">Replay сметка</h2>
          <span className="num text-[11px] text-muted">цена {fmtPrice(price, precision)}</span>
        </header>
        <div className="space-y-3 p-3.5">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-faint">
                <Term k="equity">Equity</Term>
              </div>
              <div className="num font-semibold text-text">{fmtMoney(account.equity)}</div>
            </div>
            <div>
              <div className="text-faint">
                <Term k="realized">Realized</Term>
              </div>
              <div className={cx("num font-semibold", pnlClass(account.realized_pnl))}>{fmtMoney(account.realized_pnl, true)}</div>
            </div>
            <div>
              <div className="text-faint">
                <Term k="unrealized">Unrealized</Term>
              </div>
              <div className={cx("num font-semibold", pnlClass(account.unrealized_pnl))}>{fmtMoney(account.unrealized_pnl, true)}</div>
            </div>
          </div>

          <div>
            <div className="label">Позиции</div>
            {account.positions.length ? (
              <ul className="divide-y divide-white/[0.06]">
                {account.positions.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
                    <span className="num text-muted">
                      {p.qty} @ {fmtPrice(p.entry_price, precision)}
                    </span>
                    <span className={cx("num ml-auto font-medium", pnlClass(p.unrealized_pnl))}>{fmtMoney(p.unrealized_pnl, true)}</span>
                    {active && (
                      <Button size="sm" variant="outline" onClick={() => onClose(p.id)} disabled={busy}>
                        Close
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-faint">Няма отворени позиции.</p>
            )}
          </div>

          {pending.length > 0 && (
            <div>
              <div className="label">Чакащи поръчки</div>
              <ul className="divide-y divide-white/[0.06]">
                {pending.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <Badge tone={o.side === "buy" ? "up" : "down"}>{o.side}</Badge>
                    <span className="num text-muted">
                      {o.type} · {o.qty}
                    </span>
                    <span className="ml-auto text-faint">следваща свещ</span>
                    {active && (
                      <Button size="sm" variant="ghost" onClick={() => onCancel(o.id)} disabled={busy}>
                        Cancel
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {events.length > 0 && (
            <div>
              <div className="label">Събития</div>
              <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-[11px] leading-snug">
                {events.map((e) => (
                  <li key={e.id} className="text-muted">
                    <span className="num mr-1.5 text-faint">{fmtTime(e.ts, false)}</span>
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
