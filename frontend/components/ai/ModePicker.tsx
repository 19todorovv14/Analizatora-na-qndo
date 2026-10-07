"use client";

import { modeIcon } from "@/components/ai/icons";
import { DEFAULT_MODES } from "@/components/ai/model";
import type { ModeInfo, TeacherMode } from "@/components/ai/types";
import { cx } from "@/lib/format";

export type ModePickerProps = {
  value: TeacherMode;
  onChange: (mode: TeacherMode) => void;
  /** modes from GET /teacher/modes (useTeacherModes); defaults to the built-in list of 8 */
  modes?: ModeInfo[];
  /** one scrollable row of icon + label chips (description in the tooltip) */
  compact?: boolean;
  disabled?: boolean;
  /** restrict to these modes (e.g. ["explain", "why"]) */
  only?: TeacherMode[];
  className?: string;
};

/**
 * MODE selector: the 8 teacher modes as chips with icons + one-line descriptions (aria-pressed buttons;
 * the full description is the chip title).
 * Grid of 2 columns in a side panel, 4 columns when the container is ≥ 42rem.
 */
export function ModePicker({ value, onChange, modes = DEFAULT_MODES, compact, disabled, only, className }: ModePickerProps) {
  const list = only ? modes.filter((m) => only.includes(m.key)) : modes;

  if (compact) {
    return (
      <div role="group" aria-label="Режим на учителя" className={cx("no-scrollbar flex gap-1 overflow-x-auto", className)}>
        {list.map((m) => {
          const Icon = modeIcon(m.key, m.icon);
          const on = m.key === value;
          return (
            <button
              key={m.key}
              type="button"
              title={m.description}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(m.key)}
              className={cx(
                "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold tracking-[0.03em] transition-colors disabled:opacity-45",
                on ? "border-accent/40 bg-accent/15 text-accent2" : "border-white/[0.08] bg-white/[0.03] text-muted hover:border-white/15 hover:text-text",
              )}
            >
              <Icon size={13} strokeWidth={1.9} aria-hidden />
              {m.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cx("@container", className)}>
      <div role="group" aria-label="Режим на учителя" className="grid grid-cols-2 gap-1.5 @2xl:grid-cols-4">
        {list.map((m) => {
          const Icon = modeIcon(m.key, m.icon);
          const on = m.key === value;
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={on}
              title={m.description}
              disabled={disabled}
              onClick={() => onChange(m.key)}
              className={cx(
                "group relative flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45",
                on
                  ? "border-accent/45 bg-gradient-to-b from-accent/[0.16] to-accent/[0.06] shadow-glow"
                  : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]",
              )}
            >
              <span
                className={cx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors",
                  on ? "bg-accent/25 text-white ring-accent/45" : "bg-white/[0.05] text-muted ring-white/10 group-hover:text-text",
                )}
              >
                <Icon size={14} strokeWidth={1.9} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx("block truncate text-[11.5px] font-semibold tracking-[0.04em]", on ? "text-text" : "text-text/90")}>{m.label}</span>
                <span className="block truncate text-[10.5px] leading-[1.35] text-muted">{m.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
