import { History, TriangleAlert } from "lucide-react";

import { examplesSplit, fmtValue } from "@/components/ai/model";
import type { ExamplesSummary } from "@/components/ai/types";
import { cx } from "@/lib/format";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5">
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className={cx("num text-[13px] font-semibold", tone ?? "text-text")}>{value}</div>
    </div>
  );
}

/**
 * HISTORICAL EXAMPLES: how price moved after similar past bars (count, median move in ATR, share that
 * reached +1R before −1R). Always labelled "past examples, not a forecast".
 */
export function ExamplesBlock({ examples, compact }: { examples: ExamplesSummary; compact?: boolean }) {
  const split = examplesSplit(examples);
  if (!examples.available || !examples.count || !split) {
    return (
      <p className="flex gap-2 text-[12.5px] leading-relaxed text-muted">
        <History size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
        {examples.summary || examples.reason || "Няма достатъчно подобни минали случаи — past examples, not a forecast."}
      </p>
    );
  }
  const median = examples.median_move_atr;
  return (
    <div className="@container space-y-2.5">
      <div className={cx("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-2 @md:grid-cols-4")}>
        <Kpi label="Случаи" value={String(examples.count)} />
        <Kpi label={`Медиана · ${examples.horizon ?? 10} св.`} value={median == null ? "—" : `${median > 0 ? "+" : ""}${fmtValue(median)} ATR`} />
        <Kpi label="+1R първо" value={`${split.plus}%`} tone="text-up" />
        <Kpi label="−1R първо" value={`${split.minus}%`} tone="text-down" />
      </div>
      <div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.05]" role="img" aria-label={`+1R първо ${split.plus}%, −1R първо ${split.minus}%, нито едно ${split.neither}%`}>
          <span className="h-full bg-up/70" style={{ width: `${split.plus}%` }} />
          <span className="h-full bg-down/70" style={{ width: `${split.minus}%` }} />
          <span className="h-full bg-white/15" style={{ width: `${split.neither}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-faint">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-up/70" aria-hidden /> +1R преди −1R
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-down/70" aria-hidden /> −1R първо
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-white/25" aria-hidden /> нито едно
          </span>
          {examples.r_unit && <span>1R = {examples.r_unit}</span>}
        </div>
      </div>
      {examples.criteria && <p className="text-[12px] leading-relaxed text-muted">Критерий: {examples.criteria}.</p>}
      {examples.reliable === false && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> Малка извадка — статистиката е ненадеждна.
        </p>
      )}
      <p className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted">
        {examples.note || "Минали примери (past examples, not a forecast)."}
      </p>
    </div>
  );
}
