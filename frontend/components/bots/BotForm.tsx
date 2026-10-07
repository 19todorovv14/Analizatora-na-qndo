"use client";

import { Bot, CalendarClock, ShieldX, Target } from "lucide-react";
import { useState } from "react";

import { PaperBotLabel } from "@/components/bots/StatusPill";
import { SymbolPicker } from "@/components/charts/ChartControls";
import { NumField } from "@/components/strategy/fields";
import { RulesPreview, StrategySelect } from "@/components/strategy/StrategySelect";
import type { StrategyRow } from "@/components/strategy/types";
import { Button, ErrorText, Field, InfoTip, Segmented, Spinner, Switch, Term } from "@/components/ui";
import { TF_LABEL, TIMEFRAMES, cx } from "@/lib/format";

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export type BotFormState = {
  name: string;
  symbol: string;
  timeframe: string;
  strategy_id: number;
  run_mode: "warm_start" | "forward";
  warm_start_days: number;
  risk_per_trade_pct: number;
  max_positions: number;
  daily_loss_limit_pct: number;
  start_hour: number;
  end_hour: number;
  days: number[];
  allow_short: boolean;
  initial_balance: number;
  stop_type: "" | "atr" | "percent" | "swing";
  stop_value: number;
  tp_type: "" | "r_multiple" | "atr" | "percent" | "none";
  tp_value: number;
};

export function defaultBotForm(): BotFormState {
  return {
    name: "Мой paper бот",
    symbol: "BTC/USDT",
    timeframe: "1h",
    strategy_id: 0,
    run_mode: "warm_start",
    warm_start_days: 30,
    risk_per_trade_pct: 1,
    max_positions: 1,
    daily_loss_limit_pct: 3,
    start_hour: 0,
    end_hour: 24,
    days: [0, 1, 2, 3, 4, 5, 6],
    allow_short: true,
    initial_balance: 10_000,
    stop_type: "",
    stop_value: 2,
    tp_type: "",
    tp_value: 2,
  };
}

export function botPayload(f: BotFormState) {
  return {
    name: f.name.trim() || "Paper бот",
    symbol: f.symbol,
    timeframe: f.timeframe,
    strategy_id: f.strategy_id,
    run_mode: f.run_mode,
    max_positions: f.max_positions,
    stop: f.stop_type ? { type: f.stop_type, value: f.stop_value } : undefined,
    take_profit: f.tp_type ? { type: f.tp_type, value: f.tp_value } : undefined,
    config: {
      risk_per_trade_pct: f.risk_per_trade_pct,
      max_open_positions: f.max_positions,
      daily_loss_limit_pct: f.daily_loss_limit_pct,
      trading_hours: { start: f.start_hour, end: f.end_hour, days: [...f.days].sort() },
      allow_short: f.allow_short,
      initial_balance: f.initial_balance,
      warm_start_days: f.warm_start_days,
    },
  };
}

function Group({ icon: Icon, title, children, right }: { icon: typeof Bot; title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
      <legend className="sr-only">{typeof title === "string" ? title : undefined}</legend>
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={2} className="text-accent2" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text/90">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </fieldset>
  );
}

/** "Нов paper бот" form → POST /bots (keeps the "Create paper bot" button text). */
export function BotForm({
  strategies,
  form,
  onChange,
  onSubmit,
  busy,
  error,
}: {
  strategies: StrategyRow[];
  form: BotFormState;
  onChange: (f: BotFormState) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [schedule, setSchedule] = useState(false);
  const set = <K extends keyof BotFormState>(k: K, v: BotFormState[K]) => onChange({ ...form, [k]: v });
  const strategy = strategies.find((s) => s.id === form.strategy_id);
  const hoursBad = form.start_hour >= form.end_hour;
  const noDays = !form.days.length;
  const sStop = strategy?.definition.stop;
  const sTp = strategy?.definition.take_profit;
  const stopText = sStop ? (sStop.type === "atr" ? `ATR × ${sStop.value}` : sStop.type === "percent" ? `${sStop.value}%` : `swing (${sStop.lookback ?? 10} свещи)`) : "—";
  const tpText = sTp ? (sTp.type === "r_multiple" ? `${sTp.value}R` : sTp.type === "atr" ? `ATR × ${sTp.value}` : sTp.type === "percent" ? `${sTp.value}%` : "няма") : "—";
  const allDay = form.start_hour === 0 && form.end_hour === 24 && form.days.length === 7;

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && form.strategy_id && !hoursBad && !noDays) onSubmit();
      }}
    >
      <PaperBotLabel compact />
      <Field label="Bot name">
        <input className="input" value={form.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Strategy">
        <StrategySelect
          strategies={strategies}
          value={form.strategy_id}
          onChange={(s) => onChange({ ...form, strategy_id: s.id, symbol: s.symbol, timeframe: s.timeframe, risk_per_trade_pct: s.definition.risk_per_trade_pct ?? form.risk_per_trade_pct })}
        />
      </Field>
      {strategy && <RulesPreview lines={strategy.summary} dense />}
      <div className="grid gap-3">
        <Field label="Asset">
          <SymbolPicker value={form.symbol} onChange={(s) => set("symbol", s)} className="w-full" />
        </Field>
        <div>
          <span className="label">Timeframe</span>
          <Segmented fullWidth size="sm" ariaLabel="Timeframe" value={form.timeframe} onChange={(tf) => set("timeframe", tf)} options={TIMEFRAMES.map((tf) => ({ value: tf, label: TF_LABEL[tf] }))} />
        </div>
      </div>

      <Group icon={ShieldX} title="Риск">
        <div className="grid grid-cols-2 gap-3">
          <Field label={<Term k="risk_per_trade">Risk per trade</Term>}>
            <NumField size="md" value={form.risk_per_trade_pct} onChange={(v) => set("risk_per_trade_pct", v)} min={0.05} max={10} step={0.25} suffix="%" ariaLabel="Риск на сделка" className="w-full" />
          </Field>
          <Field label="Max positions" hint="Максимум едновременно отворени позиции на бота.">
            <NumField size="md" value={form.max_positions} onChange={(v) => set("max_positions", v)} min={1} max={10} integer step={1} ariaLabel="Max positions" className="w-full" />
          </Field>
          <Field label="Daily loss limit" hint="При достигане ботът спира да отваря нови сделки до края на деня (UTC).">
            <NumField size="md" value={form.daily_loss_limit_pct} onChange={(v) => set("daily_loss_limit_pct", v)} min={0.5} max={50} step={0.5} suffix="%" ariaLabel="Дневен лимит загуба" className="w-full" />
          </Field>
          <Field label="Virtual balance">
            <NumField size="md" value={form.initial_balance} onChange={(v) => set("initial_balance", v)} min={100} max={10_000_000} step={1000} suffix="$" ariaLabel="Виртуален баланс" className="w-full" />
          </Field>
        </div>
        {form.risk_per_trade_pct > 2 && <p className="text-[11px] text-warn">Над 2% на сделка — серия загуби бързо стопява сметката.</p>}
      </Group>

      <Group icon={Target} title="Stop · Target" right={<span className="text-[10.5px] text-faint">от стратегията: {stopText} · {tpText}</span>}>
        <div>
          <span className="label">
            <Term k="stoploss">Stop loss</Term>
          </span>
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="Stop loss"
              value={form.stop_type}
              onChange={(t) => onChange({ ...form, stop_type: t, stop_value: t === "percent" ? 1 : t === "swing" ? 1 : 2 })}
              options={[
                { value: "", label: "Стратегия" },
                { value: "atr", label: "ATR ×" },
                { value: "percent", label: "%" },
                { value: "swing", label: "Swing" },
              ]}
            />
            {form.stop_type && form.stop_type !== "swing" && (
              <NumField value={form.stop_value} onChange={(v) => set("stop_value", v)} min={0.1} max={50} step={0.5} ariaLabel="Stop стойност" className="w-16" suffix={form.stop_type === "percent" ? "%" : undefined} />
            )}
          </div>
        </div>
        <div>
          <span className="label">
            <Term k="takeprofit">Take profit</Term>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="Take profit"
              value={form.tp_type}
              onChange={(t) => onChange({ ...form, tp_type: t, tp_value: t === "atr" ? 3 : 2 })}
              options={[
                { value: "", label: "Стратегия" },
                { value: "r_multiple", label: "n R" },
                { value: "atr", label: "ATR ×" },
                { value: "percent", label: "%" },
                { value: "none", label: "Няма" },
              ]}
            />
            {form.tp_type && form.tp_type !== "none" && (
              <NumField value={form.tp_value} onChange={(v) => set("tp_value", v)} min={0.1} max={50} step={0.5} ariaLabel="Target стойност" className="w-16" suffix={form.tp_type === "percent" ? "%" : form.tp_type === "r_multiple" ? "R" : undefined} />
            )}
          </div>
        </div>
      </Group>

      <Group
        icon={CalendarClock}
        title="Run mode · часове"
        right={
          <button type="button" className="text-[11px] font-medium text-accent2 hover:text-text" onClick={() => setSchedule((s) => !s)} aria-expanded={schedule}>
            {schedule ? "Скрий графика" : allDay ? "24/7 · промени" : "Промени графика"}
          </button>
        }
      >
        <div>
          <span className="label flex items-center gap-1">
            Run mode
            <InfoTip text="Warm start = първо симулира последните N дни върху история, после продължава в реално време. Forward = само нови свещи от сега нататък." />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="Run mode"
              value={form.run_mode}
              onChange={(v) => set("run_mode", v)}
              options={[
                { value: "warm_start", label: "Warm start" },
                { value: "forward", label: "Forward only" },
              ]}
            />
            {form.run_mode === "warm_start" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <NumField value={form.warm_start_days} onChange={(v) => set("warm_start_days", v)} min={1} max={365} integer step={1} ariaLabel="Warm start дни" className="w-14" />
                дни история
              </span>
            )}
          </div>
        </div>
        {schedule && (
          <div className="space-y-3">
            <div>
              <span className="label">Trading hours (UTC)</span>
              <div className="flex items-center gap-2 text-xs text-muted">
                <NumField value={form.start_hour} onChange={(v) => set("start_hour", v)} min={0} max={23} integer step={1} ariaLabel="Начален час" className="w-14" />
                <span>–</span>
                <NumField value={form.end_hour} onChange={(v) => set("end_hour", v)} min={1} max={24} integer step={1} ariaLabel="Краен час" className="w-14" />
                <span>ч.</span>
              </div>
              {hoursBad && <p className="mt-1 text-[11px] text-down">Крайният час трябва да е след началния.</p>}
            </div>
            <div>
              <span className="label">Days</span>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => {
                  const on = form.days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("days", on ? form.days.filter((x) => x !== i) : [...form.days, i].sort())}
                      className={cx(
                        "h-7 min-w-9 rounded-md border px-2 text-[11px] font-semibold transition-colors",
                        on ? "border-accent/40 bg-accent/15 text-accent2" : "border-white/[0.08] text-muted hover:border-white/20 hover:text-text",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              {noDays && <p className="mt-1 text-[11px] text-down">Избери поне един ден.</p>}
            </div>
          </div>
        )}
        <Switch
          checked={form.allow_short}
          onChange={(v) => set("allow_short", v)}
          label={
            <span>
              Allow <Term k="short">SHORT</Term>
              {strategy && !strategy.definition.entry_short && <span className="ml-1 text-faint">(стратегията няма SHORT правила)</span>}
            </span>
          }
        />
      </Group>

      <ErrorText error={error} />
      <Button type="submit" size="lg" variant="up" className="w-full" disabled={busy || !form.strategy_id || hoursBad || noDays}>
        {busy ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : <Bot size={16} strokeWidth={2} aria-hidden />}
        Create paper bot
      </Button>
      <p className="text-[11px] leading-relaxed text-faint">
        Ботът получава собствена виртуална сметка. Няма връзка с реална борса, няма API ключове, няма реални поръчки. След създаването го пусни
        с ▶ Start.
      </p>
    </form>
  );
}
