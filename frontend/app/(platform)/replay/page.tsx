"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import TradingChart, { type PriceLineDef } from "@/components/charts/TradingChart";
import { TradeReviewCard } from "@/components/trading/TradeReviewCard";
import { Badge, Button, Card, ErrorText, Field, Notice, Stat } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { cx, fmtDate, fmtMoney, fmtPrice, fromDateInput, pnlClass, toDateInput } from "@/lib/format";
import type { AccountView, Candle, Review, RiskFinding } from "@/lib/types";

type ReplayState = {
  session: { id: number; symbol: string; timeframe: string; start_ts: number; cursor_ts: number; end_ts: number; status: string; remaining: number };
  candles: Candle[];
  account: AccountView;
  events: { id: number; ts: number; type: string; message: string }[];
};
type FinishState = ReplayState & {
  metrics: { total_trades: number; net_pnl: number; win_rate: number | null };
  reviews: Review[];
  summary: string[];
  what_happened_next: Candle[];
};

function initialSetup() {
  return { symbol: "BTC/USDT", timeframe: "1h", start: toDateInput(Math.floor(Date.now() / 1000) - 60 * 86400), bars: 200 };
}

export default function ReplayPage() {
  const [setup, setSetup] = useState(initialSetup);
  const [state, setState] = useState<ReplayState | null>(null);
  const [finish, setFinish] = useState<FinishState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<RiskFinding[]>([]);
  const [auto, setAuto] = useState(false);
  const [order, setOrder] = useState({ qty: "0.01", sl: "", tp: "" });
  const { data: sessions } = useSWR<{ sessions: { id: number; symbol: string; timeframe: string; start_ts: number; status: string }[] }>("/replay", fetcher);
  const busy = useRef(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- optional ?symbol/&tf prefill
    if (p.get("symbol")) setSetup((s) => ({ ...s, symbol: p.get("symbol")!, timeframe: p.get("tf") || s.timeframe }));
  }, []);

  const call = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true;
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      setAuto(false);
      return null;
    } finally {
      busy.current = false;
    }
  };

  const start = async () => {
    const s = await call(() =>
      post<ReplayState>("/replay", { symbol: setup.symbol, timeframe: setup.timeframe, start_ts: fromDateInput(setup.start), bars: Number(setup.bars) }),
    );
    if (s) {
      setState(s);
      setFinish(null);
    }
  };

  const step = async (n: number) => {
    if (!state) return;
    const s = await call(() => post<ReplayState>(`/replay/${state.session.id}/step`, { n }));
    if (s) {
      setState(s);
      if (s.session.status === "finished") setAuto(false);
    }
  };

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => step(1), 900);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, state?.session.id]);

  const place = async (side: "buy" | "sell") => {
    if (!state) return;
    const r = await call(() =>
      post<ReplayState & { findings: RiskFinding[] }>(`/replay/${state.session.id}/order`, {
        side,
        qty: Number(order.qty),
        stop_loss: Number(order.sl) || undefined,
        take_profit: Number(order.tp) || undefined,
      }),
    );
    if (r) {
      setState(r);
      setFindings(r.findings);
    }
  };

  const closePos = async (position_id: string) => {
    if (!state) return;
    const r = await call(() => post<ReplayState>(`/replay/${state.session.id}/action`, { kind: "close", position_id }));
    if (r) setState(r);
  };

  const end = async () => {
    if (!state) return;
    setAuto(false);
    const r = await call(() => post<FinishState>(`/replay/${state.session.id}/finish`));
    if (r) {
      setFinish(r);
      setState(r);
    }
  };

  const allCandles = useMemo(() => (finish ? [...finish.candles, ...finish.what_happened_next] : state?.candles ?? []), [finish, state]);
  const lines = useMemo<PriceLineDef[]>(() => {
    const out: PriceLineDef[] = [];
    state?.account.positions.forEach((p) => {
      out.push({ id: `${p.id}e`, price: p.entry_price, color: "#8b90a0", title: p.side.toUpperCase() });
      if (p.stop_loss) out.push({ id: `${p.id}s`, price: p.stop_loss, color: "#ef5350", title: "SL", dashed: true });
      if (p.take_profit) out.push({ id: `${p.id}t`, price: p.take_profit, color: "#26a69a", title: "TP", dashed: true });
    });
    return out;
  }, [state]);

  const last = state?.candles[state.candles.length - 1];
  const precision = last && last.close < 10 ? 4 : 2;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">MARKET REPLAY</h1>
        <p className="text-sm text-muted">Исторически период свещ по свещ. Не виждаш бъдещето — решаваш BUY / SELL / WAIT само с това, което е на графиката.</p>
      </div>
      {!state && (
        <Card title="Нова replay сесия">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Asset">
              <SymbolPicker value={setup.symbol} onChange={(s) => setSetup({ ...setup, symbol: s })} className="w-full" />
            </Field>
            <Field label="Timeframe">
              <TimeframeBar value={setup.timeframe} onChange={(tf) => setSetup({ ...setup, timeframe: tf })} />
            </Field>
            <Field label="Start date">
              <input type="date" className="input" value={setup.start} onChange={(e) => setSetup({ ...setup, start: e.target.value })} />
            </Field>
            <Field label="Bars to replay">
              <input className="input num" value={setup.bars} onChange={(e) => setSetup({ ...setup, bars: Number(e.target.value) })} />
            </Field>
          </div>
          <ErrorText error={error} />
          <Button className="mt-3" onClick={start}>
            Start replay
          </Button>
          {sessions && sessions.sessions.length > 0 && (
            <div className="mt-4">
              <div className="label">Предишни сесии</div>
              <div className="flex flex-wrap gap-2">
                {sessions.sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={async () => {
                      const r = await call(() => fetcher<ReplayState>(`/replay/${s.id}`));
                      if (r) setState(r);
                    }}
                    className="rounded border border-line px-2 py-1 text-xs hover:border-accent"
                  >
                    {s.symbol} {s.timeframe} · {fmtDate(s.start_ts)} · {s.status}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {state && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <Card bodyClass="p-2">
              <div className="mb-1 flex items-center gap-2 px-1 text-xs">
                <span className="font-semibold">
                  {state.session.symbol} · {state.session.timeframe.toUpperCase()}
                </span>
                <Badge tone="info">replay</Badge>
                <span className="text-muted">остават {state.session.remaining} свещи</span>
                {finish && <Badge tone="warn">показано е какво стана след това</Badge>}
              </div>
              <TradingChart candles={allCandles} precision={precision} height={460} priceLines={lines} fitKey={`replay-${state.session.id}-${finish ? "f" : ""}`} visibleBars={120} />
            </Card>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => step(1)} disabled={state.session.status !== "active"}>
                Next candle ▶
              </Button>
              <Button variant="outline" onClick={() => step(5)} disabled={state.session.status !== "active"}>
                +5
              </Button>
              <Button variant="outline" onClick={() => step(20)} disabled={state.session.status !== "active"}>
                +20
              </Button>
              <Button variant={auto ? "warn" : "outline"} onClick={() => setAuto((a) => !a)} disabled={state.session.status !== "active"}>
                {auto ? "⏸ Pause" : "⏵ Auto play"}
              </Button>
              <Button variant="ghost" onClick={() => step(1)} disabled={state.session.status !== "active"}>
                WAIT (пропусни свещ)
              </Button>
              <span className="ml-auto" />
              {!finish ? (
                <Button variant="down" onClick={end}>
                  Finish + AI review
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setState(null);
                    setFinish(null);
                  }}
                >
                  Нова сесия
                </Button>
              )}
            </div>
            <ErrorText error={error} />
            {finish && (
              <Card title="Replay review">
                <div className="mb-3 space-y-1 text-sm">
                  {finish.summary.map((s) => (
                    <p key={s}>{s}</p>
                  ))}
                </div>
                <div className="space-y-4">
                  {finish.reviews.map((r) => (
                    <div key={r.position_id} className="rounded-md border border-line p-3">
                      <TradeReviewCard review={r} />
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
          <div className="space-y-3">
            <Card title="Replay account">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Equity" value={fmtMoney(state.account.equity)} />
                <Stat label="Realized" value={fmtMoney(state.account.realized_pnl, true)} tone={pnlClass(state.account.realized_pnl)} />
              </div>
              <p className="mt-2 text-xs text-muted">Последна цена: {fmtPrice(last?.close, precision)}</p>
            </Card>
            {state.session.status === "active" && (
              <Card title="Decision">
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Qty">
                      <input className="input num" value={order.qty} onChange={(e) => setOrder({ ...order, qty: e.target.value })} />
                    </Field>
                    <Field label="SL">
                      <input className="input num" value={order.sl} onChange={(e) => setOrder({ ...order, sl: e.target.value })} />
                    </Field>
                    <Field label="TP">
                      <input className="input num" value={order.tp} onChange={(e) => setOrder({ ...order, tp: e.target.value })} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="up" onClick={() => place("buy")}>
                      BUY
                    </Button>
                    <Button variant="down" onClick={() => place("sell")}>
                      SELL
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted">Поръчката се изпълнява на OPEN на следващата свещ — както в реалността след затваряне.</p>
                  {findings.map((f) => (
                    <Notice key={f.kind} tone={f.severity === "high" ? "down" : "warn"} title={f.message} />
                  ))}
                </div>
              </Card>
            )}
            <Card title="Positions">
              {state.account.positions.length ? (
                state.account.positions.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 border-b border-line py-1.5 text-sm last:border-0">
                    <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
                    <span className="num">{p.qty}</span>
                    <span className={cx("num ml-auto", pnlClass(p.unrealized_pnl))}>{fmtMoney(p.unrealized_pnl, true)}</span>
                    {state.session.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => closePos(p.id)}>
                        Close
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted">Няма позиции.</p>
              )}
            </Card>
            <Card title="Events">
              <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
                {state.events.map((e) => (
                  <li key={e.id} className="text-text/90">
                    {e.message}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
