"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { DRAW_COLORS, TOOL_INFO, type Tool } from "@/components/charts/drawings";
import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { hasWidthClass, splitPickerClass } from "@/components/market/model";
import { InfoTip, Term } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { TF_LABEL, TIMEFRAMES, cx, fmtPrice } from "@/lib/format";
import { INDICATORS, INDICATOR_BY_KEY, lastValue } from "@/lib/indicators";
import type { Asset, Candle, CandlesResponse } from "@/lib/types";

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

export function TimeframeBar({ value, onChange, beginner }: { value: string; onChange: (tf: string) => void; beginner?: boolean }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-panel2 p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={cx("rounded px-2 py-1 text-xs font-semibold", value === tf ? "bg-accent text-white" : "text-muted hover:text-text")}
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

export function IndicatorMenu({ active, onChange }: { active: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggle = (k: string) => onChange(active.includes(k) ? active.filter((x) => x !== k) : [...active, k]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="input flex w-auto items-center gap-1.5 text-xs font-semibold">
        ƒx Indicators <span className="rounded bg-panel3 px-1 text-[10px]">{active.length}</span>
      </button>
      {open && (
        <div className="glass-strong absolute left-0 top-9 z-50 w-72 rounded-xl p-1.5">
          {INDICATORS.map((d) => (
            <label key={d.key} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-panel2">
              <input type="checkbox" checked={active.includes(d.key)} onChange={() => toggle(d.key)} className="mt-0.5" />
              <span>
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: d.color }} />
                  {d.label}
                </span>
                <span className="block text-[11px] text-muted">{d.help}</span>
              </span>
            </label>
          ))}
          <p className="px-2 pt-1 text-[10px] text-faint">Индикаторите описват миналото — не са магически buy/sell сигнали.</p>
        </div>
      )}
    </div>
  );
}

export function DrawToolbar({
  tool,
  onTool,
  color,
  onColor,
  onClear,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-line bg-panel p-1">
      {TOOL_INFO.map((t) => (
        <button
          key={t.key}
          title={`${t.label} — ${t.help}`}
          onClick={() => onTool(t.key)}
          className={cx(
            "flex h-8 w-8 items-center justify-center rounded text-base",
            tool === t.key ? "bg-accent text-white" : "text-muted hover:bg-panel3 hover:text-text",
          )}
        >
          {t.icon}
        </button>
      ))}
      <div className="my-1 h-px w-6 bg-line" />
      {DRAW_COLORS.slice(0, 4).map((c) => (
        <button
          key={c}
          onClick={() => onColor(c)}
          title="Цвят"
          className={cx("h-4 w-4 rounded-full border-2", color === c ? "border-white" : "border-transparent")}
          style={{ background: c }}
        />
      ))}
      <button onClick={onClear} title="Изчисти всички рисунки" className="mt-1 flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-panel3 hover:text-down">
        🗑
      </button>
    </div>
  );
}

/** OHLC legend + live indicator values (with beginner explanations). */
export function ChartLegend({
  data,
  hover,
  active,
  beginner,
}: {
  data?: CandlesResponse;
  hover: Candle | null;
  active: string[];
  beginner?: boolean;
}) {
  const c = hover ?? data?.candles[data.candles.length - 1];
  const p = data?.precision ?? 2;
  if (!c) return null;
  const up = c.close >= c.open;
  const rsiDef = INDICATOR_BY_KEY.rsi;
  const rsi = active.includes("rsi") ? lastValue(data, rsiDef) : null;
  return (
    <div className="pointer-events-none flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
      {(["open", "high", "low", "close"] as const).map((k) => (
        <span key={k}>
          <span className="pointer-events-auto text-muted">
            <Term k={k}>{k[0].toUpperCase()}</Term>
          </span>{" "}
          <span className={cx("num", up ? "text-up" : "text-down")}>{fmtPrice(c[k], p)}</span>
        </span>
      ))}
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
          const v = lastValue(data, d);
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
        <span className="text-[#b39ddb]">
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
