"use client";

/* Past replay sessions with scores (GET /replay?limit=) + the replay stats (GET /replay/stats). */
import { ArrowRight, BookOpen, History, PlayCircle } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { MODE_META, presetLabel } from "@/components/replay/model";
import { ScoreRing } from "@/components/replay/parts";
import type { ReplayStats, SessionRow } from "@/components/replay/types";
import { Badge, Button, EmptyState, ErrorState, SkeletonText, StatTile } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { TF_LABEL, cx, fmtDate, fmtNum } from "@/lib/format";

export function ReplayStatsCard({ className }: { className?: string }) {
  const { data, error, mutate } = useSWR<ReplayStats>("/replay/stats", fetcher);
  return (
    <section className={cx("card min-w-0", className)} aria-label="Replay статистика">
      <header className="flex min-h-11 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-text">Твоят replay резултат</h2>
      </header>
      <div className="p-4">
        {error ? (
          <ErrorState description="Статистиката не се зареди." onRetry={() => void mutate()} />
        ) : !data ? (
          <SkeletonText lines={4} />
        ) : !data.sessions ? (
          <p className="text-sm leading-relaxed text-muted">Още нямаш replay сесии. Първата оценка се появява след „Finish + AI review“.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <ScoreRing score={data.avg_score} size={76} label="средно" />
              <div className="grid flex-1 grid-cols-2 gap-2">
                <StatTile label="Сесии" value={<span className="num">{data.sessions}</span>} sub={`${data.finished} завършени`} />
                <StatTile
                  label="Най-добър"
                  value={<span className="num">{data.best_score !== null ? Math.round(data.best_score) : "—"}</span>}
                  sub="score / 100"
                />
                <StatTile
                  label="Точност"
                  value={
                    <span className="num">{data.accuracy_pct !== null && data.accuracy_pct !== undefined ? `${fmtNum(data.accuracy_pct, 0)}%` : "—"}</span>
                  }
                  sub={`${data.correct ?? 0} верни / ${data.wrong ?? 0} грешни`}
                />
                <StatTile label="Решения" value={<span className="num">{data.decisions ?? 0}</span>} sub="LONG / SHORT / WAIT" />
              </div>
            </div>
            {data.common_flags.length > 0 && (
              <div>
                <div className="label">Най-честите ти грешки</div>
                <ul className="space-y-1.5">
                  {data.common_flags.slice(0, 4).map((f) => (
                    <li key={f.key} className="flex items-center gap-2 text-xs">
                      <Badge tone={f.severity === "warning" ? "warn" : "info"} className="normal-case tracking-normal">
                        {f.label} ×{f.count}
                      </Badge>
                      {f.href && (
                        <Link href={f.href} className="ml-auto inline-flex items-center gap-1 text-accent2 hover:underline">
                          <BookOpen size={12} aria-hidden />
                          {f.lesson_title ?? "Урок"}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function ReplayHistory({
  onOpen,
  activeId,
  limit = 20,
  className,
}: {
  onOpen: (row: SessionRow) => void;
  activeId?: number | null;
  limit?: number;
  className?: string;
}) {
  const { data, error, mutate, isLoading } = useSWR<{ sessions: SessionRow[] }>(`/replay?limit=${limit}`, fetcher);
  const rows = data?.sessions ?? [];
  return (
    <section className={cx("card min-w-0", className)} aria-label="История на replay сесиите">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <History size={14} className="text-faint" aria-hidden /> История
        </h2>
        {rows.length > 0 && <span className="text-[11px] text-faint">последните {rows.length}</span>}
      </header>
      {error ? (
        <div className="p-4">
          <ErrorState description="Историята не се зареди." onRetry={() => void mutate()} />
        </div>
      ) : isLoading && !data ? (
        <div className="p-4">
          <SkeletonText lines={4} />
        </div>
      ) : !rows.length ? (
        <div className="p-4">
          <EmptyState compact icon={History} title="Още няма сесии" description="Избери период и натисни Start replay." />
        </div>
      ) : (
        <ul className="max-h-[420px] divide-y divide-white/[0.05] overflow-y-auto">
          {rows.map((r) => {
            const finished = r.status !== "active";
            const mode = r.mode ?? "trade";
            return (
              <li key={r.id} className={cx("flex items-center gap-3 px-4 py-2.5", r.id === activeId && "bg-accent/[0.06]")}>
                <ScoreRing score={finished ? (r.score ?? null) : null} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">
                    <span className="truncate">{r.symbol}</span>
                    <span className="text-muted">{TF_LABEL[r.timeframe] ?? r.timeframe}</span>
                    <Badge tone={mode === "predict" ? "violet" : "accent"}>{MODE_META[mode].label}</Badge>
                    {r.preset && <Badge>{presetLabel(r.preset)}</Badge>}
                  </div>
                  <div className="num mt-0.5 truncate text-[11px] text-faint">
                    {fmtDate(r.start_ts)} · {r.decisions ?? 0} решения · {finished ? (r.grade ? `grade ${r.grade}` : "завършена") : "активна"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={finished ? "ghost" : "outline"}
                  onClick={() => onOpen(r)}
                  aria-label={`${finished ? "Преглед" : "Продължи"} на сесия ${r.id} (${r.symbol})`}
                >
                  {finished ? <ArrowRight size={14} aria-hidden /> : <PlayCircle size={14} aria-hidden />}
                  <span className="hidden sm:inline">{finished ? "Преглед" : "Продължи"}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
