"use client";

/*
 * /learn/candlesticks — CANDLESTICK LAB: gallery of 24 patterns (GET /learn/candlesticks) with a detail drawer
 * (five teaching sections, interactive candle, "find it on a real chart") and PRACTICE mode (10 graded rounds).
 * Deep links: ?p=<pattern key> opens a pattern, ?tab=practice opens practice.
 */
import { BookOpen, ChartCandlestick, GraduationCap, LayoutGrid, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { PatternDrawer } from "@/components/labs/candlesticks/PatternDetail";
import { PatternGallery } from "@/components/labs/candlesticks/PatternGallery";
import { PatternPractice } from "@/components/labs/candlesticks/PatternPractice";
import { filterPatterns, neighbourKey, type BiasFilter, type TypeFilter } from "@/components/labs/model";
import type { PatternGallery as GalleryPayload } from "@/components/labs/types";
import { Disclaimer, ErrorState, PageHeader, Skeleton, Tabs } from "@/components/ui";
import { errorReason, fetcher } from "@/lib/api";
import { LearnHint } from "@/lib/workspace";

type Tab = "gallery" | "practice";

const linkCls =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-text transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]";

function GallerySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="card p-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="mt-3 h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export function CandlestickLab() {
  const { data, error, isLoading, mutate } = useSWR<GalleryPayload>("/learn/candlesticks", fetcher, { revalidateOnFocus: false });
  const [tab, setTab] = useState<Tab>("gallery");
  const [type, setType] = useState<TypeFilter>("all");
  const [bias, setBias] = useState<BiasFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  // optional deep link: ?p=hammer / ?tab=practice (read once on mount, like the other pages)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const practice = q.get("tab") === "practice";
    const key = practice ? null : q.get("p");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the deep link
    if (practice) setTab("practice");
    if (key) setOpenKey(key);
  }, []);

  const patterns = useMemo(() => data?.patterns ?? [], [data]);
  const shownKeys = useMemo(() => filterPatterns(patterns, type, bias).map((p) => p.key), [patterns, type, bias]);
  const navKeys = openKey && shownKeys.includes(openKey) ? shownKeys : patterns.map((p) => p.key);
  const open = openKey ? (patterns.find((p) => p.key === openKey) ?? null) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ChartCandlestick}
        title="Candlestick Lab"
        subtitle="24 свещни модела с ясни правила, контекст и практика. Моделът описва какво вече се е случило — не е сигнал сам по себе си."
        actions={
          <>
            <Link href="/learn/candlestick" className={linkCls}>
              <BookOpen size={15} aria-hidden /> Урок: Candlestick
            </Link>
            <Link href="/learn" className={linkCls}>
              <GraduationCap size={15} aria-hidden /> Academy
            </Link>
          </>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          {
            key: "gallery",
            label: (
              <>
                <LayoutGrid size={15} aria-hidden /> Галерия
              </>
            ),
          },
          {
            key: "practice",
            label: (
              <>
                <Target size={15} aria-hidden /> Practice
              </>
            ),
          },
        ]}
      />

      {tab === "gallery" ? (
        <div className="space-y-4">
          <LearnHint title="Как да използваш лабораторията">
            Отвори модел, за да видиш как изглежда, какво означава и какво НЕ означава. Наведи мишката върху свещите — ще видиш Open, High, Low,
            Close, тялото и сенките. После го намери на реална графика и виж какво се е случило след него (история, не прогноза).
          </LearnHint>
          {error && !data ? (
            <ErrorState title="Галерията не се зареди" description={errorReason(error)} onRetry={() => mutate()} />
          ) : isLoading || !data ? (
            <GallerySkeleton />
          ) : (
            <PatternGallery patterns={patterns} type={type} bias={bias} onType={setType} onBias={setBias} activeKey={openKey} onOpen={setOpenKey} />
          )}
          {data && <Disclaimer>{data.disclaimer}</Disclaimer>}
        </div>
      ) : (
        <PatternPractice />
      )}

      <PatternDrawer
        pattern={open}
        onClose={() => setOpenKey(null)}
        onNavigate={setOpenKey}
        prevKey={open ? neighbourKey(navKeys, open.key, -1) : null}
        nextKey={open ? neighbourKey(navKeys, open.key, 1) : null}
        onPractice={() => {
          setOpenKey(null);
          setTab("practice");
        }}
      />
    </div>
  );
}
