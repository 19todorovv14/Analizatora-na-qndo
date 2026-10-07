"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { Caption, MiniSelect, NumField } from "@/components/strategy/fields";
import {
  IND_LABEL,
  PRICE_LABEL,
  UI_KIND_LABEL,
  conditionSentence,
  defaultOperand,
  hasExtras,
  needsRight,
  operandTerm,
  operatorList,
  structureOf,
  uiKind,
  uiKinds,
  withLeft,
  withOperator,
  type UiKind,
} from "@/components/strategy/meta";
import type { BuilderMeta, ConditionV2, OperandV2 } from "@/components/strategy/types";
import { GlossaryTip, IconButton, InfoTip } from "@/components/ui";
import { useExplain } from "@/lib/explain";
import { GLOSSARY } from "@/lib/glossary";
import { cx } from "@/lib/format";

export { conditionSentence };

const PARAM_LABEL: Record<string, string> = { period: "N", fast: "fast", slow: "slow", signal: "signal", mult: "σ", left: "L", right: "R" };
const PARAM_TITLE: Record<string, string> = {
  period: "Период (брой свещи)",
  fast: "Бърз период",
  slow: "Бавен период",
  signal: "Signal период",
  mult: "Множител на стандартното отклонение",
  left: "Свещи вляво от swing pivot",
  right: "Свещи вдясно — pivot-ът се потвърждава след толкова свещи (без lookahead)",
};

function ParamInput({
  name,
  value,
  onChange,
  min = 1,
  max = 500,
  integer = true,
}: {
  name: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1 text-[10.5px] font-medium text-faint" title={PARAM_TITLE[name] ?? name}>
      {PARAM_LABEL[name] ?? name}
      <NumField value={value} onChange={onChange} min={min} max={max} integer={integer} step={1} ariaLabel={PARAM_TITLE[name] ?? name} className="w-14" />
    </label>
  );
}

/**
 * Edits one operand: type → name / field / value → params. `extras` adds the multiplier (× n) and "bars back"
 * fields; `advanced` adds the swing pivot L/R params of structure operands.
 */
export function OperandEditor({
  value,
  onChange,
  meta,
  advanced,
  extras = false,
  side,
}: {
  value: OperandV2;
  onChange: (o: OperandV2) => void;
  meta: BuilderMeta;
  advanced: boolean;
  extras?: boolean;
  side: "left" | "right";
}) {
  const kind = uiKind(value, meta);
  const ind = value.kind === "indicator" && value.name ? meta.indicators[value.name] : null;
  const struct = value.kind === "structure" ? structureOf(meta, value.name) : undefined;
  const swingParams = value.kind === "structure" && struct && Object.keys(struct.params ?? {}).length > 0;
  const sp = meta.structure_params;
  return (
    <div className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg bg-black/20 p-1 ring-1 ring-inset ring-white/[0.06]">
      <MiniSelect
        ariaLabel={side === "left" ? "Тип на левия операнд" : "Тип на десния операнд"}
        value={kind}
        onChange={(k) => onChange(defaultOperand(k as UiKind, meta))}
        className="text-muted"
      >
        {uiKinds(meta).map((k) => (
          <option key={k} value={k}>
            {UI_KIND_LABEL[k]}
          </option>
        ))}
      </MiniSelect>

      {value.kind === "value" && (
        <NumField value={value.value ?? 0} onChange={(v) => onChange({ ...value, value: v })} ariaLabel="Стойност" className="w-20" step={1} />
      )}

      {value.kind === "price" && (
        <MiniSelect ariaLabel="Поле на свещта" value={value.field ?? "close"} onChange={(f) => onChange({ ...value, field: f })}>
          {meta.price_fields.map((f) => (
            <option key={f} value={f}>
              {PRICE_LABEL[f] ?? f}
            </option>
          ))}
        </MiniSelect>
      )}

      {value.kind === "indicator" && (
        <>
          <MiniSelect
            ariaLabel="Индикатор"
            value={value.name ?? ""}
            onChange={(name) => {
              const cat = meta.indicators[name];
              onChange({ ...value, name, params: { ...(cat?.params ?? {}) }, output: cat?.outputs[0] ?? "value" });
            }}
          >
            {Object.keys(meta.indicators).map((n) => (
              <option key={n} value={n}>
                {IND_LABEL[n] ?? n.toUpperCase()}
              </option>
            ))}
          </MiniSelect>
          {ind &&
            Object.keys(ind.params).map((p) => (
              <ParamInput
                key={p}
                name={p}
                value={Number(value.params?.[p] ?? ind.params[p])}
                integer={p !== "mult"}
                min={p === "mult" ? 0.1 : 1}
                max={p === "mult" ? 10 : 500}
                onChange={(v) => onChange({ ...value, params: { ...ind.params, ...value.params, [p]: v } })}
              />
            ))}
          {ind && ind.outputs.length > 1 && (
            <MiniSelect ariaLabel="Изход на индикатора" value={value.output ?? ind.outputs[0]} onChange={(o) => onChange({ ...value, output: o })}>
              {ind.outputs.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </MiniSelect>
          )}
        </>
      )}

      {value.kind === "structure" && (
        <>
          <MiniSelect
            ariaLabel={kind === "candle_pattern" ? "Свещна формация" : "Пазарна структура"}
            value={value.name ?? ""}
            onChange={(name) => onChange({ kind: "structure", name, params: {}, shift: value.shift, mult: value.mult })}
          >
            {(meta.structures ?? [])
              .filter((s) => (kind === "candle_pattern" ? s.group === "candle_pattern" : s.group !== "candle_pattern"))
              .map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}
                </option>
              ))}
          </MiniSelect>
          {struct && <InfoTip text={struct.description} className="mx-0.5" />}
          {advanced &&
            swingParams &&
            (["left", "right"] as const).map((p) => (
              <ParamInput
                key={p}
                name={p}
                min={sp?.min ?? 1}
                max={sp?.max ?? 20}
                value={Number(value.params?.[p] ?? sp?.defaults[p] ?? 3)}
                onChange={(v) => onChange({ ...value, params: { left: sp?.defaults.left ?? 3, right: sp?.defaults.right ?? 3, ...value.params, [p]: v } })}
              />
            ))}
        </>
      )}

      {extras && value.kind !== "value" && (
        <>
          <label className="inline-flex items-center gap-1 text-[10.5px] font-medium text-faint" title="Множител (напр. Volume > 1.5 × average)">
            ×
            <NumField
              value={value.mult ?? 1}
              min={0.01}
              max={100}
              step={0.1}
              onChange={(v) => onChange({ ...value, mult: v > 0 ? v : 1 })}
              ariaLabel="Множител"
              className="w-14"
            />
          </label>
          <label className="inline-flex items-center gap-1 text-[10.5px] font-medium text-faint" title="Брой свещи назад (0 = текущата затворена свещ)">
            назад
            <NumField
              value={value.shift ?? 0}
              min={0}
              max={50}
              integer
              step={1}
              onChange={(v) => onChange({ ...value, shift: v })}
              ariaLabel="Свещи назад"
              className="w-12"
            />
          </label>
        </>
      )}
    </div>
  );
}

/** One condition as a readable sentence: IF/AND/OR · left operand · operator · right operand (hidden for is true / is false). */
export function ConditionRow({
  index,
  logic,
  value,
  onChange,
  onRemove,
  meta,
  advanced,
  beginner,
  readOnly,
}: {
  index: number;
  logic: "all" | "any";
  value: ConditionV2;
  onChange: (c: ConditionV2) => void;
  onRemove: () => void;
  meta: BuilderMeta;
  advanced: boolean;
  beginner: boolean;
  readOnly?: boolean;
}) {
  const showRight = needsRight(value.op, meta);
  const ops = operatorList(meta);
  const connector = index === 0 ? "IF" : logic === "all" ? "AND" : "OR";
  const used = hasExtras(value.left) || (showRight && hasExtras(value.right));
  const [extrasOpen, setExtrasOpen] = useState(false);
  // extras stay visible while a condition uses them (otherwise the × / bars-back values would be hidden)
  const extras = advanced && (extrasOpen || used);
  const { explain } = useExplain();
  // explain mode: glossary cards for the indicators / structures used in the sentence
  const terms = [...new Set([operandTerm(value.left), showRight && value.right ? operandTerm(value.right) : undefined])].filter(
    (k): k is string => !!k && !!GLOSSARY[k],
  );

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
      <div className="flex min-w-0 items-start gap-1.5">
        {/* the connector has its own column so wrapped operands line up under the sentence, not under "IF" */}
        <span
          className={cx(
            "mt-2 inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold tracking-[0.06em]",
            index === 0 ? "bg-accent/15 text-accent2" : "bg-white/[0.05] text-muted",
          )}
        >
          {connector}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <OperandEditor value={value.left} onChange={(l) => onChange(withLeft(value, l, meta))} meta={meta} advanced={advanced} extras={extras} side="left" />
          <MiniSelect ariaLabel="Оператор" value={value.op} onChange={(op) => onChange(withOperator(value, op, meta))} className="!text-accent2 font-semibold">
            {ops.map((o) => (
              <option key={o.op} value={o.op} title={o.text}>
                {o.label}
              </option>
            ))}
          </MiniSelect>
          {showRight && value.right && (
            <OperandEditor
              value={value.right}
              onChange={(r) => onChange({ ...value, right: r })}
              meta={meta}
              advanced={advanced}
              extras={extras}
              side="right"
            />
          )}
        </div>
        {!readOnly && (
          <span className="inline-flex shrink-0 items-center gap-0.5 pt-1.5">
            {advanced && (
              <IconButton
                icon={SlidersHorizontal}
                label={used ? "Множител / свещи назад (използвани)" : extras ? "Скрий множител / свещи назад" : "Множител / свещи назад"}
                size="sm"
                active={extras}
                onClick={() => setExtrasOpen((o) => !o)}
                disabled={used}
                tooltipSide="left"
              />
            )}
            <IconButton icon={X} label="Премахни условието" size="sm" onClick={onRemove} className="hover:!text-down" tooltipSide="left" />
          </span>
        )}
      </div>
      {beginner && (
        <div className="mt-1 flex items-start gap-1.5 pl-[46px] text-[11px] leading-4 text-muted">
          <Caption className="shrink-0 pt-px !text-[9.5px]">значи</Caption>
          <span className="min-w-0">{conditionSentence(value, meta)}</span>
          {explain && terms.map((k) => <GlossaryTip key={k} k={k} className="shrink-0" />)}
        </div>
      )}
    </div>
  );
}
