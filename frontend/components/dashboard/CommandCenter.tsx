"use client";

/*
 * TRADING COMMAND CENTER (/dashboard): greeting + LEARN/TRADE-aware CTA, next steps, paper account,
 * market overview, watchlist, AI insights, risk, learning progress, recent trades and bots — all from
 * one poll of GET /api/dashboard (20 s). The guided tour (shell) triggers on this route.
 */
import { ArrowRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { greeting, isNewUser, primaryCtas } from "@/components/dashboard/model";
import {
  AccountTiles,
  ActivityCard,
  BotsCard,
  InsightsCard,
  LearningCard,
  MarketOverviewCard,
  NextActions,
  RiskCard,
  WatchlistCard,
} from "@/components/dashboard/sections";
import type { DashboardData } from "@/components/dashboard/types";
import { linkButton } from "@/components/learn/linkButton";
import { ChartSkeleton, ErrorState, PageHeader, PaperBadge, Section, Skeleton } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export const DASHBOARD_KEY = "/dashboard";

export function DashboardSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-busy="true">
      <span className="sr-only">Зареждане…</span>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 !rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-96 max-w-[70vw]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] !rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <ChartSkeleton height={420} className="xl:col-span-8" />
        <ChartSkeleton height={420} className="xl:col-span-4" />
      </div>
    </div>
  );
}

export function CommandCenter() {
  const { data, error, mutate } = useSWR<DashboardData>(DASHBOARD_KEY, fetcher, { refreshInterval: 20_000 });
  const { mode } = useWorkspace();

  if (!data) {
    if (error)
      return (
        <ErrorState
          title="Command Center не се зареди"
          description="Сървърът не отговори. Провери връзката и опитай отново."
          onRetry={() => void mutate()}
        />
      );
    return <DashboardSkeleton />;
  }

  const { primary, secondary } = primaryCtas(mode, data);
  const fresh = isNewUser(data);
  const name = data.user?.display_name ?? "";

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LayoutDashboard}
        title={`${greeting(new Date().getHours())}${name ? `, ${name}` : ""}`}
        badge={<PaperBadge compact />}
        subtitle={
          fresh
            ? "Добре дошъл в TRADING COMMAND CENTER. Започни с първия урок или с първата paper сделка — всичко е с виртуални пари."
            : "TRADING COMMAND CENTER — пазари, paper сметка, риск и прогрес на едно място."
        }
        actions={
          <>
            <Link href={secondary.href} className={linkButton("outline", "md")} title={secondary.hint}>
              {secondary.label}
            </Link>
            <Link href={primary.href} className={linkButton("primary", "md")} title={primary.hint}>
              {primary.label} <ArrowRight size={15} strokeWidth={2.25} aria-hidden />
            </Link>
          </>
        }
      />

      <NextActions actions={data.next_actions} skipHrefs={[primary.href, secondary.href]} />

      <Section
        title="Paper account"
        right={
          <Link href="/trade" className="inline-flex items-center gap-1 text-xs font-medium text-accent2 transition-colors hover:text-text">
            Терминал <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
          </Link>
        }
      >
        <AccountTiles account={data.account} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-12">
        <MarketOverviewCard market={data.market} className="xl:col-span-8" />
        <WatchlistCard total={data.watchlist_total} limit={data.watchlist_limit} className="xl:col-span-4" />
        <InsightsCard insights={data.ai_insights} className="xl:col-span-8" />
        <RiskCard risk={data.risk} className="xl:col-span-4" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <LearningCard learning={data.learning} />
        <ActivityCard trades={data.recent_trades} positions={data.open_positions} backtests={data.strategy_performance ?? []} />
        <BotsCard bots={data.bots} className="md:col-span-2 xl:col-span-1" />
      </div>
    </div>
  );
}
