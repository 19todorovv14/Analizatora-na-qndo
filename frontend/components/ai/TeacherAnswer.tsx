"use client";

import { ArrowRight, BookOpen, ChevronDown, Clock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AnswerLine, NumText } from "@/components/ai/AnswerLine";
import { CompareTable } from "@/components/ai/CompareTable";
import { ExamplesBlock } from "@/components/ai/ExamplesBlock";
import { ACCENT, MODE_ICON, SECTION_ICON, modeIcon } from "@/components/ai/icons";
import { followUpRequest, providerInfo, resultTone, sectionAccent, splitPipeline, teacherHref } from "@/components/ai/model";
import { QuizCard } from "@/components/ai/QuizCard";
import type { AnswerSection, FollowUp, TeacherAnswerData } from "@/components/ai/types";
import { Badge, DataNotAvailable, Disclaimer, Notice, Tooltip } from "@/components/ui";
import { cx, fmtR, fmtTime } from "@/lib/format";

export type TeacherAnswerProps = {
  /** POST /api/teacher/ask response */
  answer: TeacherAnswerData;
  /** Follow-up button handler. Without it follow-ups are links to /ai?mode=… (full teacher page). */
  onFollowUp?: (f: FollowUp) => void;
  /** dense layout for narrow side panels (terminal) */
  compact?: boolean;
  /** disables follow-up buttons while a request runs */
  busy?: boolean;
  /** strategy id forwarded to follow-ups that don't carry one */
  strategyId?: number | null;
  className?: string;
};

/* ───────────────────────────────────────────────────────────── header */

function ProviderBadge({ answer }: { answer: TeacherAnswerData }) {
  const p = providerInfo(answer);
  return (
    <Tooltip content={p.title}>
      <span tabIndex={0} className="inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Badge tone={p.tone}>{p.label}</Badge>
      </span>
    </Tooltip>
  );
}

function StrategyLine({ answer }: { answer: TeacherAnswerData }) {
  const s = answer.strategy;
  if (!s?.name) return null;
  const tone = resultTone(s.result);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
      <span className="font-medium uppercase tracking-[0.06em] text-faint">Стратегия</span>
      <span className="min-w-0 truncate text-text/90" title={s.name}>
        {s.name}
      </span>
      {s.selected === false && <span className="text-faint">(по подразбиране)</span>}
      {s.result && <Badge tone={tone === "neutral" ? "neutral" : tone}>{s.result}</Badge>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── sections */

function PipelineSteps({ lines, compact }: { lines: string[]; compact?: boolean }) {
  const { steps, rest } = splitPipeline(lines);
  return (
    <div className="space-y-2.5">
      {steps.length > 0 && (
        <ol className="relative space-y-1.5 pl-1">
          {steps.map((s, i) => (
            <li key={s.stage} className="relative flex gap-2.5">
              <span className="flex flex-col items-center" aria-hidden>
                <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent2 ring-1 ring-inset ring-accent/30">
                  {i + 1}
                </span>
                {i < steps.length - 1 && <span className="mt-0.5 w-px flex-1 bg-accent/20" />}
              </span>
              <span className={cx("min-w-0 pb-0.5 leading-snug", compact ? "text-[12px]" : "text-[13px]")}>
                <span className="font-semibold text-text">{s.stage}</span>
                <span className="text-muted"> — </span>
                <span className="text-text/85">
                  <NumText text={s.detail} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
        <ul className="space-y-1.5">
          {rest.map((l, i) => (
            <AnswerLine key={i} line={l} dot="bg-accent2" compact={compact} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionBody({
  section,
  answer,
  compact,
  onNewQuiz,
}: {
  section: AnswerSection;
  answer: TeacherAnswerData;
  compact?: boolean;
  onNewQuiz?: () => void;
}) {
  const accent = ACCENT[sectionAccent(section.key)];
  const lines = (
    <ul className="space-y-1.5">
      {section.body.map((l, i) => (
        <AnswerLine key={i} line={l} dot={accent.dot} compact={compact} />
      ))}
    </ul>
  );

  if (section.key === "comparison" && answer.comparison?.rows?.length) return <CompareTable comparison={answer.comparison} />;
  if (section.key === "examples" && answer.examples) return <ExamplesBlock examples={answer.examples} compact={compact} />;
  if (section.key === "why") return <PipelineSteps lines={section.body} compact={compact} />;
  if (section.key === "quiz" && answer.quiz?.questions?.length) {
    return (
      <div className="space-y-3">
        <ul className="space-y-1">
          {section.body.map((l, i) => (
            <AnswerLine key={i} line={l} dot={accent.dot} compact />
          ))}
        </ul>
        <QuizCard key={answer.quiz.questions.map((q) => q.id).join("|") + (answer.session_id ?? "")} quiz={answer.quiz} onNewQuiz={onNewQuiz} compact={compact} />
      </div>
    );
  }
  if (section.key === "lesson" && answer.lesson?.href) {
    return (
      <div className="space-y-2.5">
        {lines}
        <Link
          href={answer.lesson.href}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent2 transition-colors hover:border-accent/50 hover:text-text"
        >
          <BookOpen size={13} aria-hidden /> Целият урок: {answer.lesson.title}
        </Link>
      </div>
    );
  }
  if (section.key === "what_happened" && answer.review) {
    const r = answer.review;
    const sign = r.net_pnl ?? (r.result?.trim().startsWith("-") ? -1 : r.result?.trim().startsWith("+") ? 1 : 0);
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={r.side === "long" ? "up" : "down"}>{r.side}</Badge>
          <span className="text-[12.5px] font-medium text-text">{r.symbol}</span>
          {r.result ? (
            <span className={cx("num text-[12px] font-semibold", sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-text")}>{r.result}</span>
          ) : (
            r.r_multiple != null && <span className={cx("num text-[12px] font-semibold", r.r_multiple >= 0 ? "text-up" : "text-down")}>{fmtR(r.r_multiple)}</span>
          )}
          {r.grade && (
            <span className="ml-auto text-[11px] text-muted">
              Процес: <span className="num font-semibold text-text">{r.grade}</span>
              {r.process_score != null && <span className="num"> · {r.process_score}/100</span>}
            </span>
          )}
        </div>
        {lines}
      </div>
    );
  }
  return lines;
}

function SectionCard({
  section,
  answer,
  compact,
  onNewQuiz,
}: {
  section: AnswerSection;
  answer: TeacherAnswerData;
  compact?: boolean;
  onNewQuiz?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const accent = ACCENT[sectionAccent(section.key)];
  const Icon = SECTION_ICON[section.key] ?? BookOpen;
  const id = `ta-sec-${section.key}`;
  return (
    <section
      data-section={section.key}
      className={cx(
        "relative overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br to-transparent",
        "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:content-['']",
        accent.wash,
        accent.rule,
      )}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={cx("flex w-full items-center gap-2 text-left", compact ? "px-3 pb-1.5 pt-2.5" : "px-3.5 pb-2 pt-3")}
        >
          <span className={cx("flex shrink-0 items-center justify-center rounded-md ring-1 ring-inset", compact ? "h-5 w-5" : "h-6 w-6", accent.chip)}>
            <Icon size={compact ? 11 : 13} strokeWidth={2} aria-hidden />
          </span>
          <span className={cx("min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.1em]", accent.ink)}>{section.title}</span>
          <ChevronDown size={14} className={cx("shrink-0 text-faint transition-transform duration-150", !open && "-rotate-90")} aria-hidden />
        </button>
      </h3>
      {open && (
        <div id={id} className={cx(compact ? "px-3 pb-3" : "px-3.5 pb-3.5")}>
          <SectionBody section={section} answer={answer} compact={compact} onNewQuiz={onNewQuiz} />
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── follow-ups */

function FollowUps({
  items,
  onFollowUp,
  busy,
  strategyId,
}: {
  items: FollowUp[];
  onFollowUp?: (f: FollowUp) => void;
  busy?: boolean;
  strategyId?: number | null;
}) {
  if (!items.length) return null;
  const cls =
    "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1 text-left text-xs font-medium text-text transition-[background-color,border-color] hover:border-accent/40 hover:bg-accent/[0.08] disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Следващи стъпки</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((f, i) => {
          const Icon = modeIcon(f.mode);
          const inner = (
            <>
              <Icon size={13} strokeWidth={1.9} className="shrink-0 text-accent2" aria-hidden />
              <span className="min-w-0">{f.label}</span>
            </>
          );
          return onFollowUp ? (
            <button key={i} type="button" className={cls} disabled={busy} onClick={() => onFollowUp(f)}>
              {inner}
            </button>
          ) : (
            <Link key={i} className={cls} href={teacherHref(followUpRequest(f, { strategyId }))}>
              {inner}
              <ArrowRight size={12} className="text-faint" aria-hidden />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── answer */

/**
 * Renders a teacher answer: header (mode, title, provider OFFLINE / Claude), DATA NOT AVAILABLE and
 * safety notices, the section cards (OBSERVATION / RULES / SCENARIO / INVALIDATION / RISK /
 * ALTERNATIVE SCENARIO with distinct accents + mode extras: quiz, comparison, examples, lesson…),
 * follow-up buttons and the disclaimer.
 */
export function TeacherAnswer({ answer, onFollowUp, compact, busy, strategyId, className }: TeacherAnswerProps) {
  const ModeIcon = MODE_ICON[answer.mode] ?? BookOpen;
  const quizFollow = answer.follow_ups?.find((f) => f.mode === "quiz");
  const onNewQuiz = onFollowUp && quizFollow ? () => onFollowUp(quizFollow) : undefined;
  const rejected = answer.llm_rejected_sections ?? [];
  return (
    <article className={cx("space-y-3", busy && "opacity-60 transition-opacity", className)} aria-label={answer.title} aria-busy={busy || undefined}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent2 ring-1 ring-inset ring-accent/30">
          <ModeIcon size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cx("truncate font-semibold tracking-[-0.01em] text-text", compact ? "text-[13px]" : "text-[15px]")} title={answer.title}>
            {answer.title}
          </h2>
          {answer.generated_ts ? (
            <div className="flex items-center gap-1 text-[11px] text-faint">
              <Clock size={11} aria-hidden /> {fmtTime(answer.generated_ts)}
            </div>
          ) : null}
        </div>
        <ProviderBadge answer={answer} />
      </header>

      <StrategyLine answer={answer} />

      {answer.data_available === false && (
        <DataNotAvailable compact reason={`Няма пазарни данни за ${answer.symbol ?? "инструмента"} — учителят не измисля числа.`} />
      )}
      {answer.safety_note && (
        <Notice tone="warn" title="Safety filter">
          {answer.safety_note}
        </Notice>
      )}
      {answer.fallback && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <ShieldCheck size={13} className="shrink-0 text-faint" aria-hidden /> Външният AI не беше наличен — показан е offline отговорът на engine-а.
        </p>
      )}
      {rejected.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
          Секции с числа, които не съвпадат с данните, са заменени с offline версията ({rejected.join(", ")}).
        </p>
      )}

      <div className="space-y-2">
        {answer.sections.map((s) => (
          <SectionCard key={s.key} section={s} answer={answer} compact={compact} onNewQuiz={onNewQuiz} />
        ))}
      </div>

      <FollowUps items={answer.follow_ups ?? []} onFollowUp={onFollowUp} busy={busy} strategyId={strategyId} />

      <Disclaimer>{answer.disclaimer}</Disclaimer>
    </article>
  );
}
