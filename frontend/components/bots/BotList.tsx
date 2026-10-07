"use client";

import { Bot, ChevronRight, Funnel as FunnelIcon } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/bots/StatusPill";
import type { BotRow } from "@/components/bots/types";
import { signalTone } from "@/components/strategy/SignalCheck";
import { Badge, EmptyState, RegimeBadge } from "@/components/ui";
import { TF_LABEL, cx, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";

function Metric({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0 rounded-lg bg-black/15 px-2.5 py-1.5 ring-1 ring-inset ring-white/[0.05]", className)}>
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className="num mt-0.5 truncate text-[13px] font-semibold text-text">{children}</div>
    </div>
  );
}

/** "setups → all met → trades" with a proportional bar (from the bot's evaluation statistics). */
function FunnelLine({ b }: { b: BotRow }) {
  const g = b.setups_generated ?? 0;
  const met = b.all_conditions_met ?? 0;
  if (!g)
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
        <FunnelIcon size={12} strokeWidth={2} aria-hidden /> Още няма обработени свещи
      </span>
    );
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        <FunnelIcon size={12} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
        <span className="truncate tabular-nums">{b.coach_headline || `${g} setups → ${met} с изпълнени условия → ${b.trades} сделки`}</span>
      </span>
      <span className="relative flex h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <span className="h-full bg-accent/70" style={{ width: `${Math.min(100, (met / g) * 100)}%` }} />
        <span className="absolute inset-y-0 left-0 bg-violet" style={{ width: `${Math.min(100, (b.trades / g) * 100)}%` }} />
      </span>
    </span>
  );
}

/** "Моите ботове": one card per bot — status pill RUNNING / PAUSED / STOPPED, virtual P/L, stats, setups funnel, last signal. */
export function BotList({ bots }: { bots: BotRow[] }) {
  if (!bots.length)
    return (
      <EmptyState
        icon={Bot}
        title="Още нямаш paper ботове"
        description="Създай бот от формата: избери стратегия, риск и график. Ботът следва правилата върху нови свещи — само с виртуални пари."
      />
    );
  return (
    <ul className="space-y-2.5">
      {bots.map((b) => (
        <li key={b.id} className="@container">
          <Link
            href={`/bots/${b.id}`}
            aria-label={`Отвори ${b.name}`}
            className={cx(
              "group block rounded-xl border bg-white/[0.02] p-3.5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.035]",
              b.status === "RUNNING" ? "border-up/20" : b.status === "PAUSED" ? "border-warn/25" : "border-white/[0.07]",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-[14px] font-semibold text-text group-hover:text-accent2">{b.name}</span>
                  <StatusPill status={b.status} />
                </div>
                <div className="num mt-0.5 truncate text-[11px] text-muted">
                  {b.symbol} · {TF_LABEL[b.timeframe] ?? b.timeframe} · {b.run_mode === "warm_start" ? "warm start" : "forward"}
                  {(b.max_positions ?? 1) > 1 ? ` · max ${b.max_positions} позиции` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[15px] font-semibold text-text">{fmtMoney(b.equity)}</div>
                <div className={cx("num text-xs font-medium", pnlClass(b.pnl))}>{fmtMoney(b.pnl, true)}</div>
              </div>
              <ChevronRight
                size={16}
                strokeWidth={2}
                className="mt-1 hidden shrink-0 text-faint transition-colors group-hover:text-accent2 @md:block"
                aria-hidden
              />
            </div>

            {b.pause_reason && (
              <p className="mt-2 truncate rounded-md bg-warn/[0.08] px-2 py-1 text-[11px] text-warn" title={b.pause_reason}>
                {b.pause_reason}
              </p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-1.5 @xl:grid-cols-6">
              <Metric label="Trades">{b.trades}</Metric>
              <Metric label="Win rate">{fmtPct(b.win_rate, 0)}</Metric>
              <Metric label="Avg R">
                <span className={pnlClass(b.average_r)}>{fmtR(b.average_r)}</span>
              </Metric>
              <Metric label="Drawdown">{fmtPct(b.drawdown_pct)}</Metric>
              <Metric label="Regime">{b.regime ? <RegimeBadge regime={b.regime} /> : <span className="text-faint">—</span>}</Metric>
              <Metric label="Last signal">
                {b.last_signal?.signal ? <Badge tone={signalTone(b.last_signal.signal)}>{b.last_signal.signal}</Badge> : <span className="text-faint">—</span>}
              </Metric>
            </div>

            <div className="mt-2.5 flex min-w-0 items-center">
              <FunnelLine b={b} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
