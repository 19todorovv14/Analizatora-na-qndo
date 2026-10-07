"use client";

/*
 * Level quiz /learn/quiz/[module]. Each question is a `section.card` with native radio inputs
 * (walkthrough anchors: the radios live inside `section.card`, the "Предай" submit button and the
 * result line "… верни"). After submitting: score ring, pass / retry, XP, unlocked level and a
 * per-question review with explanations.
 */
import { ArrowRight, Check, ChevronRight, GraduationCap, ListChecks, RotateCcw, Send, Sparkles, Trophy, Unlock, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { linkButton } from "@/components/learn/linkButton";
import { ProgressRing } from "@/components/learn/ProgressRing";
import { lessonHref, type ModuleDetail, type QuizPayload, type QuizResult } from "@/components/learn/types";
import { Badge, Button, EmptyState, ErrorState, ErrorText, Skeleton, SkeletonText } from "@/components/ui";
import { ApiError, errorMessage, fetcher, post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function QuizSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5" aria-busy="true">
      <Skeleton className="h-3 w-48" />
      <div className="space-y-2.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-3 p-5">
          <Skeleton className="h-4 w-3/4" />
          {[0, 1, 2, 3].map((j) => (
            <Skeleton key={j} className="h-10 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function QuizPage() {
  const { module: moduleKey } = useParams<{ module: string }>();
  const { data, error, mutate } = useSWR<QuizPayload>(`/academy/quiz/${moduleKey}`, fetcher, { revalidateOnFocus: false });
  const { data: modules, mutate: mutateModules } = useSWR<{ modules: ModuleDetail[] }>("/academy/modules", fetcher, { revalidateOnFocus: false });
  const { mutate: globalMutate } = useSWRConfig();
  const { refresh } = useSession();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (error) {
    if (error instanceof ApiError && error.status === 404)
      return (
        <div className="mx-auto max-w-2xl pt-6">
          <EmptyState
            icon={ListChecks}
            title="Няма такъв quiz"
            description="Quiz-овете са в края на всяко ниво от пътя на обучение."
            action={
              <Link href="/learn" className={linkButton("primary")}>
                Към Academy <ArrowRight size={14} strokeWidth={2} aria-hidden />
              </Link>
            }
          />
        </div>
      );
    return (
      <div className="mx-auto max-w-2xl pt-6">
        <ErrorState title="Quiz-ът не се зареди" description={errorMessage(error)} onRetry={() => mutate()} />
      </div>
    );
  }
  if (!data) return <QuizSkeleton />;

  const mod = modules?.modules.find((m) => m.key === data.module);
  const total = data.questions.length;
  const answered = data.questions.filter((q) => answers[q.id] !== undefined).length;
  const passPct = Math.round(data.pass_score * 100);
  const unlocked = result?.unlocked_module ? modules?.modules.find((m) => m.key === result.unlocked_module) : undefined;
  const firstWrong = result?.results.find((r) => !r.correct);
  const resultById = new Map((result?.results ?? []).map((r) => [r.id, r]));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<QuizResult>(`/academy/quiz/${data.module}`, { answers });
      setResult(r);
      mutateModules();
      globalMutate("/learn/path");
      globalMutate("/learn/dashboard");
      refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setResult(null);
    setAnswers({});
    setErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jump = (id: string) => document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <Link href="/learn" className="inline-flex items-center gap-1 hover:text-text">
          <GraduationCap size={13} strokeWidth={2} aria-hidden /> Academy
        </Link>
        <ChevronRight size={12} strokeWidth={2} className="text-faint" aria-hidden />
        <span>{typeof mod?.level === "number" ? `LEVEL ${mod.level}` : "Ниво"}</span>
        <ChevronRight size={12} strokeWidth={2} className="text-faint" aria-hidden />
        <span className="text-text/80">quiz</span>
      </nav>

      <header>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="gold">
            <Trophy size={11} strokeWidth={2.2} aria-hidden /> {total} въпроса
          </Badge>
          <Badge tone="neutral">праг {passPct}%</Badge>
          {mod?.quiz_passed && !result && (
            <Badge tone="up">
              <Check size={11} strokeWidth={2.6} aria-hidden /> вече взет · {Math.round((mod.quiz_score ?? 0) * 100)}%
            </Badge>
          )}
        </div>
        <h1 className="mt-2.5 text-2xl font-semibold leading-tight tracking-[-0.02em] text-text sm:text-[28px]">Quiz: {data.title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Нужни са {passPct}% за отключване на следващото ниво. Всеки отговор идва с обяснение — грешките са част от ученето.
        </p>
      </header>

      {result && (
        <div className="card relative overflow-hidden p-4 sm:p-5" role="status">
          <div
            aria-hidden
            className={cx(
              "pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full",
              result.passed ? "bg-[radial-gradient(closest-side,rgb(34_199_158/0.2),transparent)]" : "bg-[radial-gradient(closest-side,rgb(245_184_74/0.16),transparent)]",
            )}
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            <ProgressRing value={result.score * 100} size={88} stroke={6} tone={result.passed ? "up" : "warn"} label={`Резултат ${Math.round(result.score * 100)}%`}>
              <span className={cx("num text-xl font-semibold", result.passed ? "text-up" : "text-warn")}>{Math.round(result.score * 100)}%</span>
            </ProgressRing>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {result.passed ? <Badge tone="up">Passed</Badge> : <Badge tone="warn">Опитай пак</Badge>}
                {result.xp_gained > 0 && (
                  <Badge tone="gold">
                    <Sparkles size={11} strokeWidth={2.2} aria-hidden />+{result.xp_gained} XP
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 text-lg font-semibold text-text">
                <span className="num">
                  {result.correct}/{result.total}
                </span>{" "}
                верни
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {result.passed
                  ? "Отлично — знанията от нивото са затвърдени."
                  : `Нужни са ${passPct}%. Прегледай обясненията по-долу и опитай отново — въпросите са същите.`}
              </p>
            </div>
          </div>
          {unlocked && (
            <Link
              href={unlocked.lessons[0] ? lessonHref(unlocked.lessons[0].slug, unlocked.lessons[0].href) : "/learn"}
              className="relative mt-4 flex items-center gap-3 rounded-lg border border-up/25 bg-up/[0.07] px-3 py-2.5 text-sm transition-colors hover:bg-up/[0.12]"
            >
              <Unlock size={16} strokeWidth={2} className="shrink-0 text-up" aria-hidden />
              <span className="min-w-0 flex-1">
                Отключено: <span className="font-semibold text-text">{typeof unlocked.level === "number" ? `LEVEL ${unlocked.level} · ` : ""}{unlocked.title.replace(/^Level \d+ — /, "")}</span>
              </span>
              <ArrowRight size={14} strokeWidth={2} className="shrink-0 text-up" aria-hidden />
            </Link>
          )}
          <div className="relative mt-4 flex flex-wrap gap-2">
            {!result.passed && (
              <Button type="button" onClick={retry}>
                <RotateCcw size={14} strokeWidth={2} aria-hidden /> Опитай отново
              </Button>
            )}
            {firstWrong && (
              <Button type="button" variant="outline" onClick={() => jump(firstWrong.id)}>
                <X size={14} strokeWidth={2} aria-hidden /> Към първата грешка
              </Button>
            )}
            <Link href="/learn" className={linkButton(result.passed ? "primary" : "outline")}>
              Learning path <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        </div>
      )}

      {/* sticky question navigator */}
      <div className="glass-strong sticky top-[calc(var(--spacing-topbar)+8px)] z-10 flex items-center gap-3 rounded-xl px-3 py-2">
        <span className="num shrink-0 text-xs text-muted">
          <span className="text-text">{result ? result.correct : answered}</span>/{total} {result ? "✓" : "отговорени"}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {data.questions.map((q, i) => {
            const r = resultById.get(q.id);
            const has = answers[q.id] !== undefined;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => jump(q.id)}
                aria-label={`Въпрос ${i + 1}${r ? (r.correct ? " — вярно" : " — грешно") : has ? " — отговорен" : ""}`}
                className={cx(
                  "num h-6 min-w-6 rounded-md px-1 text-[11px] font-semibold ring-1 ring-inset transition-colors",
                  r
                    ? r.correct
                      ? "bg-up/15 text-up ring-up/30"
                      : "bg-down/15 text-down ring-down/30"
                    : has
                      ? "bg-accent/20 text-accent2 ring-accent/35"
                      : "bg-white/[0.04] text-faint ring-white/10 hover:text-text",
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {data.questions.map((q, i) => {
        const r = resultById.get(q.id);
        return (
          <section key={q.id} id={`q-${q.id}`} className="card scroll-mt-32 p-4 sm:p-5" aria-labelledby={`qt-${q.id}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Въпрос <span className="num text-text">{i + 1}</span>/<span className="num">{total}</span>
              </span>
              {r &&
                (r.correct ? (
                  <Badge tone="up">
                    <Check size={11} strokeWidth={2.6} aria-hidden /> Вярно
                  </Badge>
                ) : (
                  <Badge tone="down">
                    <X size={11} strokeWidth={2.6} aria-hidden /> Грешно
                  </Badge>
                ))}
            </div>
            <p id={`qt-${q.id}`} className="mb-3 text-[15px] font-medium leading-relaxed text-text">
              {q.question}
            </p>
            <div role="radiogroup" aria-labelledby={`qt-${q.id}`} className="space-y-1.5">
              {q.options.map((o, j) => {
                const chosen = answers[q.id] === j;
                const isCorrect = !!r && r.correct_answer === j;
                const isWrongChoice = !!r && chosen && !r.correct;
                return (
                  <label
                    key={j}
                    className={cx(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                      r ? "cursor-default" : "cursor-pointer",
                      isCorrect
                        ? "border-up/45 bg-up/[0.09]"
                        : isWrongChoice
                          ? "border-down/45 bg-down/[0.09]"
                          : chosen
                            ? "border-accent/50 bg-accent/[0.1]"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]",
                    )}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={chosen}
                      disabled={!!result}
                      onChange={() => setAnswers({ ...answers, [q.id]: j })}
                      className="h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-white/25 bg-black/20 transition-colors checked:border-[5px] checked:border-accent checked:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
                    />
                    <span
                      className={cx(
                        "num flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
                        isCorrect ? "bg-up/20 text-up" : isWrongChoice ? "bg-down/20 text-down" : chosen ? "bg-accent/25 text-accent2" : "bg-white/[0.05] text-muted",
                      )}
                      aria-hidden
                    >
                      {LETTERS[j] ?? j + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-text/90">{o}</span>
                    {isCorrect && <Check size={15} strokeWidth={2.4} className="shrink-0 text-up" aria-label="правилен отговор" />}
                    {isWrongChoice && <X size={15} strokeWidth={2.4} className="shrink-0 text-down" aria-label="твоят отговор" />}
                  </label>
                );
              })}
            </div>
            {r && (
              <div
                className={cx(
                  "mt-3 rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
                  r.correct ? "border-up/20 bg-up/[0.05]" : "border-warn/25 bg-warn/[0.06]",
                )}
              >
                <span className={cx("font-semibold", r.correct ? "text-up" : "text-warn")}>{r.correct ? "Вярно. " : "Корекция: "}</span>
                <span className="text-text/90">{r.explanation}</span>
              </div>
            )}
          </section>
        );
      })}

      {err && <ErrorText error={err} />}

      <div className="flex flex-wrap items-center gap-3">
        {!result ? (
          <>
            <Button type="button" size="lg" onClick={submit} disabled={busy || answered < total}>
              <Send size={15} strokeWidth={2} aria-hidden />
              Предай ({answered}/{total})
            </Button>
            <span className="text-xs text-muted">{answered < total ? `Остават ${total - answered} въпроса.` : "Готово — предай отговорите."}</span>
          </>
        ) : (
          <>
            <Button type="button" variant={result.passed ? "outline" : "primary"} onClick={retry}>
              <RotateCcw size={14} strokeWidth={2} aria-hidden /> {result.passed ? "Направи пак" : "Опитай отново"}
            </Button>
            <Link href="/learn" className={linkButton(result.passed ? "primary" : "outline")}>
              Learning path <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </Link>
          </>
        )}
      </div>

      {!result && !modules && <SkeletonText lines={1} className="sr-only" />}
    </div>
  );
}
