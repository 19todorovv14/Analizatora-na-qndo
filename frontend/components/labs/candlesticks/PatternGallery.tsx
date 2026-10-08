"use client";

/*
 * Candlestick Lab gallery: filter row (type · bias) + grid of pattern cards. Each card shows the pattern in its
 * context as a mini SVG (context candles dimmed, the pattern on an accent band), the bias badge and the short
 * description. Clicking a card opens the detail drawer (PatternDetail).
 */
import { ChevronRight } from "lucide-react";

import { MiniCandles } from "@/components/labs/MiniCandles";
import { BIAS_META, TREND_LABEL, TYPE_META, filterPatterns, type BiasFilter, type TypeFilter } from "@/components/labs/model";
import type { PatternCard } from "@/components/labs/types";
import { Badge, EmptyState, Segmented } from "@/components/ui";
import { cx } from "@/lib/format";

export const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "Всички" },
  { value: "single", label: "1 свещ" },
  { value: "double", label: "2 свещи" },
  { value: "triple", label: "3 свещи" },
];

export const BIAS_OPTIONS: { value: BiasFilter; label: string }[] = [
  { value: "all", label: "Всички" },
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
  { value: "neutral", label: "Neutral" },
  { value: "context-dependent", label: "Контекст" },
];

export function PatternCardButton({ pattern, active, onOpen }: { pattern: PatternCard; active?: boolean; onOpen: (key: string) => void }) {
  const bias = BIAS_META[pattern.bias];
  return (
    <button
      type="button"
      onClick={() => onOpen(pattern.key)}
      data-pattern={pattern.key}
      aria-label={`${pattern.name} — ${bias.label}, ${TYPE_META[pattern.type].label}`}
      className={cx(
        "card group flex min-w-0 flex-col p-0 text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-white/[0.16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active && "border-accent/40 ring-1 ring-inset ring-accent/30",
      )}
    >
      <div className="relative border-b border-white/[0.05] bg-black/15 px-3 pb-1.5 pt-2.5">
        <MiniCandles candles={pattern.candles} highlight={pattern.highlight} ariaLabel={`${pattern.name} в контекст`} />
        <span className="absolute left-2.5 top-2 text-[10px] font-medium uppercase tracking-[0.08em] text-faint">{TREND_LABEL[pattern.requires_trend]}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 pb-3 pt-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-text">{pattern.name}</span>
          <ChevronRight size={15} className="shrink-0 text-faint transition-colors group-hover:text-accent2" aria-hidden />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={bias.tone}>{bias.label}</Badge>
          <Badge>{TYPE_META[pattern.type].label}</Badge>
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted">{pattern.short}</p>
      </div>
    </button>
  );
}

export function PatternGallery({
  patterns,
  type,
  bias,
  onType,
  onBias,
  activeKey,
  onOpen,
}: {
  patterns: PatternCard[];
  type: TypeFilter;
  bias: BiasFilter;
  onType: (t: TypeFilter) => void;
  onBias: (b: BiasFilter) => void;
  activeKey?: string | null;
  onOpen: (key: string) => void;
}) {
  const shown = filterPatterns(patterns, type, bias);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Тип</span>
          <Segmented size="sm" options={TYPE_OPTIONS} value={type} onChange={onType} ariaLabel="Филтър по брой свещи" />
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Посока</span>
          <Segmented size="sm" options={BIAS_OPTIONS} value={bias} onChange={onBias} ariaLabel="Филтър по посока" />
        </div>
        <span className="num ml-auto text-xs text-muted">
          {shown.length} / {patterns.length} модела
        </span>
      </div>
      {shown.length ? (
        <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((p) => (
            <PatternCardButton key={p.key} pattern={p} active={p.key === activeKey} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <EmptyState compact title="Няма модели с тези филтри" description="Смени типа или посоката, за да видиш други модели." />
      )}
    </div>
  );
}
