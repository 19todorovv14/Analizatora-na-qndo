"use client";

import { ChevronDown, LogOut } from "lucide-react";
import { useState } from "react";

import { BlockCard } from "@/components/strategy/BlockCard";
import { BLOCK_FALLBACK, emptyDefinition, operandText, sameCondition, useBuilderMeta } from "@/components/strategy/meta";
import { PresetBar, type PresetTarget } from "@/components/strategy/PresetBar";
import { RiskSection } from "@/components/strategy/RiskCards";
import type { BlockKey, BlockV2, DefinitionV2, OperandV2 } from "@/components/strategy/types";
import { ErrorState, Section, Skeleton, SkeletonText } from "@/components/ui";
import { LearnHint } from "@/lib/workspace";
import { cx } from "@/lib/format";

// Legacy exports kept for other packages / old imports.
export { emptyDefinition };
export { REGIMES } from "@/components/strategy/meta";

/** v1-compatible operand label (now also handles structure operands). */
export function operandLabel(o: OperandV2): string {
  return operandText(o);
}

function BuilderSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

/**
 * Visual IF / AND / THEN builder (DSL v2): LONG / SHORT entry blocks, optional exits, presets, STOP / TARGET /
 * risk cards and the regime filter. Data-driven from GET /strategies/meta.
 */
export function StrategyBuilder({
  value,
  onChange,
  advanced,
  readOnly,
  beginner,
}: {
  value: DefinitionV2;
  onChange: (d: DefinitionV2) => void;
  advanced: boolean;
  readOnly?: boolean;
  /** plain-language helper lines under each condition (defaults to !advanced) */
  beginner?: boolean;
}) {
  const { data: meta, error, mutate } = useBuilderMeta();
  const [target, setTarget] = useState<PresetTarget>("entry_long");
  const [exitsOpen, setExitsOpen] = useState(false);

  if (error && !meta) return <ErrorState title="Builder-ът не можа да се зареди" description="Метаданните за индикатори и условия не са достъпни." onRetry={() => mutate()} />;
  if (!meta) return <BuilderSkeleton />;

  const blocks = meta.blocks?.length ? meta.blocks : BLOCK_FALLBACK;
  const info = (k: BlockKey) => blocks.find((b) => b.key === k) ?? BLOCK_FALLBACK.find((b) => b.key === k)!;
  const setBlock = (k: BlockKey, b: BlockV2 | null) => onChange({ ...value, [k]: b });
  const hasExits = !!(value.exit_long || value.exit_short);
  const showExits = exitsOpen || hasExits;
  const plain = beginner ?? !advanced;

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-5">
      {!readOnly && (
        <PresetBar
          meta={meta}
          target={target}
          onTarget={setTarget}
          block={value[target]}
          onAdd={(p) => {
            const cur = value[target];
            if (cur?.conditions.some((c) => sameCondition(c, p.condition))) return;
            const cond = JSON.parse(JSON.stringify(p.condition));
            setBlock(target, cur ? { ...cur, conditions: [...cur.conditions, cond].slice(0, 12) } : { logic: "all", conditions: [cond] });
          }}
        />
      )}

      <Section title="Entry rules · IF → THEN">
        <div className="space-y-3">
          <LearnHint>
            Всяко условие се проверява на <b className="text-text">затворена свещ</b>. С AND всички трябва да са изпълнени едновременно; с OR —
            поне едно. Резултатът е само <b className="text-text">потенциален setup</b>, не поръчка.
          </LearnHint>
          {(["entry_long", "entry_short"] as const).map((k) => (
            <BlockCard
              key={k}
              blockKey={k}
              label={info(k).label}
              then={info(k).then}
              block={value[k]}
              onChange={(b) => setBlock(k, b)}
              meta={meta}
              advanced={advanced}
              beginner={plain}
              readOnly={readOnly}
              canRemove={!!value[k === "entry_long" ? "entry_short" : "entry_long"]}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Exit rules (по избор)"
        right={
          !hasExits && !readOnly ? (
            <button
              type="button"
              onClick={() => setExitsOpen((o) => !o)}
              aria-expanded={showExits}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent2 hover:text-text"
            >
              {showExits ? "Скрий" : "Покажи"}
              <ChevronDown size={13} strokeWidth={2.25} className={cx("transition-transform", showExits && "rotate-180")} aria-hidden />
            </button>
          ) : undefined
        }
      >
        {showExits ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {(["exit_long", "exit_short"] as const).map((k) => (
              <BlockCard
                key={k}
                blockKey={k}
                label={info(k).label}
                then={info(k).then}
                block={value[k]}
                onChange={(b) => setBlock(k, b)}
                meta={meta}
                advanced={advanced}
                beginner={plain}
                readOnly={readOnly}
                compact
              />
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-faint">
            <LogOut size={13} strokeWidth={2} aria-hidden />
            Без exit правила позицията се затваря от STOP или TARGET.
          </p>
        )}
      </Section>

      <Section title="Risk management · STOP / TARGET">
        <RiskSection value={value} onChange={onChange} meta={meta} advanced={advanced} />
      </Section>
    </fieldset>
  );
}

/** Fresh starter definition (copy, so callers can mutate). */
export function starterDefinition(): DefinitionV2 {
  return emptyDefinition();
}
