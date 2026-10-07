"use client";

import { Bot, GraduationCap, LayoutDashboard, Route } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { ContinueCard, LearnFlow, XpCard } from "@/components/learn/AcademyHero";
import { DashboardKpis, MistakeCard, RecommendationsCard, RiskDisciplineCard, SkillsCard } from "@/components/learn/LearningDashboard";
import { LearningPathTimeline } from "@/components/learn/LearningPath";
import type { LearningDashboard, LearningPath } from "@/components/learn/types";
import { Badge, ErrorState, PageHeader, Section, Skeleton, SkeletonText } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { LearnHint } from "@/lib/workspace";

function HeroSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <div className="card flex items-center gap-5 p-5">
        <Skeleton className="h-[92px] w-[92px] shrink-0 !rounded-full" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-10 w-64" />
        </div>
      </div>
      <div className="card p-5">
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}

function PathSkeleton() {
  return (
    <div className="space-y-3.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="relative pl-[68px]">
          <Skeleton className="absolute left-1 top-3 h-[46px] w-[46px] !rounded-full" />
          <div className="card space-y-2.5 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LearnPage() {
  const { data: path, error: pathError, mutate: retryPath } = useSWR<LearningPath>("/learn/path", fetcher);
  const { data: dash, error: dashError, mutate: retryDash } = useSWR<LearningDashboard>("/learn/dashboard", fetcher);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Trading Academy"
        icon={GraduationCap}
        subtitle="Път от LEVEL 0 до LEVEL 10: от „какво е свещ“ до цялостен анализ. Всяко ниво има уроци, quiz и практика — всичко с виртуални пари."
        badge={path ? <Badge tone="accent">{path.levels.length} нива · {path.lessons_total} урока</Badge> : undefined}
        actions={
          <Link
            href="/ai?mode=teach"
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
          >
            <Bot size={15} strokeWidth={1.9} className="text-accent2" aria-hidden />
            AI Teacher
          </Link>
        }
      />

      {pathError ? (
        <ErrorState title="Пътят на обучение не се зареди" onRetry={() => retryPath()} />
      ) : !path ? (
        <HeroSkeleton />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <ContinueCard path={path} />
          {dash ? (
            <XpCard dash={dash} />
          ) : (
            <div className="card p-5">
              <SkeletonText lines={4} />
            </div>
          )}
        </div>
      )}

      {path && <LearnFlow path={path} dash={dash} />}

      <LearnHint title="Как да учиш ефективно">
        Прочети урока и пипни интерактивния пример → намери същото на графиката → попитай AI Teacher, ако нещо не е ясно → направи
        quiz-а (грешките идват с обяснения) → упражни в Labs, Replay и Paper Trading. Следващото ниво се отключва с quiz ≥ 70% или
        когато започнеш урок от него.
      </LearnHint>

      <Section
        title={
          <>
            <LayoutDashboard size={13} strokeWidth={2} aria-hidden /> Learning dashboard
          </>
        }
      >
        {dashError ? (
          <ErrorState title="Таблото не се зареди" onRetry={() => retryDash()} />
        ) : !dash ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card space-y-3 px-4 py-3.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <DashboardKpis data={dash} />
        )}
      </Section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section
          title={
            <>
              <Route size={13} strokeWidth={2} aria-hidden /> Learning path · LEVEL 0 → 10
            </>
          }
        >
          {pathError ? null : !path ? <PathSkeleton /> : <LearningPathTimeline path={path} />}
        </Section>

        <div className="space-y-4 xl:pt-[34px]">
          {dash ? (
            <>
              <RecommendationsCard items={dash.recommendations} />
              <SkillsCard data={dash} />
              <RiskDisciplineCard risk={dash.risk_discipline} />
              <MistakeCard mistake={dash.most_common_mistake} />
            </>
          ) : dashError ? null : (
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="card p-4">
                <SkeletonText lines={4} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
