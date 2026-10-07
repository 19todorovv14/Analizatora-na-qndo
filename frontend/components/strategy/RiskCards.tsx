"use client";

import { Filter, Goal, Percent, ShieldX } from "lucide-react";

import { NumField } from "@/components/strategy/fields";
import { REGIMES, REGIME_LABEL, ruleTypes } from "@/components/strategy/meta";
import type { BuilderMeta, DefinitionV2, StopRuleV2, TakeProfitRuleV2 } from "@/components/strategy/types";
import { InfoTip, Meter, Segmented, Term } from "@/components/ui";
import { cx } from "@/lib/format";

function MiniCard({ icon: Icon, title, tone, children, right }: { icon: typeof Goal; title: React.ReactNode; tone: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset", tone)}>
          <Icon size={13} strokeWidth={2} aria-hidden />
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </div>
  );
}

const SHORT_STOP: Record<string, string> = { atr: "ATR × n", percent: "%", swing: "Swing" };
const SHORT_TP: Record<string, string> = { r_multiple: "n R", atr: "ATR × n", percent: "%", none: "Няма" };

export function StopCard({ value, onChange, meta, advanced }: { value: StopRuleV2; onChange: (s: StopRuleV2) => void; meta: BuilderMeta; advanced: boolean }) {
  const types = ruleTypes(meta, "stop");
  const cur = types.find((t) => t.type === value.type);
  return (
    <MiniCard
      icon={ShieldX}
      tone="bg-down/10 text-down ring-down/20"
      title={<Term k="stoploss">Stop</Term>}
      right={<InfoTip text="Къде е грешна идеята. ATR × n поставя стопа извън нормалния шум; % е фиксирано разстояние; Swing — зад най-ниското/високото от последните N свещи." />}
    >
      <Segmented
        fullWidth
        size="sm"
        ariaLabel="Тип stop"
        value={value.type}
        onChange={(t) => onChange({ ...value, type: t as StopRuleV2["type"], value: types.find((x) => x.type === t)?.defaults.value ?? value.value })}
        options={types.map((t) => ({ value: t.type, label: SHORT_STOP[t.type] ?? t.label, title: t.label }))}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        {value.type === "atr" && (
          <>
            <NumField value={value.value} onChange={(v) => onChange({ ...value, value: v })} min={0.1} max={50} step={0.5} ariaLabel="ATR множител" className="w-16" />
            <span>
              × <Term k="atr">ATR</Term>
            </span>
            {advanced && (
              <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-faint">
                период
                <NumField value={value.atr_period ?? 14} onChange={(v) => onChange({ ...value, atr_period: v })} min={2} max={200} integer step={1} ariaLabel="ATR период" className="w-14" />
              </label>
            )}
          </>
        )}
        {value.type === "percent" && (
          <>
            <NumField value={value.value} onChange={(v) => onChange({ ...value, value: v })} min={0.05} max={50} step={0.25} ariaLabel="Stop %" className="w-20" suffix="%" />
            <span>от входната цена</span>
          </>
        )}
        {value.type === "swing" && (
          <>
            <span>зад swing от последните</span>
            <NumField value={value.lookback ?? 10} onChange={(v) => onChange({ ...value, lookback: v })} min={2} max={200} integer step={1} ariaLabel="Swing lookback" className="w-14" />
            <span>свещи</span>
            {advanced && (
              <label className="inline-flex items-center gap-1 text-[11px] text-faint" title={cur?.note}>
                буфер
                <NumField value={value.value} onChange={(v) => onChange({ ...value, value: v })} min={0.1} max={50} step={0.5} ariaLabel="Буфер (×0.1%)" className="w-14" />
                × 0.1%
              </label>
            )}
          </>
        )}
      </div>
    </MiniCard>
  );
}

function RewardRiskBar({ r }: { r: number }) {
  const total = 1 + r;
  return (
    <div className="mt-2.5">
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
        <span className="h-full rounded-l-full bg-down/70" style={{ width: `${(1 / total) * 100}%` }} />
        <span className="h-full rounded-r-full bg-up/70" style={{ width: `${(r / total) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-faint">
        <span>Risk 1</span>
        <span className="num">Reward {Number(r.toFixed(2))}</span>
      </div>
    </div>
  );
}

export function TargetCard({ value, onChange, meta }: { value: TakeProfitRuleV2; onChange: (t: TakeProfitRuleV2) => void; meta: BuilderMeta }) {
  const types = ruleTypes(meta, "take_profit");
  return (
    <MiniCard
      icon={Goal}
      tone="bg-up/10 text-up ring-up/20"
      title={<Term k="takeprofit">Target</Term>}
      right={<InfoTip text="nR = печалба n пъти по-голяма от риска (разстоянието до stop). Без фиксирана цел — изход само от stop или exit правилата." />}
    >
      <Segmented
        fullWidth
        size="sm"
        ariaLabel="Тип цел"
        value={value.type}
        onChange={(t) => onChange({ ...value, type: t as TakeProfitRuleV2["type"], value: types.find((x) => x.type === t)?.defaults.value ?? value.value })}
        options={types.map((t) => ({ value: t.type, label: SHORT_TP[t.type] ?? t.label, title: t.label }))}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        {value.type === "none" ? (
          <span>Без фиксирана цел — изход от stop или exit правило.</span>
        ) : (
          <>
            <NumField
              value={value.value}
              onChange={(v) => onChange({ ...value, value: v })}
              min={0.1}
              max={50}
              step={value.type === "percent" ? 0.25 : 0.5}
              ariaLabel="Стойност на целта"
              className="w-16"
            />
            <span>
              {value.type === "r_multiple" ? (
                <>
                  <Term k="r">R</Term> (× риска)
                </>
              ) : value.type === "atr" ? (
                <>
                  × <Term k="atr">ATR</Term>
                </>
              ) : (
                "% от входа"
              )}
            </span>
          </>
        )}
      </div>
      {value.type === "r_multiple" && <RewardRiskBar r={value.value} />}
    </MiniCard>
  );
}

export function RiskCard({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <MiniCard
      icon={Percent}
      tone="bg-warn/10 text-warn ring-warn/20"
      title={<Term k="risk_per_trade">Risk / trade</Term>}
      right={<InfoTip text="Колко % от виртуалната сметка рискува всяка сделка (разстоянието до stop × размера). Използва се от backtest и paper бота." />}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <NumField value={value} onChange={onChange} min={0.05} max={100} step={0.25} ariaLabel="Риск на сделка %" className="w-20" suffix="%" />
        <span>от сметката</span>
      </div>
      <Meter className="mt-3" value={Math.min(value, 4)} max={4} tone="auto" />
      <p className={cx("mt-1.5 text-[11px] leading-4", value > 2 ? "text-warn" : "text-faint")}>
        {value > 2 ? "Над 2% на сделка — серия загуби бързо стопява сметката." : "За обучение: 0.5–1% на сделка."}
      </p>
    </MiniCard>
  );
}

const REGIME_ON: Record<string, string> = {
  TRENDING_UP: "border-up/40 bg-up/10 text-up",
  TRENDING_DOWN: "border-down/40 bg-down/10 text-down",
  RANGING: "border-info/40 bg-info/10 text-info",
  HIGH_VOLATILITY: "border-warn/40 bg-warn/10 text-warn",
  LOW_VOLATILITY: "border-white/25 bg-white/[0.08] text-text",
  UNCLEAR: "border-white/25 bg-white/[0.08] text-text",
};

export function RegimeFilterCard({ value, onChange, meta }: { value: string[]; onChange: (v: string[]) => void; meta: BuilderMeta }) {
  const regimes = meta.regimes?.length ? meta.regimes : REGIMES;
  return (
    <MiniCard
      icon={Filter}
      tone="bg-info/10 text-info ring-info/20"
      title={<Term k="regime">Market regime filter</Term>}
      right={<span className="text-[11px] text-faint">{value.length ? `${value.length} избрани` : "всеки режим"}</span>}
    >
      <div className="flex flex-wrap gap-1.5">
        {regimes.map((r) => {
          const on = value.includes(r);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              title={REGIME_LABEL[r]}
              onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
              className={cx(
                "rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] transition-colors",
                on ? REGIME_ON[r] : "border-white/[0.08] text-muted hover:border-white/20 hover:text-text",
              )}
            >
              {r.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-faint">Setup се генерира само в избраните режими. Празно = всеки режим.</p>
    </MiniCard>
  );
}

/** STOP · TARGET · RISK row + regime filter, as used by the builder. */
export function RiskSection({ value, onChange, meta, advanced }: { value: DefinitionV2; onChange: (d: DefinitionV2) => void; meta: BuilderMeta; advanced: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <StopCard value={value.stop} onChange={(stop) => onChange({ ...value, stop })} meta={meta} advanced={advanced} />
        <TargetCard value={value.take_profit} onChange={(take_profit) => onChange({ ...value, take_profit })} meta={meta} />
        <RiskCard value={value.risk_per_trade_pct} onChange={(risk_per_trade_pct) => onChange({ ...value, risk_per_trade_pct })} />
      </div>
      <RegimeFilterCard value={value.regime_filter} onChange={(regime_filter) => onChange({ ...value, regime_filter })} meta={meta} />
    </div>
  );
}
