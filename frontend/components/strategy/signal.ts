/*
 * Pure helpers for evaluated signals (POST /strategies/check, GET /strategies/{id}/signal, a bot's last_signal):
 * block titles, the signal badge tone, active blocks and the per-condition value text. No React imports, so they
 * are unit-testable with `node --test`.
 */
import type { Tone } from "@/components/ui";

import { fmtValue } from "./dsl";
import type { BlockKey, BlockResult, ConditionResult } from "./types";

/** Walkthrough anchor: the LONG block of a checklist is titled "LONG setup". */
export const BLOCK_TITLE: Record<string, string> = {
  entry_long: "LONG setup",
  entry_short: "SHORT setup",
  exit_long: "Exit LONG",
  exit_short: "Exit SHORT",
};

const BLOCK_ORDER: BlockKey[] = ["entry_long", "entry_short", "exit_long", "exit_short"];

/** Badge tone for "LONG SETUP" / "SHORT SETUP" / "NO TRADE" / a bot's "WAIT". */
export function signalTone(signal?: string | null): Tone {
  if (!signal) return "neutral";
  const s = signal.toUpperCase();
  if (s.includes("LONG")) return "up";
  if (s.includes("SHORT")) return "down";
  if (s === "WAIT") return "info";
  return "neutral";
}

/** Ordered active blocks of an evaluation (entries first, then exits). */
export function activeBlocks(ev: Partial<Record<BlockKey, BlockResult>> | null | undefined): [BlockKey, BlockResult][] {
  if (!ev) return [];
  return BLOCK_ORDER.filter((k) => ev[k]?.active).map((k) => [k, ev[k] as BlockResult]);
}

/**
 * Detail line under a checklist row: "106,735 vs 104,665" for comparisons, "стойност: да (1)" for boolean
 * (structure / candle pattern) conditions and a warm-up note while the indicator has no value yet.
 */
export function conditionValueText(c: Pick<ConditionResult, "left" | "right">): string {
  if (c.left === null || c.left === undefined) return "Няма стойност още (warm-up на индикатора / структурата).";
  if (c.right === null || c.right === undefined) return `стойност: ${c.left > 0 ? "да (1)" : "не (0)"}`;
  return `${fmtValue(c.left)} vs ${fmtValue(c.right)}`;
}

/** null while the condition is still warming up (no value) — the checklist shows a neutral marker then. */
export function conditionPass(c: Pick<ConditionResult, "left" | "passed">): boolean | null {
  return c.left === null || c.left === undefined ? null : c.passed;
}

/** "3/5" style counter for a checklist header. */
export function passedCount(conditions: Pick<ConditionResult, "passed">[]): { passed: number; total: number } {
  return { passed: conditions.filter((c) => c.passed).length, total: conditions.length };
}
