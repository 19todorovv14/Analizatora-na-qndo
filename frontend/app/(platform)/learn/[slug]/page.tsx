"use client";

/*
 * Lesson page /learn/[slug] (also serves the alias routes /learn/leverage-basics and
 * /learn/market-structure-basics — the API accepts both and returns the canonical `slug`).
 * Layout: breadcrumb + title, interactive visual on top, prose in section cards at reading width,
 * key points & common mistakes, a finish card ("Маркирай като завършен" → "+N XP!"), and a sticky
 * progress / next rail (aside on xl, compact bar below the top bar on smaller screens).
 */
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BookOpen,
  Check,
  ChevronRight,
  CircleCheck,
  CirclePlay,
  CircleX,
  Circle,
  GraduationCap,
  Lightbulb,
  Lock,
  Sparkles,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { LessonVisual, visualMeta, type Visual } from "@/components/academy/visuals";
import { LessonText, annotateLesson } from "@/components/learn/LessonText";
import { linkButton } from "@/components/learn/linkButton";
import { ProgressRing } from "@/components/learn/ProgressRing";
import { lessonHref, type LessonDetail, type ModuleDetail } from "@/components/learn/types";
import { Badge, Button, EmptyState, ErrorState, ErrorText, Notice, ProgressBar, Skeleton, SkeletonText } from "@/components/ui";
import { ApiError, errorMessage, fetcher, post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";
import { LearnHint } from "@/lib/workspace";

type Lesson = LessonDetail & { visual: Visual | null };

function aiHref(l: Lesson) {
  const q = `Обясни ми: ${l.title}`;
  return `/ai?mode=teach&topic=${encodeURIComponent(l.slug)}&q=${encodeURIComponent(q)}`;
}

/* ────────────────────────────────────────────── skeleton */

function LessonSkeleton() {
  return (
    <div className="mx-auto max-w-[1180px] space-y-5" aria-busy="true">
      <Skeleton className="h-3 w-64" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3 max-w-xl" />
        <Skeleton className="h-4 w-1/2 max-w-lg" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <div className="card h-[320px] p-4">
            <Skeleton className="h-full w-full" />
          </div>
          <div className="card p-5">
            <SkeletonText lines={6} />
          </div>
        </div>
        <div className="card hidden h-[360px] p-4 xl:block">
          <SkeletonText lines={8} />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────── progress rail */

function ModuleLessons({ module, current }: { module: ModuleDetail | undefined; current: string }) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const ready = !!module;
  useEffect(() => {
    // keep the current lesson visible inside the scrollable list (never scrolls the page)
    const ol = listRef.current;
    const el = ol?.querySelector<HTMLElement>('[aria-current="page"]');
    if (ol && el) ol.scrollTop = Math.max(0, el.offsetTop - ol.offsetTop - ol.clientHeight / 2 + el.clientHeight / 2);
  }, [current, ready]);
  if (!module) return <SkeletonText lines={6} />;
  return (
    <ol ref={listRef} className="-mx-1 max-h-[44vh] space-y-0.5 overflow-y-auto px-1">
      {module.lessons.map((l, i) => {
        const here = l.slug === current;
        return (
          <li key={l.slug}>
            <Link
              href={lessonHref(l.slug, l.href)}
              aria-current={here ? "page" : undefined}
              className={cx(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                here ? "bg-accent/[0.12] text-text ring-1 ring-inset ring-accent/30" : "text-muted hover:bg-white/[0.04] hover:text-text",
              )}
            >
              {l.completed ? (
                <CircleCheck size={14} strokeWidth={2} className="shrink-0 text-up" aria-label="завършен" />
              ) : here ? (
                <CirclePlay size={14} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
              ) : (
                <Circle size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden />
              )}
              <span className="num w-5 shrink-0 text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 truncate">{l.title}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function ProgressAside({ lesson, module }: { lesson: Lesson; module: ModuleDetail | undefined }) {
  const done = module?.lessons_completed ?? 0;
  const total = module?.lessons_total ?? lesson.count;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const nextHref = lesson.next ? (lesson.next_href ?? lessonHref(lesson.next)) : (lesson.quiz_href ?? `/learn/quiz/${lesson.module}`);
  return (
    <div className="space-y-3">
      <section className="card p-4">
        <div className="flex items-center gap-3">
          <ProgressRing value={pct} size={48} stroke={4} tone={pct >= 100 ? "up" : "accent"} label={`${done}/${total} урока`}>
            <span className="num text-[11px] font-semibold text-text">{pct}%</span>
          </ProgressRing>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {typeof lesson.level === "number" ? `LEVEL ${lesson.level}` : "Модул"}
            </div>
            <div className="truncate text-sm font-semibold text-text">{lesson.level_title ?? lesson.module_title}</div>
            <div className="text-xs text-muted">
              Урок <span className="num text-text">{lesson.index}</span> от <span className="num">{lesson.count}</span> · завършени{" "}
              <span className="num text-text">{done}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <ModuleLessons module={module} current={lesson.slug} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3">
          {lesson.prev ? (
            <Link href={lesson.prev_href ?? lessonHref(lesson.prev)} className={linkButton("outline", "sm")}>
              <ArrowLeft size={13} strokeWidth={2} aria-hidden /> Предишен
            </Link>
          ) : (
            <Link href="/learn" className={linkButton("outline", "sm")}>
              <GraduationCap size={13} strokeWidth={2} aria-hidden /> Academy
            </Link>
          )}
          <Link href={nextHref} className={linkButton("primary", "sm")}>
            {lesson.next ? "Следващ" : "Quiz"} <ArrowRight size={13} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </section>

      <Link
        href={aiHref(lesson)}
        className="card group flex items-start gap-3 p-4 transition-colors hover:border-accent/30 hover:bg-accent/[0.05]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent2 ring-1 ring-inset ring-accent/30">
          <Bot size={17} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-text group-hover:text-accent2">Ask the AI Teacher about this</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">Обяснение с прост пример по темата „{lesson.title}“ — без прогнози.</span>
        </span>
      </Link>

      {lesson.quiz_href && (
        <Link href={lesson.quiz_href} className="card group flex items-center gap-3 p-4 transition-colors hover:border-gold/30">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold ring-1 ring-inset ring-gold/25">
            <Trophy size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text">Quiz на нивото</span>
            <span className="block text-xs text-muted">
              {module?.quiz_passed ? (
                <>
                  Взет · <span className="num text-up">{Math.round((module.quiz_score ?? 0) * 100)}%</span>
                </>
              ) : (
                <>{module?.quiz_questions ?? "—"} въпроса · праг 70%</>
              )}
            </span>
          </span>
          <ChevronRight size={15} strokeWidth={2} className="shrink-0 text-faint group-hover:text-text" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** Compact sticky progress bar for < xl (the aside is hidden there). */
function MobileProgressBar({ lesson, module }: { lesson: Lesson; module: ModuleDetail | undefined }) {
  const nextHref = lesson.next ? (lesson.next_href ?? lessonHref(lesson.next)) : (lesson.quiz_href ?? `/learn/quiz/${lesson.module}`);
  const pct = lesson.count ? (lesson.index / lesson.count) * 100 : 0;
  return (
    <div className="glass-strong sticky top-[calc(var(--spacing-topbar)+8px)] z-10 rounded-xl px-3 py-2 xl:hidden">
      <div className="flex items-center gap-3">
        {lesson.prev ? (
          <Link href={lesson.prev_href ?? lessonHref(lesson.prev)} aria-label="Предишен урок" className={linkButton("ghost", "sm", "!px-1.5")}>
            <ArrowLeft size={15} strokeWidth={2} aria-hidden />
          </Link>
        ) : (
          <Link href="/learn" aria-label="Academy" className={linkButton("ghost", "sm", "!px-1.5")}>
            <GraduationCap size={15} strokeWidth={2} aria-hidden />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate text-muted">
              {typeof lesson.level === "number" ? `LEVEL ${lesson.level} · ` : ""}
              {lesson.level_title ?? lesson.module_title}
            </span>
            <span className="num shrink-0 text-text">
              {lesson.index}/{lesson.count}
              {module ? <span className="text-faint"> · ✓{module.lessons_completed}</span> : null}
            </span>
          </div>
          <ProgressBar value={pct} className="mt-1 !h-1" />
        </div>
        <Link href={nextHref} className={linkButton("primary", "sm")}>
          {lesson.next ? "Следващ" : "Quiz"} <ArrowRight size={13} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────── page */

export default function LessonPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, mutate } = useSWR<Lesson>(`/academy/lessons/${slug}`, fetcher);
  const { data: modules, mutate: mutateModules } = useSWR<{ modules: ModuleDetail[] }>("/academy/modules", fetcher, { revalidateOnFocus: false });
  const { mutate: globalMutate } = useSWRConfig();
  const { refresh } = useSession();
  const [gained, setGained] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastSlug, setLastSlug] = useState(slug);

  // reset per-lesson feedback when navigating to another lesson (state is kept across param changes)
  if (lastSlug !== slug) {
    setLastSlug(slug);
    setGained(null);
    setErr(null);
  }

  const blocks = useMemo(
    () => (data ? annotateLesson([data.body, ...data.sections.map((s) => s.body)]) : []),
    [data],
  );

  if (error) {
    if (error instanceof ApiError && error.status === 404)
      return (
        <div className="mx-auto max-w-2xl pt-6">
          <EmptyState
            icon={BookOpen}
            title="Урокът не е намерен"
            description="Възможно е адресът да е променен. Всички уроци са в пътя на обучение."
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
        <ErrorState title="Урокът не се зареди" description={errorMessage(error)} onRetry={() => mutate()} />
      </div>
    );
  }
  if (!data) return <LessonSkeleton />;

  const mod = modules?.modules.find((m) => m.key === data.module);
  const meta = visualMeta(data.visual?.type);
  const VisualIcon = meta.icon;
  const nextHref = data.next ? (data.next_href ?? lessonHref(data.next)) : (data.quiz_href ?? `/learn/quiz/${data.module}`);
  const [bodyBlocks, ...sectionBlocks] = blocks;

  const complete = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ xp_gained: number }>(`/academy/lessons/${data.slug}/complete`);
      setGained(r.xp_gained);
      mutate();
      mutateModules();
      globalMutate("/learn/path");
      globalMutate("/learn/dashboard");
      refresh();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 pb-8">
      {/* breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted">
        <Link href="/learn" className="inline-flex items-center gap-1 hover:text-text">
          <GraduationCap size={13} strokeWidth={2} aria-hidden /> Academy
        </Link>
        <ChevronRight size={12} strokeWidth={2} className="text-faint" aria-hidden />
        <span className="min-w-0 truncate">
          {typeof data.level === "number" ? `LEVEL ${data.level} · ` : ""}
          {data.level_title ?? data.module_title}
        </span>
        <ChevronRight size={12} strokeWidth={2} className="text-faint" aria-hidden />
        <span className="num text-text/80">
          урок {data.index} от {data.count}
        </span>
      </nav>

      {/* title */}
      <header className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-1.5">
          {typeof data.level === "number" && <Badge tone="accent">LEVEL {data.level}</Badge>}
          <Badge tone="gold">
            <Sparkles size={11} strokeWidth={2.2} aria-hidden />+{data.xp} XP
          </Badge>
          {data.completed && (
            <Badge tone="up">
              <Check size={11} strokeWidth={2.6} aria-hidden /> завършен
            </Badge>
          )}
          {!data.module_unlocked && (
            <Badge tone="warn">
              <Lock size={11} strokeWidth={2.2} aria-hidden /> нивото е заключено
            </Badge>
          )}
        </div>
        <h1 className="mt-2.5 text-2xl font-semibold leading-tight tracking-[-0.02em] text-text sm:text-[28px]">{data.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{data.summary}</p>
      </header>

      <MobileProgressBar lesson={data} module={mod} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <article className="min-w-0 space-y-4">
          {!data.module_unlocked && (
            <Notice tone="warn" title="Това ниво още е заключено">
              Можеш да прочетеш урока — когато го маркираш като завършен, нивото се отключва. Иначе го отключва quiz-ът на предишното ниво (≥ 70%).
            </Notice>
          )}

          {data.visual && (
            <section className="card min-w-0 overflow-hidden" aria-label="Интерактивен пример">
              <header className="flex min-h-11 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
                <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-text">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent2">
                    <VisualIcon size={13} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="truncate">{meta.label}</span>
                </h2>
                <span className="hidden text-[11px] text-faint sm:inline">интерактивно · пипни го</span>
              </header>
              <div className="p-3 sm:p-4">
                <LessonVisual visual={data.visual} />
              </div>
            </section>
          )}

          <section className="card px-4 py-4 sm:px-6 sm:py-5">
            <div className="max-w-[72ch]">
              <LessonText blocks={bodyBlocks ?? []} />
            </div>
          </section>

          {data.sections.map((s, i) => (
            <section key={s.heading} className="card px-4 py-4 sm:px-6 sm:py-5">
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent2">
                <span className="num flex h-5 w-5 items-center justify-center rounded-md bg-accent/15 text-[11px]">{i + 1}</span>
                {s.heading}
              </h2>
              <div className="max-w-[72ch]">
                <LessonText blocks={sectionBlocks[i] ?? []} />
              </div>
            </section>
          ))}

          <div className={cx("grid gap-4", data.common_mistakes.length > 0 && "md:grid-cols-2")}>
            {data.key_points.length > 0 && (
              <section className="card p-4 sm:p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-text">
                  <Lightbulb size={15} strokeWidth={2} className="text-up" aria-hidden /> Key points
                </h2>
                <ul className="space-y-2">
                  {data.key_points.map((k) => (
                    <li key={k} className="flex gap-2.5 text-sm leading-relaxed text-text/90">
                      <CircleCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-up" aria-hidden />
                      <span className="min-w-0">{k}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.common_mistakes.length > 0 && (
              <section className="card p-4 sm:p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-text">
                  <CircleX size={15} strokeWidth={2} className="text-down" aria-hidden /> Common mistakes
                </h2>
                <ul className="space-y-2">
                  {data.common_mistakes.map((k) => (
                    <li key={k} className="flex gap-2.5 text-sm leading-relaxed text-text/90">
                      <CircleX size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-down/80" aria-hidden />
                      <span className="min-w-0">{k}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* finish */}
          <section className="card relative overflow-hidden p-4 sm:p-5" aria-label="Край на урока">
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgb(59_130_246/0.16),transparent)]" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Край на урока</div>
                <div className="mt-1 text-[15px] font-semibold text-text">
                  {data.completed ? "Урокът е завършен" : "Разбра ли основната идея?"}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {data.next ? "Маркирай урока и продължи към следващия." : "Това е последният урок от нивото — следва quiz-ът."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={complete} disabled={busy} variant={data.completed ? "outline" : "primary"} type="button">
                  {data.completed ? <CircleCheck size={15} strokeWidth={2} className="text-up" aria-hidden /> : <Check size={15} strokeWidth={2.4} aria-hidden />}
                  {data.completed ? "Завършен" : "Маркирай като завършен"}
                </Button>
                {gained !== null &&
                  (gained > 0 ? (
                    <span role="status" className="num animate-pop-in rounded-md bg-gold/10 px-2 py-1 text-sm font-semibold text-gold ring-1 ring-inset ring-gold/25">
                      +{gained} XP!
                    </span>
                  ) : (
                    <span role="status" className="text-xs text-muted">
                      Вече отбелязан — XP се дава веднъж.
                    </span>
                  ))}
                <Link href={nextHref} className={linkButton(data.completed || gained !== null ? "primary" : "outline")}>
                  {data.next ? "Следващ урок" : "Към quiz-а"} <ArrowRight size={14} strokeWidth={2} aria-hidden />
                </Link>
              </div>
            </div>
            {err && <ErrorText error={err} />}
            <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-xs">
              {data.prev && (
                <Link href={data.prev_href ?? lessonHref(data.prev)} className="inline-flex items-center gap-1 text-muted hover:text-text">
                  <ArrowLeft size={12} strokeWidth={2} aria-hidden /> Предишен урок
                </Link>
              )}
              <Link href={aiHref(data)} className="inline-flex items-center gap-1.5 font-medium text-accent2 hover:text-text xl:hidden">
                <Bot size={13} strokeWidth={2} aria-hidden /> Ask the AI Teacher about this
              </Link>
              <Link href="/learn" className="inline-flex items-center gap-1 text-muted hover:text-text">
                <GraduationCap size={12} strokeWidth={2} aria-hidden /> Learning path
              </Link>
            </div>
          </section>

          <LearnHint title="Как да запомниш повече">
            Опиши идеята с твои думи в една фраза, после я намери на реална графика в Charts. Ако нещо не е ясно — попитай AI Teacher.
          </LearnHint>
        </article>

        <aside className="hidden xl:sticky xl:top-[calc(var(--spacing-topbar)+16px)] xl:block" aria-label="Прогрес в нивото">
          <ProgressAside lesson={data} module={mod} />
        </aside>
      </div>
    </div>
  );
}
