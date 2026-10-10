"use client";

import { Crosshair, Info } from "lucide-react";
import { useMemo, useState } from "react";

import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { MarketStatusDot } from "@/components/market/MarketStatusDot";
import { LEVERAGE_WARNING, LeverageControl } from "@/components/trading/LeverageControl";
import {
  RISK_PCTS,
  SETUPS,
  STOP_PCTS,
  TARGET_RS,
  computeTicket,
  orderRequest,
  quickStopText,
  quickTargetText,
  submitLabel,
  ticketHints,
} from "@/components/trading/ticket";
import { useOrderPreview, useOrderTicket, type OrderTicket } from "@/components/trading/useOrderTicket";
import { Badge, Button, DataNotAvailable, ErrorText, InfoTip, Kbd, Notice, Segmented, Term } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtPrice } from "@/lib/format";
import { usePaperInstrument } from "@/lib/hooks";
import type { AccountView, Order, PaperInstrument } from "@/lib/types";

type Props = {
  symbol: string;
  /** last price of the chart (fallback when the instrument has no bid / ask yet) */
  price: number | null;
  precision: number;
  /** account equity (USD) — used when `account` is not given */
  equity: number;
  timeframe: string;
  onPlaced?: (res: { order: Order; view: AccountView }) => void;
  beginner?: boolean;
  /* ── v2 (all optional) ── */
  /** shared ticket (page-level useOrderTicket) — chart click-to-set + AI draft read the same draft */
  ticket?: OrderTicket;
  /** account view: equity, available margin (sizing cap) */
  account?: AccountView | null;
  /** instrument search inside the panel ("Asset") — switches the terminal symbol */
  onSymbol?: (symbol: string) => void;
  /** GET /paper/instrument payload when the parent already has it */
  instrument?: PaperInstrument | null;
  /** "Order panel" heading (default true) */
  heading?: boolean;
  /** show the click-to-set hint (the chart picks Entry / SL / TP) */
  chartPick?: boolean;
  className?: string;
};

const QUICK = "rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-text/90 transition-colors hover:border-accent/40 hover:text-accent2 disabled:pointer-events-none disabled:opacity-40";

function Row({ label, children, tone }: { label: React.ReactNode; children: React.ReactNode; tone?: string }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className={cx("num text-right", tone)}>{children}</span>
    </>
  );
}

/**
 * Paper order ticket: asset, LONG / SHORT, Market / Limit / Stop, size by risk % or manual units, entry,
 * stop loss, take profit (quick stops / R targets), per-order leverage (capped at the instrument maximum,
 * with the liquidation estimate), live preview (risk $ / %, potential P/L, R:R, margin, spread / fee) and
 * risk findings — warnings never block. Everything is virtual; nothing reaches a real exchange.
 */
export function OrderPanel({
  symbol,
  price,
  precision: precisionProp,
  equity: equityProp,
  timeframe,
  onPlaced,
  beginner,
  ticket: ticketProp,
  account,
  onSymbol,
  instrument: instrumentProp,
  heading = true,
  chartPick,
  className,
}: Props) {
  const own = useOrderTicket(symbol);
  const ticket = ticketProp && ticketProp.symbol === symbol ? ticketProp : own;
  const { state: t, dispatch } = ticket;
  const { data: fetched, error: instError } = usePaperInstrument(instrumentProp ? null : symbol);
  const inst = instrumentProp ?? (fetched && fetched.symbol === symbol ? fetched : null);
  const precision = inst?.price_precision ?? precisionProp;
  const equity = account?.equity ?? equityProp;
  const freeMargin = account ? (account.available_margin ?? account.free_margin) : undefined;

  const calc = useMemo(
    () => computeTicket(t, { instrument: inst, last: price, precision, equity, freeMargin }),
    [t, inst, price, precision, equity, freeMargin],
  );
  const request = useMemo(() => orderRequest(symbol, timeframe, t, calc), [symbol, timeframe, t, calc]);
  const { preview, error: previewError, loading: previewLoading } = useOrderPreview(request);

  // outcome of the last submit — shown only while the same instrument is selected
  const [outcome, setOutcome] = useState<{ symbol: string; order: Order | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const result = outcome?.symbol === symbol ? outcome.order : null;
  const error = outcome?.symbol === symbol ? outcome.error : null;

  const submit = async () => {
    if (!request || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await post<{ order: Order; view: AccountView }>("/paper/orders", request);
      setOutcome({ symbol: request.symbol, order: res.order, error: null });
      if (res.order.status !== "rejected") dispatch({ type: "placed" });
      onPlaced?.(res);
    } catch (e) {
      setOutcome({ symbol: request.symbol, order: null, error: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const plan = preview?.plan;
  const high = preview?.findings.filter((f) => f.severity === "high") ?? [];
  const warns = preview?.findings.filter((f) => f.severity !== "high") ?? [];
  const hints = ticketHints(calc, t, inst?.min_qty);
  const riskUsd = plan?.potential_loss ?? calc.riskUsd;
  const riskPct = plan?.risk_pct ?? calc.riskPct;
  const profitUsd = plan?.potential_profit ?? calc.rewardUsd;
  const rr = plan?.reward_risk ?? calc.rr;
  const margin = preview?.margin_required ?? calc.margin;
  const notional = preview?.notional ?? plan?.notional ?? calc.notional;
  const showPlan = calc.qty > 0;
  const unavailable = inst?.available === false;
  const closed = inst?.market_status?.status === "closed";
  const quote = inst?.quote_currency && inst.quote_currency !== (inst.currency || "USD") ? inst.quote_currency : null;

  return (
    <div className={cx("space-y-3 text-sm", className)}>
      {heading && (
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-text">Order panel</h3>
          <Badge tone="warn">paper</Badge>
          <span className="ml-auto hidden items-center gap-1 text-[10.5px] text-faint xl:flex" title="Смени посоката от клавиатурата">
            <Kbd>B</Kbd>/<Kbd>S</Kbd>
          </span>
        </div>
      )}

      {/* ── asset ── */}
      <div className="space-y-1">
        <span className="label">Asset</span>
        {onSymbol ? (
          <AssetSearchCombobox value={symbol} onChange={onSymbol} size="sm" className="w-full" ariaLabel="Asset" placeholder="Търси инструмент…" />
        ) : (
          <div className="input flex h-8 items-center font-semibold">{symbol}</div>
        )}
        <div className="num flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          {inst?.market_status && <MarketStatusDot status={inst.market_status} showLabel />}
          {inst && inst.bid !== null && inst.ask !== null && (
            <span>
              <Term k="bid">Bid</Term> <span className="text-down">{fmtPrice(inst.bid, precision)}</span> · <Term k="ask">Ask</Term>{" "}
              <span className="text-up">{fmtPrice(inst.ask, precision)}</span>
            </span>
          )}
        </div>
      </div>

      {unavailable && <DataNotAvailable compact reason={inst?.unavailable_reason ?? undefined} />}
      {!inst && instError && <ErrorText error={errorMessage(instError)} />}
      {closed && !unavailable && (
        <Notice tone="warn" title="Пазарът е затворен">
          Market поръчка ще се изпълни на последната цена от доставчика.
        </Notice>
      )}

      {/* ── side ── */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.07] bg-black/25 p-1">
        <button
          type="button"
          aria-pressed={t.side === "buy"}
          onClick={() => dispatch({ type: "side", side: "buy" })}
          className={cx(
            "rounded-md py-1.5 text-[13px] font-bold tracking-wide transition-colors",
            t.side === "buy" ? "bg-gradient-to-b from-[#14a884] to-[#0e8a6c] text-white shadow-btn" : "text-muted hover:bg-white/[0.05] hover:text-text",
          )}
        >
          BUY / LONG
        </button>
        <button
          type="button"
          aria-pressed={t.side === "sell"}
          onClick={() => dispatch({ type: "side", side: "sell" })}
          className={cx(
            "rounded-md py-1.5 text-[13px] font-bold tracking-wide transition-colors",
            t.side === "sell" ? "bg-gradient-to-b from-[#e5484d] to-[#c9353c] text-white shadow-btn" : "text-muted hover:bg-white/[0.05] hover:text-text",
          )}
        >
          SELL / SHORT
        </button>
      </div>

      {/* ── order type ── */}
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          fullWidth
          ariaLabel="Order type"
          value={t.type}
          onChange={(v) => dispatch({ type: "orderType", orderType: v })}
          options={[
            { value: "market", label: "Market", title: "Веднага на текущата цена (spread + slippage)" },
            { value: "limit", label: "Limit", title: "На твоята цена или по-добра" },
            { value: "stop", label: "Stop", title: "Активира се при достигане на цената и става market" },
          ]}
          className="flex-1"
        />
        <InfoTip text="MARKET — веднага на текущата цена (със spread и slippage). LIMIT — на твоята цена или по-добра, ако пазарът стигне до нея. STOP — активира се при достигане на цената и става market." />
      </div>

      {/* ── levels ── */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0 space-y-1">
          <span className="label">
            {t.type === "market" ? (
              <>
                Entry <span className="normal-case text-faint">({t.side === "buy" ? "ask" : "bid"})</span>
              </>
            ) : (
              <Term k={t.type === "limit" ? "limit_order" : "stop_order"}>{t.type === "limit" ? "Limit price" : "Stop price"}</Term>
            )}
          </span>
          {t.type === "market" ? (
            <div className="input num flex h-8 items-center">{fmtPrice(calc.entry, precision)}</div>
          ) : (
            <input
              className="input num h-8"
              inputMode="decimal"
              value={t.entry}
              onChange={(e) => dispatch({ type: "set", field: "entry", value: e.target.value })}
              placeholder={fmtPrice(price, precision)}
            />
          )}
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="label">Notional</span>
          <div className="input num flex h-8 items-center text-muted">{notional ? fmtMoney(notional) : "—"}</div>
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="label text-down/90">
            <Term k="stoploss">Stop Loss</Term>
          </span>
          <input
            className="input num h-8"
            inputMode="decimal"
            value={t.stop}
            onChange={(e) => dispatch({ type: "set", field: "stop", value: e.target.value })}
            placeholder={t.sizing === "risk" ? "задай стоп" : "по избор"}
          />
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="label text-up/90">
            <Term k="takeprofit">Take Profit</Term>
          </span>
          <input
            className="input num h-8"
            inputMode="decimal"
            value={t.target}
            onChange={(e) => dispatch({ type: "set", field: "target", value: e.target.value })}
            placeholder="по избор"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-0.5 text-[11px] text-muted">Стоп:</span>
        {STOP_PCTS.map((p) => (
          <button
            key={p}
            type="button"
            className={QUICK}
            aria-label={`Стоп ${p * 100}%`}
            disabled={!calc.entry}
            onClick={() => {
              const v = quickStopText(calc, t.side, p, precision);
              if (v) dispatch({ type: "set", field: "stop", value: v });
            }}
          >
            {p * 100}%
          </button>
        ))}
        <span className="ml-2 mr-0.5 text-[11px] text-muted">Цел:</span>
        {TARGET_RS.map((r) => (
          <button
            key={r}
            type="button"
            className={QUICK}
            aria-label={`Цел ${r}R`}
            disabled={!calc.entry || !calc.stop}
            onClick={() => {
              const v = quickTargetText(calc, t.side, r, precision);
              if (v) dispatch({ type: "set", field: "target", value: v });
            }}
          >
            {r}R
          </button>
        ))}
      </div>
      {chartPick && (
        <p className="flex items-center gap-1.5 text-[11px] text-faint">
          <Crosshair size={12} aria-hidden /> Кликни върху графиката, за да зададеш Entry / SL / TP.
        </p>
      )}

      {/* ── size ── */}
      <div className="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">
            <Term k="position_size">Size</Term>
          </span>
          <div className="flex gap-1 text-[10.5px]">
            {(["risk", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={t.sizing === m}
                onClick={() => dispatch({ type: "sizing", sizing: m })}
                className={cx("rounded-md px-1.5 py-0.5 font-medium", t.sizing === m ? "bg-accent text-white" : "bg-white/[0.05] text-muted hover:text-text")}
              >
                {m === "risk" ? "By risk %" : "Manual size"}
              </button>
            ))}
          </div>
        </div>
        {t.sizing === "risk" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              className="input num h-8 w-16"
              inputMode="decimal"
              aria-label="Risk % от equity"
              value={t.riskPct}
              onChange={(e) => dispatch({ type: "set", field: "riskPct", value: e.target.value })}
            />
            <span className="text-xs text-muted">
              % <Term k="risk_per_trade">risk</Term> от equity
            </span>
            {RISK_PCTS.map((r) => (
              <button
                key={r}
                type="button"
                className={QUICK}
                aria-label={`Риск ${r}%`}
                onClick={() => dispatch({ type: "set", field: "riskPct", value: String(r) })}
              >
                {r}%
              </button>
            ))}
          </div>
        ) : (
          <input
            className="input num h-8"
            inputMode="decimal"
            value={t.manualQty}
            onChange={(e) => dispatch({ type: "set", field: "manualQty", value: e.target.value })}
            placeholder="Количество (единици)"
          />
        )}
        <div className="text-xs text-muted">
          Position size: <span className="num font-semibold text-text">{calc.qtyText || "—"}</span>{" "}
          {inst && (
            <span className="text-faint">
              (стъпка {inst.qty_step}, мин. {inst.min_qty})
            </span>
          )}
        </div>
        {hints.map((h) => (
          <p key={h.text} className={cx("text-[11px] leading-snug", h.tone === "warn" ? "text-warn" : "text-muted")}>
            {h.text}
          </p>
        ))}
      </div>

      {/* ── leverage ── */}
      <LeverageControl
        value={t.leverage}
        effective={calc.leverage}
        accountDefault={inst?.default_leverage ?? calc.leverage}
        max={calc.maxLeverage}
        steps={calc.leverageSteps}
        onChange={(v) => dispatch({ type: "leverage", leverage: v })}
        liquidation={preview?.liquidation_estimate ?? null}
        liquidationDistancePct={preview?.liquidation_distance_pct ?? null}
        precision={precision}
        warning={inst?.leverage_warning || preview?.leverage_warning || LEVERAGE_WARNING}
        disabled={!inst || unavailable}
      />

      {/* ── plan ── */}
      {showPlan && (
        <div className={cx("grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-white/[0.07] p-2.5 text-xs", previewLoading && "opacity-70")} aria-busy={previewLoading || undefined}>
          <Row label={<Term k="risk_per_trade">Risk</Term>}>
            {riskUsd !== null && riskUsd !== undefined ? (
              <>
                {fmtMoney(riskUsd)} <span className="text-muted">({fmtPct(riskPct, 2)})</span>
              </>
            ) : (
              <span className="text-down">∞ (няма стоп!)</span>
            )}
          </Row>
          <Row label="Potential profit" tone="text-up">
            {profitUsd !== null && profitUsd !== undefined ? fmtMoney(profitUsd) : "—"}
          </Row>
          <Row label="Potential loss" tone="text-down">
            {riskUsd !== null && riskUsd !== undefined ? fmtMoney(-riskUsd) : "∞"}
          </Row>
          <Row label={<Term k="rr">Risk/Reward</Term>}>{rr ? `1 : ${rr.toFixed(2)}` : "—"}</Row>
          <Row
            label={
              <>
                <Term k="margin">Margin</Term> <span className="text-faint">({calc.leverage}x)</span>
              </>
            }
          >
            {fmtMoney(margin)}
          </Row>
          <Row
            label={
              <>
                <Term k="spread">Spread</Term> · <Term k="fees">fee</Term>
              </>
            }
          >
            {preview ? `${fmtPrice(preview.spread, precision)} · ${fmtMoney(preview.fee_estimate)}` : "—"}
          </Row>
          {!beginner && preview && (
            <>
              <Row label={<Term k="freemargin">Free margin after</Term>}>{fmtMoney(preview.free_margin_after ?? null)}</Row>
              <Row label={<Term k="marginlevel">Margin level after</Term>}>
                {preview.margin_level_after_pct ? `${preview.margin_level_after_pct.toLocaleString("en-US", { maximumFractionDigits: 0 })}%` : "—"}
              </Row>
            </>
          )}
          {quote && preview?.fx_rate ? (
            <p className="col-span-2 mt-0.5 flex items-center gap-1 text-[10.5px] text-faint">
              <Info size={11} aria-hidden /> Котировка в {quote}; P/L и margin са в USD (курс {preview.fx_rate.toPrecision(6)}).
            </p>
          ) : null}
        </div>
      )}
      <ErrorText error={previewError} />

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
        <label className="block min-w-0 space-y-1">
          <span className="label">Setup</span>
          <select className="input h-8 py-0" value={t.setup} onChange={(e) => dispatch({ type: "set", field: "setup", value: e.target.value })}>
            {SETUPS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="label">
            <Term k="timeframe">Timeframe</Term>
          </span>
          <div className="input flex h-8 items-center">{timeframe.toUpperCase()}</div>
        </label>
      </div>

      <ErrorText error={error} />
      {result && (
        <Notice tone={result.status === "rejected" ? "down" : "up"} title={`Поръчката е ${result.status}`}>
          {result.status === "rejected"
            ? result.reject_reason
            : result.avg_fill_price
              ? `Изпълнена на ${fmtPrice(result.avg_fill_price, precision)} · такса ${fmtMoney(result.fees)} · slippage ${fmtMoney(result.slippage_cost)}${
                  result.effective_leverage ? ` · ${result.effective_leverage}x` : ""
                }`
              : "Чака изпълнение."}
        </Notice>
      )}
      <Button
        type="button"
        variant={t.side === "buy" ? "up" : "down"}
        className="w-full"
        size="lg"
        onClick={submit}
        disabled={!request || !calc.canSubmit || busy}
      >
        {busy ? "…" : submitLabel(t.side, calc.qtyText)}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-[10.5px] text-faint">
        <Badge tone="warn">paper</Badge> Виртуална поръчка — нищо не се изпраща към реална борса.
      </p>
    </div>
  );
}
