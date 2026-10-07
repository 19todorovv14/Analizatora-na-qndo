"use client";

import { History, Trash2 } from "lucide-react";
import { useState } from "react";

import type { BacktestRow } from "@/components/backtest/types";
import { Badge, EmptyState, IconButton, Spinner, type Tone } from "@/components/ui";
import { TF_LABEL, cx, fmtDate, fmtMoney, pnlClass } from "@/lib/format";

const STATUS_TONE: Record<string, Tone> = { done: "up", failed: "down", pending: "warn", running: "info" };

/** Past backtests (latest 50): click to open, trash to delete (two-step confirm). */
export function BacktestHistory({
  rows,
  activeId,
  onOpen,
  onDelete,
}: {
  rows: BacktestRow[];
  activeId: number | null;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [confirm, setConfirm] = useState<number | null>(null);
  if (!rows.length) return <EmptyState compact icon={History} title="Още няма backtests" description="Резултатите ще се пазят тук." />;
  return (
    <ul className="-mx-1 max-h-[420px] space-y-1 overflow-y-auto px-1">
      {rows.map((b) => {
        const active = activeId === b.id;
        return (
          <li key={b.id} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(b.id)}
              aria-current={active || undefined}
              className={cx(
                "w-full rounded-lg border px-2.5 py-2 pr-10 text-left transition-colors",
                active ? "border-accent/35 bg-accent/[0.09]" : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text">{b.strategy_name}</span>
                {b.status === "running" || b.status === "pending" ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status}</Badge>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                <span className="num">{b.symbol}</span>
                <span className="num">{TF_LABEL[b.timeframe] ?? b.timeframe}</span>
                <span>·</span>
                <span className="num">
                  {fmtDate(b.start_ts)} – {fmtDate(b.end_ts)}
                </span>
              </div>
              {b.status === "done" && (
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  <span className="num text-muted">{b.metrics?.total_trades ?? 0} сделки</span>
                  <span className={cx("num font-medium", pnlClass(b.metrics?.net_pnl))}>{fmtMoney(b.metrics?.net_pnl, true)}</span>
                  {b.validation?.overfitting?.risk && (
                    <span className="ml-auto text-[10px] uppercase tracking-[0.05em] text-faint">overfit {b.validation.overfitting.risk}</span>
                  )}
                </div>
              )}
            </button>
            <span className="absolute right-1.5 top-1.5">
              {confirm === b.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirm(null);
                    onDelete(b.id);
                  }}
                  onBlur={() => setConfirm(null)}
                  className="rounded-md bg-down/15 px-1.5 py-1 text-[10.5px] font-semibold text-down ring-1 ring-inset ring-down/30"
                >
                  Изтрий?
                </button>
              ) : (
                <IconButton
                  icon={Trash2}
                  label="Изтрий backtest"
                  size="sm"
                  tooltipSide="left"
                  onClick={() => setConfirm(b.id)}
                  className="opacity-60 hover:!text-down group-hover:opacity-100"
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
