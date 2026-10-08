"use client";

/*
 * Guided scenario: "$2,000 at 1x → 5x → 20x" (GET /learn/leverage/scenario). The same stake is used as margin at
 * three leverages and the price moves a little against the position; each step is revealed in turn and shows what
 * the move does to the account and to the margin. Ends with the same-position comparison and the takeaways.
 */
import { ArrowRight, Footprints, RotateCcw } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { RISK_META, signedPct, usd } from "@/components/labs/model";
import type { LeverageWalkthrough as Walkthrough, ScenarioStep } from "@/components/labs/types";
import { Badge, Button, Card, ErrorState, Notice, Segmented, SkeletonText } from "@/components/ui";
import { errorReason, fetcher } from "@/lib/api";
import { cx } from "@/lib/format";

const MOVES = [-1, -2, -5, -10] as const;

export function walkthroughKey(stake: number, move: number, equity: number): string {
  return `/learn/leverage/scenario?stake=${stake}&move_pct=${move}&equity=${equity}&side=long`;
}

/** Horizontal bar: `part` of `whole` lost (red) and the rest kept. */
function LossBar({ whole, lost, label }: { whole: number; lost: number; label: string }) {
  const raw = whole > 0 ? (Math.abs(lost) / whole) * 100 : 0;
  const pct = Math.min(100, raw);
  const text = `${raw.toFixed(raw < 10 && raw > 0 ? 1 : 0)}%`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted">
        <span className="min-w-0">{label}</span>
        <span className={cx("num shrink-0", raw > 100 ? "font-semibold text-down" : "text-text")}>
          {text} изгубени{raw > 100 ? " (над margin-а)" : ""}
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${label}: изгубени ${text}`}>
        <div className="h-full bg-up/45" style={{ width: `${100 - pct}%` }} />
        {pct > 0 && <div className="h-full border-l-2 border-surface bg-down" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

function StepCard({ step, index, equity, active }: { step: ScenarioStep; index: number; equity: number; active: boolean }) {
  return (
    <li className={cx("glass-inset min-w-0 space-y-3 p-3.5 transition-shadow", active && "ring-1 ring-inset ring-accent/35")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Стъпка {index + 1}</div>
          <div className="num text-2xl font-semibold leading-tight text-text">{step.leverage}x</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-muted">позиция</div>
          <div className="num text-sm font-semibold text-text">{usd(step.position_notional)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.06em] text-muted">P/L</div>
          <div className={cx("num text-base font-semibold", step.pnl < 0 ? "text-down" : step.pnl > 0 ? "text-up" : "text-text")}>{usd(step.pnl, true)}</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.06em] text-muted">Сметка след</div>
          <div className="num text-base font-semibold text-text">{usd(step.equity_after)}</div>
        </div>
      </div>
      <LossBar whole={equity} lost={Math.min(0, step.pnl)} label={`От сметката (${usd(equity)})`} />
      <LossBar whole={step.margin} lost={Math.min(0, step.pnl)} label={`От margin-а (${usd(step.margin)})`} />
      <p className="text-xs leading-relaxed text-muted">{step.text}</p>
      <div className="flex flex-wrap gap-1.5">
        {step.liquidated && <Badge tone="down">ликвидирана</Badge>}
        {step.isolated_liquidation_move_pct !== null && (
          <Badge tone={step.risk_level === "low" ? "neutral" : "warn"}>isolated ликвидация при {signedPct(step.isolated_liquidation_move_pct, 1)}</Badge>
        )}
        {step.risk_level !== "low" && <Badge tone="down">риск: {RISK_META[step.risk_level].label.toLowerCase()}</Badge>}
      </div>
    </li>
  );
}

export function LeverageWalkthrough({ stake = 2_000, equity = 10_000 }: { stake?: number; equity?: number }) {
  const [move, setMove] = useState<number>(-5);
  const [shown, setShown] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<Walkthrough>(walkthroughKey(stake, move, equity), fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const steps = data?.steps ?? [];
  const done = steps.length > 0 && shown >= steps.length;

  return (
    <Card
      title={
        <>
          <Footprints size={14} className="text-accent2" aria-hidden /> {data?.title ?? `${usd(stake)} при 1x → 5x → 20x`}
        </>
      }
      right={<Badge tone="violet">virtual</Badge>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 max-w-2xl text-sm leading-relaxed text-muted">
            Сметка {usd(equity)}. Слагаш {usd(stake)} като margin и цената се движи с{" "}
            <span className="num font-semibold text-down">{signedPct(move, 0)}</span> срещу теб. Виж какво прави едно и също малко движение при
            различен leverage.
          </p>
          <Segmented<number>
            size="sm"
            options={MOVES.map((m) => ({ value: m, label: signedPct(m, 0) }))}
            value={move}
            onChange={setMove}
            ariaLabel="Движение срещу позицията"
          />
        </div>

        {error && !data ? (
          <ErrorState title="Сценарият не се зареди" description={errorReason(error)} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <SkeletonText lines={5} />
        ) : (
          <>
            <ol className="grid gap-3 md:grid-cols-3">
              {steps.map((s, i) =>
                i < shown ? (
                  <StepCard key={s.leverage} step={s} index={i} equity={data?.equity ?? equity} active={i === shown - 1 && !done} />
                ) : (
                  <li key={s.leverage} className="flex min-h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 p-4 text-center">
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Стъпка {i + 1}</span>
                    <span className="num text-2xl font-semibold text-muted">{s.leverage}x</span>
                    <span className="num text-xs text-faint">
                      същите {usd(s.margin)} → позиция {usd(s.position_notional)}
                    </span>
                    {i === shown && <span className="mt-1 text-[11px] text-accent2">Какво става при {signedPct(move, 0)}? Натисни „Следваща стъпка“.</span>}
                  </li>
                ),
              )}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              {!done ? (
                <Button type="button" size="sm" onClick={() => setShown((n) => Math.min(steps.length, n + 1))}>
                  Следваща стъпка: {steps[shown]?.leverage}x <ArrowRight size={14} aria-hidden />
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => setShown(1)}>
                  <RotateCcw size={14} aria-hidden /> Отначало
                </Button>
              )}
              {!done && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setShown(steps.length)}>
                  Покажи всички
                </Button>
              )}
            </div>
            {done && data && (
              <div className="grid gap-3 lg:grid-cols-2">
                <Notice tone="info" title={`Същата позиция ${usd(data.same_notional.position_notional)} при всеки leverage`}>
                  {data.same_notional.text}
                </Notice>
                <div className="glass-inset p-3.5">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Изводи</div>
                  <ul className="space-y-1.5 text-sm leading-relaxed text-muted">
                    {data.takeaways.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent2" aria-hidden />
                        <span className={cx("min-w-0", t.includes("Higher leverage") && "font-medium text-warn")}>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {data && <p className="text-[11px] text-faint">{data.virtual_notice}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
