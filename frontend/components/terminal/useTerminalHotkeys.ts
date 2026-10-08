"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Tool } from "@/components/charts/drawings";
import { createNavTracker, letterBindings, timeframeBindings } from "@/components/terminal/model";
import { useHotkeys } from "@/lib/hotkeys";

export type TerminalHotkeys = {
  onTimeframe?: (tf: string) => void;
  onTool?: (t: Tool) => void;
  /** B / S — switch the order side (not while typing) */
  onSide?: (side: "buy" | "sell") => void;
  /** "]" */
  toggleRight?: () => void;
  /** "\" */
  toggleBottom?: () => void;
  enabled?: boolean;
};

/**
 * Terminal keyboard: Alt+1…8 timeframes, H / T / R / M drawing tools, Esc → cursor, B / S order side,
 * "]" right panel, "\" bottom panel. Keys typed in inputs are ignored (useHotkeys). Letter keys do not
 * preventDefault and skip the second key of the shell's "g x" navigation, so "g t" still navigates.
 */
export function useTerminalHotkeys({ onTimeframe, onTool, onSide, toggleRight, toggleBottom, enabled = true }: TerminalHotkeys): void {
  // the key before the current one (window capture phase runs before every bubbling hotkey listener)
  const [nav] = useState(createNavTracker);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => nav.record(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled, nav]);

  // Esc → cursor tool (useHotkeys never binds Escape; dialogs keep handling their own Esc)
  const toolRef = useRef(onTool);
  useEffect(() => {
    toolRef.current = onTool;
  });
  useEffect(() => {
    if (!enabled) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") toolRef.current?.("cursor");
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [enabled]);

  const tfKeys = useMemo(() => (onTimeframe ? timeframeBindings(onTimeframe) : {}), [onTimeframe]);
  const letters = useMemo(() => letterBindings({ onTool, onSide, toggleRight, toggleBottom }, nav.skip), [onTool, onSide, toggleRight, toggleBottom, nav]);
  useHotkeys(tfKeys, { enabled });
  useHotkeys(letters, { enabled, preventDefault: false });
}
