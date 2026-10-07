"use client";

import { Bot, ChevronRight } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/bots/StatusPill";
import type { BotRow } from "@/components/bots/types";
import { Badge, EmptyState, RegimeBadge } from "@/components/ui";
import { TF_LABEL, cx, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";

function signalTone(sig?: string) {
  if (!sig) return "neutral" as const;
  if (sig.includes("LONG")) return "up" as const;
  if (sig.includes("SHORT")) return "down" as const;
  return "neutral" as const;
}

/** Mini funnel "setups → all met → trades" used in the bot list. */
function Funnel({ b }: { b: BotRow }) {
  const g = b.setups_generated ?? 0;
  if (!g) return <span className="text-faint">—</span>;
  const met = b.all_conditions_met ?? 0;
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="num text-[11px] text-muted">
        {g} → <span className="text-text/90">{met}</span> → <span className="text-accent2">{b.trades}</span>
      </span>
      <span className="flex h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <span className="h-full bg-accent/70" style={{ width: `${Math.min(100, (met / g) * 100)}%` }} />
      </span>
    </span>
  );
}

/** "Моите ботове" table: status pills RUNNING / PAUSED / STOPPED, virtual P/L, funnel, last signal. */
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
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">
          <tr className="border-b border-white/[0.07]">
            <th className="py-2 pr-3 font-semibold">Bot</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 pr-3 text-right font-semibold">Equity</th>
            <th className="py-2 pr-3 text-right font-semibold">P/L</th>
            <th className="py-2 pr-3 text-right font-semibold">Trades</th>
            <th className="py-2 pr-3 text-right font-semibold">Win · Avg R</th>
            <th className="py-2 pr-3 text-right font-semibold">DD</th>
            <th className="py-2 pr-3 font-semibold">Setups funnel</th>
            <th className="py-2 pr-3 font-semibold">Regime</th>
            <th className="py-2 font-semibold">Last signal</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {bots.map((b) => (
            <tr key={b.id} className="group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]">
              <td className="py-2.5 pr-3">
                <Link href={`/bots/${b.id}`} className="block min-w-0 font-semibold text-text hover:text-accent2">
                  {b.name}
                </Link>
                <span className="num text-[11px] text-muted">
                  {b.symbol} · {TF_LABEL[b.timeframe] ?? b.timeframe} · {b.run_mode === "warm_start" ? "warm start" : "forward"}
                  {(b.max_positions ?? 1) > 1 ? ` · max ${b.max_positions}` : ""}
                </span>
              </td>
              <td className="py-2.5 pr-3">
                <StatusPill status={b.status} />
                {b.pause_reason && <div className="mt-1 max-w-40 truncate text-[10.5px] text-warn" title={b.pause_reason}>{b.pause_reason}</div>}
              </td>
              <td className="num py-2.5 pr-3 text-right">{fmtMoney(b.equity)}</td>
              <td className={cx("num py-2.5 pr-3 text-right font-medium", pnlClass(b.pnl))}>{fmtMoney(b.pnl, true)}</td>
              <td className="num py-2.5 pr-3 text-right">{b.trades}</td>
              <td className="num py-2.5 pr-3 text-right text-xs">
                {fmtPct(b.win_rate, 0)} · <span className={pnlClass(b.average_r)}>{fmtR(b.average_r)}</span>
              </td>
              <td className="num py-2.5 pr-3 text-right text-xs text-muted">{fmtPct(b.drawdown_pct)}</td>
              <td className="py-2.5 pr-3">
                <Funnel b={b} />
              </td>
              <td className="py-2.5 pr-3">{b.regime ? <RegimeBadge regime={b.regime} /> : <span className="text-faint">—</span>}</td>
              <td className="py-2.5">
                {b.last_signal?.signal ? <Badge tone={signalTone(b.last_signal.signal)}>{b.last_signal.signal}</Badge> : <span className="text-xs text-faint">—</span>}
              </td>
              <td className="py-2.5 text-right">
                <Link href={`/bots/${b.id}`} aria-label={`Отвори ${b.name}`} className="inline-flex text-faint transition-colors group-hover:text-accent2">
                  <ChevronRight size={16} strokeWidth={2} aria-hidden />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
