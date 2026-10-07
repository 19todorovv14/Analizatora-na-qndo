"use client";

import { ChevronDown, Play, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { MAX_BARS, RANGES, WARMUP_BARS, estimateBars, fitStart, rangeStart, todayInput, withStrategy, type BacktestFormState } from "@/components/backtest/formState";
import { SymbolPicker } from "@/components/charts/ChartControls";
import { NumField } from "@/components/strategy/fields";
import { RulesPreview, StrategySelect } from "@/components/strategy/StrategySelect";
import type { StrategyRow } from "@/components/strategy/types";
import { Button, ErrorText, Field, InfoTip, Segmented, Spinner, Switch, Term } from "@/components/ui";
import { TF_LABEL, TIMEFRAMES, cx, fromDateInput } from "@/lib/format";

export {
  MAX_BARS,
  RANGES,
  WARMUP_BARS,
  applyPrefill,
  defaultForm,
  estimateBars,
  rangeStart,
  toPayload,
  todayInput,
  type BacktestFormState,
} from "@/components/backtest/formState";

/**
 * Backtest settings: Strategy, Asset, Timeframe, Period (quick ranges), balance, risk, fees, slippage and an
 * "Advanced" fold (spread, shorts, intrabar policy, max positions). Keeps the "Run backtest" button text.
 */
export function BacktestForm({
  strategies,
  form,
  onChange,
  onRun,
  running,
  error,
  beginner,
}: {
  strategies: StrategyRow[];
  form: BacktestFormState;
  onChange: (f: BacktestFormState) => void;
  onRun: () => void;
  running: boolean;
  error: string | null;
  beginner: boolean;
}) {
  const [advanced, setAdvanced] = useState(!beginner);
  const set = <K extends keyof BacktestFormState>(k: K, v: BacktestFormState[K]) => onChange({ ...form, [k]: v });
  const strategy = strategies.find((s) => s.id === form.strategy_id);
  const bars = estimateBars(form);
  const tooLong = bars > MAX_BARS;
  const badDates = fromDateInput(form.end) <= fromDateInput(form.start);
  const hasShortRules = !!strategy?.definition.entry_short;

  const fitPeriod = () => onChange({ ...form, start: fitStart(form), range: null });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!running && !tooLong && !badDates && form.strategy_id) onRun();
      }}
    >
      <Field label="Strategy">
        <StrategySelect
          strategies={strategies}
          value={form.strategy_id}
          onChange={(s) => onChange(withStrategy(form, s))}
        />
      </Field>
      {strategy && <RulesPreview lines={strategy.summary} dense />}

      <div className="grid gap-3">
        <Field label="Asset">
          <SymbolPicker value={form.symbol} onChange={(s) => set("symbol", s)} className="w-full" />
        </Field>
        <div>
          <span className="label flex items-center gap-1">
            <Term k="timeframe">Timeframe</Term>
          </span>
          <Segmented
            fullWidth
            size="sm"
            ariaLabel="Timeframe"
            value={form.timeframe}
            onChange={(tf) => set("timeframe", tf)}
            options={TIMEFRAMES.map((tf) => ({ value: tf, label: TF_LABEL[tf] }))}
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="label !mb-0">Period</span>
          <Segmented
            size="sm"
            ariaLabel="Бърз период"
            value={form.range ?? ""}
            onChange={(k) => {
              const r = RANGES.find((x) => x.key === k);
              if (!r) return;
              const end = todayInput();
              onChange({ ...form, end, start: rangeStart(end, r.days), range: r.key });
            }}
            options={RANGES.map((r) => ({ value: r.key, label: r.label }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            aria-label="От дата"
            className="input num !text-[13px]"
            value={form.start}
            max={form.end}
            onChange={(e) => e.target.value && onChange({ ...form, start: e.target.value, range: null })}
          />
          <input
            type="date"
            aria-label="До дата"
            className="input num !text-[13px]"
            value={form.end}
            min={form.start}
            max={todayInput()}
            onChange={(e) => e.target.value && onChange({ ...form, end: e.target.value, range: null })}
          />
        </div>
        <div className={cx("mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px]", tooLong ? "text-warn" : "text-faint")}>
          <span className="num">
            ≈ {bars.toLocaleString("en-US")} свещи (вкл. {WARMUP_BARS} warm-up) · максимум {MAX_BARS.toLocaleString("en-US")}
          </span>
          {tooLong && (
            <button type="button" onClick={fitPeriod} className="font-medium text-accent2 underline-offset-2 hover:underline">
              Съкрати периода
            </button>
          )}
        </div>
        {badDates && <p className="mt-1 text-[11px] text-down">Крайната дата трябва да е след началната.</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting balance">
          <NumField size="md" value={form.initial_balance} onChange={(v) => set("initial_balance", v)} min={100} max={10_000_000} step={1000} ariaLabel="Начален баланс" className="w-full" />
        </Field>
        <Field label="Risk per trade" hint="% от сметката, рискуван на сделка (разстояние до stop × размер). По подразбиране — от стратегията.">
          <NumField size="md" value={form.risk_per_trade_pct} onChange={(v) => set("risk_per_trade_pct", v)} min={0.05} max={100} step={0.25} suffix="%" ariaLabel="Риск на сделка" className="w-full" />
        </Field>
        <div className="min-w-0">
          <span className="label flex items-center gap-1">
            <Term k="fees">Fees</Term>
            <InfoTip text="Празно (auto) = таксите на инструмента (taker). 10 bps = 0.1% на страна." />
          </span>
          <div className="flex items-center gap-2">
            <Switch checked={form.fees_enabled} onChange={(v) => set("fees_enabled", v)} ariaLabel="Такси" />
            <NumField
              size="md"
              value={form.fee_bps}
              onChange={(v) => set("fee_bps", v)}
              onClear={() => set("fee_bps", null)}
              placeholder="auto"
              min={0}
              max={100}
              step={1}
              suffix="bps"
              disabled={!form.fees_enabled}
              ariaLabel="Такси в bps"
              className="w-full"
            />
          </div>
        </div>
        <Field label="Slippage" hint="Приплъзване при изпълнение в basis points (1 bps = 0.01%). Stress тестът го утроява.">
          <NumField size="md" value={form.slippage_bps} onChange={(v) => set("slippage_bps", v)} min={0} max={200} step={1} suffix="bps" ariaLabel="Slippage bps" className="w-full" />
        </Field>
      </div>

      <div className="glass-inset">
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted hover:text-text"
        >
          <SlidersHorizontal size={13} strokeWidth={2} aria-hidden />
          Advanced
          <span className="ml-1 font-normal normal-case tracking-normal text-faint">spread · shorts · intrabar · позиции</span>
          <ChevronDown size={14} strokeWidth={2} className={cx("ml-auto transition-transform", advanced && "rotate-180")} aria-hidden />
        </button>
        {advanced && (
          <div className="space-y-3 border-t border-white/[0.05] px-3 pb-3 pt-3">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Switch checked={form.spread_enabled} onChange={(v) => set("spread_enabled", v)} label={<Term k="spread">Spread</Term>} />
              <Switch
                checked={form.allow_short}
                onChange={(v) => set("allow_short", v)}
                label={
                  <span>
                    Allow <Term k="short">SHORT</Term>
                    {!hasShortRules && <span className="ml-1 text-faint">(няма SHORT правила)</span>}
                  </span>
                }
              />
            </div>
            <div>
              <span className="label flex items-center gap-1">
                Intrabar policy
                <InfoTip text="Ако stop и target са в една и съща свещ, не знаем кое е първо. Worst case приема, че първо е ударен стопът (консервативно); OHLC path следва open → high/low → close." />
              </span>
              <Segmented
                fullWidth
                size="sm"
                ariaLabel="Intrabar policy"
                value={form.intrabar_policy}
                onChange={(v) => set("intrabar_policy", v)}
                options={[
                  { value: "worst_case", label: "Worst case (SL first)" },
                  { value: "path", label: "OHLC path" },
                ]}
              />
            </div>
            <Field label="Max open positions" hint="Колко позиции едновременно (1 = класически backtest). Повече позиции = по-голяма експозиция.">
              <NumField size="md" value={form.max_open_positions} onChange={(v) => set("max_open_positions", v)} min={1} max={10} integer step={1} ariaLabel="Максимум позиции" className="w-24" />
            </Field>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Сигнал на close → вход на open на следващата свещ (без lookahead). Същият paper engine с такси, spread и slippage. Включва out-of-sample,
        walk-forward, stress и sensitivity проверки.
      </p>
      {/* wide screens: the settings panel scrolls on its own — keep the run button reachable at its bottom edge */}
      <div className="space-y-2 xl:sticky xl:bottom-0 xl:z-[1] xl:-mx-4 xl:-mb-4 xl:rounded-b-xl xl:bg-[linear-gradient(to_top,var(--color-surface)_72%,transparent)] xl:px-4 xl:pb-4 xl:pt-4">
        <ErrorText error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={running || tooLong || badDates || !form.strategy_id}>
          {running ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : <Play size={16} strokeWidth={2.25} aria-hidden />}
          Run backtest
        </Button>
      </div>
    </form>
  );
}
