"use client";

import { ArrowLeft, ArrowRight, BookOpen, CandlestickChart, Check, GraduationCap, RotateCcw, Sparkles, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useReducer } from "react";

import { quizInit, quizReducer, quizScore, validQuestions } from "@/components/ai/model";
import type { Quiz, QuizQuestion } from "@/components/ai/types";
import { Badge, Button, Checklist } from "@/components/ui";
import { cx } from "@/lib/format";
import { lessonHref } from "@/lib/lessons";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function SourceChip({ q }: { q: QuizQuestion }) {
  if (q.source === "chart")
    return (
      <Badge tone="info">
        <CandlestickChart size={11} strokeWidth={2} aria-hidden /> От графиката
      </Badge>
    );
  return (
    <Badge tone="violet">
      <GraduationCap size={11} strokeWidth={2} aria-hidden /> Академия{q.module_title ? ` · ${q.module_title.split("—")[0].trim()}` : ""}
    </Badge>
  );
}

/**
 * Interactive QUIZ ME card: one question at a time — pick an option → it locks, the correct answer and
 * the explanation are revealed; at the end a score (pass at `quiz.pass_score`, default 70%).
 * Scoring is client-side (the API sends answer_index). Remount it (key) for a new quiz.
 */
export function QuizCard({ quiz, onNewQuiz, compact }: { quiz: Quiz; onNewQuiz?: () => void; compact?: boolean }) {
  const questions = validQuestions(quiz.questions);
  const [state, dispatch] = useReducer(quizReducer, questions.length, quizInit);
  const passScore = quiz.pass_score ?? 0.7;
  const score = quizScore(questions, state.answers, passScore);

  if (!questions.length) return <p className="text-sm text-muted">Няма въпроси за този quiz.</p>;

  const dots = (
    <div className="flex items-center gap-1.5" role="group" aria-label="Въпроси">
      {questions.map((q, i) => {
        const a = state.answers[i];
        const tone = a === null ? "bg-white/10" : a === q.answer_index ? "bg-up" : "bg-down";
        const current = !state.finished && i === state.index;
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => dispatch({ type: "goto", index: i })}
            aria-label={`Въпрос ${i + 1}${a === null ? "" : a === q.answer_index ? " — верен" : " — грешен"}`}
            aria-current={current ? "step" : undefined}
            className={cx("h-2 rounded-full transition-all duration-200", tone, current ? "w-6 ring-2 ring-accent/40" : "w-2 hover:opacity-80")}
          />
        );
      })}
    </div>
  );

  if (state.finished) {
    return (
      <div className="space-y-3" aria-live="polite">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
          <span
            className={cx(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
              score.passed ? "bg-up/10 text-up ring-up/25" : "bg-warn/10 text-warn ring-warn/25",
            )}
          >
            <Trophy size={20} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="num text-xl font-semibold text-text">
                {score.correct}/{score.total} · {score.pct}%
              </span>
              {dots}
            </div>
            <div className="mt-0.5 text-xs leading-snug text-muted">
              {score.passed
                ? `Отлично — над прага от ${Math.round(passScore * 100)}%.`
                : `Под прага от ${Math.round(passScore * 100)}% — прегледай обясненията и опитай пак.`}
            </div>
          </div>
        </div>
        <Checklist
          items={questions.map((q, i) => ({
            pass: state.answers[i] === null ? null : state.answers[i] === q.answer_index,
            label: (
              <button type="button" className="text-left hover:text-accent2" onClick={() => dispatch({ type: "goto", index: i })}>
                {q.question}
              </button>
            ),
            detail: `Верен отговор: ${q.options[q.answer_index]}`,
          }))}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => dispatch({ type: "restart" })}>
            <RotateCcw size={13} aria-hidden /> Започни отначало
          </Button>
          {onNewQuiz && (
            <Button size="sm" onClick={onNewQuiz}>
              <Sparkles size={13} aria-hidden /> Нови въпроси
            </Button>
          )}
        </div>
      </div>
    );
  }

  const q = questions[state.index];
  const chosen = state.answers[state.index];
  const revealed = chosen !== null;
  const last = state.index === questions.length - 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Въпрос <span className="num text-text">{state.index + 1}</span>/<span className="num">{questions.length}</span>
          <SourceChip q={q} />
        </div>
        {dots}
      </div>
      <p className={cx("font-medium leading-snug text-text", compact ? "text-[13px]" : "text-[14.5px]")}>{q.question}</p>
      <ul className="space-y-1.5" role="list">
        {q.options.map((opt, i) => {
          const isAnswer = i === q.answer_index;
          const isChosen = i === chosen;
          const look = !revealed ? "idle" : isAnswer ? "right" : isChosen ? "wrong" : "dim";
          return (
            <li key={i}>
              <button
                type="button"
                disabled={revealed}
                aria-pressed={isChosen}
                onClick={() => dispatch({ type: "answer", choice: i })}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] leading-snug transition-[background-color,border-color,color] duration-150",
                  look === "idle" && "border-white/[0.08] bg-white/[0.025] text-text hover:border-accent/40 hover:bg-accent/[0.07]",
                  look === "right" && "border-up/40 bg-up/[0.09] text-text",
                  look === "wrong" && "border-down/40 bg-down/[0.09] text-text",
                  look === "dim" && "border-white/[0.05] bg-transparent text-muted",
                  revealed && "cursor-default",
                )}
              >
                <span
                  className={cx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10.5px] font-semibold ring-1 ring-inset",
                    look === "right"
                      ? "bg-up/20 text-up ring-up/40"
                      : look === "wrong"
                        ? "bg-down/20 text-down ring-down/40"
                        : "bg-white/[0.05] text-muted ring-white/10",
                  )}
                  aria-hidden
                >
                  {look === "right" ? <Check size={11} strokeWidth={3} /> : look === "wrong" ? <X size={11} strokeWidth={3} /> : LETTERS[i]}
                </span>
                <span className="min-w-0">{opt}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {revealed && (
        <div
          role="status"
          className={cx(
            "fade-in rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed",
            chosen === q.answer_index ? "border-up/25 bg-up/[0.06]" : "border-warn/25 bg-warn/[0.06]",
          )}
        >
          <div className={cx("mb-0.5 font-semibold", chosen === q.answer_index ? "text-up" : "text-warn")}>
            {chosen === q.answer_index ? "Вярно." : `Не съвсем — верният отговор е ${LETTERS[q.answer_index]}.`}
          </div>
          <div className="text-muted">{q.explanation}</div>
          {q.lesson && (
            <Link href={lessonHref(q.lesson)} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent2 hover:text-text">
              <BookOpen size={12} aria-hidden /> Урок по темата
            </Link>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" disabled={state.index === 0} onClick={() => dispatch({ type: "prev" })}>
          <ArrowLeft size={13} aria-hidden /> Назад
        </Button>
        <Button size="sm" variant={revealed ? "primary" : "outline"} disabled={!revealed} onClick={() => dispatch({ type: "next" })}>
          {last ? "Виж резултата" : "Следващ въпрос"} <ArrowRight size={13} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
