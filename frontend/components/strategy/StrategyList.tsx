"use client";

import { FolderOpen, Plus } from "lucide-react";

import type { StrategyRow } from "@/components/strategy/types";
import { Card, EmptyState, IconButton } from "@/components/ui";
import { TF_LABEL, cx } from "@/lib/format";

/** "Моите стратегии" — the user's saved strategies (templates live in the gallery). */
export function StrategyList({
  strategies,
  activeId,
  dirty,
  onOpen,
  onNew,
}: {
  strategies: StrategyRow[];
  activeId?: number;
  dirty: boolean;
  onOpen: (s: StrategyRow) => void;
  onNew: () => void;
}) {
  return (
    <Card
      title={
        <>
          <FolderOpen size={15} strokeWidth={2} className="text-accent2" aria-hidden />
          Моите стратегии
          <span className="num font-normal text-muted">{strategies.length}</span>
        </>
      }
      right={<IconButton icon={Plus} label="Нова стратегия" size="sm" variant="glass" onClick={onNew} tooltipSide="left" />}
      bodyClass="p-2"
    >
      {strategies.length ? (
        <ul className="max-h-[min(60vh,520px)] space-y-0.5 overflow-y-auto">
          {strategies.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  aria-current={active || undefined}
                  className={cx(
                    "relative w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                    active ? "bg-accent/[0.12] text-text ring-1 ring-inset ring-accent/30" : "text-text/90 hover:bg-white/[0.04]",
                  )}
                >
                  {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent2" aria-hidden />}
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.name}</span>
                    {active && dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Незапазени промени" aria-label="Незапазени промени" />}
                  </span>
                  <span className="num mt-0.5 block text-[11px] text-muted">
                    {s.symbol} · {TF_LABEL[s.timeframe] ?? s.timeframe} · {s.rules_count} {s.rules_count === 1 ? "условие" : "условия"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact title="Още нямаш стратегии" description="Започни от празен builder или копирай шаблон от галерията отдолу." />
      )}
    </Card>
  );
}
