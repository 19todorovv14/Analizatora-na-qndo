"use client";

/*
 * TRADING COMMAND CENTER sections (data: GET /api/dashboard). Each card takes its slice of the payload,
 * so the page polls one endpoint. Market lists reuse the S1 components (QuoteList, WatchlistPanel,
 * ClassIcon), learning recommendations reuse S3a (RecommendationList), bots reuse S6 (StatusPill).
 */
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Brain,
  CandlestickChart,
  ChartNoAxesCombined,
  GraduationCap,
  LayoutGrid,
  NotebookPen,
  Rewind,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RiskStatusBadge, RiskStatusSummary } from "@/components/analytics/RiskPanels";
import { exitLabel, fmtPF, marginLevelPct } from "@/components/analytics/model";
import type { RiskStatus } from "@/components/analytics/types";
import { StatusPill } from "@/components/bots/StatusPill";
import {
  MOVER_TABS,
  breadth,
  classState,
  extraActions,
  lessonsPercent,
  moverItems,
  orderInsights,
  xpPercent,
  type MoverTab,
} from "@/components/dashboard/model";
import type { DashAccount, DashBot, DashLearning, Insight, MarketBlock, MarketClass, NextAction, StrategyPerf } from "@/components/dashboard/types";
import { RecommendationList } from "@/components/learn/LearningDashboard";
import { linkButton } from "@/components/learn/linkButton";
import { ClassIcon } from "@/components/market/ClassBadge";
import { QuoteList } from "@/components/market/QuoteList";
import { WatchlistPanel } from "@/components/market/WatchlistPanel";
import {
  Badge,
  Card,
  ChangePill,
  DataNotAvailable,
  EmptyState,
  Meter,
  RegimeBadge,
  Segmented,
  SourceBadge,
  StatTile,
  Term,
  WhyButton,
  pnlTone,
} from "@/components/ui";
import { LearnHint } from "@/lib/workspace";
import { cx, fmtMoney, fmtPct, fmtR, fmtTime, pnlClass } from "@/lib/format";
import type { Position, Trade } from "@/lib/types";
import { lessonHref } from "@/lib/lessons";

const cardLink = "inline-flex items-center gap-1 text-xs font-medium text-accent2 transition-colors hover:text-text";

/* ───────────────────────────────────────────────────── next actions */

const ACTION_ICON: Record<string, LucideIcon> = {
  learn: GraduationCap,
  first_trade: CandlestickChart,
  replay: Rewind,
  journal: NotebookPen,
  risk: ShieldAlert,
};

export function NextActions({ actions, skipHrefs }: { actions?: NextAction[]; skipHrefs: string[] }) {
  const list = extraActions(actions, skipHrefs);
  if (!list.length) return null;
  return (
    <nav aria-label="Следващи стъпки" className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
      {list.map((a) => {
        const Icon = ACTION_ICON[a.key] ?? Sparkles;
        return (
          <Link
            key={a.key + a.href}
            href={a.href}
            className="group flex min-w-0 items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 transition-colors hover:border-accent/30 hover:bg-accent/[0.06]"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent2 ring-1 ring-inset ring-accent/25">
              <Icon size={14} strokeWidth={2} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-sm font-medium text-text group-hover:text-accent2">{a.label}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted">{a.reason}</span>
            </span>
            <ArrowRight size={14} strokeWidth={2} className="mt-1.5 shrink-0 text-faint group-hover:text-accent2" aria-hidden />
          </Link>
        );
      })}
    </nav>
  );
}

/* ────────────────────────────────────────────────── paper account */

export function AccountTiles({ account }: { account: DashAccount }) {
  const ml = marginLevelPct(account.margin_level ?? null, account.margin_level_pct ?? null);
  const used = account.used_margin ?? 0;
  const avail = account.available_margin ?? account.free_margin;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatTile label="Equity" term="equity" value={fmtMoney(account.equity)} sub={`Баланс ${fmtMoney(account.balance)}`} />
      <StatTile label="Day P/L" value={fmtMoney(account.day_pnl, true)} tone={pnlTone(account.day_pnl)} sub="от 00:00 UTC" />
      <StatTile label="Unrealized P/L" term="unrealized" value={fmtMoney(account.unrealized_pnl, true)} tone={pnlTone(account.unrealized_pnl)} sub={`${account.open_positions ?? 0} отворени`} />
      <StatTile label="Realized P/L" term="realized" value={fmtMoney(account.realized_pnl, true)} tone={pnlTone(account.realized_pnl)} sub="затворени сделки" />
      <StatTile label="Free margin" term="freemargin" value={fmtMoney(avail)} sub={`Max DD ${fmtPct(-Math.abs(account.max_drawdown_pct || 0), 2)}`} />
      <StatTile
        label="Used margin"
        term="margin"
        value={fmtMoney(used)}
        sub={ml === null ? "Margin level —" : `Margin level ${fmtPct(ml, 0)}`}
        tone={ml !== null && ml < 200 ? "warn" : "neutral"}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────── market overview */

function ClassTile({ c }: { c: MarketClass }) {
  const state = classState(c);
  const share = breadth(c);
  const top = c.top_mover;
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <ClassIcon cls={c.asset_class} size={22} />
          <span className="truncate text-[13px] font-semibold text-text">{c.label}</span>
        </span>
        {state === "ok" ? <ChangePill value={c.average_change_pct} /> : <SourceBadge source={c.source ?? { status: "unavailable" }} />}
      </div>
      {state === "ok" ? (
        <>
          <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-label={`${c.advancers} нагоре, ${c.decliners} надолу`}>
            {share !== null && (
              <>
                <span className="h-full bg-up/80" style={{ width: `${share}%` }} />
                <span className="h-full bg-down/70" style={{ width: `${100 - share}%` }} />
              </>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
            <span className="num text-muted">
              <span className="text-up">{c.advancers}↑</span> <span className="text-down">{c.decliners}↓</span>
            </span>
            {top && (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium text-text/90">{top.symbol}</span>
                <span className={cx("num shrink-0", pnlClass(top.quote?.change_24h_pct))}>{fmtPct(top.quote?.change_24h_pct, 1, true)}</span>
              </span>
            )}
          </div>
        </>
      ) : state === "warming" ? (
        <p className="mt-2.5 text-[11px] leading-snug text-muted">Данните се зареждат (warm-up)…</p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-muted">
          <span className="font-semibold tracking-[0.06em] text-text/80">DATA NOT AVAILABLE</span>
          <span className="line-clamp-2">{c.reason ?? (state === "plan" ? "Планът на доставчика не позволява класация." : "Няма доставчик за този клас.")}</span>
        </p>
      )}
    </>
  );
  const cls = "block min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5";
  return state === "ok" ? (
    <Link href={c.href} className={cx(cls, "transition-colors hover:border-white/[0.14] hover:bg-white/[0.045]")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function MarketOverviewCard({ market, className }: { market: MarketBlock | null | undefined; className?: string }) {
  const [tab, setTab] = useState<MoverTab>("gainers");
  const items = moverItems(market, tab);
  return (
    <Card
      className={className}
      title={
        <>
          <Activity size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Market overview
        </>
      }
      right={
        <span className="flex items-center gap-3">
          <Link href={market?.heatmap_href ?? "/markets?view=heatmap"} className={cardLink}>
            <LayoutGrid size={12} strokeWidth={2.25} aria-hidden /> Heatmap
          </Link>
          <Link href={market?.markets_href ?? "/markets"} className={cardLink}>
            Markets <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
          </Link>
        </span>
      }
    >
      {!market ? (
        <DataNotAvailable compact reason="Пазарният преглед не е наличен в момента." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {market.classes.map((c) => (
              <ClassTile key={c.asset_class} c={c} />
            ))}
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Top movers · 24h</span>
              <Segmented options={MOVER_TABS.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={setTab} size="sm" ariaLabel="Movers" />
            </div>
            {items.length ? (
              <QuoteList items={items} kind={tab} dense className="-mx-1 rounded-lg" />
            ) : (
              <DataNotAvailable compact reason="Още няма класирани инструменти (данните се зареждат или доставчикът не ги поддържа)." />
            )}
          </div>
          {(market.note || market.coverage) && (
            <p className="text-[11px] leading-relaxed text-faint">
              {market.coverage && (
                <span className="num">
                  {market.coverage.ranked} от {market.coverage.eligible} инструмента класирани.{" "}
                </span>
              )}
              {market.note}
            </p>
          )}
          <LearnHint>Movers показват какво се е движило най-много за 24 часа — това е ориентация, не сигнал за вход.</LearnHint>
        </div>
      )}
    </Card>
  );
}

/* ──────────────────────────────────────────────────────── watchlist */

export function WatchlistCard({ total, limit, className }: { total?: number; limit?: number; className?: string }) {
  return (
    <Card
      className={cx("flex flex-col", className)}
      title="Watchlist"
      right={total !== undefined && <span className="num text-[11px] text-faint">{total > (limit ?? 20) ? `първите ${limit ?? 20} от ${total}` : `${total} инструмента`}</span>}
      bodyClass="p-0 min-h-0 flex-1 h-[26rem] xl:h-auto xl:[contain:size]"
    >
      <WatchlistPanel compact pageSize={limit ?? 20} />
    </Card>
  );
}

/* ──────────────────────────────────────────────────── AI insights */

const INSIGHT_META: Record<string, { icon: LucideIcon; label: string }> = {
  behavior: { icon: Brain, label: "Поведение" },
  market: { icon: CandlestickChart, label: "Пазар" },
  next_step: { icon: GraduationCap, label: "Следваща стъпка" },
};

function InsightRow({ it }: { it: Insight }) {
  const meta = INSIGHT_META[it.kind] ?? { icon: Sparkles, label: it.kind };
  const Icon = meta.icon;
  const warn = it.severity === "warn";
  const lessonLink = it.lesson_href ?? (it.lesson ? lessonHref(it.lesson) : null);
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={cx(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
          warn ? "bg-warn/10 text-warn ring-warn/25" : it.kind === "market" ? "bg-info/10 text-info ring-info/25" : "bg-accent/12 text-accent2 ring-accent/25",
        )}
      >
        <Icon size={15} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{meta.label}</span>
          {it.kind === "market" && it.available !== false && (
            <>
              <RegimeBadge regime={it.regime} />
              <SourceBadge source={it.source} />
            </>
          )}
          {it.count !== null && it.count !== undefined && it.sample ? (
            <span className="num text-[11px] text-faint">
              {it.count} от {it.sample} сделки
            </span>
          ) : null}
        </div>
        <h3 className="mt-0.5 text-sm font-semibold leading-snug text-text">{it.title}</h3>
        {it.kind === "market" && it.available === false ? (
          <DataNotAvailable compact reason={it.text} className="mt-1.5" />
        ) : (
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{it.text}</p>
        )}
        <div className="flex flex-wrap items-start gap-x-4">
          {it.why && (
            <WhyButton label="Защо?">
              {it.why}
              {lessonLink && (
                <>
                  {" "}
                  <Link href={lessonLink} className="font-medium text-accent2 hover:text-text">
                    Свързан урок →
                  </Link>
                </>
              )}
            </WhyButton>
          )}
          {it.action && (
            <Link href={it.action.href} className={cx(cardLink, "mt-1")}>
              {it.action.label} <ArrowUpRight size={12} strokeWidth={2.25} aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

export function InsightsCard({ insights, className }: { insights: Insight[]; className?: string }) {
  const list = orderInsights(insights ?? []);
  return (
    <Card
      className={className}
      title={
        <>
          <Sparkles size={14} strokeWidth={2} className="text-accent2" aria-hidden /> AI market insights
        </>
      }
      right={
        <Link href="/stats" className={cardLink}>
          AI Coach <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
        </Link>
      }
    >
      {list.length ? (
        <ul className="divide-y divide-white/[0.05]">
          {list.map((it, i) => (
            <InsightRow key={(it.key ?? it.kind) + i} it={it} />
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={Sparkles} title="Още няма insights" description="Направи няколко paper сделки и урока — AI ще посочи модели в процеса ти и пазарния режим." />
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-faint">Наблюдения върху данните и правилата — не прогноза и не съвет за покупка/продажба.</p>
    </Card>
  );
}

/* ───────────────────────────────────────────────────────── risk */

export function RiskCard({ risk, className }: { risk: RiskStatus; className?: string }) {
  return (
    <Card
      className={className}
      title={
        <>
          <ShieldAlert size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Risk status
        </>
      }
      right={<RiskStatusBadge status={risk.status} />}
    >
      <RiskStatusSummary st={risk} compact />
      <Link href="/risk" className={cx(cardLink, "mt-3")}>
        Risk Management <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
      </Link>
    </Card>
  );
}

/* ───────────────────────────────────────────────────── learning */

function MiniKpi({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className="num mt-0.5 text-sm font-semibold text-text">{value}</div>
      {sub && <div className="truncate text-[10.5px] text-faint">{sub}</div>}
    </div>
  );
}

export function LearningCard({ learning, className }: { learning: DashLearning; className?: string }) {
  const lvl = learning.current_level;
  const p = learning.xp_progress;
  const recs = (learning.recommendations ?? []).filter((r) => r.kind !== "continue").slice(0, 2);
  const rd = learning.risk_discipline;
  return (
    <Card
      className={className}
      title={
        <>
          <GraduationCap size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Learning progress
        </>
      }
      right={
        <span className="num rounded-md bg-gold/10 px-1.5 py-0.5 text-[11px] font-semibold text-gold ring-1 ring-inset ring-gold/25">
          XP level {learning.xp_level ?? learning.level} · {learning.xp} XP
        </span>
      }
    >
      <div className="space-y-3.5">
        {lvl && (
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Level {lvl.level}</div>
                <div className="truncate text-sm font-semibold text-text">{lvl.title_bg || lvl.title}</div>
              </div>
              <span className="num shrink-0 text-xs text-muted">{lvl.percent ?? 0}%</span>
            </div>
            <Meter value={lvl.percent ?? 0} tone="accent" className="mt-1.5" />
          </div>
        )}
        <div>
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted">XP до следващо ниво</span>
            {p && <span className="num text-muted">{p.needed} XP</span>}
          </div>
          <Meter value={xpPercent(learning)} tone="info" className="mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniKpi label="Уроци" value={`${learning.lessons_completed}/${learning.lessons_total}`} sub={`${lessonsPercent(learning)}% от пътя`} />
          <MiniKpi label="Quiz среден" value={learning.quiz_avg_score === null || learning.quiz_avg_score === undefined ? "—" : `${Math.round(learning.quiz_avg_score)}%`} sub={`${learning.quizzes_passed ?? 0} взети`} />
          <MiniKpi label="Replay score" value={learning.replay_score === null || learning.replay_score === undefined ? "—" : Math.round(learning.replay_score)} sub={`${learning.replay_sessions ?? 0} сесии`} />
          <MiniKpi label="Risk discipline" value={rd?.score === null || rd?.score === undefined ? "—" : `${rd.score}/100`} sub={`${rd?.trades ?? 0} сделки`} />
        </div>
        {learning.weakest_skill && (
          <p className="text-xs text-muted">
            Най-слабо умение: <span className="font-medium text-warn">{learning.weakest_skill.title_bg}</span>{" "}
            <span className="num text-faint">({learning.weakest_skill.score}/100)</span>
          </p>
        )}
        {learning.next && (
          <Link href={learning.next.href} className={linkButton("primary", "sm", "w-full !justify-between")}>
            <span className="truncate">Следва: {learning.next.title}</span>
            <ArrowRight size={13} strokeWidth={2.25} aria-hidden />
          </Link>
        )}
        {recs.length > 0 && <RecommendationList items={recs} />}
      </div>
    </Card>
  );
}

/* ──────────────────────────────────────────────── trades & positions */

type ActivityTab = "trades" | "positions" | "backtests";

function TradeRow({ t }: { t: Trade }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{t.symbol}</span>
          <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
        </div>
        <div className="truncate text-[11px] text-muted">
          <span className="num">{fmtTime(t.closed_ts)}</span> · {exitLabel(t.exit_reason)}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cx("num text-sm font-semibold", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</div>
        <div className="num text-[11px] text-muted">{fmtR(t.r_multiple)}</div>
      </div>
    </li>
  );
}

function PositionRow({ p }: { p: Position }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{p.symbol}</span>
          <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
        </div>
        <div className="num truncate text-[11px] text-muted">qty {p.qty}</div>
      </div>
      <div className={cx("num shrink-0 text-sm font-semibold", pnlClass(p.unrealized_pnl))}>{fmtMoney(p.unrealized_pnl, true)}</div>
    </li>
  );
}

export function ActivityCard({
  trades,
  positions,
  backtests,
  className,
}: {
  trades: Trade[];
  positions: Position[];
  backtests: StrategyPerf[];
  className?: string;
}) {
  const [tab, setTab] = useState<ActivityTab>("trades");
  const options: { value: ActivityTab; label: string }[] = [
    { value: "trades", label: "Сделки" },
    { value: "positions", label: `Позиции${positions.length ? ` (${positions.length})` : ""}` },
  ];
  if (backtests.length) options.push({ value: "backtests", label: "Backtests" });
  return (
    <Card
      className={className}
      title={
        <>
          <ChartNoAxesCombined size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Recent trades
        </>
      }
      right={<Segmented options={options} value={tab} onChange={setTab} size="sm" ariaLabel="Активност" />}
    >
      {tab === "trades" &&
        (trades.length ? (
          <ul className="-my-2 divide-y divide-white/[0.05]">
            {trades.map((t) => (
              <TradeRow key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={CandlestickChart}
            title="Още няма затворени сделки"
            description="Направи първата си paper сделка — със stop loss и риск ≤ 1%. Парите са виртуални."
            action={
              <>
                <Link href="/trade" className={linkButton("primary", "sm")}>
                  Първа paper сделка
                </Link>
                <Link href="/simulator" className={linkButton("outline", "sm")}>
                  Trade Simulator
                </Link>
              </>
            }
          />
        ))}
      {tab === "positions" &&
        (positions.length ? (
          <ul className="-my-2 divide-y divide-white/[0.05]">
            {positions.map((p) => (
              <PositionRow key={p.id} p={p} />
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={CandlestickChart} title="Няма отворени позиции" description="Отворените paper позиции и техният unrealized P/L се показват тук." />
        ))}
      {tab === "backtests" && (
        <>
          <ul className="-my-2 divide-y divide-white/[0.05]">
            {backtests.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{b.strategy}</div>
                  <div className="num truncate text-[11px] text-muted">
                    {b.symbol} · {b.timeframe} · {b.trades ?? "—"} сделки · PF {fmtPF(b.profit_factor)}
                  </div>
                </div>
                <div className={cx("num shrink-0 text-sm font-semibold", pnlClass(b.net_pnl))}>{fmtMoney(b.net_pnl, true)}</div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-faint">Past backtest performance does not guarantee future results.</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.05] pt-2.5">
        <Link href="/stats" className={cardLink}>
          Statistics <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
        </Link>
        <Link href="/journal" className={cardLink}>
          Trading Journal <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

/* ───────────────────────────────────────────────────────── bots */

export function BotsCard({ bots, className }: { bots: DashBot[]; className?: string }) {
  return (
    <Card
      className={className}
      title={
        <>
          <Bot size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Bot status
        </>
      }
      right={
        <Link href="/bots" className={cardLink}>
          Bot Lab <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
        </Link>
      }
    >
      {bots.length ? (
        <ul className="-my-2 divide-y divide-white/[0.05]">
          {bots.map((b) => (
            <li key={b.id}>
              <Link href={b.href ?? `/bots/${b.id}`} className="group block py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-text group-hover:text-accent2">{b.name}</span>
                  <StatusPill status={b.status} />
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="num">
                    {b.symbol} · {b.timeframe}
                  </span>
                  {b.regime && <RegimeBadge regime={b.regime} />}
                </div>
                {(b.pause_reason || b.coach_headline || b.last_signal) && (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">{b.pause_reason || b.coach_headline || `Последен сигнал: ${b.last_signal}`}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Bot}
          title="Нямаш paper ботове"
          description="Strategy → Backtest → Bot: ботът изпълнява правилата на стратегията с виртуални пари."
          action={
            <Link href="/strategies" className={linkButton("outline", "sm")}>
              Създай стратегия
            </Link>
          }
        />
      )}
      <p className="mt-3 text-[11px] text-faint">
        Ботовете са <Term k="paper_trading">paper</Term> — никога не изпращат реални поръчки.
      </p>
    </Card>
  );
}
