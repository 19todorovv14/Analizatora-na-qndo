"use client";

import { ArrowUpRight, BookOpen, BrainCircuit, CircleSlash, FlaskConical, Lightbulb, NotebookPen, ShieldAlert, Blocks, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { COACH_DISCLAIMER, type CoachGroup, type CoachResponse } from "@/components/bots/types";
import { Badge, Card, Disclaimer, EmptyState, ErrorState, RegimeBadge, Segmented, Skeleton, SkeletonText } from "@/components/ui";
import { cx, fmtDate, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";

const STEP_ICON: Record<string, typeof BookOpen> = { backtest: FlaskConical, strategy: Blocks, journal: NotebookPen, lesson: BookOpen };

function FunnelRow({ label, value, of, tone, hint }: { label: string; value: number; of: number; tone: string; hint?: string }) {
  const pct = of > 0 ? (value / of) * 100 : 0;
  return (
    <li className="grid grid-cols-[minmax(0,148px)_minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <span className="min-w-0">
        <span className="block truncate font-medium text-text/90">{label}</span>
        {hint && <span className="block truncate text-[10.5px] text-faint">{hint}</span>}
      </span>
      <span className="h-2.5 min-w-0 overflow-hidden rounded-full bg-white/[0.05]">
        <span className={cx("block h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${Math.max(pct, value ? 1.5 : 0)}%` }} />
      </span>
      <span className="num w-20 text-right">
        <b className="text-sm font-semibold text-text">{value}</b>
        <span className="ml-1 text-[10.5px] text-faint">{of > 0 ? `${pct.toFixed(0)}%` : ""}</span>
      </span>
    </li>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="glass-inset min-w-0 px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className={cx("num mt-0.5 text-[15px] font-semibold", tone ?? "text-text")}>{value}</div>
    </div>
  );
}

function RegimeCard({ kind, r }: { kind: "worst" | "best"; r: CoachResponse["worst_regime"] }) {
  const worst = kind === "worst";
  const Icon = worst ? TrendingDown : TrendingUp;
  return (
    <div className={cx("min-w-0 rounded-xl border p-3", worst ? "border-down/20 bg-down/[0.04]" : "border-up/20 bg-up/[0.04]")}>
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted">
        <Icon size={13} strokeWidth={2} className={worst ? "text-down" : "text-up"} aria-hidden />
        {worst ? "Най-слаб режим" : "Най-силен режим"}
      </div>
      {r ? (
        <>
          <div className="mt-2">
            <RegimeBadge regime={r.regime} />
          </div>
          <div className="num mt-2 text-xs text-muted">
            {r.trades} сделки · win {fmtPct(r.win_rate, 0)} · <span className={pnlClass(r.average_r)}>{fmtR(r.average_r)}</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-faint">{worst ? "Няма режим с отрицателен среден R (мин. 3 сделки)." : "Няма режим с положителен среден R (мин. 3 сделки)."}</p>
      )}
    </div>
  );
}

const BREAKDOWN_LABEL: Record<string, string> = { regime: "Режим", session: "Сесия", volatility: "Волатилност", side: "Посока" };

function Breakdown({ groups }: { groups: CoachGroup[] }) {
  if (!groups.length) return <p className="text-xs text-faint">Недостатъчно данни за тази разбивка.</p>;
  const maxAbs = Math.max(0.5, ...groups.map((g) => Math.abs(g.average_r ?? 0)));
  return (
    <ul className="space-y-1.5">
      {groups.map((g) => (
        <li key={g.value} className={cx("grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_auto] items-center gap-2 text-xs", !g.enough_trades && "opacity-55")}>
          <span className="min-w-0 truncate text-text/90" title={g.label}>
            {g.label}
          </span>
          <span className="relative h-2 rounded-full bg-white/[0.04]">
            <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" aria-hidden />
            <span
              className={cx("absolute inset-y-0 rounded-full", (g.average_r ?? 0) >= 0 ? "left-1/2 bg-up/70" : "right-1/2 bg-down/70")}
              style={{ width: `${(Math.abs(g.average_r ?? 0) / maxAbs) * 50}%` }}
            />
          </span>
          <span className="num whitespace-nowrap text-right text-muted">
            {g.trades} tr · <span className={pnlClass(g.average_r)}>{fmtR(g.average_r)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CoachSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-5 w-2/3" />
      <div className="space-y-2.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
      <SkeletonText lines={4} />
    </div>
  );
}

/**
 * BOT AI COACH (GET /bots/{id}/coach): setups funnel (generated → all conditions met → rejected → trades),
 * top blockers, main losing context, worst / best regime, breakdowns, insights, next steps and the disclaimer.
 */
export function BotCoach({ data, error, onRetry, advanced }: { data?: CoachResponse; error?: unknown; onRetry?: () => void; advanced: boolean }) {
  const [tab, setTab] = useState<"regime" | "session" | "volatility" | "side">("regime");

  let body: React.ReactNode;
  if (error && !data) body = <ErrorState title="BOT AI COACH не се зареди" onRetry={onRetry} />;
  else if (!data) body = <CoachSkeleton />;
  else if (data.source === "unavailable")
    body = <EmptyState compact icon={CircleSlash} title="Няма данни за анализ" description={data.source_label || "Ботът още не е обработил свещи и историята не е налична."} />;
  else {
    const maxBlock = Math.max(1, ...data.top_blockers.map((b) => b.count));
    const breakdowns = data.breakdowns ?? {};
    const tabs = (["regime", "session", "volatility", "side"] as const).filter((k) => (breakdowns[k]?.length ?? 0) > 0);
    const activeTab = tabs.includes(tab) ? tab : tabs[0];
    body = (
      <div className="space-y-5">
        <div>
          <p className="text-[11px] text-faint">{data.source_label}</p>
          <p className="num mt-1 text-[15px] font-semibold leading-snug text-text">{data.headline}</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section aria-label="Setups funnel" className="min-w-0">
            <div className="label">Setups funnel</div>
            <ul className="space-y-2.5">
              <FunnelRow label="Setups generated" hint="тригерът (1-во условие) е изпълнен" value={data.setups_generated} of={data.setups_generated} tone="bg-gradient-to-r from-accent/70 to-accent2" />
              <FunnelRow label="All conditions met" hint="всички условия са изпълнени" value={data.all_conditions_met} of={data.setups_generated} tone="bg-up/75" />
              <FunnelRow label="Rejected" hint="setup без всички условия" value={data.rejected} of={data.setups_generated} tone="bg-down/60" />
              <FunnelRow label="Paper trades" hint="реално отворени (виртуално)" value={data.entries} of={data.setups_generated} tone="bg-violet/70" />
            </ul>
          </section>

          <section aria-label="Top blockers" className="min-w-0">
            <div className="label">Top blockers</div>
            {data.top_blockers.length ? (
              <ul className="space-y-2">
                {data.top_blockers.slice(0, 6).map((b) => (
                  <li key={b.kind + b.label} className="text-xs">
                    <div className="flex items-center gap-2">
                      <Badge tone={b.kind === "filter" ? "warn" : "neutral"}>{b.kind === "filter" ? "filter" : "condition"}</Badge>
                      <span className="num min-w-0 flex-1 truncate text-text/90" title={b.label}>
                        {b.label}
                      </span>
                      <span className="num font-semibold text-text">{b.count}</span>
                    </div>
                    <span className="mt-1 block h-1.5 rounded-full bg-white/[0.04]">
                      <span className={cx("block h-full rounded-full", b.kind === "filter" ? "bg-warn/60" : "bg-white/30")} style={{ width: `${(b.count / maxBlock) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-faint">Няма отхвърлени setups.</p>
            )}
          </section>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Сделки" value={data.trades} />
          <MiniStat label="Win rate" value={fmtPct(data.win_rate, 0)} />
          <MiniStat label="Average R" value={fmtR(data.average_r)} tone={pnlClass(data.average_r)} />
          <MiniStat label="Net P/L (virtual)" value={fmtMoney(data.net_pnl, true)} tone={pnlClass(data.net_pnl)} />
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className={cx("min-w-0 rounded-xl border p-3", data.main_losing_condition ? "border-down/25 bg-down/[0.05]" : "border-white/[0.07] bg-white/[0.02]")}>
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted">
              <ShieldAlert size={13} strokeWidth={2} className="text-down" aria-hidden />
              Main losing condition
            </div>
            {data.main_losing_condition ? (
              <>
                <div className="mt-2 text-[13.5px] font-semibold text-text">{data.main_losing_condition.description}</div>
                <div className="text-[11px] text-faint">{data.main_losing_condition.attribute_label}</div>
                <div className="num mt-2 text-xs text-muted">
                  {data.main_losing_condition.trades} сделки · win {fmtPct(data.main_losing_condition.win_rate, 0)} · среден{" "}
                  <span className="text-down">{fmtR(data.main_losing_condition.average_r)}</span> ·{" "}
                  <span className={pnlClass(data.main_losing_condition.net_pnl)}>{fmtMoney(data.main_losing_condition.net_pnl, true)}</span>
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-faint">Няма ясно изразен губещ контекст (нужни са поне 3 сделки в група и разлика между групите).</p>
            )}
          </div>
          <RegimeCard kind="worst" r={data.worst_regime} />
          <RegimeCard kind="best" r={data.best_regime} />
        </div>

        {advanced && tabs.length > 0 && activeTab && (
          <section aria-label="Разбивки" className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="label !mb-0">Average R по контекст</span>
              <Segmented size="sm" ariaLabel="Разбивка" value={activeTab} onChange={setTab} options={tabs.map((k) => ({ value: k, label: BREAKDOWN_LABEL[k] }))} />
            </div>
            <Breakdown groups={breakdowns[activeTab] ?? []} />
            <p className="mt-1.5 text-[10.5px] text-faint">Бледите редове са с под 3 сделки — твърде малко за изводи.</p>
          </section>
        )}

        {data.insights.length > 0 && (
          <section aria-label="Insights" className="min-w-0">
            <div className="label">Insights</div>
            <ul className="space-y-1.5">
              {data.insights.map((t) => (
                <li key={t} className="flex gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-[12.5px] leading-relaxed text-text/90">
                  <Lightbulb size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-gold" aria-hidden />
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.next_steps.length > 0 && (
          <section aria-label="Следващи стъпки" className="min-w-0">
            <div className="label">Next steps</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.next_steps.map((s) => {
                const Icon = STEP_ICON[s.kind] ?? ArrowUpRight;
                return (
                  <Link
                    key={s.href + s.title}
                    href={s.href}
                    className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-xs text-text/90 transition-colors hover:border-accent/35 hover:bg-accent/[0.06]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/12 text-accent2">
                      <Icon size={14} strokeWidth={2} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">{s.title}</span>
                    <ArrowUpRight size={14} strokeWidth={2} className="shrink-0 text-faint transition-colors group-hover:text-accent2" aria-hidden />
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <Disclaimer>
          <b className="text-text/80">{data.disclaimer || COACH_DISCLAIMER}</b> Коучът описва минало симулирано поведение и предлага хипотези за
          проверка — не прогнозира цени и не дава сигнали за реални сделки.
        </Disclaimer>
      </div>
    );
  }

  return (
    <Card
      title={
        <>
          <BrainCircuit size={15} strokeWidth={2} className="text-violet" aria-hidden />
          BOT AI COACH
        </>
      }
      right={
        data ? (
          <div className="flex items-center gap-2">
            {data.period?.from_ts && (
              <span className="num hidden text-[11px] text-faint sm:inline">
                {fmtDate(data.period.from_ts)} – {fmtDate(data.period.to_ts)} · {data.period.bars_evaluated} свещи
              </span>
            )}
            <Badge tone={data.source === "bot" ? "violet" : "warn"}>{data.source === "bot" ? "bot stats" : data.source === "estimate" ? "оценка" : data.source}</Badge>
          </div>
        ) : undefined
      }
      className="border-violet/20"
    >
      {body}
    </Card>
  );
}
