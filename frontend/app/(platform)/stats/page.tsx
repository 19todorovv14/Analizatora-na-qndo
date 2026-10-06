"use client";

import Link from "next/link";
import useSWR from "swr";

import { EquityChart } from "@/components/charts/EquityChart";
import { TradeReviewCard } from "@/components/trading/TradeReviewCard";
import { AiText, Badge, Card, Empty, Loading, Notice, ProgressBar, Stat } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx, fmtDate, fmtDuration, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Metrics, Review } from "@/lib/types";

type Group = { key: string; trades: number; net_pnl: number; win_rate: number; average_r?: number | null };
type Finding = { kind: string; title: string; severity: string; count: number; text: string; lesson: string };
type Report = {
  enough_data: boolean;
  message: string | null;
  metrics: Metrics;
  best_setup: Group | null;
  worst_setup: Group | null;
  most_common_mistake: { mistake: string; count: number } | null;
  behavioral_mistakes: Finding[];
  discipline_score: number;
  strategy_stability: null | {
    first_half: { expectancy_r: number | null; win_rate: number | null; trades: number };
    second_half: { expectancy_r: number | null; win_rate: number | null; trades: number };
    verdict: string;
  };
  by_symbol: Group[];
  by_exit_reason: Record<string, number>;
  equity_curve: [number, number][];
};
type Coach = {
  title: string;
  period: { from: number; to: number };
  summary: string[];
  strengths: string[];
  weaknesses: string[];
  biggest_mistake: Finding | null;
  next_lessons: { slug: string; title: string; reason: string }[];
  discipline_score: number;
  text: string;
  provider: string;
};

export default function StatsPage() {
  const { beginner } = useSession();
  const { data: rep } = useSWR<Report>("/stats/report", fetcher);
  const { data: coach } = useSWR<Coach>("/ai/coach", fetcher);
  const { data: reviews } = useSWR<{ reviews: Review[] }>("/ai/reviews", fetcher);
  if (!rep) return <Loading />;
  const m = rep.metrics;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Statistics & Performance Report</h1>
      {!rep.enough_data && <Notice tone="info">{rep.message}</Notice>}

      <Card title="Performance Report">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Total trades" value={m.total_trades} />
          <Stat label="Win rate" term="winrate" value={fmtPct(m.win_rate, 1)} />
          <Stat label="Profit factor" term="profitfactor" value={m.profit_factor ? (m.profit_factor > 1e6 ? "∞" : m.profit_factor.toFixed(2)) : "—"} />
          <Stat label="Expectancy" term="expectancy" value={fmtR(m.expectancy_r)} sub={fmtMoney(m.expectancy)} />
          <Stat label="Average R" term="r" value={fmtR(m.average_r)} />
          <Stat label="Max drawdown" term="drawdown" value={fmtMoney(m.max_drawdown)} sub={fmtPct(m.max_drawdown_pct)} />
          <Stat label="Net P/L" value={fmtMoney(m.net_pnl, true)} tone={pnlClass(m.net_pnl)} />
          <Stat label="Average win" term="avgwin" value={fmtMoney(m.average_win)} tone="text-up" sub={fmtR(m.average_win_r)} />
          <Stat label="Average loss" term="avgloss" value={fmtMoney(m.average_loss)} tone="text-down" sub={fmtR(m.average_loss_r)} />
          <Stat label="Best setup" value={rep.best_setup?.key ?? "—"} sub={rep.best_setup ? fmtMoney(rep.best_setup.net_pnl, true) : undefined} />
          <Stat label="Worst setup" value={rep.worst_setup?.key ?? "—"} sub={rep.worst_setup ? fmtMoney(rep.worst_setup.net_pnl, true) : undefined} />
          <Stat label="Most common mistake" value={<span className="text-sm">{rep.most_common_mistake?.mistake ?? "—"}</span>} />
          <Stat label="Discipline score" value={`${rep.discipline_score}/100`} tone={rep.discipline_score >= 80 ? "text-up" : "text-warn"} />
          {!beginner && <Stat label="Avg holding" value={fmtDuration(m.average_holding_seconds)} />}
        </div>
        {rep.equity_curve.length > 1 && (
          <div className="mt-4">
            <div className="label">Cumulative P/L (paper)</div>
            <EquityChart points={rep.equity_curve} baseline={0} height={200} />
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Behavioral mistakes">
          {rep.behavioral_mistakes.length ? (
            <ul className="space-y-2">
              {rep.behavioral_mistakes.map((f) => (
                <li key={f.kind} className="rounded-md border border-line bg-panel2 p-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={f.severity === "high" ? "down" : "warn"}>{f.title}</Badge>
                    <span className="text-xs text-muted">{f.count}×</span>
                    <Link href={`/learn/${f.lesson}`} className="ml-auto text-xs text-accent2">
                      урок →
                    </Link>
                  </div>
                  <p className="mt-1 text-text/90">{f.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Не са засечени overtrading, oversizing, revenge trading, преместени стопове или chasing.</Empty>
          )}
        </Card>
        <Card title="Strategy stability & breakdown">
          {rep.strategy_stability ? (
            <div className="mb-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <span />
                <span className="text-muted">1-ва половина</span>
                <span className="text-muted">2-ра половина</span>
                <span className="text-muted">Expectancy</span>
                <span className="num">{fmtR(rep.strategy_stability.first_half.expectancy_r)}</span>
                <span className="num">{fmtR(rep.strategy_stability.second_half.expectancy_r)}</span>
                <span className="text-muted">Win rate</span>
                <span className="num">{fmtPct(rep.strategy_stability.first_half.win_rate, 0)}</span>
                <span className="num">{fmtPct(rep.strategy_stability.second_half.win_rate, 0)}</span>
              </div>
              <p className="mt-2 text-xs">{rep.strategy_stability.verdict}</p>
            </div>
          ) : (
            <p className="mb-3 text-xs text-muted">Нужни са поне 10 сделки за оценка на стабилността.</p>
          )}
          <div className="label">By symbol</div>
          <table className="w-full text-xs">
            <tbody>
              {rep.by_symbol.map((g) => (
                <tr key={g.key} className="border-t border-line first:border-0">
                  <td className="py-1">{g.key}</td>
                  <td className="num">{g.trades} tr.</td>
                  <td className="num">{fmtPct(g.win_rate, 0)}</td>
                  <td className={cx("num text-right", pnlClass(g.net_pnl))}>{fmtMoney(g.net_pnl, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="label mt-3">Exit reasons</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(rep.by_exit_reason).map(([k, v]) => (
              <Badge key={k}>
                {k}: {v}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card title="AI COACH — WEEKLY REVIEW" right={coach && <span className="text-xs text-muted">{fmtDate(coach.period.from)} – {fmtDate(coach.period.to)}</span>}>
        {!coach ? (
          <Loading />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AiText text={coach.text} />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="label text-up">Strengths</div>
                  <ul className="space-y-1 text-sm">
                    {coach.strengths.map((s) => (
                      <li key={s}>✓ {s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label text-down">Weaknesses</div>
                  <ul className="space-y-1 text-sm">
                    {coach.weaknesses.map((s) => (
                      <li key={s}>✗ {s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div>
              <div className="label">NEXT LESSONS</div>
              <ul className="space-y-1.5">
                {coach.next_lessons.map((l) => (
                  <li key={l.slug}>
                    <Link href={`/learn/${l.slug}`} className="block rounded-md border border-line bg-panel2 p-2 text-sm hover:border-accent">
                      {l.title}
                      <span className="block text-[11px] text-muted">{l.reason}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="label mt-3">Discipline</div>
              <ProgressBar value={coach.discipline_score ?? 0} tone={(coach.discipline_score ?? 0) >= 80 ? "up" : "warn"} />
              <p className="mt-2 text-[11px] text-faint">provider: {coach.provider}</p>
            </div>
          </div>
        )}
      </Card>

      <Card title="Последни trade reviews">
        {reviews?.reviews.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {reviews.reviews.slice(0, 6).map((r) => (
              <div key={r.position_id} className="rounded-md border border-line p-3">
                <TradeReviewCard review={r} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>Затвори paper сделка, за да видиш AI review.</Empty>
        )}
      </Card>
    </div>
  );
}
