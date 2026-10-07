"use client";

import { ArrowLeftRight, ChevronDown, Crosshair, FlaskConical, Info } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";

import { QUESTION_MODES, defaultCompareTimeframe, draftRR, fmtValue, parseDraftInputs, tfLabel, uniquePositions } from "@/components/ai/model";
import type { BacktestOption, ClosedTrade, StrategyOption, TeacherMode } from "@/components/ai/types";
import { SymbolPicker } from "@/components/charts/ChartControls";
import { Badge, EmptyState, Segmented, SkeletonText } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { TIMEFRAMES, cx, fmtR, fmtTime } from "@/lib/format";

export type DraftForm = { side: "long" | "short"; entry: string; stop: string; target: string };

export type ConsoleInputs = {
  question: string;
  /** lesson slug for TEACH ME ("" = the teacher picks) */
  topic: string;
  compareKind: "timeframe" | "symbol";
  compareSymbol: string;
  compareTimeframe: string;
  /** closed position to review ("" = latest) */
  positionId: string;
  reviewStrategyId: number | null;
  backtestId: number | null;
  draftOn: boolean;
  draft: DraftForm;
};

export const EMPTY_INPUTS: ConsoleInputs = {
  question: "",
  topic: "",
  compareKind: "timeframe",
  compareSymbol: "",
  compareTimeframe: "",
  positionId: "",
  reviewStrategyId: null,
  backtestId: null,
  draftOn: false,
  draft: { side: "long", entry: "", stop: "", target: "" },
};

type ModulesResponse = { modules: { key: string; title: string; lessons: { slug: string; title: string }[] }[] };

const QUESTION_PLACEHOLDER: Partial<Record<TeacherMode, string>> = {
  analyze: "Въпрос към учителя (по избор), напр. „Къде е invalidation?“",
  explain: "Въпрос към учителя (по избор), напр. „Защо stop-ът е там?“",
  why: "Въпрос към учителя (по избор), напр. „Защо NO TRADE?“",
  teach: "За какво да е урокът? (по избор), напр. „Какво е ATR?“",
};

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</div>;
}

/* ─────────────────────────────────────────────────────────── per-mode inputs */

function TeachInputs({ value, onChange }: { value: ConsoleInputs; onChange: (p: Partial<ConsoleInputs>) => void }) {
  const { data } = useSWR<ModulesResponse>("/academy/modules", fetcher, { revalidateOnFocus: false });
  return (
    <div>
      <Label>Тема на урока</Label>
      <select className="input" value={value.topic} onChange={(e) => onChange({ topic: e.target.value })} aria-label="Тема на урока">
        <option value="">Автоматично — според графиката и слабите ти зони</option>
        {value.topic && !data && <option value={value.topic}>{value.topic}</option>}
        {(data?.modules ?? []).map((m) => (
          <optgroup key={m.key} label={m.title}>
            {m.lessons.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function CompareInputs({
  value,
  onChange,
  symbol,
  timeframe,
}: {
  value: ConsoleInputs;
  onChange: (p: Partial<ConsoleInputs>) => void;
  symbol: string;
  timeframe: string;
}) {
  const otherTf = value.compareTimeframe && value.compareTimeframe !== timeframe ? value.compareTimeframe : defaultCompareTimeframe(timeframe);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Сравни {symbol} {tfLabel(timeframe)} с</Label>
        <Segmented
          size="sm"
          value={value.compareKind}
          onChange={(k) =>
            onChange(
              k === "symbol" && (!value.compareSymbol || value.compareSymbol === symbol)
                ? { compareKind: k, compareSymbol: symbol === "ETH/USDT" ? "BTC/USDT" : "ETH/USDT" }
                : { compareKind: k },
            )
          }
          ariaLabel="Какво да сравня"
          options={[
            { value: "timeframe", label: "Друг timeframe" },
            { value: "symbol", label: "Друг актив" },
          ]}
        />
      </div>
      {value.compareKind === "timeframe" ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Втори timeframe">
          {TIMEFRAMES.filter((t) => t !== timeframe).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={otherTf === t}
              onClick={() => onChange({ compareTimeframe: t })}
              className={cx(
                "h-7 min-w-10 rounded-md border px-2 text-xs font-semibold transition-colors",
                otherTf === t ? "border-accent/45 bg-accent/15 text-accent2" : "border-white/[0.08] text-muted hover:border-white/15 hover:text-text",
              )}
            >
              {tfLabel(t)}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ArrowLeftRight size={14} className="text-faint" aria-hidden />
          <SymbolPicker value={value.compareSymbol || ""} onChange={(s) => onChange({ compareSymbol: s })} className="min-w-0 flex-1" />
        </div>
      )}
      {value.compareKind === "symbol" && (!value.compareSymbol || value.compareSymbol === symbol) && (
        <p className="text-[11px] text-faint">Избери различен актив — иначе ще сравня {tfLabel(timeframe)} с {tfLabel(defaultCompareTimeframe(timeframe))}.</p>
      )}
    </div>
  );
}

function TradePicker({ value, onChange }: { value: ConsoleInputs; onChange: (p: Partial<ConsoleInputs>) => void }) {
  const { data, isLoading } = useSWR<{ trades: ClosedTrade[] }>("/paper/trades?limit=40", fetcher, { revalidateOnFocus: false });
  const rows = useMemo(() => uniquePositions(data?.trades).slice(0, 12), [data]);
  if (isLoading && !data) return <SkeletonText lines={3} />;
  if (!rows.length)
    return (
      <EmptyState
        compact
        title="Още нямаш затворени paper сделки"
        description="Направи сделка с stop loss и target, затвори я — и учителят ще я разбере с теб."
        action={
          <Link href="/trade" className="text-xs font-medium text-accent2 hover:text-text">
            Към Paper Trading →
          </Link>
        }
      />
    );
  const selected = value.positionId || rows[0].position_id;
  return (
    <div>
      <Label>Коя сделка да разберем</Label>
      <ul className="max-h-56 space-y-1 overflow-y-auto pr-0.5" role="listbox" aria-label="Затворени сделки">
        {rows.map((t) => {
          const on = t.position_id === selected;
          return (
            <li key={t.position_id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onChange({ positionId: t.position_id })}
                className={cx(
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  on ? "border-accent/45 bg-accent/[0.1]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/15",
                )}
              >
                <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium text-text">{t.symbol}</span>
                <span className={cx("num font-semibold", t.net_pnl >= 0 ? "text-up" : "text-down")}>{t.r_multiple != null ? fmtR(t.r_multiple) : fmtValue(t.net_pnl)}</span>
                <span className="hidden text-[11px] text-faint sm:inline">{fmtTime(t.closed_ts)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StrategyPicker({
  value,
  onChange,
  strategies,
}: {
  value: ConsoleInputs;
  onChange: (p: Partial<ConsoleInputs>) => void;
  strategies: StrategyOption[] | undefined;
}) {
  const { data } = useSWR<{ backtests: BacktestOption[] }>("/backtests", fetcher, { revalidateOnFocus: false });
  const list = strategies ?? [];
  const mine = list.filter((s) => !s.is_template);
  const templates = list.filter((s) => s.is_template);
  const sid = value.reviewStrategyId ?? mine[0]?.id ?? templates[0]?.id ?? null;
  const backtests = (data?.backtests ?? []).filter((b) => b.strategy_id === sid && b.status === "done");
  return (
    <div className="space-y-2.5">
      <div>
        <Label>Стратегия за преглед</Label>
        <select
          className="input"
          aria-label="Стратегия за преглед"
          value={sid ?? ""}
          onChange={(e) => onChange({ reviewStrategyId: e.target.value ? Number(e.target.value) : null, backtestId: null })}
        >
          {!list.length && <option value="">Зареждане…</option>}
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
            <optgroup label="Шаблони (образователни)">
              {templates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div>
        <Label>Backtest (по избор)</Label>
        {backtests.length ? (
          <select
            className="input"
            aria-label="Backtest"
            value={value.backtestId ?? ""}
            onChange={(e) => onChange({ backtestId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Последният завършен backtest</option>
            {backtests.map((b) => (
              <option key={b.id} value={b.id}>
                #{b.id} · {b.symbol} {tfLabel(b.timeframe)} · {fmtTime(b.created_ts ?? null)}
              </option>
            ))}
          </select>
        ) : (
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-faint">
            <FlaskConical size={13} className="mt-0.5 shrink-0" aria-hidden />
            Няма завършен backtest за тази стратегия — учителят ще оцени правилата и ще предложи тест.
            {sid ? (
              <Link href={`/backtesting?strategy=${sid}`} className="whitespace-nowrap text-accent2 hover:text-text">
                Пусни backtest →
              </Link>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}

function DraftInputs({ value, onChange }: { value: ConsoleInputs; onChange: (p: Partial<ConsoleInputs>) => void }) {
  const d = value.draft;
  const parsed = parseDraftInputs(d);
  const rr = draftRR(parsed);
  const set = (p: Partial<DraftForm>) => onChange({ draft: { ...d, ...p } });
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button
        type="button"
        aria-expanded={value.draftOn}
        onClick={() => onChange({ draftOn: !value.draftOn })}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-muted hover:text-text"
      >
        <Crosshair size={13} className="text-accent2" aria-hidden />
        Моята чернова на поръчка <span className="text-faint">(по избор)</span>
        <ChevronDown size={13} className={cx("ml-auto transition-transform", !value.draftOn && "-rotate-90")} aria-hidden />
      </button>
      {value.draftOn && (
        <div className="space-y-2 border-t border-white/[0.06] px-3 pb-3 pt-2.5">
          <Segmented
            size="sm"
            variant="accent"
            value={d.side}
            onChange={(side) => set({ side })}
            ariaLabel="Посока"
            options={[
              { value: "long", label: "LONG" },
              { value: "short", label: "SHORT" },
            ]}
          />
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["entry", "Entry"],
                ["stop", "Stop Loss"],
                ["target", "Take Profit"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="min-w-0">
                <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
                <input className="input num h-8 text-[12.5px]" inputMode="decimal" value={d[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder="—" />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-faint">
            {parsed ? (
              <>
                Учителят ще провери stop-а спрямо ATR и нивата{rr != null ? <>, R:R <span className="num text-accent2">{fmtValue(rr)}</span></> : ""} — без да пуска поръчка.
              </>
            ) : (
              "Въведи поне Entry. Черновата е само за обяснение — не е поръчка."
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Inputs of the selected teacher mode: question (explain / analyze / why / teach), lesson topic (teach),
 * second symbol or timeframe (compare), closed-trade picker (review trade), strategy + backtest picker
 * (review strategy) and an optional draft order (explain).
 */
export function ModeInputs({
  mode,
  value,
  onChange,
  symbol,
  timeframe,
  strategies,
  onSubmit,
}: {
  mode: TeacherMode;
  value: ConsoleInputs;
  onChange: (p: Partial<ConsoleInputs>) => void;
  symbol: string;
  timeframe: string;
  strategies: StrategyOption[] | undefined;
  /** Ctrl/⌘ + Enter in the question box */
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3">
      {mode === "teach" && <TeachInputs value={value} onChange={onChange} />}
      {mode === "compare" && <CompareInputs value={value} onChange={onChange} symbol={symbol} timeframe={timeframe} />}
      {mode === "review_trade" && <TradePicker value={value} onChange={onChange} />}
      {mode === "review_strategy" && <StrategyPicker value={value} onChange={onChange} strategies={strategies} />}
      {mode === "explain" && <DraftInputs value={value} onChange={onChange} />}
      {mode === "quiz" && (
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
          <Info size={13} className="mt-0.5 shrink-0 text-accent2" aria-hidden />
          3–5 въпроса от академията, претеглени към слабите ти модули, + 1–2 въпроса за текущата графика ({symbol} {tfLabel(timeframe)}). Отговорът се
          проверява веднага.
        </p>
      )}
      {QUESTION_MODES.includes(mode) && (
        <textarea
          className="input min-h-[60px] resize-y py-2 text-[13px] leading-snug"
          rows={2}
          maxLength={2000}
          value={value.question}
          onChange={(e) => onChange({ question: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={QUESTION_PLACEHOLDER[mode]}
          aria-label="Въпрос към учителя (по избор)"
        />
      )}
    </div>
  );
}
