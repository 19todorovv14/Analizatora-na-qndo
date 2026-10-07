"use client";

import { ScrollText } from "lucide-react";

import type { StrategyRow } from "@/components/strategy/types";
import { cx } from "@/lib/format";

const PREFIX_TONE: [RegExp, string][] = [
  [/^LONG setup/i, "text-up"],
  [/^SHORT setup/i, "text-down"],
  [/^Изход/i, "text-text"],
  [/^STOP/i, "text-down"],
  [/^TAKE PROFIT/i, "text-up"],
  [/^Риск/i, "text-warn"],
  [/^Режим/i, "text-info"],
];

/** One describe() line, e.g. "LONG setup: АКО Close > EMA(200) И …" with a toned prefix. */
export function RuleLine({ line, dense }: { line: string; dense?: boolean }) {
  const idx = line.indexOf(":");
  const head = idx > 0 && idx < 28 ? line.slice(0, idx) : "";
  const body = head ? line.slice(idx + 1) : line;
  const tone = PREFIX_TONE.find(([re]) => re.test(line))?.[1] ?? "text-text";
  return (
    <li
      className={cx(
        "rounded-lg border border-white/[0.05] bg-white/[0.02] leading-relaxed",
        dense ? "px-2 py-1.5 text-[11.5px]" : "px-2.5 py-2 text-[12.5px]",
      )}
    >
      {head && <span className={cx("mr-1 text-[10.5px] font-semibold uppercase tracking-[0.05em]", tone)}>{head}</span>}
      <span className="text-text/90">{body.trim()}</span>
    </li>
  );
}

/** Rules preview (describe() lines) for a saved strategy. `columns` lays the lines out in two columns on wide screens. */
export function RulesPreview({ lines, dense, className, columns }: { lines: string[]; dense?: boolean; className?: string; columns?: boolean }) {
  if (!lines.length) return null;
  return (
    <div className={cx("min-w-0", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
        <ScrollText size={12} strokeWidth={2} aria-hidden /> Правила
      </div>
      <ul className={cx(columns ? "grid gap-1.5 lg:grid-cols-2" : "space-y-1")}>
        {lines.map((l) => (
          <RuleLine key={l} line={l} dense={dense} />
        ))}
      </ul>
    </div>
  );
}

/** Strategy <select> grouped into "Моите стратегии" and "Шаблони". */
export function StrategySelect({
  strategies,
  value,
  onChange,
  id,
  className,
}: {
  strategies: StrategyRow[];
  value: number;
  onChange: (s: StrategyRow) => void;
  id?: string;
  className?: string;
}) {
  const mine = strategies.filter((s) => !s.is_template);
  const templates = strategies.filter((s) => s.is_template);
  return (
    <select
      id={id}
      className={cx("input", className)}
      value={value || ""}
      onChange={(e) => {
        const s = strategies.find((x) => x.id === Number(e.target.value));
        if (s) onChange(s);
      }}
    >
      {!value && <option value="">Избери стратегия…</option>}
      {mine.length > 0 && (
        <optgroup label="Моите стратегии">
          {mine.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {templates.length > 0 && (
        <optgroup label="Шаблони (образователни)">
          {templates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
