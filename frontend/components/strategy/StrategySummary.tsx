"use client";

import { CircleCheck, CircleX, Layers, SlidersHorizontal } from "lucide-react";
import useSWR from "swr";

import { SETUP_DISCLAIMER, type DefinitionV2, type DescribeResponse } from "@/components/strategy/types";
import { Badge, InfoTip, Meter, SkeletonText } from "@/components/ui";
import { post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

const PREFIX_TONE: [RegExp, string][] = [
  [/^LONG setup/i, "text-up"],
  [/^SHORT setup/i, "text-down"],
  [/^Изход/i, "text-text"],
  [/^STOP/i, "text-down"],
  [/^TAKE PROFIT/i, "text-up"],
  [/^Риск/i, "text-warn"],
  [/^Режим/i, "text-info"],
];

function SummaryLine({ line }: { line: string }) {
  const idx = line.indexOf(":");
  const head = idx > 0 ? line.slice(0, idx) : "";
  const body = idx > 0 ? line.slice(idx + 1) : line;
  const tone = PREFIX_TONE.find(([re]) => re.test(line))?.[1] ?? "text-text";
  return (
    <li className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-[12.5px] leading-relaxed">
      {head && <span className={cx("mr-1 text-[11px] font-semibold uppercase tracking-[0.05em]", tone)}>{head}</span>}
      <span className="text-text/90">{body.replace(/ АКО /, " АКО ").trim()}</span>
    </li>
  );
}

/** Live plain-language summary of the (unsaved) definition via POST /strategies/describe (debounced). */
export function StrategySummary({ definition, beginner }: { definition: DefinitionV2; beginner: boolean }) {
  const body = useDebounced(JSON.stringify(definition), 350);
  const { data, error, isLoading } = useSWR<DescribeResponse>(
    ["/strategies/describe", body],
    ([path, b]: [string, string]) => post<DescribeResponse>(path, { definition: JSON.parse(b) }),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  if (!data && (isLoading || !error)) return <SkeletonText lines={4} />;
  if (!data) return <p className="text-sm text-muted">Обобщението не е достъпно в момента.</p>;

  const params = data.parameters;
  const complexity = params <= 6 ? "ниска" : params <= 10 ? "умерена" : "висока";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {data.valid ? (
          <Badge tone="up">
            <CircleCheck size={11} strokeWidth={2.5} aria-hidden /> валидна
          </Badge>
        ) : (
          <Badge tone="down">
            <CircleX size={11} strokeWidth={2.5} aria-hidden /> невалидна
          </Badge>
        )}
        {isLoading && <span className="text-[11px] text-faint">обновяване…</span>}
      </div>
      {data.valid ? (
        <ul className="space-y-1.5">
          {data.summary.map((l) => (
            <SummaryLine key={l} line={l} />
          ))}
        </ul>
      ) : (
        <ul className="space-y-1.5" role="alert">
          {data.errors.map((e, i) => (
            <li key={i} className="rounded-lg border border-down/25 bg-down/[0.06] px-2.5 py-2 text-xs text-down">
              {e.loc && <span className="num mr-1 text-faint">{e.loc}</span>}
              {e.msg.replace(/^Value error, /, "")}
            </li>
          ))}
        </ul>
      )}
      {data.valid && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted">
              <Layers size={11} strokeWidth={2} aria-hidden /> Условия
            </div>
            <div className="num mt-0.5 text-base font-semibold text-text">{data.conditions}</div>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted">
              <SlidersHorizontal size={11} strokeWidth={2} aria-hidden /> Параметри
              <InfoTip text="Числови параметри (периоди, прагове, stop, target). Повече параметри = повече възможности за напасване към миналото (overfitting)." />
            </div>
            <div className="num mt-0.5 text-base font-semibold text-text">{params}</div>
          </div>
          <div className="col-span-2">
            <Meter value={Math.min(params, 14)} max={14} tone="auto" label={`Сложност: ${complexity}`} />
            {beginner && (
              <p className="mt-1.5 text-[11px] leading-4 text-faint">
                Всяко ново условие намалява броя сигнали и увеличава риска от overfitting — проверявай sample size в backtest-а.
              </p>
            )}
          </div>
        </div>
      )}
      <p className="text-[11px] leading-4 text-faint">{SETUP_DISCLAIMER}</p>
    </div>
  );
}
