"use client";

/*
 * LEVEL 0–10 learning path: a vertical timeline of level nodes (percent ring, status colour, lock,
 * lessons count, quiz badge, lab chips). Expanding a level shows its lessons (completed ticks), the
 * level quiz and its practice labs. Data: GET /api/learn/path.
 */
import {
  Activity,
  ArrowRight,
  BookOpen,
  Calculator,
  ChartCandlestick,
  ChartLine,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  CirclePlay,
  Clapperboard,
  FlaskConical,
  Layers,
  ListChecks,
  Lock,
  NotebookPen,
  Scale,
  Sigma,
  Sparkles,
  TrendingDown,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { ProgressRing, type RingTone } from "@/components/learn/ProgressRing";
import type { LearningPath, LevelStatus, NextStep, PathLab, PathLevel, PathQuiz } from "@/components/learn/types";
import { Badge, Notice, type Tone } from "@/components/ui";
import { cx } from "@/lib/format";

export const STATUS_META: Record<LevelStatus, { label: string; tone: Tone; ring: RingTone }> = {
  completed: { label: "Завършено", tone: "up", ring: "up" },
  in_progress: { label: "В процес", tone: "accent", ring: "accent" },
  available: { label: "Отключено", tone: "info", ring: "accent" },
  locked: { label: "Заключено", tone: "neutral", ring: "muted" },
};

const VISUAL_ICON: Record<string, { icon: LucideIcon; label: string }> = {
  candle: { icon: ChartCandlestick, label: "Интерактивна свещ" },
  live_chart: { icon: ChartLine, label: "Графика с demo данни" },
  timeframes: { icon: Layers, label: "Сравнение на timeframes" },
  scenario: { icon: Clapperboard, label: "Анимиран сценарий" },
  indicator: { icon: Activity, label: "Индикатор на графика" },
  leverage: { icon: Scale, label: "Leverage симулатор" },
  risk_calc: { icon: Calculator, label: "Калкулатор на риска" },
  drawdown: { icon: TrendingDown, label: "Drawdown визуализация" },
  expectancy: { icon: Sigma, label: "Expectancy симулация" },
  strategy_flow: { icon: ListChecks, label: "Схема на процеса" },
  reflection: { icon: NotebookPen, label: "Въпроси за размисъл" },
};

function VisualIcon({ type }: { type: string | null }) {
  if (!type) return null;
  const meta = VISUAL_ICON[type] ?? { icon: Sparkles, label: "Интерактивен пример" };
  const Icon = meta.icon;
  return (
    <span title={meta.label} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-faint">
      <Icon size={12} strokeWidth={2} aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** "Quiz 85%" / "Quiz · 9 въпроса" chip. */
export function QuizChip({ quiz, className }: { quiz: PathQuiz; className?: string }) {
  if (quiz.passed)
    return (
      <Badge tone="up" className={className}>
        <Trophy size={11} strokeWidth={2.2} aria-hidden />
        Quiz {quiz.best_pct ?? 0}%
      </Badge>
    );
  if (quiz.attempts > 0)
    return (
      <Badge tone="warn" className={className}>
        Quiz {quiz.best_pct ?? 0}% · опитай пак
      </Badge>
    );
  return (
    <Badge tone="neutral" className={className}>
      Quiz · {quiz.questions} въпроса
    </Badge>
  );
}

function LabChip({ lab, link = false }: { lab: PathLab; link?: boolean }) {
  const inner = (
    <>
      {lab.attempted ? (
        <Check size={11} strokeWidth={2.6} className="text-up" aria-hidden />
      ) : (
        <FlaskConical size={11} strokeWidth={2} className="text-violet" aria-hidden />
      )}
      <span className="truncate">{lab.title}</span>
    </>
  );
  const cls =
    "inline-flex max-w-full items-center gap-1 rounded-md border border-violet/20 bg-violet/[0.06] px-1.5 py-0.5 text-[11px] font-medium leading-4 text-text/85";
  if (!link) return <span className={cls}>{inner}</span>;
  return (
    <Link href={lab.href} className={cx(cls, "transition-colors hover:border-violet/40 hover:bg-violet/[0.12] hover:text-text")}>
      {inner}
    </Link>
  );
}

function NodeRing({ level, current }: { level: PathLevel; current: boolean }) {
  const meta = STATUS_META[level.status];
  return (
    <ProgressRing
      value={level.status === "locked" ? 0 : level.percent}
      size={46}
      stroke={3.5}
      tone={meta.ring}
      label={`LEVEL ${level.level}: ${level.percent}%`}
      className={cx(
        "rounded-full bg-surface shadow-[0_0_0_5px_var(--color-bg)]",
        current && "shadow-[0_0_0_5px_var(--color-bg),0_0_22px_-2px_rgb(59_130_246/0.55)]",
      )}
    >
      {level.status === "completed" ? (
        <Check size={18} strokeWidth={2.6} className="text-up" aria-hidden />
      ) : level.status === "locked" ? (
        <Lock size={15} strokeWidth={2} className="text-faint" aria-hidden />
      ) : (
        <span className={cx("num text-[15px] font-semibold", current ? "text-text" : "text-accent2")}>{level.level}</span>
      )}
    </ProgressRing>
  );
}

function LevelBody({ level, next }: { level: PathLevel; next: NextStep | null }) {
  const quiz = level.quiz;
  const allLessonsDone = level.lessons_total > 0 && level.lessons_completed >= level.lessons_total;
  return (
    <div className="space-y-4 border-t border-white/[0.06] px-3 pb-4 pt-3.5 sm:px-4">
      {level.status === "locked" && (
        <Notice tone="warn" title="Нивото е заключено">
          {level.unlock.text} Можеш да разгледаш уроците — започването на урок отключва нивото.
        </Notice>
      )}
      {level.modules.map((m) => (
        <div key={m.key}>
          {level.modules.length > 1 && <div className="mb-2 text-xs font-semibold text-muted">{m.title}</div>}
          <ol className="grid gap-1 md:grid-cols-2">
            {m.lessons.map((l, i) => {
              const isNext = next?.type === "lesson" && next.slug === l.slug;
              return (
                <li key={l.slug} className="min-w-0">
                  <Link
                    href={l.href}
                    className={cx(
                      "group flex min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                      isNext
                        ? "border-accent/35 bg-accent/[0.08] hover:bg-accent/[0.12]"
                        : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.035]",
                    )}
                  >
                    <span className="mt-0.5 shrink-0">
                      {l.completed ? (
                        <CircleCheck size={16} strokeWidth={2} className="text-up" aria-label="завършен" />
                      ) : isNext ? (
                        <CirclePlay size={16} strokeWidth={2} className="text-accent2" aria-label="следващ" />
                      ) : (
                        <Circle size={16} strokeWidth={1.75} className="text-faint" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="num shrink-0 text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                        <span className={cx("truncate text-sm", l.completed ? "text-text/80" : "text-text")}>{l.title}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{l.summary}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                      <VisualIcon type={l.visual_type} />
                      <span className="num text-[11px] text-faint">+{l.xp}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      ))}

      <div className="grid gap-3 lg:grid-cols-2">
        {quiz && (
          <div className="glass-inset flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span
              className={cx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                quiz.passed ? "bg-up/10 text-up ring-up/25" : "bg-gold/10 text-gold ring-gold/25",
              )}
            >
              <Trophy size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text">{quiz.title}</div>
              <div className="text-xs text-muted">
                {quiz.questions} въпроса · праг 70%
                {quiz.best_pct !== null && (
                  <>
                    {" "}
                    · най-добър <span className={cx("num", quiz.passed ? "text-up" : "text-warn")}>{quiz.best_pct}%</span>
                  </>
                )}
              </div>
            </div>
            <Link
              href={quiz.href}
              className={cx(
                "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
                !quiz.passed && (allLessonsDone || level.status !== "locked")
                  ? "border border-[#5b95f7]/40 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-btn hover:from-[#4a8cf7] hover:to-[#2f6df0]"
                  : "border border-white/10 bg-white/[0.04] text-text hover:border-white/[0.18] hover:bg-white/[0.07]",
              )}
            >
              {quiz.passed ? "Повтори quiz" : quiz.attempts > 0 ? "Опитай отново" : "Направи quiz"}
              <ArrowRight size={13} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        )}
        {level.labs.length > 0 && (
          <div className="glass-inset px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              <FlaskConical size={12} strokeWidth={2} className="text-violet" aria-hidden />
              Практика
            </div>
            <ul className="space-y-1">
              {level.labs.map((lab) => (
                <li key={lab.href}>
                  <Link
                    href={lab.href}
                    className="group flex items-start gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-white/[0.04]"
                  >
                    {lab.attempted ? (
                      <CircleCheck size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-up" aria-label="упражнено" />
                    ) : (
                      <FlaskConical size={15} strokeWidth={1.9} className="mt-0.5 shrink-0 text-violet" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="text-text group-hover:text-accent2">{lab.title}</span>
                      {lab.description && <span className="block truncate text-xs text-muted">{lab.description}</span>}
                    </span>
                    <ArrowRight size={13} strokeWidth={2} className="mt-1 shrink-0 text-faint group-hover:text-accent2" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function LevelItem({
  level,
  current,
  open,
  onToggle,
  next,
  last,
  nextStatus,
}: {
  level: PathLevel;
  current: boolean;
  open: boolean;
  onToggle: () => void;
  next: NextStep | null;
  last: boolean;
  nextStatus: LevelStatus | null;
}) {
  const id = useId();
  const meta = STATUS_META[level.status];
  const locked = level.status === "locked";
  return (
    <li className="relative pl-[60px] sm:pl-[68px]">
      {!last && (
        <span
          aria-hidden
          className={cx(
            "absolute left-[22px] top-[52px] w-[2px] rounded-full sm:left-[26px]",
            "bottom-[-26px]",
            level.status === "completed"
              ? nextStatus && nextStatus !== "locked"
                ? "bg-gradient-to-b from-up/70 to-accent/50"
                : "bg-gradient-to-b from-up/70 to-white/10"
              : "bg-white/[0.08]",
          )}
        />
      )}
      <span className="absolute left-0 top-3 sm:left-1">
        <NodeRing level={level} current={current} />
      </span>
      <section
        className={cx(
          "card overflow-hidden transition-[border-color,box-shadow] duration-200",
          current && "border-accent/30 shadow-[var(--shadow-glass),0_0_0_1px_rgb(59_130_246/0.12)]",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.02] sm:px-4"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cx("num text-[11px] font-semibold tracking-[0.12em]", current ? "text-accent2" : "text-muted")}>
                LEVEL {level.level}
              </span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {current && level.status !== "completed" && (
                <Badge tone="accent" className="!normal-case">
                  ← ти си тук
                </Badge>
              )}
            </span>
            <span className={cx("mt-1 block text-[15px] font-semibold leading-snug tracking-[-0.01em]", locked ? "text-text/70" : "text-text")}>
              {level.title}
              <span className="font-normal text-muted"> · {level.title_bg}</span>
            </span>
            <span className={cx("mt-1 block text-sm leading-relaxed text-muted", !open && "line-clamp-2")}>{level.goal}</span>
            <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-4 text-muted ring-1 ring-inset ring-white/[0.07]">
                <BookOpen size={11} strokeWidth={2} aria-hidden />
                <span className="num text-text/85">
                  {level.lessons_completed}/{level.lessons_total}
                </span>
                урока
              </span>
              {level.quiz && <QuizChip quiz={level.quiz} />}
              {level.labs.map((lab) => (
                <LabChip key={lab.href} lab={lab} />
              ))}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
            <span className={cx("num text-sm font-semibold", level.status === "completed" ? "text-up" : locked ? "text-faint" : "text-text")}>
              {level.percent}%
            </span>
            <ChevronDown
              size={16}
              strokeWidth={2}
              className={cx("text-faint transition-transform duration-200", open && "rotate-180")}
              aria-hidden
            />
          </span>
        </button>
        {open && (
          <div id={id} className="animate-fade-in">
            <LevelBody level={level} next={next} />
          </div>
        )}
      </section>
    </li>
  );
}

/** The vertical LEVEL 0 → 10 timeline. Opens the current level by default; any level can be expanded. */
export function LearningPathTimeline({ path, className }: { path: LearningPath; className?: string }) {
  const [openSet, setOpenSet] = useState<Set<number> | null>(null);
  const open = openSet ?? new Set([path.current_level]);
  const toggle = (lvl: number) => {
    const s = new Set(open);
    if (s.has(lvl)) s.delete(lvl);
    else s.add(lvl);
    setOpenSet(s);
  };
  const allOpen = open.size === path.levels.length;
  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="num text-text">
            {path.levels_completed}/{path.levels.length}
          </span>{" "}
          нива завършени ·{" "}
          <span className="num text-text">
            {path.lessons_completed}/{path.lessons_total}
          </span>{" "}
          урока
        </div>
        <button
          type="button"
          onClick={() => setOpenSet(allOpen ? new Set([path.current_level]) : new Set(path.levels.map((l) => l.level)))}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
        >
          {allOpen ? <ChevronsDownUp size={13} strokeWidth={2} aria-hidden /> : <ChevronsUpDown size={13} strokeWidth={2} aria-hidden />}
          {allOpen ? "Свий всички" : "Разгъни всички"}
        </button>
      </div>
      <ol className="space-y-3.5">
        {path.levels.map((lvl, i) => (
          <LevelItem
            key={lvl.key}
            level={lvl}
            current={lvl.level === path.current_level}
            open={open.has(lvl.level)}
            onToggle={() => toggle(lvl.level)}
            next={path.next}
            last={i === path.levels.length - 1}
            nextStatus={path.levels[i + 1]?.status ?? null}
          />
        ))}
      </ol>
    </div>
  );
}

export { LabChip };
