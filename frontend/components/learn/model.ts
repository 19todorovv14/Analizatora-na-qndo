/*
 * Pure helpers for the academy page (no React): the 8-step learning loop with per-step evidence,
 * score tones, overall progress and lesson-list helpers. Unit-tested in components/learn/__tests__.
 */
import type { LearningDashboard, LearningPath, LevelStatus, PathLevel } from "@/components/learn/types";

export type FlowKey = "learn" | "understand" | "practice" | "replay" | "backtest" | "paper" | "review" | "improve";

export type FlowStepDef = { key: FlowKey; label: string; bg: string; href: string };

/** LEARN → UNDERSTAND → PRACTICE → REPLAY → BACKTEST → PAPER TRADE → REVIEW → IMPROVE */
export const FLOW_STEPS: readonly FlowStepDef[] = [
  { key: "learn", label: "LEARN", bg: "Уроци", href: "/learn" },
  { key: "understand", label: "UNDERSTAND", bg: "Quiz + AI Teacher", href: "/ai?mode=teach" },
  { key: "practice", label: "PRACTICE", bg: "Labs", href: "/learn/candlesticks" },
  { key: "replay", label: "REPLAY", bg: "Свещ по свещ", href: "/replay" },
  { key: "backtest", label: "BACKTEST", bg: "Тест на правила", href: "/backtesting" },
  { key: "paper", label: "PAPER TRADE", bg: "Виртуални пари", href: "/trade" },
  { key: "review", label: "REVIEW", bg: "Дневник", href: "/journal" },
  { key: "improve", label: "IMPROVE", bg: "AI coach", href: "/ai?mode=review_trade" },
];

export type FlowStep = FlowStepDef & { done: boolean; next: boolean };

/**
 * Evidence per step (✓ when the user has done it at least once). LEARN links to path.next; IMPROVE is
 * "done" only when every other step is. The first not-done step is marked `next`.
 */
export function learningFlow(path: LearningPath, dash?: LearningDashboard | null): FlowStep[] {
  const labs = path.levels.flatMap((l) => l.labs);
  const attempted = (href: string) => labs.some((l) => l.href === href && l.attempted === true);
  const done: Record<FlowKey, boolean> = {
    learn: path.lessons_completed > 0,
    understand: (dash?.quizzes_passed ?? 0) > 0 || path.levels.some((l) => l.quiz?.passed),
    practice: labs.some((l) => l.attempted === true),
    replay: (dash?.replay_sessions ?? 0) > 0 || attempted("/replay"),
    backtest: attempted("/backtesting"),
    paper: (dash?.paper_trades ?? 0) > 0,
    review: attempted("/journal"),
    improve: false,
  };
  done.improve = (Object.keys(done) as FlowKey[]).filter((k) => k !== "improve").every((k) => done[k]);
  const nextIdx = FLOW_STEPS.findIndex((s) => !done[s.key]);
  return FLOW_STEPS.map((s, i) => ({
    ...s,
    href: s.key === "learn" ? (path.next?.href ?? s.href) : s.href,
    done: done[s.key],
    next: i === nextIdx,
  }));
}

/** "good / ok / weak" for a 0–100 score where higher is better (null → neutral). */
export function scoreTone(v: number | null | undefined): "up" | "warn" | "down" | "neutral" {
  if (v === null || v === undefined || !Number.isFinite(v)) return "neutral";
  return v >= 75 ? "up" : v >= 50 ? "warn" : "down";
}

/** Share of all academy lessons completed, 0–100 (integer). */
export function overallPercent(path: Pick<LearningPath, "lessons_completed" | "lessons_total">): number {
  if (!path.lessons_total) return 0;
  return Math.round(Math.min(1, Math.max(0, path.lessons_completed / path.lessons_total)) * 100);
}

/** The level the "Continue" card talks about: the current level, else the first one. */
export function currentLevel(path: LearningPath): PathLevel | undefined {
  return path.levels.find((l) => l.level === path.current_level) ?? path.levels[0];
}

/** Levels opened by default in the timeline: the current one. */
export function defaultOpenLevels(path: LearningPath): Set<number> {
  return new Set([path.current_level]);
}

/** Toggle one level in a set of open levels (returns a new set). */
export function toggleLevel(open: Set<number>, level: number): Set<number> {
  const s = new Set(open);
  if (s.has(level)) s.delete(level);
  else s.add(level);
  return s;
}

/** Whether the level's quiz is the natural next action (all lessons done and not passed yet). */
export function quizIsNext(level: PathLevel): boolean {
  return !!level.quiz && !level.quiz.passed && level.lessons_total > 0 && level.lessons_completed >= level.lessons_total;
}

/** Colour of the connector between two consecutive timeline nodes. */
export function connectorTone(status: LevelStatus, nextStatus: LevelStatus | null): "done" | "done-to-open" | "idle" {
  if (status !== "completed") return "idle";
  return nextStatus && nextStatus !== "locked" ? "done-to-open" : "done";
}

/** Number with a thousands separator for XP ("1,250"). */
export function fmtXp(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}
