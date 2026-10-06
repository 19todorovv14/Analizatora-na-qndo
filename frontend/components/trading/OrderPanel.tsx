"use client";

import { useEffect, useMemo, useState } from "react";

import { useAssets } from "@/components/charts/ChartControls";
import { Badge, Button, ErrorText, Field, InfoTip, Notice, Term } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtPrice } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { AccountView, Order, OrderPreview } from "@/lib/types";

const SETUPS = ["breakout", "pullback", "range", "reversal", "momentum", "retest", "other"];

type Props = {
  symbol: string;
  price: number | null;
  precision: number;
  equity: number;
  timeframe: string;
  onPlaced?: (res: { order: Order; view: AccountView }) => void;
  beginner?: boolean;
};

/** Order entry. Parents render it with `key={symbol}` so the form resets when the instrument changes. */
export function OrderPanel({ symbol, price, precision, equity, timeframe, onPlaced, beginner }: Props) {
  const { data: assets } = useAssets();
  const asset = assets?.assets.find((a) => a.symbol === symbol);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit" | "stop">("market");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [riskPct, setRiskPct] = useState("1");
  const [manualQty, setManualQty] = useState("");
  const [sizing, setSizing] = useState<"risk" | "manual">("risk");
  const [setup, setSetup] = useState("pullback");
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);

  const entryPrice = type === "market" ? price ?? 0 : Number(entry) || 0;
  const stopNum = Number(stop) || 0;
  const targetNum = Number(target) || 0;

  const qty = useMemo(() => {
    if (sizing === "manual") return Number(manualQty) || 0;
    if (!stopNum || !entryPrice || stopNum === entryPrice || !asset) return 0;
    const raw = (equity * (Number(riskPct) || 0)) / 100 / Math.abs(entryPrice - stopNum);
    const steps = Math.floor(raw / asset.qty_step + 1e-9);
    return Number((steps * asset.qty_step).toFixed(10));
  }, [sizing, manualQty, stopNum, entryPrice, asset, equity, riskPct]);

  const req = useMemo(
    () =>
      qty > 0
        ? {
            symbol,
            side,
            type,
            qty,
            price: type === "market" ? undefined : Number(entry) || undefined,
            stop_loss: stopNum || undefined,
            take_profit: targetNum || undefined,
            timeframe,
            setup,
          }
        : null,
    [qty, symbol, side, type, entry, stopNum, targetNum, timeframe, setup],
  );
  const debounced = useDebounced(req, 450);

  const previewable = !!debounced && (debounced.type === "market" || !!debounced.price);
  useEffect(() => {
    if (!debounced || !previewable) return;
    let cancelled = false;
    post<OrderPreview>("/paper/orders/preview", debounced)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [debounced, previewable]);

  const setRR = (rr: number) => {
    if (!stopNum || !entryPrice) return;
    const d = Math.abs(entryPrice - stopNum) * rr;
    setTarget((side === "buy" ? entryPrice + d : entryPrice - d).toFixed(precision));
  };

  const suggestStop = (pct: number) => {
    if (!entryPrice) return;
    const d = entryPrice * pct;
    setStop((side === "buy" ? entryPrice - d : entryPrice + d).toFixed(precision));
  };

  const submit = async () => {
    if (!req) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await post<{ order: Order; view: AccountView }>("/paper/orders", req);
      setResult(res.order);
      onPlaced?.(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = previewable && req ? preview : null;
  const plan = shown?.plan;
  const high = shown?.findings.filter((f) => f.severity === "high") ?? [];
  const warns = shown?.findings.filter((f) => f.severity !== "high") ?? [];

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-panel2 p-1">
        <button
          onClick={() => setSide("buy")}
          className={cx("rounded py-1.5 font-bold", side === "buy" ? "bg-up text-white" : "text-muted hover:text-text")}
        >
          BUY / LONG
        </button>
        <button
          onClick={() => setSide("sell")}
          className={cx("rounded py-1.5 font-bold", side === "sell" ? "bg-down text-white" : "text-muted hover:text-text")}
        >
          SELL / SHORT
        </button>
      </div>
      {beginner && (
        <p className="text-[11px] leading-snug text-muted">
          {side === "buy"
            ? "LONG = печелиш, ако цената се покачи. Купуваш на ASK цената."
            : "SHORT = печелиш, ако цената падне. Продаваш на BID цената (в симулацията без реален заем)."}
        </p>
      )}

      <div className="flex gap-1">
        {(["market", "limit", "stop"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cx(
              "flex-1 rounded border py-1 text-xs font-semibold uppercase",
              type === t ? "border-accent bg-accent/15 text-accent2" : "border-line text-muted",
            )}
          >
            {t}
          </button>
        ))}
        <InfoTip text="MARKET — веднага на текущата цена (със spread и slippage). LIMIT — на твоята цена или по-добра, ако пазарът стигне до нея. STOP — активира се при достигане на цената и става market." />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Asset">
          <div className="input font-semibold">{symbol}</div>
        </Field>
        <Field label={type === "market" ? "Entry (live)" : "Entry price"}>
          {type === "market" ? (
            <div className="input num">{fmtPrice(price, precision)}</div>
          ) : (
            <input className="input num" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={fmtPrice(price, precision)} />
          )}
        </Field>
        <Field label={<Term k="stoploss">Stop Loss</Term>} hint="Къде идеята ти е ГРЕШНА. Определя максималната загуба и размера на позицията.">
          <input className="input num" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="задължителен за risk sizing" />
        </Field>
        <Field label={<Term k="takeprofit">Take Profit</Term>}>
          <input className="input num" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="по избор" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <span className="text-muted">Стоп:</span>
        {[0.005, 0.01, 0.02].map((p) => (
          <button key={p} onClick={() => suggestStop(p)} className="rounded bg-panel3 px-1.5 py-0.5 hover:text-accent2">
            {p * 100}%
          </button>
        ))}
        <span className="ml-2 text-muted">Цел:</span>
        {[1.5, 2, 3].map((rr) => (
          <button key={rr} onClick={() => setRR(rr)} className="rounded bg-panel3 px-1.5 py-0.5 hover:text-accent2">
            {rr}R
          </button>
        ))}
      </div>

      <div className="rounded-md border border-line bg-panel2 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold">How much are you risking?</span>
          <div className="flex gap-1 text-[10px]">
            {(["risk", "manual"] as const).map((m) => (
              <button key={m} onClick={() => setSizing(m)} className={cx("rounded px-1.5 py-0.5", sizing === m ? "bg-accent text-white" : "bg-panel3 text-muted")}>
                {m === "risk" ? "By risk %" : "Manual size"}
              </button>
            ))}
          </div>
        </div>
        {sizing === "risk" ? (
          <div className="flex items-center gap-2">
            <input className="input num w-20" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
            <span className="text-muted">% от equity</span>
            {[0.5, 1, 2].map((r) => (
              <button key={r} onClick={() => setRiskPct(String(r))} className="rounded bg-panel3 px-1.5 py-0.5 text-[11px] hover:text-accent2">
                {r}%
              </button>
            ))}
          </div>
        ) : (
          <input className="input num" value={manualQty} onChange={(e) => setManualQty(e.target.value)} placeholder="Количество (единици)" />
        )}
        <div className="mt-1.5 text-xs text-muted">
          Position size: <span className="num font-semibold text-text">{qty || "—"}</span> {asset && <span>(стъпка {asset.qty_step}, мин. {asset.min_qty})</span>}
          {sizing === "risk" && !stopNum && <span className="block text-warn">Задай stop loss, за да изчисля размера.</span>}
        </div>
      </div>

      {shown && plan && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-line p-2.5 text-xs">
          <span className="text-muted">Risk</span>
          <span className="num text-right">
            {fmtMoney(plan.potential_loss)} ({fmtPct(plan.risk_pct, 2)})
          </span>
          <span className="text-muted">Potential profit</span>
          <span className="num text-right text-up">{fmtMoney(plan.potential_profit)}</span>
          <span className="text-muted">Potential loss</span>
          <span className="num text-right text-down">{plan.potential_loss !== null ? fmtMoney(-plan.potential_loss) : "∞ (няма стоп!)"}</span>
          <span className="text-muted">
            <Term k="rr">Risk/Reward</Term>
          </span>
          <span className="num text-right">{plan.reward_risk ? `1 : ${plan.reward_risk.toFixed(2)}` : "—"}</span>
          <span className="text-muted">
            <Term k="margin">Margin</Term> (<Term k="leverage">{shown.leverage}x</Term>)
          </span>
          <span className="num text-right">{fmtMoney(shown.margin_required)}</span>
          <span className="text-muted">
            <Term k="spread">Spread</Term> · <Term k="fees">fee</Term>
          </span>
          <span className="num text-right">
            {fmtPrice(shown.spread, precision)} · {fmtMoney(shown.fee_estimate)}
          </span>
        </div>
      )}

      {high.map((f) => (
        <Notice key={f.kind} tone="down" title={f.message}>
          {f.explanation}
        </Notice>
      ))}
      {warns.map((f) => (
        <Notice key={f.kind} tone="warn" title={f.message}>
          {beginner ? f.explanation : null}
        </Notice>
      ))}
      {high.length > 0 && <p className="text-[11px] text-muted">Предупрежденията са образователни — paper сделката не е блокирана.</p>}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Setup">
          <select className="input" value={setup} onChange={(e) => setSetup(e.target.value)}>
            {SETUPS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Timeframe">
          <div className="input">{timeframe.toUpperCase()}</div>
        </Field>
      </div>

      <ErrorText error={error} />
      {result && (
        <Notice tone={result.status === "rejected" ? "down" : "up"} title={`Поръчката е ${result.status}`}>
          {result.status === "rejected"
            ? result.reject_reason
            : result.avg_fill_price
              ? `Изпълнена на ${fmtPrice(result.avg_fill_price, precision)} · такса ${fmtMoney(result.fees)} · slippage ${fmtMoney(result.slippage_cost)}`
              : "Чака изпълнение."}
        </Notice>
      )}
      <Button variant={side === "buy" ? "up" : "down"} className="w-full" size="lg" onClick={submit} disabled={!req || busy}>
        {busy ? "…" : `${side === "buy" ? "BUY / LONG" : "SELL / SHORT"} ${qty || ""} · virtual`}
      </Button>
      <div className="flex items-center justify-center gap-1 text-[10px] text-faint">
        <Badge tone="warn">paper</Badge> Виртуална поръчка — нищо не се изпраща към реална борса.
      </div>
    </div>
  );
}
