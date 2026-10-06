"use client";

import useSWR from "swr";

import { Field, InfoTip } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";
import type { Block, Condition, Operand, StrategyDefinition } from "@/lib/types";

type Meta = {
  indicators: Record<string, { params: Record<string, number>; pane: string; outputs: string[] }>;
  operators: string[];
  price_fields: string[];
};

const OP_LABEL: Record<string, string> = {
  "<": "<",
  ">": ">",
  "<=": "≤",
  ">=": "≥",
  crosses_above: "crosses above ↗",
  crosses_below: "crosses below ↘",
};
const IND_LABEL: Record<string, string> = {
  sma: "SMA",
  ema: "EMA",
  rsi: "RSI",
  macd: "MACD",
  bb: "Bollinger",
  atr: "ATR",
  vwap: "VWAP",
  volume_sma: "Average volume",
  adx: "ADX",
  highest: "Highest high (N)",
  lowest: "Lowest low (N)",
};
export const REGIMES = ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCLEAR"];

export function emptyDefinition(): StrategyDefinition {
  return {
    entry_long: {
      logic: "all",
      conditions: [
        { left: { kind: "indicator", name: "rsi", params: { period: 14 }, output: "value" }, op: "<", right: { kind: "value", value: 30 } },
        { left: { kind: "price", field: "close" }, op: ">", right: { kind: "indicator", name: "ema", params: { period: 200 }, output: "value" } },
        {
          left: { kind: "price", field: "volume" },
          op: ">",
          right: { kind: "indicator", name: "volume_sma", params: { period: 20 }, output: "value" },
        },
      ],
    },
    entry_short: null,
    exit_long: null,
    exit_short: null,
    stop: { type: "atr", value: 2, atr_period: 14, lookback: 10 },
    take_profit: { type: "r_multiple", value: 2 },
    risk_per_trade_pct: 1,
    regime_filter: [],
  };
}

export function operandLabel(o: Operand): string {
  if (o.kind === "value") return String(o.value ?? 0);
  if (o.kind === "price") return (o.field ?? "close").replace(/^\w/, (c) => c.toUpperCase());
  const params = Object.values(o.params ?? {}).join(",");
  let s = `${IND_LABEL[o.name ?? ""] ?? o.name}${params ? `(${params})` : ""}`;
  if (o.output && o.output !== "value") s += `.${o.output}`;
  if (o.mult && o.mult !== 1) s += ` × ${o.mult}`;
  return s;
}

function OperandEditor({ value, onChange, meta, advanced }: { value: Operand; onChange: (o: Operand) => void; meta: Meta; advanced: boolean }) {
  const cat = value.kind === "indicator" && value.name ? meta.indicators[value.name] : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        className="input w-auto !py-1 text-xs"
        value={value.kind}
        onChange={(e) => {
          const k = e.target.value as Operand["kind"];
          if (k === "value") onChange({ kind: "value", value: 0 });
          else if (k === "price") onChange({ kind: "price", field: "close" });
          else onChange({ kind: "indicator", name: "ema", params: { period: 20 }, output: "value" });
        }}
      >
        <option value="indicator">Indicator</option>
        <option value="price">Price</option>
        <option value="value">Value</option>
      </select>
      {value.kind === "value" && (
        <input className="input num w-20 !py-1 text-xs" value={value.value ?? 0} onChange={(e) => onChange({ ...value, value: Number(e.target.value) })} />
      )}
      {value.kind === "price" && (
        <select className="input w-auto !py-1 text-xs" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })}>
          {meta.price_fields.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      )}
      {value.kind === "indicator" && (
        <>
          <select
            className="input w-auto !py-1 text-xs"
            value={value.name}
            onChange={(e) => {
              const name = e.target.value;
              onChange({ ...value, name, params: { ...meta.indicators[name].params }, output: meta.indicators[name].outputs[0] });
            }}
          >
            {Object.keys(meta.indicators).map((n) => (
              <option key={n} value={n}>
                {IND_LABEL[n] ?? n}
              </option>
            ))}
          </select>
          {cat &&
            Object.keys(cat.params).map((p) => (
              <label key={p} className="flex items-center gap-0.5 text-[10px] text-muted">
                {p}
                <input
                  className="input num w-14 !px-1 !py-1 text-xs"
                  value={value.params?.[p] ?? cat.params[p]}
                  onChange={(e) => onChange({ ...value, params: { ...value.params, [p]: Number(e.target.value) } })}
                />
              </label>
            ))}
          {cat && cat.outputs.length > 1 && (
            <select className="input w-auto !py-1 text-xs" value={value.output} onChange={(e) => onChange({ ...value, output: e.target.value })}>
              {cat.outputs.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
        </>
      )}
      {advanced && value.kind !== "value" && (
        <label className="flex items-center gap-0.5 text-[10px] text-muted">
          ×
          <input className="input num w-12 !px-1 !py-1 text-xs" value={value.mult ?? 1} onChange={(e) => onChange({ ...value, mult: Number(e.target.value) || 1 })} />
        </label>
      )}
    </div>
  );
}

function BlockEditor({
  title,
  then,
  block,
  onChange,
  meta,
  advanced,
  tone,
}: {
  title: string;
  then: string;
  block: Block | null;
  onChange: (b: Block | null) => void;
  meta: Meta;
  advanced: boolean;
  tone: "up" | "down" | "neutral";
}) {
  const border = tone === "up" ? "border-up/40" : tone === "down" ? "border-down/40" : "border-line";
  if (!block)
    return (
      <button
        onClick={() => onChange({ logic: "all", conditions: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "indicator", name: "ema", params: { period: 50 }, output: "value" } }] })}
        className={cx("w-full rounded-md border border-dashed p-3 text-left text-sm text-muted hover:text-text", border)}
      >
        + Добави „{title}“
      </button>
    );
  const setCond = (i: number, c: Condition) => onChange({ ...block, conditions: block.conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <div className={cx("rounded-md border p-3", border)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-bold">{title}</span>
        <div className="ml-auto flex rounded border border-line text-[11px]">
          {(["all", "any"] as const).map((l) => (
            <button key={l} onClick={() => onChange({ ...block, logic: l })} className={cx("px-2 py-0.5", block.logic === l ? "bg-accent text-white" : "text-muted")}>
              {l === "all" ? "ALL (AND)" : "ANY (OR)"}
            </button>
          ))}
        </div>
        <button className="text-xs text-faint hover:text-down" onClick={() => onChange(null)}>
          премахни
        </button>
      </div>
      <div className="space-y-1.5">
        {block.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded bg-panel2 p-1.5">
            <span className="w-9 text-[11px] font-bold text-accent2">{i === 0 ? "IF" : block.logic === "all" ? "AND" : "OR"}</span>
            <OperandEditor value={c.left} onChange={(o) => setCond(i, { ...c, left: o })} meta={meta} advanced={advanced} />
            <select className="input w-auto !py-1 text-xs font-bold" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value })}>
              {meta.operators.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o] ?? o}
                </option>
              ))}
            </select>
            <OperandEditor value={c.right} onChange={(o) => setCond(i, { ...c, right: o })} meta={meta} advanced={advanced} />
            <button className="ml-auto px-1 text-faint hover:text-down" onClick={() => onChange({ ...block, conditions: block.conditions.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="text-xs text-accent2 hover:underline"
          onClick={() =>
            onChange({
              ...block,
              conditions: [
                ...block.conditions,
                { left: { kind: "indicator", name: "rsi", params: { period: 14 }, output: "value" }, op: ">", right: { kind: "value", value: 50 } },
              ],
            })
          }
        >
          + condition
        </button>
        <span className="ml-auto text-xs font-bold">THEN → {then}</span>
      </div>
    </div>
  );
}

export function StrategyBuilder({
  value,
  onChange,
  advanced,
  readOnly,
}: {
  value: StrategyDefinition;
  onChange: (d: StrategyDefinition) => void;
  advanced: boolean;
  readOnly?: boolean;
}) {
  const { data: meta } = useSWR<Meta>("/strategies/meta", fetcher, { revalidateOnFocus: false });
  if (!meta) return null;
  const set = <K extends keyof StrategyDefinition>(k: K, v: StrategyDefinition[K]) => onChange({ ...value, [k]: v });
  return (
    <fieldset disabled={readOnly} className="space-y-3">
      <BlockEditor title="LONG setup" then="Generate LONG setup" block={value.entry_long} onChange={(b) => set("entry_long", b)} meta={meta} advanced={advanced} tone="up" />
      <BlockEditor title="SHORT setup" then="Generate SHORT setup" block={value.entry_short} onChange={(b) => set("entry_short", b)} meta={meta} advanced={advanced} tone="down" />
      <div className="grid gap-3 md:grid-cols-2">
        <BlockEditor title="Exit LONG (по избор)" then="Close LONG" block={value.exit_long} onChange={(b) => set("exit_long", b)} meta={meta} advanced={advanced} tone="neutral" />
        <BlockEditor title="Exit SHORT (по избор)" then="Close SHORT" block={value.exit_short} onChange={(b) => set("exit_short", b)} meta={meta} advanced={advanced} tone="neutral" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-line p-3">
          <div className="mb-1 flex items-center gap-1 text-sm font-bold">
            STOP <InfoTip text="ATR × N поставя стопа извън нормалния шум. Percent — фиксиран %. Swing — зад най-ниското/високото от последните N свещи." />
          </div>
          <div className="flex gap-1">
            <select className="input !py-1 text-xs" value={value.stop.type} onChange={(e) => set("stop", { ...value.stop, type: e.target.value as StrategyDefinition["stop"]["type"] })}>
              <option value="atr">ATR ×</option>
              <option value="percent">Percent</option>
              <option value="swing">Swing</option>
            </select>
            <input className="input num w-20 !py-1 text-xs" value={value.stop.value} onChange={(e) => set("stop", { ...value.stop, value: Number(e.target.value) })} />
          </div>
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="mb-1 text-sm font-bold">TAKE PROFIT</div>
          <div className="flex gap-1">
            <select
              className="input !py-1 text-xs"
              value={value.take_profit.type}
              onChange={(e) => set("take_profit", { ...value.take_profit, type: e.target.value as StrategyDefinition["take_profit"]["type"] })}
            >
              <option value="r_multiple">Risk ×</option>
              <option value="atr">ATR ×</option>
              <option value="percent">Percent</option>
              <option value="none">None</option>
            </select>
            <input
              className="input num w-20 !py-1 text-xs"
              value={value.take_profit.value}
              onChange={(e) => set("take_profit", { ...value.take_profit, value: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="rounded-md border border-line p-3">
          <Field label="Risk per trade %" hint="Колко % от equity рискува всяка сделка при backtest/бот.">
            <input className="input num !py-1 text-xs" value={value.risk_per_trade_pct} onChange={(e) => set("risk_per_trade_pct", Number(e.target.value))} />
          </Field>
        </div>
      </div>
      <div className="rounded-md border border-line p-3">
        <div className="mb-1 flex items-center gap-1 text-sm font-bold">
          Market regime filter <InfoTip text="Ако избереш режими, setup се генерира само когато пазарът е в тях. Празно = всеки режим." />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REGIMES.map((r) => {
            const on = value.regime_filter.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => set("regime_filter", on ? value.regime_filter.filter((x) => x !== r) : [...value.regime_filter, r])}
                className={cx("rounded-full border px-2 py-0.5 text-xs", on ? "border-accent bg-accent/15 text-accent2" : "border-line text-muted")}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
