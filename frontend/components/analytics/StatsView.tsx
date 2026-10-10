"use client";

/*
 * STATISTICS (/stats): trade statistics (GET /api/stats/report), behaviour & psychology (mistakes with
 * lesson links, discipline score, strategy stability), the AI COACH weekly review (GET /api/ai/coach)
 * and the latest AI trade reviews (GET /api/ai/reviews). Deeper curves and breakdowns live on /performance.
 */
import { ArrowRight, BarChart3, Brain, CandlestickChart, CircleCheck, NotebookPen, TriangleAlert } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { CoachReview } from "@/components/analytics/CoachReview";
import { exitLabel, fmtHold, fmtPF, pfTone, scoreTone } from "@/components/analytics/model";
import type { Coach, StatsReport } from "@/components/analytics/types";
import { EquityChart } from "@/components/charts/EquityChart";
import { linkButton } from "@/components/learn/linkButton";
import { TradeReviewCard } from "@/components/trading/TradeReviewCard";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Meter,
  Notice,
  PageHeader,
  Skeleton,
  StatTile,
  Term,
  pnlTone,
} from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Review } from "@/lib/types";
import { lessonHref } from "@/lib/lessons";

const pageLink = "inline-flex items-center gap-1 text-xs font-medium text-accent2 transition-colors hover:text-text";

function TradeStats({ rep, beginner }: { rep: StatsReport; beginner: boolean }) {
  const m = rep.metrics;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Total trades" value={m.total_trades} sub={`${m.winning_trades}W / ${m.losing_trades}L`} />
      <StatTile label="Win rate" term="winrate" value={fmtPct(m.win_rate, 1)} />
      <StatTile label="Profit factor" term="profitfactor" value={fmtPF(m.profit_factor)} tone={pfTone(m.profit_factor)} />
      <StatTile label="Expectancy" term="expectancy" value={fmtR(m.expectancy_r)} tone={pnlTone(m.expectancy_r)} sub={`${fmtMoney(m.expectancy, true)} на сделка`} />
      <StatTile label="Net P/L" value={fmtMoney(m.net_pnl, true)} tone={pnlTone(m.net_pnl)} sub={`такси ${fmtMoney(m.fees_total)}`} />
      <StatTile label="Average win" term="avgwin" value={fmtMoney(m.average_win)} tone="up" sub={fmtR(m.average_win_r)} />
      <StatTile label="Average loss" term="avgloss" value={fmtMoney(m.average_loss)} tone="down" sub={fmtR(m.average_loss_r)} />
      <StatTile label="Max drawdown" term="drawdown" value={fmtPct(-Math.abs(m.max_drawdown_pct || 0), 2)} sub={fmtMoney(-Math.abs(m.max_drawdown || 0))} />
      {!beginner && (
        <>
          <StatTile label="Average R" term="r" value={fmtR(m.average_r)} tone={pnlTone(m.average_r)} />
          <StatTile label="SQN" term="sqn" value={m.sqn === null || m.sqn === undefined ? "—" : m.sqn.toFixed(2)} />
          <StatTile label="Avg holding" value={fmtHold(m.average_holding_seconds)} />
          <StatTile label="Max losing streak" value={m.max_consecutive_losses} tone={m.max_consecutive_losses >= 4 ? "warn" : "neutral"} />
        </>
      )}
    </div>
  );
}

function Behaviour({ rep }: { rep: StatsReport }) {
  const tone = scoreTone(rep.discipline_score);
  return (
    <Card
      title={
        <>
          <Brain size={14} strokeWidth={2} className="text-violet" aria-hidden /> Behaviour & psychology
        </>
      }
    >
      <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Discipline score</span>
          <span className={cx("num text-lg font-semibold", tone === "up" ? "text-up" : tone === "warn" ? "text-warn" : "text-down")}>{rep.discipline_score}/100</span>
        </div>
        <Meter value={rep.discipline_score} tone={tone === "neutral" ? "accent" : tone} className="mt-1.5" />
        {rep.most_common_mistake && (
          <p className="mt-2 text-xs text-muted">
            Най-честа грешка: <span className="font-medium text-warn">{rep.most_common_mistake.mistake}</span>{" "}
            <span className="num text-faint">({rep.most_common_mistake.count}×)</span>
          </p>
        )}
      </div>
      {rep.behavioral_mistakes.length ? (
        <ul className="space-y-2">
          {rep.behavioral_mistakes.map((f) => (
            <li key={f.kind} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <TriangleAlert size={14} strokeWidth={2} className={f.severity === "high" ? "text-down" : "text-warn"} aria-hidden />
                <span className="text-sm font-semibold text-text">{f.title}</span>
                <span className="num text-[11px] text-faint">{f.count}×</span>
                {f.lesson && (
                  <Link href={lessonHref(f.lesson)} className={cx(pageLink, "ml-auto")}>
                    Урок <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
                  </Link>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={CircleCheck}
          title="Не са засечени поведенчески грешки"
          description="Проверяваме за overtrading, oversizing, revenge trading, преместени стопове и chasing."
        />
      )}
      {rep.strategy_stability && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Стабилност (1-ва vs 2-ра половина)</h3>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
            <span />
            <span className="text-faint">1-ва половина</span>
            <span className="text-faint">2-ра половина</span>
            <span className="text-muted">
              <Term k="expectancy">Expectancy</Term>
            </span>
            <span className="num">{fmtR(rep.strategy_stability.first_half.expectancy_r)}</span>
            <span className="num">{fmtR(rep.strategy_stability.second_half.expectancy_r)}</span>
            <span className="text-muted">Win rate</span>
            <span className="num">{fmtPct(rep.strategy_stability.first_half.win_rate, 0)}</span>
            <span className="num">{fmtPct(rep.strategy_stability.second_half.win_rate, 0)}</span>
          </div>
          <p className="mt-2 text-xs text-muted">{rep.strategy_stability.verdict}</p>
        </div>
      )}
    </Card>
  );
}

function SymbolsCard({ rep }: { rep: StatsReport }) {
  const exits = Object.entries(rep.by_exit_reason ?? {});
  return (
    <Card title="По инструмент и изход" right={<Link href="/performance" className={pageLink}>Всички разбивки <ArrowRight size={12} strokeWidth={2.25} aria-hidden /></Link>}>
      {rep.by_symbol.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-[13px]">
            <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-faint">
              <tr>
                <th className="pb-1.5 font-medium">Инструмент</th>
                <th className="pb-1.5 text-right font-medium">Сделки</th>
                <th className="pb-1.5 text-right font-medium">Win rate</th>
                <th className="pb-1.5 text-right font-medium">Net P/L</th>
              </tr>
            </thead>
            <tbody>
              {rep.by_symbol.map((g) => (
                <tr key={g.key} className="border-t border-white/[0.05]">
                  <td className="py-1.5 font-medium">{g.key}</td>
                  <td className="num text-right">{g.trades}</td>
                  <td className="num text-right">{fmtPct(g.win_rate, 0)}</td>
                  <td className={cx("num text-right", pnlClass(g.net_pnl))}>{fmtMoney(g.net_pnl, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-3 text-center text-xs text-muted">Няма данни.</p>
      )}
      {exits.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {exits.map(([k, v]) => (
            <Badge key={k} tone={k === "take_profit" ? "up" : k === "stop_loss" ? "down" : "neutral"}>
              {exitLabel(k)}: <span className="num">{v}</span>
            </Badge>
          ))}
        </div>
      )}
      {(rep.best_setup || rep.worst_setup) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <div className="text-[11px] text-muted">Най-добър setup</div>
            <div className="truncate font-semibold">{rep.best_setup?.key ?? "—"}</div>
            {rep.best_setup && <div className={cx("num", pnlClass(rep.best_setup.net_pnl))}>{fmtMoney(rep.best_setup.net_pnl, true)}</div>}
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <div className="text-[11px] text-muted">Най-слаб setup</div>
            <div className="truncate font-semibold">{rep.worst_setup?.key ?? "—"}</div>
            {rep.worst_setup && <div className={cx("num", pnlClass(rep.worst_setup.net_pnl))}>{fmtMoney(rep.worst_setup.net_pnl, true)}</div>}
          </div>
        </div>
      )}
    </Card>
  );
}

export function StatsView() {
  const { beginner } = useSession();
  const { data: rep, error: repError, mutate: retryRep } = useSWR<StatsReport>("/stats/report", fetcher);
  const { data: coach, error: coachError, mutate: retryCoach } = useSWR<Coach>("/ai/coach", fetcher);
  const { data: reviews } = useSWR<{ reviews: Review[] }>("/ai/reviews", fetcher);
  const noTrades = rep && !rep.metrics.total_trades;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BarChart3}
        title="Statistics"
        subtitle="Статистика на paper сделките, поведенчески модели и седмичен преглед от AI Coach."
        actions={
          <>
            <Link href="/journal" className={linkButton("outline", "sm")}>
              <NotebookPen size={13} strokeWidth={2.25} aria-hidden /> Journal
            </Link>
            <Link href="/performance" className={linkButton("outline", "sm")}>
              Performance <ArrowRight size={13} strokeWidth={2.25} aria-hidden />
            </Link>
          </>
        }
      />

      {!rep ? (
        repError ? (
          <ErrorState title="Статистиката не се зареди" onRetry={() => void retryRep()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[92px] !rounded-xl" />
            ))}
          </div>
        )
      ) : noTrades ? (
        <EmptyState
          icon={CandlestickChart}
          title="Още няма затворени paper сделки"
          description="Статистиката, поведенческият анализ и AI Coach-ът работят върху твоите сделки. Започни с една малка сделка със stop loss."
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
      ) : (
        <>
          {!rep.enough_data && rep.message && <Notice tone="info">{rep.message}</Notice>}
          <TradeStats rep={rep} beginner={beginner} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Behaviour rep={rep} />
            <div className="space-y-4">
              <SymbolsCard rep={rep} />
              {rep.equity_curve.length > 1 && (
                <Card title="Cumulative P/L (paper)">
                  <EquityChart points={rep.equity_curve} baseline={0} height={180} />
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      <CoachReview coach={coach} error={coachError} onRetry={() => void retryCoach()} />

      <Card title="Последни trade reviews" right={<Link href="/ai?mode=review_trade" className={pageLink}>AI Teacher <ArrowRight size={12} strokeWidth={2.25} aria-hidden /></Link>}>
        {reviews?.reviews.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {reviews.reviews.slice(0, 4).map((r) => (
              <div key={r.position_id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                <TradeReviewCard review={r} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact title="Още няма AI trade reviews" description="След затворена paper сделка натисни „AI review“ в историята на сделките или в журнала." />
        )}
      </Card>
    </div>
  );
}
