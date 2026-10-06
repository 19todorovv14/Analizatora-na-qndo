"use client";

import { Kbd } from "@/components/ui";
import { cx } from "@/lib/format";
import { hotkeyParts, useIsMac } from "@/lib/hotkeys";

/**
 * Renders a hotkey combo as key caps: "mod+k" → [Ctrl][K] (⌘ on macOS), "g d" → [G] › [D].
 * `parts` overrides the parsed combo (display-only rows such as [["Alt", "1…8"]]).
 */
export function ShortcutKeys({
  combo,
  parts,
  className,
  decorative,
}: {
  combo?: string;
  parts?: string[][];
  className?: string;
  /** hide from assistive tech (e.g. a hint inside a link whose name should stay the label) */
  decorative?: boolean;
}) {
  const isMac = useIsMac();
  const steps = parts ?? (combo ? hotkeyParts(combo, isMac) : []);
  return (
    <span aria-hidden={decorative || undefined} className={cx("inline-flex shrink-0 items-center gap-1", className)}>
      {steps.map((keys, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && (
            <span className="px-0.5 text-[10px] text-faint" aria-hidden>
              ›
            </span>
          )}
          {keys.map((k, j) => (
            <Kbd key={j}>{k}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
