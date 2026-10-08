"use client";

/*
 * Detail of one candlestick pattern: the pattern in context, the interactive candle (S3a CandleAnatomy — hover
 * OHLC, body / upper wick / lower wick highlighting), the five teaching sections WHAT IT LOOKS LIKE / WHAT IT
 * MEANS / WHAT IT DOES NOT MEAN / COMMON MISTAKE / PRACTICE (+ context rule & confirmation) and "Find it on a
 * real chart". PatternDrawer shows it in a wide side drawer with previous / next navigation.
 */
import {
  Ban,
  BookOpen,
  Bot,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lightbulb,
  MapPin,
  MousePointerClick,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { CandleAnatomy } from "@/components/academy/visuals/candle";
import { PatternExamples } from "@/components/labs/candlesticks/PatternExamples";
import { MiniCandles } from "@/components/labs/MiniCandles";
import { BIAS_META, TREND_LABEL, TYPE_META, anatomyFocus, candlePrecision } from "@/components/labs/model";
import type { PatternCard } from "@/components/labs/types";
import { Badge, Button, Disclaimer, Drawer, Term } from "@/components/ui";
import { cx } from "@/lib/format";
import { LearnHint } from "@/lib/workspace";

type Tone = "accent" | "up" | "down" | "warn" | "violet" | "info";

const SECTION_INK: Record<Tone, string> = {
  accent: "bg-accent/15 text-accent2 ring-accent/25",
  up: "bg-up/10 text-up ring-up/20",
  down: "bg-down/10 text-down ring-down/20",
  warn: "bg-warn/10 text-warn ring-warn/20",
  violet: "bg-violet/10 text-violet ring-violet/20",
  info: "bg-info/10 text-info ring-info/20",
};

function TeachSection({
  icon: Icon,
  label,
  title,
  tone = "accent",
  children,
  className,
}: {
  icon: LucideIcon;
  /** the English anchor (WHAT IT LOOKS LIKE …) */
  label: string;
  title: string;
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("glass-inset min-w-0 rounded-xl p-3.5", className)} aria-label={label}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", SECTION_INK[tone])}>
          <Icon size={14} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
          <h3 className="text-[13px] font-semibold leading-tight text-text">{title}</h3>
        </div>
      </div>
      <div className="text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export function PatternDetail({ pattern, onPractice }: { pattern: PatternCard; onPractice?: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // previous / next keep the drawer open (this component remounts per pattern) → start at the top again
  useEffect(() => {
    const scroller = rootRef.current?.closest(".overflow-y-auto");
    if (scroller) scroller.scrollTop = 0;
  }, []);
  const bias = BIAS_META[pattern.bias];
  const items = pattern.candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close })); // synthetic → no time labels
  const lastPattern = pattern.highlight.length ? Math.max(...pattern.highlight) : items.length - 1;
  const aiHref = `/ai?mode=teach&topic=${encodeURIComponent(pattern.lesson ?? "candlestick")}&q=${encodeURIComponent(
    `Обясни модела ${pattern.name}: кога има смисъл и кога не.`,
  )}`;

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={bias.tone}>{bias.label}</Badge>
            <Badge>{TYPE_META[pattern.type].label}</Badge>
            <Badge tone="info">{TREND_LABEL[pattern.requires_trend]}</Badge>
          </div>
          <p className="text-[15px] leading-relaxed text-text">{pattern.short}</p>
          <p className="text-xs text-muted">{pattern.context_text}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {pattern.lesson_href && (
              <Link
                href={pattern.lesson_href}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-text transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
              >
                <BookOpen size={13} aria-hidden /> Урок
              </Link>
            )}
            <Link
              href={aiHref}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-text transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
            >
              <Bot size={13} aria-hidden /> Попитай AI Teacher
            </Link>
          </div>
        </div>
        <div className="glass-inset rounded-xl px-2.5 pb-1.5 pt-2">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            <span>Контекст</span>
            <span className="text-accent2">Модел</span>
          </div>
          <MiniCandles candles={pattern.candles} highlight={pattern.highlight} width={200} height={96} ariaLabel={`${pattern.name} в контекст`} />
        </div>
      </div>

      <section aria-label="Интерактивна свещ" className="glass-inset rounded-xl p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
            <MousePointerClick size={14} className="text-accent2" aria-hidden /> Интерактивна свещ
          </h3>
          <span className="text-[11px] text-faint">
            Наведи върху свещ: <Term k="open">Open</Term> / <Term k="high">High</Term> / <Term k="low">Low</Term> / <Term k="close">Close</Term>,{" "}
            <Term k="body">тяло</Term> и <Term k="wick">сенки</Term>
          </span>
        </div>
        <CandleAnatomy
          key={pattern.key}
          candles={items}
          precision={candlePrecision(items)}
          highlight={anatomyFocus(pattern.key)}
          defaultActive={lastPattern}
          height={230}
          ariaLabel={`${pattern.name}: интерактивни свещи`}
        />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <TeachSection icon={Eye} label="WHAT IT LOOKS LIKE" title="Как изглежда">
          <p>{pattern.looks_like}</p>
          <p className="mt-2 rounded-md bg-black/20 px-2 py-1.5 font-mono text-[11.5px] leading-relaxed text-text/85">{pattern.rule}</p>
        </TeachSection>
        <TeachSection icon={Lightbulb} label="WHAT IT MEANS" title="Какво означава" tone="info">
          {pattern.means}
        </TeachSection>
        <TeachSection icon={Ban} label="WHAT IT DOES NOT MEAN" title="Какво НЕ означава" tone="violet">
          {pattern.does_not_mean}
        </TeachSection>
        <TeachSection icon={TriangleAlert} label="COMMON MISTAKE" title="Честа грешка" tone="warn">
          {pattern.common_mistake}
        </TeachSection>
        <TeachSection icon={MapPin} label="CONTEXT" title="Къде има значение">
          {pattern.context_rule}
        </TeachSection>
        <TeachSection icon={CheckCheck} label="CONFIRMATION" title="Какво да изчакаш" tone="up">
          {pattern.confirmation}
        </TeachSection>
        <TeachSection icon={Target} label="PRACTICE" title="Упражнение" className="md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1">{pattern.practice_hint}</p>
            {onPractice && (
              <Button size="sm" type="button" onClick={onPractice}>
                <Target size={14} aria-hidden /> Practice: 10 рунда
              </Button>
            )}
          </div>
        </TeachSection>
      </div>

      <LearnHint title="Моделът не е сигнал">
        Свещният модел описва какво вече се е случило в един период. Гледай къде се появява (тренд, <Term k="support">support</Term> /{" "}
        <Term k="resistance">resistance</Term>) и изчакай потвърждение — без контекст той е просто форма.
      </LearnHint>

      <section aria-label="Find it on a real chart" className="space-y-2.5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">FIND IT ON A REAL CHART</div>
          <h3 className="text-[13px] font-semibold text-text">Намери го на реална графика</h3>
        </div>
        <PatternExamples pattern={pattern} />
      </section>

      <Disclaimer>{pattern.disclaimer}</Disclaimer>
    </div>
  );
}

export function PatternDrawer({
  pattern,
  onClose,
  onNavigate,
  prevKey,
  nextKey,
  onPractice,
}: {
  pattern: PatternCard | null;
  onClose: () => void;
  onNavigate: (key: string) => void;
  prevKey: string | null;
  nextKey: string | null;
  onPractice?: () => void;
}) {
  return (
    <Drawer
      open={!!pattern}
      onClose={onClose}
      title={pattern ? `${pattern.name} · Candlestick Lab` : "Candlestick Lab"}
      className="!w-[min(860px,96vw)]"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="outline" type="button" disabled={!prevKey} onClick={() => prevKey && onNavigate(prevKey)}>
            <ChevronLeft size={14} aria-hidden /> Предишен
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>
            Затвори
          </Button>
          <Button size="sm" variant="outline" type="button" disabled={!nextKey} onClick={() => nextKey && onNavigate(nextKey)}>
            Следващ <ChevronRight size={14} aria-hidden />
          </Button>
        </div>
      }
    >
      {pattern && <PatternDetail key={pattern.key} pattern={pattern} onPractice={onPractice} />}
    </Drawer>
  );
}
