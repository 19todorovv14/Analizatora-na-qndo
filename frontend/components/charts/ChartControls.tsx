"use client";

import {
  AreaChart,
  CandlestickChart,
  Check,
  ChevronDown,
  Crosshair,
  LineChart,
  ListOrdered,
  Minus,
  MousePointer2,
  MoveUpRight,
  RectangleHorizontal,
  Ruler,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Type,
  ArrowUpDown,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import useSWR from "swr";

import { barIndexAt } from "@/components/charts/chartMath";
import { DRAW_COLORS, TOOL_HOTKEYS, TOOL_INFO, type Tool } from "@/components/charts/drawings";
import type { ChartType } from "@/components/charts/TradingChart";
import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { hasWidthClass, splitPickerClass } from "@/components/market/model";
import { InfoTip, Popover, Term } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { TF_LABEL, TIMEFRAMES, cx, fmtPrice } from "@/lib/format";
import { INDICATORS, INDICATOR_BY_KEY, responseKey } from "@/lib/indicators";
import type { Asset, Candle, CandlesResponse, Point } from "@/lib/types";

export function useAssets() {
  return useSWR<{ assets: Asset[] }>("/market/assets", fetcher, { revalidateOnFocus: false });
}

/**
 * Instrument picker (owned by S1): a search combobox over the whole catalog (curated + synced
 * instruments) built on components/market/AssetSearchCombobox. Keeps the old {value, onChange,
 * className} contract: layout classes (width, flex) go to the wrapper, typography/padding classes
 * (e.g. "!py-1 text-xs") to the text field.
 */
export function SymbolPicker({ value, onChange, className }: { value: string; onChange: (s: string) => void; className?: string }) {
  const { wrapper, input } = splitPickerClass(className);
  return (
    <AssetSearchCombobox
      value={value}
      onChange={onChange}
      className={hasWidthClass(wrapper) ? wrapper : cx("w-60 max-w-full", wrapper)}
      inputClassName={input}
      size={/(^|\s)!?text-xs\b/.test(input) ? "sm" : "md"}
      placeholder="Търси инструмент…"
    />
  );
}

/**
 * Timeframe buttons 1m … 1W. Labels stay exactly "1m", "5m", …, "1H", "4H", "1D", "1W" (role=button).
 * `hotkeys` adds "Alt+N" to each button's title (the terminal binds Alt+1…8).
 */
export function TimeframeBar({
  value,
  onChange,
  beginner,
  hotkeys,
  className,
}: {
  value: string;
  onChange: (tf: string) => void;
  beginner?: boolean;
  hotkeys?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Timeframe"
      className={cx(
        "inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-white/[0.08] bg-black/25 p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      {TIMEFRAMES.map((tf, i) => (
        <button
          key={tf}
          type="button"
          title={hotkeys ? `Timeframe ${TF_LABEL[tf]} (Alt+${i + 1})` : undefined}
          aria-pressed={value === tf}
          onClick={() => onChange(tf)}
          className={cx(
            "h-6 min-w-7 rounded-md px-1.5 text-[11.5px] font-semibold tabular-nums transition-colors duration-150",
            value === tf
              ? "bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-btn"
              : "text-muted hover:bg-white/[0.05] hover:text-text",
          )}
        >
          {TF_LABEL[tf]}
        </button>
      ))}
      {beginner && (
        <InfoTip
          className="ml-1 mr-1"
          text="Lower timeframe = more noise. Higher timeframe = broader context. Определи посоката на по-висок timeframe, търси вход на по-нисък."
        />
      )}
    </div>
  );
}

/** "Indicators" menu (popover, closes on Esc / outside click). Item labels are the indicator names, e.g. "MACD". */
export function IndicatorMenu({ active, onChange, compact }: { active: string[]; onChange: (keys: string[]) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const toggle = (k: string) => onChange(active.includes(k) ? active.filter((x) => x !== k) : [...active, k]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150",
          open ? "border-accent/35 bg-accent/15 text-accent2" : "border-white/10 bg-white/[0.04] text-text hover:border-white/[0.18] hover:bg-white/[0.07]",
        )}
      >
        <SlidersHorizontal size={13} aria-hidden />
        {compact ? null : "Indicators"}
        {compact && <span className="sr-only">Indicators</span>}
        <span className="num rounded bg-white/[0.08] px-1 text-[10px] text-muted">{active.length}</span>
        <ChevronDown size={12} className="text-faint" aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} ariaLabel="Indicators" className="w-72">
        <div className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Indicators</div>
        {INDICATORS.map((d) => (
          <label key={d.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.05]">
            <input type="checkbox" checked={active.includes(d.key)} onChange={() => toggle(d.key)} className="mt-0.5 accent-[#3b82f6]" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden />
                <span>{d.label}</span>
              </span>
              <span className="block text-[11px] leading-snug text-muted">{d.help}</span>
            </span>
          </label>
        ))}
        <p className="px-2 pb-0.5 pt-1 text-[10px] leading-snug text-faint">Индикаторите описват миналото — не са магически buy/sell сигнали.</p>
      </Popover>
    </>
  );
}

const CHART_TYPES: { value: ChartType; label: string; icon: LucideIcon }[] = [
  { value: "candles", label: "Candles", icon: CandlestickChart },
  { value: "heikin", label: "Heikin-Ashi", icon: CandlestickChart },
  { value: "line", label: "Line", icon: LineChart },
  { value: "area", label: "Area", icon: AreaChart },
];

/** Chart type menu: candles / Heikin-Ashi / line / area. */
export function ChartTypeMenu({ value, onChange }: { value: ChartType; onChange: (t: ChartType) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const cur = CHART_TYPES.find((t) => t.value === value) ?? CHART_TYPES[0];
  const Icon = cur.icon;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Тип графика: ${cur.label}`}
        title={`Тип графика: ${cur.label}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-muted transition-colors hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-text"
      >
        <Icon size={14} aria-hidden />
        <ChevronDown size={12} className="text-faint" aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} role="menu" ariaLabel="Тип графика" className="w-44">
        {CHART_TYPES.map((t) => {
          const I = t.icon;
          return (
            <button
              key={t.value}
              type="button"
              role="menuitemradio"
              aria-checked={t.value === value}
              onClick={() => {
                onChange(t.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06]"
            >
              <I size={14} className={t.value === "heikin" ? "text-violet" : "text-muted"} aria-hidden />
              <span className="flex-1">{t.label}</span>
              {t.value === value && <Check size={13} className="text-accent2" aria-hidden />}
            </button>
          );
        })}
      </Popover>
    </>
  );
}

const TOOL_ICONS: Record<Tool, LucideIcon> = {
  cursor: MousePointer2,
  crosshair: Crosshair,
  trend: TrendingUp,
  hline: Minus,
  ray: MoveUpRight,
  rect: RectangleHorizontal,
  text: Type,
  measure: Ruler,
  fib: ListOrdered,
  position: ArrowUpDown,
};

/**
 * Drawing tools. Every tool button keeps the native `title="<label> — <help>"` (walkthrough selectors
 * `button[title^="Horizontal line"]`, `button[title^="Cursor"]`). Vertical (terminal left rail) or
 * horizontal (scrollable strip on small screens).
 */
export function DrawToolbar({
  tool,
  onTool,
  color,
  onColor,
  onClear,
  orientation = "vertical",
  className,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  onClear: () => void;
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  const vertical = orientation === "vertical";
  return (
    <div
      role="toolbar"
      aria-label="Инструменти за чертане"
      aria-orientation={orientation}
      className={cx(
        "flex items-center gap-0.5",
        vertical ? "flex-col py-1" : "no-scrollbar flex-row overflow-x-auto px-1",
        className,
      )}
    >
      {TOOL_INFO.map((t, i) => {
        const Icon = TOOL_ICONS[t.key];
        const key = TOOL_HOTKEYS[t.key];
        const on = tool === t.key;
        return (
          <span key={t.key} className={cx("contents")}>
            {(i === 2 || i === 8) && <span aria-hidden className={cx("shrink-0 bg-white/[0.07]", vertical ? "my-1 h-px w-5" : "mx-1 h-5 w-px")} />}
            <button
              type="button"
              title={`${t.label} — ${t.help}${key ? ` (${key.toUpperCase()})` : ""}`}
              aria-label={t.label}
              aria-pressed={on}
              onClick={() => onTool(t.key)}
              className={cx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
                on ? "bg-accent/20 text-accent2 shadow-[inset_0_0_0_1px_rgb(59_130_246/0.45)]" : "text-muted hover:bg-white/[0.06] hover:text-text",
              )}
            >
              <Icon size={16} strokeWidth={1.85} aria-hidden />
            </button>
          </span>
        );
      })}
      <span aria-hidden className={cx("shrink-0 bg-white/[0.07]", vertical ? "my-1 h-px w-5" : "mx-1 h-5 w-px")} />
      <div className={cx("flex items-center gap-1", vertical ? "flex-col py-0.5" : "flex-row px-0.5")}>
        {DRAW_COLORS.slice(0, 4).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColor(c)}
            title="Цвят"
            aria-label={`Цвят ${c}`}
            aria-pressed={color === c}
            className={cx(
              "h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-transform",
              color === c ? "scale-110 border-white/90" : "border-transparent hover:scale-110",
            )}
            style={{ background: c }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onClear}
        title="Изчисти всички рисунки"
        aria-label="Изчисти всички рисунки"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-down/10 hover:text-down"
      >
        <Trash2 size={15} strokeWidth={1.85} aria-hidden />
      </button>
    </div>
  );
}

/** Value of an indicator series at a bar time (exact match), else null. */
function valueAt(points: Point[] | undefined, t: number): number | null {
  if (!points?.length) return null;
  const i = barIndexAt(points, t);
  return i >= 0 && points[i].time === t ? points[i].value : null;
}

/** OHLC legend + indicator values of the hovered (or last) candle, with beginner explanations. */
export function ChartLegend({
  data,
  hover,
  active,
  beginner,
  candles,
}: {
  data?: CandlesResponse;
  hover: Candle | null;
  active: string[];
  beginner?: boolean;
  /** merged candles (incl. history pages) when they differ from data.candles */
  candles?: Candle[];
}) {
  const list = candles ?? data?.candles ?? [];
  const c = hover ?? list[list.length - 1];
  const p = data?.precision ?? 2;
  if (!c) return null;
  const up = c.close >= c.open;
  const chg = c.open ? ((c.close - c.open) / c.open) * 100 : 0;
  const series = (key: string, output = "value") => {
    const def = INDICATOR_BY_KEY[key];
    return def ? data?.indicators[responseKey(def)]?.series[output] : undefined;
  };
  const rsi = active.includes("rsi") ? valueAt(series("rsi"), c.time) : null;
  return (
    <div className="pointer-events-none flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-4">
      {(["open", "high", "low", "close"] as const).map((k) => (
        <span key={k}>
          <span className="pointer-events-auto text-muted">
            <Term k={k}>{k[0].toUpperCase()}</Term>
          </span>{" "}
          <span className={cx("num", up ? "text-up" : "text-down")}>{fmtPrice(c[k], p)}</span>
        </span>
      ))}
      <span className={cx("num", up ? "text-up" : "text-down")}>
        {chg >= 0 ? "+" : ""}
        {chg.toFixed(2)}%
      </span>
      <span>
        <span className="pointer-events-auto text-muted">
          <Term k="volume">Vol</Term>
        </span>{" "}
        <span className="num">{c.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      </span>
      {active
        .filter((k) => INDICATOR_BY_KEY[k]?.pane === "price" && k !== "bb")
        .map((k) => {
          const d = INDICATOR_BY_KEY[k];
          const v = valueAt(series(k), c.time);
          return (
            <span key={k} style={{ color: d.color }}>
              <span className="pointer-events-auto">
                <Term k={d.name}>{d.label}</Term>
              </span>{" "}
              <span className="num">{fmtPrice(v, p)}</span>
            </span>
          );
        })}
      {rsi !== null && (
        <span className="text-[#c4b5fd]">
          <span className="pointer-events-auto">
            <Term k="rsi">RSI</Term>
          </span>{" "}
          <span className="num">{rsi.toFixed(1)}</span>
          {beginner && rsi > 70 && <span className="ml-1 text-warn">(висок — това НЕ означава автоматично, че цената трябва да падне)</span>}
          {beginner && rsi < 30 && <span className="ml-1 text-warn">(нисък — НЕ означава автоматично отскок)</span>}
        </span>
      )}
    </div>
  );
}
