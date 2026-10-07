"use client";

import { ListFilter } from "lucide-react";
import { useMemo, useState } from "react";

import {
  EXIT_LABEL,
  REGIME_BAR,
  exitTone,
  filterTrades,
  fmtTradePrice,
  regimeShort,
  shortTime,
  type TradeFilter,
} from "@/components/backtest/format";
import type { BacktestTrade } from "@/components/backtest/types";
import { REGIME_LABEL } from "@/components/strategy/meta";
import { Badge, EmptyState, Segmented, VirtualList } from "@/components/ui";
import { cx, fmtMoney, fmtNum, fmtR, fmtTime, pnlClass } from "@/lib/format";

// fits the results column at 1440px (≈ 736px); narrower screens scroll sideways
const COLS = "grid grid-cols-[28px_92px_50px_minmax(132px,1fr)_92px_92px_58px_88px] items-center gap-x-2 px-2.5";
const ROW_H = 38;

/**
 * Virtualized trade list (thousands of rows stay smooth) with quick filters. Columns: #, entry time, side,
 * entry → exit (qty in the tooltip), exit reason, regime at entry, R multiple, net P/L.
 */
export function TradesTable({ trades, height = 420, focusRegime }: { trades: BacktestTrade[]; height?: number; focusRegime?: string | null }) {
  const [filter, setFilter] = useState<TradeFilter>("all");
  const numbered = useMemo(() => trades.map((t, i) => ({ ...t, n: i + 1 })), [trades]);
  const rows = useMemo(() => filterTrades(numbered, filter), [numbered, filter]);
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const shorts = trades.filter((t) => t.side === "short").length;

  if (!trades.length)
    return (
      <EmptyState
        compact
        icon={ListFilter}
        title="Няма сделки в този период"
        description="Условията не са се изпълнили нито веднъж. Опитай по-дълъг период или по-малко условия."
      />
    );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* the counts make the filter wider than a phone screen: it scrolls sideways instead of the page */}
        <div className="-mx-0.5 max-w-full overflow-x-auto px-0.5">
          <Segmented
            size="sm"
            ariaLabel="Филтър на сделките"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `Всички ${trades.length}` },
              { value: "win", label: `Печеливши ${wins}` },
              { value: "loss", label: `Губещи ${trades.length - wins}` },
              { value: "long", label: "LONG" },
              { value: "short", label: "SHORT", disabled: !shorts },
            ]}
          />
        </div>
        <span className="ml-auto text-[11px] text-faint">Вход на open на следващата свещ · R = резултат / първоначален риск</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/10">
        <div className="min-w-[700px]">
          <div
            className={cx(COLS, "h-9 border-b border-white/[0.07] bg-surface/80 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted")}
          >
            <span>#</span>
            <span>Entry</span>
            <span>Side</span>
            <span>Entry → Exit</span>
            <span>Exit</span>
            <span>Regime</span>
            <span className="text-right">R</span>
            <span className="text-right">Net</span>
          </div>
          {rows.length ? (
            <VirtualList
              items={rows}
              rowHeight={ROW_H}
              height={Math.min(height, rows.length * ROW_H + 2)}
              getKey={(t) => t.n}
              ariaLabel="Списък сделки"
              renderRow={(t) => (
                <div
                  className={cx(
                    COLS,
                    "h-full border-b border-white/[0.035] text-xs transition-colors hover:bg-white/[0.03]",
                    focusRegime && t.regime === focusRegime && "bg-warn/[0.05]",
                  )}
                >
                  <span className="num text-faint">{t.n}</span>
                  <span className="num text-[11px] text-muted" title={`${fmtTime(t.entry_ts)} → ${fmtTime(t.exit_ts)}`}>
                    {shortTime(t.entry_ts)}
                  </span>
                  <span>
                    <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                  </span>
                  <span className="num truncate text-text/90" title={`qty ${fmtNum(t.qty, 6)} · fees ${fmtMoney(t.fees)}`}>
                    {fmtTradePrice(t.entry_price)} <span className="text-faint">→</span> {fmtTradePrice(t.exit_price)}
                  </span>
                  <span className="min-w-0 truncate">
                    <Badge tone={exitTone(t.exit_reason)}>{EXIT_LABEL[t.exit_reason] ?? t.exit_reason.replace(/_/g, " ")}</Badge>
                  </span>
                  <span
                    className="flex min-w-0 items-center gap-1.5 text-[11px] text-text/85"
                    title={t.regime ? (REGIME_LABEL[t.regime] ?? t.regime) : undefined}
                  >
                    {t.regime ? (
                      <>
                        <span className={cx("h-2 w-2 shrink-0 rounded-sm", REGIME_BAR[t.regime] ?? "bg-white/25")} aria-hidden />
                        <span className="truncate">{regimeShort(t.regime)}</span>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </span>
                  <span className={cx("num text-right", pnlClass(t.r_multiple))}>{fmtR(t.r_multiple)}</span>
                  <span className={cx("num text-right font-medium", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</span>
                </div>
              )}
            />
          ) : (
            <p className="px-3 py-6 text-center text-xs text-muted">Няма сделки за този филтър.</p>
          )}
        </div>
      </div>
    </div>
  );
}
