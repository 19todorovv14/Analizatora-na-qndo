"use client";

import { ArrowRight, LogOut, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";

import { ConditionRow } from "@/components/strategy/ConditionRow";
import { MAX_CONDITIONS, starterCondition } from "@/components/strategy/meta";
import type { BlockKey, BlockV2, BuilderMeta, ConditionV2 } from "@/components/strategy/types";
import { IconButton, Segmented } from "@/components/ui";
import { cx } from "@/lib/format";

const TONE: Record<BlockKey, { ring: string; stripe: string; icon: typeof TrendingUp; ink: string; then: string }> = {
  entry_long: { ring: "border-up/25", stripe: "bg-up", icon: TrendingUp, ink: "text-up", then: "bg-up/10 text-up ring-up/25" },
  entry_short: { ring: "border-down/25", stripe: "bg-down", icon: TrendingDown, ink: "text-down", then: "bg-down/10 text-down ring-down/25" },
  exit_long: { ring: "border-white/[0.08]", stripe: "bg-white/20", icon: LogOut, ink: "text-muted", then: "bg-white/[0.05] text-text ring-white/10" },
  exit_short: { ring: "border-white/[0.08]", stripe: "bg-white/20", icon: LogOut, ink: "text-muted", then: "bg-white/[0.05] text-text ring-white/10" },
};

/** Default condition added by "+ Условие" (direction-aware) — re-exported from the pure DSL module. */
export { starterCondition };

export function BlockCard({
  blockKey,
  label,
  then,
  block,
  onChange,
  meta,
  advanced,
  beginner,
  readOnly,
  canRemove = true,
  compact,
}: {
  blockKey: BlockKey;
  label: string;
  then: string;
  block: BlockV2 | null;
  onChange: (b: BlockV2 | null) => void;
  meta: BuilderMeta;
  advanced: boolean;
  beginner: boolean;
  readOnly?: boolean;
  canRemove?: boolean;
  compact?: boolean;
}) {
  const t = TONE[blockKey];
  const Icon = t.icon;
  if (!block) {
    if (readOnly) return null;
    return (
      <button
        type="button"
        onClick={() => onChange({ logic: "all", conditions: [starterCondition(blockKey)] })}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-xl border border-dashed px-4 text-left text-sm text-muted transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-text",
          compact ? "py-2.5" : "py-3.5",
          t.ring,
        )}
      >
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04]", t.ink)}>
          <Plus size={15} strokeWidth={2} aria-hidden />
        </span>
        <span>
          Добави блок <b className="font-semibold text-text">{label}</b>
          <span className="block text-xs text-faint">THEN → {then}</span>
        </span>
      </button>
    );
  }

  const setCond = (i: number, c: ConditionV2) => onChange({ ...block, conditions: block.conditions.map((x, j) => (j === i ? c : x)) });
  const removeCond = (i: number) => {
    const next = block.conditions.filter((_, j) => j !== i);
    onChange(next.length ? { ...block, conditions: next } : null);
  };
  const logicOpts = (meta.logic ?? [
    { value: "all" as const, label: "AND", text: "всички условия" },
    { value: "any" as const, label: "OR", text: "поне едно условие" },
  ]).map((l) => ({ value: l.value, label: l.label, title: `${l.label} — ${l.text}` }));

  return (
    <div className={cx("relative overflow-hidden rounded-xl border bg-white/[0.015] pl-1", t.ring)}>
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[3px] opacity-70", t.stripe)} />
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-2.5">
        <Icon size={15} strokeWidth={2} className={t.ink} aria-hidden />
        <span className="text-[13px] font-semibold text-text">{label}</span>
        <span className="text-[11px] text-faint">
          {block.conditions.length} {block.conditions.length === 1 ? "условие" : "условия"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented size="sm" ariaLabel={`Логика за ${label}`} options={logicOpts} value={block.logic} onChange={(v) => onChange({ ...block, logic: v })} />
          {!readOnly && canRemove && <IconButton icon={Trash2} label={`Премахни блока ${label}`} size="sm" onClick={() => onChange(null)} className="hover:!text-down" />}
        </div>
      </div>
      <div className="space-y-1.5 px-3 pb-2">
        {block.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            index={i}
            logic={block.logic}
            value={c}
            onChange={(nc) => setCond(i, nc)}
            onRemove={() => removeCond(i)}
            meta={meta}
            advanced={advanced}
            beginner={beginner}
            readOnly={readOnly}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-3 py-2">
        {!readOnly && (
          <button
            type="button"
            disabled={block.conditions.length >= MAX_CONDITIONS}
            onClick={() => onChange({ ...block, conditions: [...block.conditions, starterCondition(blockKey)] })}
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent2 transition-colors hover:bg-accent/10 hover:text-text disabled:opacity-40"
          >
            <Plus size={13} strokeWidth={2.25} aria-hidden /> Условие
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
          THEN
          <ArrowRight size={12} strokeWidth={2.25} aria-hidden />
        </span>
        <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", t.then)}>{then}</span>
      </div>
    </div>
  );
}
