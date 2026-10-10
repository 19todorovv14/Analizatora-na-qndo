"use client";

/*
 * AI COACH — WEEKLY REVIEW (GET /api/ai/coach, v2): summary, findings with evidence + impact + lesson,
 * the pattern checks that ran (found / ok / not enough data), NEXT LESSON and PRACTICE EXERCISE cards,
 * strengths / weaknesses and the discipline score. Falls back to the v1 text when there are no findings.
 * The text "WEEKLY REVIEW" appears exactly once (e2e anchor) — the card title.
 */
import { BookOpen, Brain, CircleCheck, CircleDashed, Dumbbell, GraduationCap, ListChecks, Target, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { checkMeta, orderChecks, scoreTone } from "@/components/analytics/model";
import type { Coach, CoachFinding } from "@/components/analytics/types";
import { linkButton } from "@/components/learn/linkButton";
import { AiText, Badge, Card, Disclaimer, EmptyState, Meter, Notice, SkeletonText, Tooltip } from "@/components/ui";
import { cx, fmtDate } from "@/lib/format";

function FindingItem({ f }: { f: CoachFinding }) {
  const high = f.severity === "high";
  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
      <div className="flex items-start gap-2.5">
        <TriangleAlert size={16} strokeWidth={2} className={cx("mt-0.5 shrink-0", high ? "text-down" : "text-warn")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-semibold text-text">{f.title}</h4>
            {f.count !== null && f.count !== undefined && (
              <span className="num text-[11px] text-faint">
                {f.count}
                {f.sample ? ` от ${f.sample}` : "×"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-text/85">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Доказателство · </span>
            {f.evidence}
          </p>
          {f.impact && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Ефект · </span>
              {f.impact}
            </p>
          )}
          {f.lesson && (
            <Link href={f.lesson.href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent2 hover:text-text">
              <BookOpen size={12} strokeWidth={2.25} aria-hidden /> Урок: {f.lesson.title}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function ChecksGrid({ checks }: { checks: NonNullable<Coach["checks"]> }) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {orderChecks(checks).map((c) => {
        const meta = checkMeta(c.status);
        const Icon = c.status === "found" ? TriangleAlert : c.status === "ok" ? CircleCheck : CircleDashed;
        return (
          <li key={c.key}>
            <Tooltip content={<span className="text-xs leading-relaxed">{c.detail}</span>} className="block" maxWidth={320}>
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs">
                <Icon
                  size={13}
                  strokeWidth={2.25}
                  className={cx("shrink-0", meta.tone === "warn" ? "text-warn" : meta.tone === "up" ? "text-up" : "text-faint")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-text/90">{c.title}</span>
                <span className={cx("shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.05em]", meta.tone === "warn" ? "text-warn" : meta.tone === "up" ? "text-up" : "text-faint")}>
                  {meta.label}
                </span>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function SideCard({ icon: Icon, label, children, tone = "accent" }: { icon: typeof Target; label: string; children: React.ReactNode; tone?: "accent" | "violet" }) {
  return (
    <div className={cx("rounded-xl border p-3.5", tone === "accent" ? "border-accent/25 bg-accent/[0.06]" : "border-violet/25 bg-violet/[0.06]")}>
      <div className={cx("mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]", tone === "accent" ? "text-accent2" : "text-violet")}>
        <Icon size={13} strokeWidth={2.25} aria-hidden /> {label}
      </div>
      {children}
    </div>
  );
}

export function CoachReview({ coach, error, onRetry }: { coach: Coach | undefined; error?: unknown; onRetry?: () => void }) {
  const period = coach ? `${fmtDate(coach.period.from)} – ${fmtDate(coach.period.to)}` : null;
  const findings = coach?.findings ?? [];
  const lesson = coach?.next_lesson ?? null;
  const ex = coach?.practice_exercise ?? null;
  const tone = scoreTone(coach?.discipline_score);
  return (
    <Card
      id="coach"
      title={
        <>
          <Brain size={14} strokeWidth={2} className="text-violet" aria-hidden /> AI COACH — WEEKLY REVIEW
        </>
      }
      right={
        coach && (
          <span className="flex items-center gap-2">
            <span className="num hidden text-[11px] text-muted sm:inline">{period}</span>
            <Badge tone={coach.provider === "offline" ? "neutral" : "violet"}>{coach.provider}</Badge>
          </span>
        )
      }
    >
      {!coach ? (
        error ? (
          <Notice tone="down" title="AI Coach не отговори">
            Опитай отново след малко.{" "}
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-medium text-accent2 hover:text-text">
                Опитай пак
              </button>
            )}
          </Notice>
        ) : (
          <SkeletonText lines={5} />
        )
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4">
            {coach.sample?.note && (
              <p className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-muted">
                <ListChecks size={14} strokeWidth={2} className="mt-px shrink-0 text-faint" aria-hidden />
                <span>
                  <span className="num font-medium text-text">{coach.sample.positions} позиции</span> · {coach.sample.note}
                </span>
              </p>
            )}
            {coach.summary.length > 0 && (
              <ul className="space-y-1.5 text-sm leading-relaxed text-text/90">
                {coach.summary.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent2" aria-hidden />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
            {findings.length ? (
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Находки ({findings.length})</h3>
                <ul className="space-y-2">
                  {findings.map((f) => (
                    <FindingItem key={f.key} f={f} />
                  ))}
                </ul>
              </div>
            ) : coach.version && coach.version >= 2 ? (
              <EmptyState
                compact
                icon={CircleCheck}
                title="Няма засечени проблемни модели"
                description="Провери долу кои проверки са минали и за кои още няма достатъчно сделки."
              />
            ) : (
              <AiText text={coach.text} />
            )}
            {coach.checks && coach.checks.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Какво провери Coach-ът</h3>
                <ChecksGrid checks={coach.checks} />
              </div>
            )}
            {(coach.strengths.length > 0 || coach.weaknesses.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-up">Strengths</h3>
                  <ul className="space-y-1 text-[13px] leading-relaxed text-text/85">
                    {coach.strengths.map((s) => (
                      <li key={s} className="flex gap-1.5">
                        <CircleCheck size={13} strokeWidth={2.25} className="mt-1 shrink-0 text-up" aria-hidden /> <span>{s}</span>
                      </li>
                    ))}
                    {!coach.strengths.length && <li className="text-muted">—</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-down">Weaknesses</h3>
                  <ul className="space-y-1 text-[13px] leading-relaxed text-text/85">
                    {coach.weaknesses.map((s) => (
                      <li key={s} className="flex gap-1.5">
                        <TriangleAlert size={13} strokeWidth={2.25} className="mt-1 shrink-0 text-down" aria-hidden /> <span>{s}</span>
                      </li>
                    ))}
                    {!coach.weaknesses.length && <li className="text-muted">—</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            {lesson ? (
              <SideCard icon={GraduationCap} label="Next lesson">
                <div className="text-sm font-semibold text-text">{lesson.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{lesson.why}</p>
                <Link href={lesson.href} className={linkButton("primary", "sm", "mt-2.5 w-full")}>
                  {lesson.completed ? "Преговори урока" : "Отвори урока"}
                </Link>
              </SideCard>
            ) : (
              coach.next_lessons.length > 0 && (
                <SideCard icon={GraduationCap} label="Next lessons">
                  <ul className="space-y-1.5">
                    {coach.next_lessons.map((l) => (
                      <li key={l.slug}>
                        <Link href={l.href ?? `/learn/${l.slug}`} className="text-sm font-medium text-text hover:text-accent2">
                          {l.title}
                        </Link>
                        <span className="block text-[11px] text-muted">{l.reason}</span>
                      </li>
                    ))}
                  </ul>
                </SideCard>
              )
            )}
            {ex && (
              <SideCard icon={Dumbbell} label="Practice exercise" tone="violet">
                <div className="text-sm font-semibold text-text">{ex.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{ex.description}</p>
                {ex.success_criteria.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {ex.success_criteria.map((c) => (
                      <li key={c} className="flex gap-1.5 text-xs text-text/85">
                        <Target size={12} strokeWidth={2.25} className="mt-0.5 shrink-0 text-violet" aria-hidden /> {c}
                      </li>
                    ))}
                  </ul>
                )}
                <Link href={ex.href} className={linkButton("outline", "sm", "mt-2.5 w-full")}>
                  Започни упражнението
                </Link>
              </SideCard>
            )}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted">Discipline score</span>
                <span className={cx("num text-sm font-semibold", tone === "up" ? "text-up" : tone === "warn" ? "text-warn" : tone === "down" ? "text-down" : "text-text")}>
                  {coach.discipline_score ?? "—"}/100
                </span>
              </div>
              <Meter value={coach.discipline_score ?? 0} tone={tone === "neutral" ? "accent" : tone} className="mt-1.5" />
              <p className="mt-1.5 text-[11px] leading-snug text-faint">Стоп на всяка сделка, риск в правилата, без преместени стопове и revenge trading.</p>
            </div>
          </aside>
          {coach.disclaimer && <Disclaimer className="lg:col-span-2">{coach.disclaimer}</Disclaimer>}
        </div>
      )}
    </Card>
  );
}
