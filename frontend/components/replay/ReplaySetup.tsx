"use client";

/*
 * Setup of a new replay: instrument (AssetSearchCombobox), timeframe, period (a past start date or a preset
 * chip: Random / Trend / Range / High volatility / Breakout), number of candles, mode (Trade with paper
 * orders / Predict only) and the strategy for the "what would the rules have done" comparison.
 */
import { CalendarDays, Dices, Info, Play, Target, TrendingUp, Waves, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { TimeframeBar } from "@/components/charts/ChartControls";
import { AssetSearchCombobox } from "@/components/market";
import { BARS_LIMITS, FALLBACK_PRESETS, MODE_META, validateSetup } from "@/components/replay/model";
import type { PresetKey, ReplayMode, ReplayOptions, ReplaySetupValues } from "@/components/replay/types";
import type { StrategyRow } from "@/components/strategy/types";
import { Button, DataNotAvailable, ErrorText, Tooltip } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx, toDateInput } from "@/lib/format";
import { LearnHint } from "@/lib/workspace";

import type { ReplayError } from "@/components/replay/useReplaySession";

const PRESET_ICON: Record<string, LucideIcon> = {
  random: Dices,
  trend: TrendingUp,
  range: Waves,
  high_volatility: Zap,
  breakout: Target,
};

export function ReplaySetup({
  value,
  onChange,
  onStart,
  busy,
  error,
  options,
  beginner,
}: {
  value: ReplaySetupValues;
  onChange: (v: ReplaySetupValues) => void;
  onStart: () => void;
  busy: boolean;
  error: ReplayError | null;
  options?: ReplayOptions | null;
  beginner?: boolean;
}) {
  const { data: strategies } = useSWR<{ strategies: StrategyRow[] }>("/strategies", fetcher);
  const presets = options?.presets?.length ? options.presets : FALLBACK_PRESETS;
  const limits = options?.limits?.bars ?? BARS_LIMITS;
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const issues = validateSetup(value, now);
  const issue = (f: string) => issues.find((i) => i.field === f)?.message ?? null;
  const set = (patch: Partial<ReplaySetupValues>) => onChange({ ...value, ...patch });
  const maxDate = toDateInput(now - 2 * 86_400);
  const mine = strategies?.strategies.filter((s) => !s.is_template) ?? [];
  const templates = strategies?.strategies.filter((s) => s.is_template) ?? [];

  return (
    <section className="card min-w-0" aria-labelledby="replay-setup-title">
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <h2 id="replay-setup-title" className="text-[13px] font-semibold text-text">
          Нова replay сесия
        </h2>
        <span className="text-[11px] text-faint">исторически свещи · бъдещето е скрито</span>
      </header>
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!issues.length && !busy) onStart();
        }}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="label">Инструмент</div>
            <AssetSearchCombobox value={value.symbol} onChange={(symbol) => set({ symbol })} className="w-full" ariaLabel="Инструмент за replay" />
            {issue("symbol") && <p className="mt-1 text-[11px] text-down">{issue("symbol")}</p>}
          </div>
          <div className="min-w-0">
            <div className="label">Timeframe</div>
            <div className="max-w-full overflow-x-auto">
              <TimeframeBar value={value.timeframe} onChange={(timeframe) => set({ timeframe })} beginner={beginner} />
            </div>
          </div>
        </div>

        <div>
          <div className="label">Период</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Период">
            <PeriodChip icon={CalendarDays} label="Дата" title="Избираш началната дата" active={value.period === "date"} onClick={() => set({ period: "date" })} />
            {presets.map((p) => (
              <PeriodChip
                key={p.key}
                icon={PRESET_ICON[p.key] ?? Dices}
                label={p.label}
                title={p.label_bg ? `${p.label_bg} — ${p.description ?? ""}` : p.description}
                active={value.period === p.key}
                onClick={() => set({ period: p.key as PresetKey })}
              />
            ))}
          </div>
          {value.period !== "date" && (
            <p className="mt-2 flex gap-2 text-xs leading-relaxed text-muted">
              <Info size={13} className="mt-0.5 shrink-0 text-accent2" aria-hidden />
              <span>
                {presets.find((p) => p.key === value.period)?.description} Периодът се избира от историята — посоката не се казва, а следващите свещи остават скрити.
              </span>
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_110px_minmax(0,1.3fr)]">
          {value.period === "date" ? (
            <label className="min-w-0 text-xs text-muted">
              Начална дата
              <input
                type="date"
                className="input mt-1"
                value={value.start}
                max={maxDate}
                onChange={(e) => set({ start: e.target.value })}
                aria-invalid={!!issue("start")}
              />
              {issue("start") && <span className="mt-1 block text-[11px] text-down">{issue("start")}</span>}
            </label>
          ) : (
            <div className="min-w-0 text-xs text-muted">
              Начална дата
              <div className="input mt-1 truncate text-faint">автоматично · {presets.find((p) => p.key === value.period)?.label}</div>
            </div>
          )}
          <label className="min-w-0 text-xs text-muted">
            Свещи
            <input
              type="number"
              className="input num mt-1"
              min={limits.min}
              max={limits.max}
              step={10}
              value={Number.isFinite(value.bars) ? value.bars : ""}
              onChange={(e) => set({ bars: e.target.value === "" ? NaN : Number(e.target.value) })}
              aria-invalid={!!issue("bars")}
            />
            {issue("bars") && <span className="mt-1 block text-[11px] text-down">{issue("bars")}</span>}
          </label>
          <label className="min-w-0 text-xs text-muted sm:col-span-2 lg:col-span-1" title="В AI прегледа: правилата на тази стратегия върху същия период и със същите разходи.">
            Стратегия за сравнение
            <select className="input mt-1" value={value.strategyId ?? ""} onChange={(e) => set({ strategyId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Автоматично (последната ми)</option>
              {mine.length > 0 && (
                <optgroup label="Моите стратегии">
                  {mine.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {templates.length > 0 && (
                <optgroup label="Шаблони">
                  {templates.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>

        <div>
          <div className="label">Режим</div>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Режим">
            {(["trade", "predict"] as ReplayMode[]).map((m) => {
              const meta = MODE_META[m];
              const on = value.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ mode: m })}
                  className={cx(
                    "rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                    on ? "border-accent/50 bg-accent/[0.1] shadow-glow" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-text">
                    <span className={cx("h-3 w-3 rounded-full border", on ? "border-accent bg-accent" : "border-white/30")} aria-hidden />
                    {meta.title}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{meta.text}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-faint">В края: „Here is what a rule-based strategy would have done.“ — правилата върху същия период и със същите разходи.</p>
        </div>

        {error?.unavailable ? <DataNotAvailable reason={error.reason ?? error.message} compact /> : <ErrorText error={error?.message ?? null} />}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={busy || issues.length > 0}>
            <Play size={16} aria-hidden />
            Start replay
          </Button>
          <span className="text-xs text-faint">Клавиши в replay: Space / → свещ · L / S / W решение · P auto play</span>
        </div>

        {beginner && (
          <LearnHint title="Защо replay?">
            Решаваш само с миналото на графиката — както в реален момент. След всяка свещ виждаш какво стана наистина, а накрая AI прегледът показва къде позна,
            къде гони цената и какво биха направили правилата на стратегията.
          </LearnHint>
        )}
      </form>
    </section>
  );
}

function PeriodChip({
  icon: Icon,
  label,
  sub,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  const chip = (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-left transition-colors",
        active ? "border-accent/50 bg-accent/[0.12] text-text" : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20 hover:text-text",
      )}
    >
      <Icon size={15} className={active ? "text-accent2" : "text-faint"} aria-hidden />
      <span className="text-[13px] font-semibold leading-tight">{label}</span>
      {sub && <span className="hidden text-[10px] text-faint xl:inline">{sub}</span>}
    </button>
  );
  return title ? (
    <Tooltip content={title} side="bottom">
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
