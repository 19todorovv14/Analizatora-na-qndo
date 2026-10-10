"use client";

/* Live score HUD of an active replay: score ring, decisions / correct / wrong / total R, open predictions and flags. */
import { flagLabel } from "@/components/replay/model";
import { ScoreRing } from "@/components/replay/parts";
import type { DecisionsSummary, LiveScore, ReplayOptions } from "@/components/replay/types";
import { Term } from "@/components/ui";
import { cx, fmtR } from "@/lib/format";

const WARN_FLAGS = new Set(["chased", "entered_too_early", "ignored_structure", "counter_trend", "poor_rr", "stop_in_noise"]);

export function ScoreHud({
  score,
  summary,
  flagOptions,
  className,
}: {
  score: LiveScore | null | undefined;
  summary: DecisionsSummary | null | undefined;
  flagOptions?: ReplayOptions["flags"] | null;
  className?: string;
}) {
  const s = summary;
  const flags = Object.entries(s?.flags ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <section className={cx("card min-w-0", className)} aria-label="Live score">
      <div className="flex items-center gap-3.5 p-3.5">
        <ScoreRing score={score?.value ?? null} grade={score?.grade ?? null} size={68} label="live" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-text">Live score</h2>
            <span className="text-[11px] text-faint">
              {score?.pending ? `${score.pending} в изчакване` : score?.scored ? `${score.scored} оценени` : "още няма решения"}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-4 gap-1.5 text-center">
            <Cell label="Решения" value={s?.total ?? 0} />
            <Cell label="Верни" value={s?.correct ?? 0} tone="text-up" />
            <Cell label="Грешни" value={s?.wrong ?? 0} tone="text-down" />
            <Cell
              label={<Term k="r">Общо R</Term>}
              value={s?.total_r !== null && s?.total_r !== undefined ? fmtR(s.total_r) : "—"}
              tone={s?.total_r ? (s.total_r > 0 ? "text-up" : "text-down") : undefined}
            />
          </dl>
        </div>
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] px-3.5 py-2.5">
          {flags.map(([key, n]) => (
            <span
              key={key}
              className={cx(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                WARN_FLAGS.has(key) ? "bg-warn/10 text-warn ring-warn/25" : "bg-info/10 text-info ring-info/20",
              )}
            >
              {flagLabel(key, flagOptions)}
              <span className="num opacity-80">×{n}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Cell({ label, value, tone }: { label: React.ReactNode; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-md bg-white/[0.03] px-1 py-1">
      <dt className="truncate text-[10px] text-faint">{label}</dt>
      <dd className={cx("num text-sm font-semibold", tone ?? "text-text")}>{value}</dd>
    </div>
  );
}
