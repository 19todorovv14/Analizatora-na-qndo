"use client";

import { Check, ChevronDown, Plus, Zap } from "lucide-react";

import { PRESET_GROUP_LABEL, featuredPresets, sameCondition } from "@/components/strategy/meta";
import type { BlockV2, BuilderMeta, PresetMeta } from "@/components/strategy/types";
import { Segmented, useStoredState } from "@/components/ui";
import { cx } from "@/lib/format";

export type PresetTarget = "entry_long" | "entry_short";

const GROUP_ORDER = ["trend", "momentum", "structure", "volume", "candle_pattern"];

const SIDE_DOT: Record<string, string> = { long: "bg-up", short: "bg-down", both: "bg-accent2" };

function PresetChip({ p, added, offSide, onAdd }: { p: PresetMeta; added: boolean; offSide: boolean; onAdd: () => void }) {
  return (
    <button
      type="button"
      disabled={added}
      onClick={onAdd}
      title={offSide ? `Обичайно за ${p.side === "long" ? "LONG" : "SHORT"} setup` : undefined}
      aria-label={`Добави „${p.label}“`}
      className={cx(
        "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-[background-color,border-color,color,opacity] duration-150",
        added
          ? "cursor-default border-accent/30 bg-accent/10 text-accent2"
          : "border-white/[0.08] bg-white/[0.03] text-text hover:border-white/20 hover:bg-white/[0.07]",
        offSide && !added && "opacity-55 hover:opacity-100",
      )}
    >
      <span aria-hidden className={cx("h-1.5 w-1.5 shrink-0 rounded-full", SIDE_DOT[p.side] ?? "bg-faint")} />
      {p.label}
      {added ? <Check size={12} strokeWidth={2.5} aria-hidden /> : <Plus size={12} strokeWidth={2.25} className="text-faint" aria-hidden />}
    </button>
  );
}

/**
 * Presets row: "Price > EMA 200", "RSI > 50", "Higher High", "Volume > Average", "EMA 20 crosses above EMA 50"…
 * One click adds the condition to the chosen block. The full grouped catalogue (trend / momentum / structure /
 * volume / candle patterns) opens on demand and the choice is remembered per viewer.
 */
export function PresetBar({
  meta,
  target,
  onTarget,
  block,
  onAdd,
}: {
  meta: BuilderMeta;
  target: PresetTarget;
  onTarget: (t: PresetTarget) => void;
  block: BlockV2 | null;
  onAdd: (p: PresetMeta) => void;
}) {
  const [expanded, setExpanded] = useStoredState<boolean>("ta-s6-presets-open", false);
  const presets = meta.presets ?? [];
  if (!presets.length) return null;
  const wantSide = target === "entry_long" ? "long" : "short";
  const featured = featuredPresets(presets, wantSide);
  const groups = GROUP_ORDER.filter((g) => presets.some((p) => p.group === g)).concat(
    [...new Set(presets.map((p) => p.group))].filter((g) => !GROUP_ORDER.includes(g)),
  );
  const chip = (p: PresetMeta) => (
    <PresetChip
      key={p.key}
      p={p}
      added={!!block?.conditions.some((c) => sameCondition(c, p.condition))}
      offSide={p.side !== "both" && p.side !== wantSide}
      onAdd={() => onAdd(p)}
    />
  );

  return (
    <div className="glass-inset p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          <Zap size={13} strokeWidth={2} className="text-gold" aria-hidden />
          Бързи условия
        </span>
        <span className="hidden text-[11px] text-faint sm:inline">— клик добавя в</span>
        <Segmented
          size="sm"
          ariaLabel="Към кой блок се добавят бързите условия"
          value={target}
          onChange={onTarget}
          options={[
            { value: "entry_long", label: "LONG entry" },
            { value: "entry_short", label: "SHORT entry" },
          ]}
        />
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-accent2 transition-colors hover:text-text"
        >
          {expanded ? "По-малко" : `Всички условия (${presets.length})`}
          <ChevronDown size={13} strokeWidth={2.25} className={cx("transition-transform", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>

      {!expanded && <div className="mt-2.5 flex flex-wrap gap-1.5">{featured.map(chip)}</div>}

      {expanded && (
        <>
          <div className="mt-2.5 space-y-1.5">
            {groups.map((g) => (
              <div key={g} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                <div className="w-28 shrink-0 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{PRESET_GROUP_LABEL[g] ?? g}</div>
                <div className="flex min-w-0 flex-wrap gap-1">{presets.filter((p) => p.group === g).map(chip)}</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10.5px] text-faint">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-up" aria-hidden /> LONG
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-down" aria-hidden /> SHORT
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2" aria-hidden /> и двете
            </span>
          </div>
        </>
      )}
    </div>
  );
}
