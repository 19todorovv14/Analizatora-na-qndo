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
import { ProgressRing } from "@/components/learn/ProgressRing";
import { XpProgress } from "@/components/learn/LearningDashboard";
import type { LearningDashboard, LearningPath, NextStep } from "@/components/learn/types";
import { Badge } from "@/components/ui";
import { cx } from "@/lib/format";

const NEXT_KIND: Record<NextStep["type"], { label: string; icon: LucideIcon }> = {
  lesson: { label: "Урок", icon: BookOpen },
  quiz: { label: "Quiz", icon: Trophy },
  lab: { label: "Практика", icon: FlaskConical },
};

export function ContinueCard({ path, className }: { path: LearningPath; className?: string }) {
  const level = path.levels.find((l) => l.level === path.current_level) ?? path.levels[0];
  const next = path.next;
  const kind = next ? NEXT_KIND[next.type] : null;
  const KindIcon = kind?.icon ?? BookOpen;
  const total = path.lessons_total || 1;
  const overall = Math.round((path.lessons_completed / total) * 100);
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
            {dash.xp.toLocaleString("en-US")} <span className="text-sm font-medium text-muted">XP</span>
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

type FlowStep = { key: string; label: string; bg: string; icon: LucideIcon; href: string; done: boolean };

function flowSteps(path: LearningPath, dash: LearningDashboard | undefined): FlowStep[] {
  const labs = path.levels.flatMap((l) => l.labs);
  const attempted = (href: string) => labs.some((l) => l.href === href && l.attempted === true);
  const anyLab = labs.some((l) => l.attempted === true);
  const nextHref = path.next?.href ?? "/learn";
  const steps: Omit<FlowStep, "done">[] = [
    { key: "learn", label: "LEARN", bg: "Уроци", icon: BookOpen, href: nextHref },
    { key: "understand", label: "UNDERSTAND", bg: "Quiz + AI Teacher", icon: Bot, href: "/ai?mode=teach" },
    { key: "practice", label: "PRACTICE", bg: "Labs", icon: FlaskConical, href: "/learn/candlesticks" },
    { key: "replay", label: "REPLAY", bg: "Свещ по свещ", icon: Rewind, href: "/replay" },
    { key: "backtest", label: "BACKTEST", bg: "Тест на правила", icon: TrendingUp, href: "/backtesting" },
    { key: "paper", label: "PAPER TRADE", bg: "Виртуални пари", icon: Wallet, href: "/trade" },
    { key: "review", label: "REVIEW", bg: "Дневник", icon: NotebookPen, href: "/journal" },
    { key: "improve", label: "IMPROVE", bg: "AI coach", icon: Sparkles, href: "/ai?mode=review_trade" },
  ];
  const done: Record<string, boolean> = {
    learn: path.lessons_completed > 0,
    understand: (dash?.quizzes_passed ?? 0) > 0,
    practice: anyLab,
    replay: (dash?.replay_sessions ?? 0) > 0 || attempted("/replay"),
    backtest: attempted("/backtesting"),
    paper: (dash?.paper_trades ?? 0) > 0,
    review: attempted("/journal"),
  };
  done.improve = Object.values(done).every(Boolean);
  return steps.map((s) => ({ ...s, done: !!done[s.key] }));
}

/** The 8-step learning loop with ✓ for steps the user has evidence of, and the next one highlighted. */
export function LearnFlow({ path, dash, className }: { path: LearningPath; dash?: LearningDashboard; className?: string }) {
  const steps = flowSteps(path, dash);
  const nextIdx = steps.findIndex((s) => !s.done);
  return (
    <nav aria-label="Learning loop" className={cx("card p-2", className)}>
      <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isNext = i === nextIdx;
          return (
            <li key={s.key} className="relative min-w-0">
              <Link
                href={s.href}
                className={cx(
                  "group flex h-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                  isNext ? "bg-accent/[0.1] ring-1 ring-inset ring-accent/30" : "hover:bg-white/[0.04]",
                )}
              >
                <span
                  className={cx(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                    s.done ? "bg-up/10 text-up ring-up/25" : isNext ? "bg-accent/15 text-accent2 ring-accent/30" : "bg-white/[0.04] text-muted ring-white/10",
                  )}
                >
                  {s.done ? <Check size={15} strokeWidth={2.4} aria-label="направено" /> : <Icon size={15} strokeWidth={1.9} aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className={cx("block truncate text-[11px] font-semibold tracking-[0.06em]", s.done ? "text-up" : isNext ? "text-text" : "text-text/80")}>
                    <span className="num mr-1 text-faint">{i + 1}</span>
                    {s.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted">{isNext ? "следваща стъпка" : s.bg}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
