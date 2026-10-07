"use client";

/*
 * Academy hero: "Continue" card (path.next), XP / level card and the learning loop
 * LEARN → UNDERSTAND → PRACTICE → REPLAY → BACKTEST → PAPER TRADE → REVIEW → IMPROVE with per-step
 * evidence (✓ when the user has done that step at least once).
 */
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  FlaskConical,
  NotebookPen,
  Rewind,
  Sparkles,
  TrendingUp,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { STATUS_META } from "@/components/learn/LearningPath";
import { XpProgress } from "@/components/learn/LearningDashboard";
import { currentLevel, fmtXp, learningFlow, overallPercent, type FlowKey } from "@/components/learn/model";
import { ProgressRing } from "@/components/learn/ProgressRing";
import type { LearningDashboard, LearningPath, NextStep } from "@/components/learn/types";
import { Badge } from "@/components/ui";
import { cx } from "@/lib/format";

const NEXT_KIND: Record<NextStep["type"], { label: string; icon: LucideIcon }> = {
  lesson: { label: "Урок", icon: BookOpen },
  quiz: { label: "Quiz", icon: Trophy },
  lab: { label: "Практика", icon: FlaskConical },
};

export function ContinueCard({ path, className }: { path: LearningPath; className?: string }) {
  const level = currentLevel(path);
  const next = path.next;
  const kind = next ? NEXT_KIND[next.type] : null;
  const KindIcon = kind?.icon ?? BookOpen;
  const overall = overallPercent(path);
  if (!level) return null;
  const meta = STATUS_META[level.status];
  return (
    <section className={cx("card relative overflow-hidden", className)}>
      <div aria-hidden className="grid-mesh pointer-events-none absolute inset-0 opacity-50" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(59_130_246/0.22),transparent)]"
      />
      <div className="relative flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
        <ProgressRing value={level.percent} size={92} stroke={6} tone={level.status === "completed" ? "up" : "accent"} label={`LEVEL ${level.level}: ${level.percent}%`}>
          <span className="flex flex-col items-center leading-none">
            <span className="text-[10px] font-semibold tracking-[0.14em] text-muted">LEVEL</span>
            <span className="num mt-1 text-[28px] font-semibold text-text">{level.level}</span>
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent2">Continue · продължи оттук</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <h2 className="mt-1.5 text-lg font-semibold leading-snug tracking-[-0.015em] text-text sm:text-xl">
            {level.title} <span className="font-normal text-muted">· {level.title_bg}</span>
          </h2>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{level.goal}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {next ? (
              <Link
                href={next.href}
                className="group inline-flex min-h-10 max-w-full items-center gap-2.5 rounded-lg border border-[#5b95f7]/40 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] py-1.5 pl-2 pr-4 text-sm font-medium text-white shadow-btn transition-colors hover:from-[#4a8cf7] hover:to-[#2f6df0]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
                  <KindIcon size={15} strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 truncate">
                  <span className="text-white/75">{kind?.label}: </span>
                  {next.title}
                </span>
                <ArrowRight size={15} strokeWidth={2} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ) : (
              <span className="text-sm text-muted">Всички нива са завършени.</span>
            )}
            <span className="text-xs text-muted">
              Академия: <span className="num text-text">{overall}%</span> ·{" "}
              <span className="num text-text">
                {path.levels_completed}/{path.levels.length}
              </span>{" "}
              нива
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function XpCard({ dash, className }: { dash: LearningDashboard; className?: string }) {
  return (
    <section className={cx("card flex flex-col justify-between gap-4 p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Опит</div>
          <div className="num mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] text-gold">
            {fmtXp(dash.xp)} <span className="text-sm font-medium text-muted">XP</span>
          </div>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold ring-1 ring-inset ring-gold/25">
          <Sparkles size={18} strokeWidth={1.8} aria-hidden />
        </span>
      </div>
      <XpProgress data={dash} />
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { k: "Нива", v: `${dash.levels_completed ?? 0}/${dash.levels_total ?? 11}` },
          { k: "Quiz-ове", v: `${dash.quizzes_passed}/${dash.quizzes_total ?? 11}` },
          { k: "Уроци", v: `${dash.lessons_completed}` },
        ].map((x) => (
          <div key={x.k} className="glass-inset px-2 py-1.5">
            <div className="num text-sm font-semibold text-text">{x.v}</div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-faint">{x.k}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const FLOW_ICON: Record<FlowKey, LucideIcon> = {
  learn: BookOpen,
  understand: Bot,
  practice: FlaskConical,
  replay: Rewind,
  backtest: TrendingUp,
  paper: Wallet,
  review: NotebookPen,
  improve: Sparkles,
};

/**
 * The 8-step learning loop LEARN → … → IMPROVE. A step shows ✓ once the user has evidence of it
 * (lessons, a passed quiz, a lab, replay, backtest, paper trades, journal); the first missing step is
 * highlighted as the next one. Horizontal stepper with connectors on wide screens, a grid below.
 */
export function LearnFlow({ path, dash, className }: { path: LearningPath; dash?: LearningDashboard; className?: string }) {
  const steps = learningFlow(path, dash);
  return (
    <nav aria-label="Learning loop" className={cx("card px-2 py-2 sm:px-3 sm:py-3", className)}>
      <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4 sm:gap-y-2 xl:grid-cols-8 xl:gap-0">
        {steps.map((s, i) => {
          const Icon = FLOW_ICON[s.key];
          const last = i === steps.length - 1;
          return (
            <li key={s.key} className="relative min-w-0" data-flow-step={s.key} data-done={s.done || undefined}>
              {!last && (
                <span
                  aria-hidden
                  className={cx(
                    "pointer-events-none absolute left-[calc(50%+24px)] right-[calc(-50%+24px)] top-[26px] hidden h-px xl:block",
                    s.done ? "bg-gradient-to-r from-up/60 to-up/25" : "bg-white/[0.09]",
                  )}
                />
              )}
              <Link
                href={s.href}
                aria-current={s.next ? "step" : undefined}
                className={cx(
                  "group flex h-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors sm:flex-col sm:gap-1.5 sm:px-1.5 sm:text-center",
                  s.next ? "bg-accent/[0.08] ring-1 ring-inset ring-accent/25" : "hover:bg-white/[0.04]",
                )}
              >
                <span
                  className={cx(
                    "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-colors",
                    s.done
                      ? "bg-up/10 text-up ring-up/30"
                      : s.next
                        ? "bg-accent/15 text-accent2 ring-accent/40 shadow-[0_0_18px_-4px_rgb(59_130_246/0.7)]"
                        : "bg-surface text-muted ring-white/10 group-hover:text-text",
                  )}
                >
                  {s.done ? <Check size={16} strokeWidth={2.4} aria-hidden /> : <Icon size={16} strokeWidth={1.9} aria-hidden />}
                  {s.done && <span className="sr-only">направено</span>}
                </span>
                <span className="min-w-0 sm:w-full">
                  <span
                    className={cx(
                      "block truncate text-[11px] font-semibold tracking-[0.06em]",
                      s.done ? "text-up" : s.next ? "text-text" : "text-text/80",
                    )}
                  >
                    <span className="num mr-1 text-faint">{i + 1}</span>
                    {s.label}
                  </span>
                  <span className={cx("block truncate text-[11px]", s.next ? "text-accent2" : "text-muted")}>{s.next ? "следваща стъпка" : s.bg}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
