"use client";

import { ListFilter } from "lucide-react";
import { useMemo, useState } from "react";

import { EXIT_LABEL, exitTone } from "@/components/backtest/format";
import type { BacktestTrade } from "@/components/backtest/types";
import { Badge, EmptyState, RegimeBadge, Segmented, VirtualList } from "@/components/ui";
import { cx, fmtMoney, fmtNum, fmtR, fmtTime, pnlClass } from "@/lib/format";

type Filter = "all" | "win" | "loss" | "long" | "short";

const COLS = "grid grid-cols-[40px_112px_58px_minmax(170px,1fr)_72px_104px_128px_68px_96px] items-center gap-x-3 px-3";
const ROW_H = 38;

function price(v: number): string {
  const a = Math.abs(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 4 : 6 });
}

/**
 * Virtualized trade list (thousands of rows stay smooth) with quick filters. Columns: #, entry time, side,
 * entry → exit, qty, exit reason, regime at entry, R multiple, net P/L. Wide tables scroll sideways on phones.
 */
export function TradesTable({ trades, height = 420, focusRegime }: { trades: BacktestTrade[]; height?: number; focusRegime?: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const numbered = useMemo(() => trades.map((t, i) => ({ ...t, n: i + 1 })), [trades]);
  const rows = useMemo(
    () =>
      numbered.filter((t) => {
        if (filter === "win") return t.net_pnl > 0;
        if (filter === "loss") return t.net_pnl <= 0;
        if (filter === "long") return t.side === "long";
        if (filter === "short") return t.side === "short";
        return true;
      }),
    [numbered, filter],
  );
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const shorts = trades.filter((t) => t.side === "short").length;

  if (!trades.length)
    return <EmptyState compact icon={ListFilter} title="Няма сделки в този период" description="Условията не са се изпълнили нито веднъж. Опитай по-дълъг период или по-малко условия." />;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
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
        <span className="ml-auto text-[11px] text-faint">
          Вход на open на следващата свещ · R = резултат / първоначален риск
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/10">
        <div className="min-w-[980px]">
          <div className={cx(COLS, "h-9 border-b border-white/[0.07] bg-surface/80 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted")}>
            <span>#</span>
            <span>Entry</span>
            <span>Side</span>
            <span>Entry → Exit</span>
            <span className="text-right">Qty</span>
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
                  <span className="num text-muted">{fmtTime(t.entry_ts)}</span>
                  <span>
                    <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                  </span>
                  <span className="num truncate text-text/90">
                    {price(t.entry_price)} <span className="text-faint">→</span> {price(t.exit_price)}
                  </span>
                  <span className="num text-right text-muted">{fmtNum(t.qty, 4)}</span>
                  <span>
                    <Badge tone={exitTone(t.exit_reason)}>{EXIT_LABEL[t.exit_reason] ?? t.exit_reason.replace(/_/g, " ")}</Badge>
                  </span>
                  <span className="min-w-0 truncate">{t.regime ? <RegimeBadge regime={t.regime} /> : <span className="text-faint">—</span>}</span>
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
