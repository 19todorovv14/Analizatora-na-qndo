import { Equal, Scale } from "lucide-react";

import { NumText } from "@/components/ai/AnswerLine";
import type { Comparison } from "@/components/ai/types";
import { cx } from "@/lib/format";

const NA = "DATA NOT AVAILABLE";

function Cell({ value, different, available }: { value: string; different: boolean; available: boolean }) {
  if (!available || value === NA)
    return <span className="text-[10.5px] font-semibold tracking-[0.08em] text-faint">{NA}</span>;
  return (
    <span className={cx("min-w-0 break-words", different ? "text-text" : "text-muted")}>
      <NumText text={value} />
    </span>
  );
}

/**
 * COMPARE answer: two-column comparison (regime, structure, volatility, momentum, distance to levels,
 * strategy fit, decision). Rows that differ are marked; it describes differences, never a prediction.
 * Container-query layout: a table when ≥ 28rem wide, stacked rows below that.
 */
export function CompareTable({ comparison, className }: { comparison: Comparison; className?: string }) {
  const { left, right, rows } = comparison;
  const diff = rows.filter((r) => r.different).length;
  return (
    <div className={cx("@container", className)}>
      <div className="overflow-hidden rounded-lg border border-white/[0.07]">
        <div className="hidden grid-cols-[minmax(7rem,0.9fr)_1fr_1fr] gap-3 border-b border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted @md:grid">
          <span>Показател</span>
          <span className="truncate text-text">{left.label}</span>
          <span className="truncate text-text">{right.label}</span>
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.key}
              className={cx(
                "grid gap-x-3 gap-y-1 border-b border-white/[0.05] px-3 py-2 text-[12.5px] leading-snug last:border-0 @md:grid-cols-[minmax(7rem,0.9fr)_1fr_1fr]",
                r.different && "bg-accent/[0.035]",
              )}
            >
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                {r.different ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent2" title="Различава се" aria-label="Различава се" />
                ) : (
                  <Equal size={11} className="shrink-0 text-faint" aria-label="Еднакво" />
                )}
                {r.label}
              </span>
              <span className="flex min-w-0 gap-1.5">
                <span className="w-9 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint @md:hidden">A</span>
                <Cell value={r.left} different={r.different} available={left.available} />
              </span>
              <span className="flex min-w-0 gap-1.5">
                <span className="w-9 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint @md:hidden">B</span>
                <Cell value={r.right} different={r.different} available={right.available} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
        <span className="@md:hidden">
          <b className="font-semibold text-text">A</b> = {left.label} · <b className="font-semibold text-text">B</b> = {right.label}
        </span>
        <span className="flex items-center gap-1.5">
          <Scale size={12} className="text-faint" aria-hidden />
          {diff} от {rows.length} показателя се различават. {comparison.note ?? "Това са разлики, не прогноза (differences, not a prediction)."}
        </span>
      </div>
    </div>
  );
}
