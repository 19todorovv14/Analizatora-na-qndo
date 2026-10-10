"use client";

/*
 * Performance report building blocks (GET /api/stats/performance):
 *   <BreakdownTable rows minTrades currency? />   per-dimension table with inline P/L bars + sample flags
 *   <MonthlyReturns rows />                       year × month heat table (return % on the reference capital)
 *   <RHistogram dist />                            R-multiple distribution (CSS bars, losses red / wins green)
 *   <TradeBriefList trades title tone />           best / worst trades
 */
import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import {
  MONTHS_BG,
  bucketTone,
  exitLabel,
  fmtHold,
  fmtPF,
  heatStyle,
  maxAbsPnl,
  maxBucket,
  monthlyScale,
  pfTone,
} from "@/components/analytics/model";
import type { BreakdownRow, MonthlyRow, Performance, TradeBrief } from "@/components/analytics/types";
import { Badge, EmptyState, Term, Tooltip } from "@/components/ui";
import { cx, fmtDate, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";

const INK = { up: "text-up", down: "text-down", warn: "text-warn", info: "text-info", neutral: "text-text", accent: "text-accent2" } as const;

/* ─────────────────────────────────────────────────── breakdown table */

export function BreakdownTable({ rows, minTrades, className }: { rows: BreakdownRow[]; minTrades: number; className?: string }) {
  if (!rows.length) return <EmptyState compact title="Няма данни за тази разбивка" description="Сделките нямат етикет за това измерение." />;
  const scale = maxAbsPnl(rows) || 1;
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full min-w-[36rem] text-[13px]">
        <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-faint">
          <tr>
            <th className="pb-2 font-medium">Група</th>
            <th className="pb-2 text-right font-medium">Сделки</th>
            <th className="pb-2 text-right font-medium">
              <Term k="winrate">Win rate</Term>
            </th>
            <th className="w-[34%] pb-2 pl-4 font-medium">Net P/L</th>
            <th className="pb-2 text-right font-medium">
              <Term k="r">Avg R</Term>
            </th>
            <th className="pb-2 text-right font-medium">
              <Term k="profitfactor">PF</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = Math.round((Math.abs(r.net_pnl) / scale) * 100);
            return (
              <tr key={r.key} className={cx("border-t border-white/[0.05]", !r.enough_data && "text-muted")}>
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-1.5">
                    <span className={cx("font-medium", r.enough_data ? "text-text" : "text-text/75")}>{r.label}</span>
                    {!r.enough_data && (
                      <Tooltip content={`По-малко от ${minTrades} сделки — резултатът е по-скоро шум, отколкото закономерност.`}>
                        <span className="inline-flex items-center gap-0.5 rounded bg-white/[0.05] px-1 py-px text-[10px] font-semibold uppercase tracking-[0.05em] text-faint">
                          <TriangleAlert size={10} strokeWidth={2.25} aria-hidden /> малко
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="num py-2 text-right">
                  {r.trades}
                  <span className="text-faint">
                    {" "}
                    ({r.wins}/{r.losses})
                  </span>
                </td>
                <td className="num py-2 text-right">{fmtPct(r.win_rate, 0)}</td>
                <td className="py-2 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <span className={cx("absolute inset-y-0 left-0 rounded-full", r.net_pnl >= 0 ? "bg-up/70" : "bg-down/70")} style={{ width: `${w}%` }} />
                    </div>
                    <span className={cx("num w-20 shrink-0 text-right", pnlClass(r.net_pnl))}>{fmtMoney(r.net_pnl, true)}</span>
                  </div>
                </td>
                <td className={cx("num py-2 text-right", pnlClass(r.average_r))}>{fmtR(r.average_r)}</td>
                <td className={cx("num py-2 text-right", INK[pfTone(r.profit_factor)])}>{fmtPF(r.profit_factor)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────── monthly returns */

export function MonthlyReturns({ rows, currency = "USD" }: { rows: MonthlyRow[]; currency?: string }) {
  if (!rows.length) return <EmptyState compact title="Още няма месечни резултати" description="Таблицата се попълва със затворените сделки по месеци." />;
  const scale = monthlyScale(rows);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] table-fixed border-separate border-spacing-1 text-[11.5px]">
        <thead className="text-[10.5px] uppercase tracking-[0.05em] text-faint">
          <tr>
            <th className="w-12 text-left font-medium">Год.</th>
            {MONTHS_BG.map((m) => (
              <th key={m} className="font-medium">
                {m}
              </th>
            ))}
            <th className="w-16 font-medium">Общо</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((y) => (
            <tr key={y.year}>
              <td className="num text-left font-semibold text-muted">{y.year}</td>
              {y.months.map((c, i) => (
                <td key={i} className="p-0">
                  {c ? (
                    <Tooltip
                      className="block"
                      content={
                        <span className="num text-xs">
                          {MONTHS_BG[i]} {y.year}: {fmtMoney(c.pnl, true)} · {c.trades} сделки
                          {c.return_pct !== null ? ` · ${fmtPct(c.return_pct, 2, true)}` : ""}
                        </span>
                      }
                    >
                      <div
                        className={cx("num flex h-9 items-center justify-center rounded-md ring-1 ring-inset ring-white/[0.05]", pnlClass(c.pnl))}
                        style={heatStyle(c.return_pct ?? c.pnl, scale)}
                      >
                        <span className="text-text">{c.return_pct !== null ? fmtPct(c.return_pct, 1, true) : fmtMoney(c.pnl, true)}</span>
                      </div>
                    </Tooltip>
                  ) : (
                    <div className="h-9 rounded-md bg-white/[0.02]" aria-label="няма сделки" />
                  )}
                </td>
              ))}
              <td className={cx("num text-center font-semibold", pnlClass(y.pnl))}>{y.return_pct !== null ? fmtPct(y.return_pct, 1, true) : fmtMoney(y.pnl, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-faint">Return % спрямо референтния капитал ({currency}); наситеността на цвета е пропорционална на резултата.</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────── R distribution */

const BAR = { up: "bg-up/70", down: "bg-down/70", neutral: "bg-white/25" } as const;

export function RHistogram({ dist }: { dist: Performance["r_distribution"] }) {
  const buckets = dist.buckets ?? [];
  const max = maxBucket(buckets);
  if (!dist.with_r || !max) {
    return (
      <EmptyState
        compact
        title="Няма сделки с R-multiple"
        description="R се изчислява само за сделки със stop loss (рискът е известен). Задавай стоп на всяка сделка."
      />
    );
  }
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Разпределение на R-multiple">
        {buckets.map((b) => {
          const h = b.count ? Math.max(6, Math.round((b.count / max) * 100)) : 0;
          return (
            <Tooltip key={b.key} content={<span className="num text-xs">{`${b.label}: ${b.count} сделки (${fmtPct(b.pct, 0)})`}</span>} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex h-full flex-col justify-end">
                {b.count > 0 && <span className="num mb-1 text-center text-[10.5px] text-muted">{b.count}</span>}
                <div className={cx("w-full rounded-t-md", BAR[bucketTone(b)])} style={{ height: `${h}%` }} />
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-white/[0.08] pt-1.5">
        {buckets.map((b) => (
          <span key={b.key} className="num min-w-0 flex-1 truncate text-center text-[10px] text-faint" title={b.label}>
            {b.label.replace(" … ", "…")}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Average <span className={cx("num", pnlClass(dist.average_r))}>{fmtR(dist.average_r)}</span>
        </span>
        <span>
          Median <span className={cx("num", pnlClass(dist.median_r))}>{fmtR(dist.median_r)}</span>
        </span>
        <span className="num">{dist.with_r} сделки с R</span>
        {dist.without_r > 0 && <span className="num text-warn">{dist.without_r} без стоп (без R)</span>}
      </div>
      {dist.note && <p className="mt-1.5 text-[11px] text-faint">{dist.note}</p>}
    </div>
  );
}

/* ───────────────────────────────────────────────────── best / worst */

export function TradeBriefList({ trades, empty }: { trades: TradeBrief[]; empty: string }) {
  if (!trades.length) return <p className="py-3 text-center text-xs text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-white/[0.05]">
      {trades.map((t) => (
        <li key={t.position_id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{t.symbol}</span>
              <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
              {t.timeframe && <span className="num text-[11px] text-faint">{t.timeframe}</span>}
            </div>
            <div className="truncate text-[11px] text-muted">
              <span className="num">{fmtDate(t.closed_ts)}</span> · {exitLabel(t.exit_reason)} · държана {fmtHold(t.holding_seconds)}
              {t.setup ? ` · ${t.setup}` : ""}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={cx("num text-sm font-semibold", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</div>
            <div className={cx("num text-[11px]", pnlClass(t.r))}>{fmtR(t.r)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LessonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent2 transition-colors hover:text-text">
      {children}
    </Link>
  );
}
