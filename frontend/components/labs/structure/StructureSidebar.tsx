"use client";

/*
 * Market Structure Lab side column: a short theory card (HH / HL / LH / LL, trend, range, breakout, retest,
 * fakeout — every term with its glossary tooltip) and the user's attempt history (GET /learn/structure/history).
 */
import { BookOpen, History, ListChecks } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { DIFFICULTY_META, scoreTone } from "@/components/labs/model";
import type { StructureHistory } from "@/components/labs/types";
import { Badge, Card, EmptyState, ErrorState, SkeletonText, Term } from "@/components/ui";
import { errorReason, fetcher } from "@/lib/api";
import { cx, fmtDate } from "@/lib/format";

export const HISTORY_KEY = "/learn/structure/history?limit=8";

const SCORE_INK: Record<string, string> = { up: "text-up", warn: "text-warn", down: "text-down", neutral: "text-text" };

function TheoryRow({ term, title, children }: { term: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="text-[13px] font-semibold text-text">
        <Term k={term}>{title}</Term>
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{children}</p>
    </li>
  );
}

export function StructureTheory({ rules }: { rules?: string[] }) {
  return (
    <Card
      title={
        <>
          <BookOpen size={14} className="text-accent2" aria-hidden /> Кратка теория
        </>
      }
      right={
        <Link href="/learn/market-structure-basics" className="text-xs font-medium text-accent2 hover:text-text">
          Урок →
        </Link>
      }
    >
      <ul className="divide-y divide-white/[0.05]">
        <TheoryRow term="hh" title="HH — Higher High">
          Swing high над предходния swing high. Купувачите стигат по-високо от преди.
        </TheoryRow>
        <TheoryRow term="hl" title="HL — Higher Low">
          Swing low над предходното swing low. Продавачите не успяват да свалят цената до старото дъно.
        </TheoryRow>
        <TheoryRow term="lh" title="LH — Lower High">
          Swing high под предходния swing high — покачванията отслабват.
        </TheoryRow>
        <TheoryRow term="ll" title="LL — Lower Low">
          Swing low под предходното swing low — продавачите натискат по-ниско.
        </TheoryRow>
        <TheoryRow term="trend" title="Trend">
          Uptrend = поредица HH + HL. Downtrend = LH + LL. Структурата се чете от swing точките, не от една свещ.
        </TheoryRow>
        <TheoryRow term="range" title="Range">
          Върховете и дъната не образуват ясна поредица — цената се движи между support и resistance.
        </TheoryRow>
        <TheoryRow term="breakout" title="Breakout">
          Първо затваряне отвъд последния потвърден swing high (или под последния swing low).
        </TheoryRow>
        <TheoryRow term="retest" title="Retest">
          След breakout цената се връща до пробитото ниво и затваря от страната на пробива.
        </TheoryRow>
        <TheoryRow term="fakeout" title="Fakeout">
          Пробив, след който до 3 свещи цената затваря обратно от другата страна на нивото.
        </TheoryRow>
      </ul>
      {rules && rules.length > 0 && (
        <details className="group mt-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-text">
            <ListChecks size={13} className="text-accent2" aria-hidden /> Правила на проверката
            <span className="ml-auto text-faint transition-transform group-open:rotate-90">›</span>
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
            {rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}

export function StructureHistoryCard() {
  const { data, error, isLoading, mutate } = useSWR<StructureHistory>(HISTORY_KEY, fetcher, { revalidateOnFocus: false });
  return (
    <Card
      title={
        <>
          <History size={14} className="text-accent2" aria-hidden /> История на опитите
        </>
      }
    >
      {error && !data ? (
        <ErrorState title="Историята не се зареди" description={errorReason(error)} onRetry={() => mutate()} className="py-6" />
      ) : isLoading || !data ? (
        <SkeletonText lines={4} />
      ) : data.count === 0 ? (
        <EmptyState compact icon={History} title="Още няма опити" description="След първата проверка тук ще видиш резултатите си." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Най-добър", v: data.best_score },
              { label: "Среден", v: data.avg_score },
              { label: "Последен", v: data.last_score },
            ].map((s) => (
              <div key={s.label} className="glass-inset rounded-lg px-2 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{s.label}</div>
                <div className={cx("num mt-0.5 text-lg font-semibold", SCORE_INK[scoreTone(s.v)])}>{s.v === null ? "—" : Math.round(s.v)}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
            {(["easy", "medium", "hard"] as const).map((d) => {
              const st = data.by_difficulty[d];
              return (
                <span key={d} className="rounded-md bg-white/[0.04] px-2 py-0.5">
                  {DIFFICULTY_META[d].label}: <span className="num text-text">{st?.count ?? 0}</span>
                  {st?.best_score !== null && st?.best_score !== undefined && (
                    <>
                      {" "}
                      · max <span className="num text-text">{Math.round(st.best_score)}</span>
                    </>
                  )}
                </span>
              );
            })}
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {data.attempts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 text-xs">
                <span className={cx("num w-9 shrink-0 text-right text-sm font-semibold", SCORE_INK[scoreTone(a.score)])}>{Math.round(a.score)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-text">
                    {a.symbol} · {a.timeframe}
                  </div>
                  <div className="text-faint">
                    {fmtDate(a.created_ts)} · {a.marks} етикета
                  </div>
                </div>
                <Badge tone={a.difficulty === "hard" ? "violet" : a.difficulty === "medium" ? "info" : "neutral"}>{DIFFICULTY_META[a.difficulty]?.label ?? a.difficulty}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
