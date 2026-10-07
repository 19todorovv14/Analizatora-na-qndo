"use client";

import { Brain, CircleSlash } from "lucide-react";

import { CONTEXT_ICON } from "@/components/ai/icons";
import { contextCoverage, contextRows } from "@/components/ai/model";
import type { ContextItem } from "@/components/ai/types";
import { Skeleton, Tooltip } from "@/components/ui";
import { cx } from "@/lib/format";

function ChipDetails({ item }: { item: ContextItem }) {
  const rows = contextRows(item);
  return (
    <div className="w-64 max-w-full space-y-2 text-left">
      <div className="text-[12px] font-semibold text-text">{item.label}</div>
      {item.detail && <div className="text-[11.5px] leading-relaxed text-muted">{item.detail}</div>}
      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/[0.07] pt-2 text-[11.5px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint">{k}</dt>
              <dd className="num min-w-0 truncate text-right text-text" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        !item.available && <div className="text-[11px] text-faint">Учителят няма тези данни и не ги измисля.</div>
      )}
    </div>
  );
}

/**
 * "What the teacher knows": one chip per context section (chart, strategy, historical examples, account,
 * trades, journal, learning, backtest). Available sections are lit; click (or hover/focus) a chip for
 * the exact values the teacher used.
 */
export function ContextChips({
  items,
  loading,
  compact,
  className,
}: {
  items: ContextItem[] | undefined;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { available, total } = contextCoverage(items);
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
        <Brain size={12} strokeWidth={2} className="text-accent2" aria-hidden />
        Какво знае учителят
        <span className="font-normal normal-case tracking-normal text-faint">· What the teacher knows</span>
        {total > 0 && (
          <span className="num ml-auto font-medium normal-case tracking-normal text-faint">
            {available}/{total}
          </span>
        )}
      </div>
      {loading && !items?.length ? (
        <div className="flex flex-wrap gap-1.5" aria-busy="true">
          {[88, 72, 110, 80, 64].map((w, i) => (
            <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
          ))}
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {(items ?? []).map((item) => {
            const Icon = CONTEXT_ICON[item.key] ?? Brain;
            return (
              <li key={item.key}>
                <Tooltip content={<ChipDetails item={item} />} pinOnClick interactive side="bottom" align="start" maxWidth={300}>
                  <button
                    type="button"
                    aria-label={`${item.label}${item.available ? "" : " — няма данни"}`}
                    className={cx(
                      "inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border text-[11.5px] font-medium transition-colors",
                      compact ? "h-6 px-2" : "h-7 px-2.5",
                      item.available
                        ? "border-accent/25 bg-accent/[0.08] text-text hover:border-accent/45 hover:bg-accent/[0.14]"
                        : "border-dashed border-white/10 bg-transparent text-faint hover:text-muted",
                    )}
                  >
                    {item.available ? (
                      <Icon size={12} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
                    ) : (
                      <CircleSlash size={12} strokeWidth={2} className="shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{item.label}</span>
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
