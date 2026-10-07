"use client";

/*
 * LEARNING DASHBOARD pieces (data: GET /api/learn/dashboard): KPI row, skill bars, risk-discipline
 * meter, most common mistake, strongest/weakest skill and recommendations. Every piece takes the
 * dashboard payload (or a slice of it) so other pages can reuse them.
 */
import {
  ArrowRight,
  Bot,
  BookOpen,
  CircleCheck,
  CirclePlay,
  FlaskConical,
  GraduationCap,
  Rewind,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import type { LearningDashboard, Mistake, Recommendation, RiskDiscipline, Skill, SkillBrief } from "@/components/learn/types";
import { Card, EmptyState, StatTile, Tooltip, type Tone } from "@/components/ui";
import { cx } from "@/lib/format";

/* ───────────────────────────────────────────────────────── helpers */

/** "good / ok / weak" for a 0–100 score where higher is better. */
export function scoreTone(v: number | null | undefined): "up" | "warn" | "down" | "neutral" {
  if (v === null || v === undefined || !Number.isFinite(v)) return "neutral";
  return v >= 75 ? "up" : v >= 50 ? "warn" : "down";
}

const INK: Record<"up" | "warn" | "down" | "neutral", string> = { up: "text-up", warn: "text-warn", down: "text-down", neutral: "text-text" };

const FILL: Record<"up" | "warn" | "down" | "accent" | "neutral", string> = {
  up: "bg-gradient-to-r from-up/70 to-up",
  warn: "bg-gradient-to-r from-warn/70 to-warn",
  down: "bg-gradient-to-r from-down/70 to-down",
  accent: "bg-gradient-to-r from-accent to-accent2",
  neutral: "bg-white/20",
};

/** Thin horizontal bar (0–100) with a rounded data-end. */
function Bar({ value, tone = "accent", className }: { value: number | null; tone?: keyof typeof FILL; className?: string }) {
  const v = value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] shadow-[inset_0_1px_1px_rgb(0_0_0/0.3)]", className)}>
      {v > 0 && <div className={cx("h-full rounded-full transition-[width] duration-700 ease-out-quart", FILL[tone])} style={{ width: `${v}%` }} />}
    </div>
  );
}

/* ──────────────────────────────────────────────────────── KPI row */

export function DashboardKpis({ data, className }: { data: LearningDashboard; className?: string }) {
  const lessonsPct = data.lessons_total ? Math.round((data.lessons_completed / data.lessons_total) * 100) : 0;
  return (
    <div className={cx("grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6", className)}>
      <StatTile
        label="Ниво"
        icon={GraduationCap}
        tone="accent"
        value={<span className="num">LEVEL {data.current_level.level}</span>}
        sub={<span className="line-clamp-1">{data.current_level.title}</span>}
      />
      <StatTile
        label="XP"
        icon={Sparkles}
        tone="gold"
        value={data.xp.toLocaleString("en-US")}
        sub={
          data.xp_progress ? (
            <span>
              XP level <span className="num text-text">{data.xp_level}</span> · още <span className="num">{data.xp_progress.needed}</span>
            </span>
          ) : (
            <span>XP level {data.xp_level}</span>
          )
        }
      />
      <StatTile
        label="Уроци"
        icon={BookOpen}
        value={
          <span>
            {data.lessons_completed}
            <span className="text-base text-faint">/{data.lessons_total}</span>
          </span>
        }
        sub={`${lessonsPct}% от академията`}
      />
      <StatTile
        label="Quiz резултат"
        icon={Trophy}
        tone={data.quiz_avg_score === null ? "neutral" : scoreTone(data.quiz_avg_score) === "up" ? "up" : "warn"}
        value={data.quiz_avg_score === null ? "—" : `${Math.round(data.quiz_avg_score)}%`}
        sub={`${data.quizzes_passed}/${data.quizzes_total ?? 11} quiz-а взети`}
      />
      <StatTile
        label="Replay score"
        icon={Rewind}
        tone={data.replay_score === null ? "neutral" : "info"}
        value={data.replay_score === null ? "—" : `${Math.round(data.replay_score)}/100`}
        sub={data.replay_sessions ? `${data.replay_finished ?? 0}/${data.replay_sessions} завършени сесии` : "Още няма replay сесии"}
      />
      <StatTile
        label="Paper сделки"
        icon={Wallet}
        term="paper_trading"
        value={data.paper_trades}
        sub={data.paper_trades ? "затворени (виртуални)" : "Още няма затворени"}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────── XP level */

export function XpProgress({ data, className }: { data: LearningDashboard; className?: string }) {
  const p = data.xp_progress;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted">
          XP level <span className="num font-semibold text-text">{data.xp_level}</span>
        </span>
        {p && (
          <span className="num text-muted">
            {p.into_level}/{p.next_level_at - p.level_start} XP
          </span>
        )}
      </div>
      <Bar value={p?.percent ?? 0} tone="accent" className="mt-1.5 !h-2" />
      {p && (
        <div className="mt-1.5 text-[11px] text-faint">
          Още <span className="num text-muted">{p.needed} XP</span> до XP level {data.xp_level + 1}. Урок = +10–15 XP, взет quiz = +50 XP.
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────── skills */

function SkillRow({ s, emphasis }: { s: Skill; emphasis: "strong" | "weak" | null }) {
  const tone = emphasis === "strong" ? "up" : emphasis === "weak" ? "warn" : "accent";
  const tip = (
    <div className="space-y-1 text-xs">
      <div className="font-semibold text-text">
        {s.title_bg} · {s.score}/100
      </div>
      <div className="text-muted">{s.basis}</div>
      {s.inputs && (
        <div className="num text-[11px] text-faint">
          уроци {Math.round(s.inputs.lessons_pct)}% · quiz {s.inputs.quiz_pct === null ? "—" : `${Math.round(s.inputs.quiz_pct)}%`}
          {s.inputs.practice_avg !== null && ` · практика ${Math.round(s.inputs.practice_avg)}`}
        </div>
      )}
    </div>
  );
  const row = (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate text-text/90">{s.title_bg}</span>
        {emphasis === "strong" && <TrendingUp size={12} strokeWidth={2.2} className="shrink-0 text-up" aria-label="най-силно" />}
        {emphasis === "weak" && <Target size={12} strokeWidth={2.2} className="shrink-0 text-warn" aria-label="най-слабо" />}
      </div>
      <span className="num text-xs text-muted">{s.score}</span>
      <Bar value={s.score} tone={s.score > 0 ? tone : "neutral"} className="col-span-2" />
    </div>
  );
  return (
    <li>
      <Tooltip content={tip} side="left" className="block" maxWidth={260}>
        {s.href ? (
          <Link href={s.href} className="-mx-1.5 block rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.035]">
            {row}
          </Link>
        ) : (
          <div className="py-1">{row}</div>
        )}
      </Tooltip>
    </li>
  );
}

export function SkillBars({
  skills,
  strongest,
  weakest,
  className,
}: {
  skills: Skill[];
  strongest: SkillBrief | null;
  weakest: SkillBrief | null;
  className?: string;
}) {
  return (
    <ul className={cx("space-y-1.5", className)} aria-label="Умения (0–100)">
      {skills.map((s) => (
        <SkillRow key={s.key} s={s} emphasis={strongest?.key === s.key ? "strong" : weakest?.key === s.key ? "weak" : null} />
      ))}
    </ul>
  );
}

function SkillTile({ label, skill, tone, icon: Icon }: { label: string; skill: SkillBrief | null; tone: Tone; icon: LucideIcon }) {
  const ink = tone === "up" ? "text-up bg-up/10 ring-up/20" : "text-warn bg-warn/10 ring-warn/20";
  return (
    <div className="glass-inset min-w-0 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
        <span className={cx("flex h-5 w-5 items-center justify-center rounded-md ring-1 ring-inset", ink)}>
          <Icon size={11} strokeWidth={2.2} aria-hidden />
        </span>
        {label}
      </div>
      {skill ? (
        <div className="mt-1.5 min-w-0">
          <div className="truncate text-sm font-medium text-text">{skill.title_bg}</div>
          <div className="num text-xs text-muted">{skill.score}/100</div>
        </div>
      ) : (
        <div className="mt-1.5 text-xs text-faint">Завърши уроци и quiz-ове</div>
      )}
    </div>
  );
}

export function SkillsCard({ data, className }: { data: LearningDashboard; className?: string }) {
  return (
    <Card
      className={className}
      title={
        <>
          <Target size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Умения
        </>
      }
      right={<span className="text-[11px] text-faint">0–100</span>}
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <SkillTile label="Най-силно" skill={data.strongest_skill} tone="up" icon={TrendingUp} />
        <SkillTile label="Най-слабо" skill={data.weakest_skill} tone="warn" icon={Target} />
      </div>
      <SkillBars skills={data.skills} strongest={data.strongest_skill} weakest={data.weakest_skill} />
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Оценка = 60% уроци + 40% най-добър quiz; където има практика (labs, replay, paper сделки) тя тежи 40% от резултата.
      </p>
    </Card>
  );
}

/* ───────────────────────────────────────────────── risk discipline */

const RISK_PARTS: { key: keyof RiskDiscipline["components"]; label: (r: RiskDiscipline) => string; term?: string }[] = [
  { key: "with_stop_pct", label: () => "Сделки със stop loss", term: "stoploss" },
  { key: "within_risk_rule_pct", label: (r) => `Риск ≤ ${r.rules?.max_risk_per_trade_pct ?? 1}% на сделка`, term: "risk_per_trade" },
  { key: "no_widened_stops_pct", label: () => "Стопът не е отдалечаван" },
  { key: "rr_ok_pct", label: (r) => `R:R ≥ ${r.rules?.min_reward_risk ?? 1.5}`, term: "rr" },
];

export function RiskDisciplineCard({ risk, className }: { risk: RiskDiscipline; className?: string }) {
  const tone = scoreTone(risk.score);
  const verdict =
    risk.score === null ? null : tone === "up" ? "Стабилна дисциплина" : tone === "warn" ? "Има какво да се подобри" : "Рискът не е под контрол";
  return (
    <Card
      className={className}
      title={
        <>
          <ShieldCheck size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Risk discipline
        </>
      }
      right={risk.trades ? <span className="num text-[11px] text-faint">{risk.trades} позиции</span> : undefined}
    >
      {risk.score === null ? (
        <EmptyState
          compact
          icon={ShieldCheck}
          title="Още няма затворени paper сделки"
          description="Оценката се смята от твоите виртуални сделки: stop loss, риск на сделка, отдалечаване на стопа и R:R."
          action={
            <Link href="/trade" className="inline-flex items-center gap-1 text-xs font-medium text-accent2 hover:text-text">
              Отвори Paper Trading <ArrowRight size={12} strokeWidth={2} aria-hidden />
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className={cx("num text-3xl font-semibold leading-none tracking-[-0.02em]", INK[tone])}>
                {Math.round(risk.score)}
                <span className="text-base text-faint">/100</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                {tone === "up" ? (
                  <CircleCheck size={13} strokeWidth={2} className="text-up" aria-hidden />
                ) : (
                  <TriangleAlert size={13} strokeWidth={2} className={tone === "warn" ? "text-warn" : "text-down"} aria-hidden />
                )}
                {verdict}
              </div>
            </div>
          </div>
          <Bar value={risk.score} tone={tone === "neutral" ? "accent" : tone} className="mt-3 !h-2" />
          <ul className="mt-4 space-y-2.5">
            {RISK_PARTS.map((p) => {
              const v = risk.components[p.key];
              const t = scoreTone(v);
              return (
                <li key={p.key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted">{p.label(risk)}</span>
                    <span className="num text-text">{v === null ? "—" : `${Math.round(v)}%`}</span>
                  </div>
                  <Bar value={v} tone={t === "neutral" ? "neutral" : t} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────── most common mistake */

const SOURCE_LABEL: Record<string, string> = {
  behavior: "от поведението в paper сделките",
  journal: "от бележките в дневника",
  both: "от сделките и дневника",
};

export function MistakeCard({ mistake, className }: { mistake: Mistake | null; className?: string }) {
  return (
    <Card
      className={className}
      title={
        <>
          <TriangleAlert size={14} strokeWidth={2} className="text-warn" aria-hidden /> Най-честа грешка
        </>
      }
    >
      {mistake ? (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-snug text-text">{mistake.title_bg || mistake.title}</div>
              {mistake.title_bg && <div className="text-xs text-faint">{mistake.title}</div>}
            </div>
            <span className="num shrink-0 rounded-md bg-warn/10 px-2 py-0.5 text-sm font-semibold text-warn ring-1 ring-inset ring-warn/25">
              ×{mistake.count}
            </span>
          </div>
          {mistake.source && <p className="mt-1.5 text-xs text-muted">Открита {SOURCE_LABEL[mistake.source] ?? ""}.</p>}
          {mistake.href ? (
            <Link
              href={mistake.href}
              className="mt-3 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 text-sm transition-colors hover:bg-accent/[0.12]"
            >
              <BookOpen size={14} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Урок: <span className="font-medium text-text">{mistake.lesson_title || mistake.lesson}</span>
              </span>
              <ArrowRight size={13} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
            </Link>
          ) : (
            <Link href="/journal" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent2 hover:text-text">
              Виж записите в дневника <ArrowRight size={12} strokeWidth={2} aria-hidden />
            </Link>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-up/10 text-up ring-1 ring-inset ring-up/20">
            <CircleCheck size={16} strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0 text-sm">
            <div className="font-medium text-text">Няма повтаряща се грешка</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Грешките се откриват от затворените paper сделки и тагове в дневника. Колкото повече практикуваш, толкова по-точен е
              анализът.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────── recommendations */

const REC_ICON: Record<string, LucideIcon> = {
  continue: CirclePlay,
  mistake: TriangleAlert,
  risk: ShieldCheck,
  skill: Target,
  lab: FlaskConical,
  teacher: Bot,
  practice: Rewind,
};

export function RecommendationList({ items, className }: { items: Recommendation[]; className?: string }) {
  if (!items.length)
    return <EmptyState compact icon={Sparkles} title="Няма препоръки в момента" description="Продължи по пътя — препоръките се обновяват след всеки урок и quiz." />;
  return (
    <ul className={cx("space-y-1.5", className)}>
      {items.map((r, i) => {
        const Icon = REC_ICON[r.kind ?? ""] ?? Sparkles;
        const first = i === 0;
        return (
          <li key={r.href + i}>
            <Link
              href={r.href}
              className={cx(
                "group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                first ? "border-accent/25 bg-accent/[0.07] hover:bg-accent/[0.11]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]",
              )}
            >
              <span
                className={cx(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                  first ? "bg-accent/15 text-accent2 ring-accent/30" : "bg-white/[0.04] text-muted ring-white/10",
                )}
              >
                <Icon size={14} strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text group-hover:text-accent2">{r.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{r.reason}</span>
              </span>
              <ArrowRight size={14} strokeWidth={2} className="mt-1.5 shrink-0 text-faint group-hover:text-accent2" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function RecommendationsCard({ items, className }: { items: Recommendation[]; className?: string }) {
  return (
    <Card
      className={className}
      title={
        <>
          <Sparkles size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Препоръки за теб
        </>
      }
    >
      <RecommendationList items={items} />
    </Card>
  );
}
