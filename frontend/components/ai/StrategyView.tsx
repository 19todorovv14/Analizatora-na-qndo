"use client";

import { ChevronDown, CircleSlash, Clock, Pencil, RefreshCw, ScrollText, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AnswerLine } from "@/components/ai/AnswerLine";
import { useStrategyView } from "@/components/ai/hooks";
import { SETUP_DISCLAIMER, conditionCounts, fmtValue, isDataNotAvailableError, logicLabel, regimeFilterText, resultTone, tfLabel } from "@/components/ai/model";
import type { ConditionCheck, StrategyViewData } from "@/components/ai/types";
import {
  Badge,
  Checklist,
  DataNotAvailable,
  Disclaimer,
  ErrorState,
  IconButton,
  Notice,
  RegimeBadge,
  Skeleton,
  SkeletonText,
  SourceBadge,
  Spinner,
  Term,
} from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { cx, fmtTime } from "@/lib/format";

export type StrategyViewProps = {
  /** instrument, e.g. "BTC/USDT" */
  symbol: string;
  /** timeframe key, e.g. "1h" */
  timeframe: string;
  /** strategy to evaluate; omitted → the user's most recent own strategy, else the default template */
  strategyId?: number | null;
  /** dense layout for terminal side panels (one column, shorter texts) */
  compact?: boolean;
  className?: string;
};

/* ───────────────────────────────────────────────────── result badge */

export function SetupResultBadge({ result, size = "md" }: { result: string; size?: "sm" | "md" }) {
  const tone = resultTone(result);
  const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : CircleSlash;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border font-semibold tracking-[0.06em]",
        size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[12px]",
        tone === "up" && "border-up/40 bg-up/[0.12] text-up",
        tone === "down" && "border-down/40 bg-down/[0.12] text-down",
        tone === "neutral" && "border-white/15 bg-white/[0.05] text-text/90",
      )}
    >
      <Icon size={size === "sm" ? 12 : 14} strokeWidth={2.2} aria-hidden />
      {result}
    </span>
  );
}

/* ───────────────────────────────────────────────────────── pieces */

function Mini({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
      <div className="mb-0.5 truncate text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className="min-w-0 text-[12.5px] leading-snug text-text">{children}</div>
    </div>
  );
}

function ConditionList({
  side,
  list,
  logic,
  passed,
  compact,
}: {
  side: "long" | "short";
  list: ConditionCheck[];
  logic?: string;
  passed?: boolean;
  compact?: boolean;
}) {
  const { passed: ok, total } = conditionCounts(list);
  const tone = side === "long" ? "text-up" : "text-down";
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={cx("text-[11px] font-semibold uppercase tracking-[0.08em]", tone)}>{side === "long" ? "LONG entry" : "SHORT entry"}</span>
          <span className="num ml-2 text-[11px] text-muted">
            {ok}/{total}
          </span>
          <div className="text-[10.5px] text-faint">{logicLabel(logic)}</div>
        </div>
        {total > 0 && (
          <Badge tone={passed ? (side === "long" ? "up" : "down") : "neutral"} className="shrink-0">
            {passed ? "изпълнено" : "не е изпълнено"}
          </Badge>
        )}
      </div>
      {total === 0 ? (
        <p className="text-[12px] text-faint">Стратегията няма правила за {side === "long" ? "LONG" : "SHORT"}.</p>
      ) : (
        <Checklist
          className="space-y-1.5"
          items={list.map((c) => ({
            pass: c.passed,
            label: (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12.5px]">{c.label}</span>
                {c.left_value != null && (
                  <span className="num text-[11px] text-muted">
                    {fmtValue(c.left_value)}
                    {c.right_value != null && <span className="text-faint"> vs {fmtValue(c.right_value)}</span>}
                  </span>
                )}
              </span>
            ),
            detail: compact ? undefined : c.explanation,
          }))}
        />
      )}
    </div>
  );
}

function RiskPlanBlock({ data }: { data: StrategyViewData }) {
  const rp = data.risk_plan;
  if (!rp) return null;
  const cells: [React.ReactNode, string, string][] = [
    ["Entry", fmtValue(rp.entry), "text-text"],
    [<Term key="sl" k="stoploss">Stop</Term>, fmtValue(rp.stop), "text-down"],
    [<Term key="tp" k="takeprofit">Target</Term>, rp.target == null ? "—" : fmtValue(rp.target), "text-up"],
    [<Term key="rr" k="rr">R:R</Term>, rp.rr == null ? "—" : `${fmtValue(rp.rr)}R`, "text-accent2"],
  ];
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        Risk plan <Badge tone={rp.side === "long" ? "up" : "down"}>{rp.side}</Badge>
        <span className="ml-auto text-[10.5px] font-normal normal-case tracking-normal text-faint">хипотетичен</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-4">
        {cells.map(([label, v, tone], i) => (
          <div key={i} className="min-w-0 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
            <div className={cx("num truncate text-[13px] font-semibold", tone)}>{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-0.5 text-[11.5px] text-muted">
        {rp.stop_rule && (
          <div>
            Stop: <span className="text-text/90">{rp.stop_rule}</span>
            {rp.target_rule && (
              <>
                {" "}
                · Target: <span className="text-text/90">{rp.target_rule}</span>
              </>
            )}
            {rp.risk_per_trade_pct != null && (
              <>
                {" "}
                · <Term k="risk_per_trade">Риск</Term> <span className="num text-text/90">{rp.risk_per_trade_pct}%</span>
              </>
            )}
          </div>
        )}
        {rp.note && <div className="text-faint">{rp.note}</div>}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── body */

/** Presentational strategy view (no fetching) — used by StrategyView and tests. */
export function StrategyViewBody({
  data,
  compact,
  refreshing,
  stale,
  onRefresh,
  className,
}: {
  data: StrategyViewData;
  compact?: boolean;
  refreshing?: boolean;
  stale?: boolean;
  onRefresh?: () => void;
  className?: string;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const s = data.strategy;
  const rf = data.regime_filter;
  const levels = (xs: { price: number; touches?: number }[] | undefined) =>
    (xs ?? []).slice(0, 3).map((l) => (
      <span key={l.price} className="num">
        {fmtValue(l.price)}
        {l.touches ? <span className="text-faint"> ×{l.touches}</span> : null}
      </span>
    ));

  return (
    <div className={cx("@container space-y-3", stale && "opacity-60 transition-opacity", className)} aria-busy={refreshing || undefined}>
      {/* header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">What would the strategy do?</div>
          {refreshing && <Spinner className="h-3.5 w-3.5" />}
          {onRefresh && <IconButton icon={RefreshCw} label="Обнови Strategy View" size="sm" onClick={onRefresh} />}
          {!compact && <SetupResultBadge result={data.result} />}
        </div>
        {compact && <SetupResultBadge result={data.result} size="sm" />}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-text" title={s.name}>
            {s.name}
          </span>
          {s.id != null && !s.is_template && (
            <Link href={`/strategies?strategy=${s.id}`} aria-label="Редактирай стратегията" className="shrink-0 text-faint hover:text-accent2">
              <Pencil size={12} aria-hidden />
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span>
            {data.symbol} · {tfLabel(data.timeframe)}
          </span>
          {s.selected === false && <span className="text-faint">{s.is_template ? "шаблон по подразбиране" : "последната ти стратегия"}</span>}
          {data.source && <SourceBadge source={data.source} />}
          {data.time ? (
            <span className="flex items-center gap-1 text-faint" title="Оценката е само върху затворени свещи">
              <Clock size={11} aria-hidden /> затворена свещ {fmtTime(data.time)}
            </span>
          ) : null}
        </div>
      </div>

      {!data.available && (
        <Notice tone="warn" title="Оценката не е възможна">
          {data.reason ?? "Няма достатъчно затворени свещи за тази стратегия."}
        </Notice>
      )}

      {data.available && (
        <>
          {/* market context */}
          <div className={cx("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-2 @xl:grid-cols-4")}>
            <Mini label={<Term k="regime">Режим</Term>}>{data.regime?.regime ? <RegimeBadge regime={data.regime.regime} /> : "—"}</Mini>
            <Mini label="Структура">
              {data.structure?.last_high_label || data.structure?.last_low_label ? (
                <span className="num">
                  {[data.structure?.last_high_label, data.structure?.last_low_label].filter(Boolean).join(" + ")}
                  {data.structure?.trend && <span className="text-faint"> · {data.structure.trend}</span>}
                </span>
              ) : (
                (data.structure?.trend ?? "—")
              )}
            </Mini>
            <Mini label="Momentum">
              {data.momentum?.label ?? "—"}
              {data.momentum?.rsi != null && (
                <span className="num text-faint">
                  {" "}
                  · <Term k="rsi">RSI</Term> {fmtValue(data.momentum.rsi, 1)}
                </span>
              )}
            </Mini>
            <Mini label={<Term k="volatility">Волатилност</Term>}>
              {data.volatility?.label ?? "—"}
              {data.volatility?.atr_pct != null && <span className="num text-faint"> · ATR {fmtValue(data.volatility.atr_pct)}%</span>}
            </Mini>
          </div>

          {/* conditions */}
          <div className={cx("grid gap-2", !compact && "@xl:grid-cols-2")}>
            <ConditionList side="long" list={data.conditions.long} logic={data.logic?.long} passed={data.long_passed} compact={compact} />
            <ConditionList side="short" list={data.conditions.short} logic={data.logic?.short} passed={data.short_passed} compact={compact} />
          </div>

          {/* regime filter */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
            <Checklist
              items={[
                {
                  pass: rf.passed,
                  label: (
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="text-[12.5px] font-medium">Regime filter</span>
                      <span className="text-[11.5px] text-muted">{regimeFilterText(rf)}</span>
                    </span>
                  ),
                  detail: rf.passed
                    ? rf.required.length
                      ? "Текущият режим е разрешен от стратегията."
                      : "Стратегията търгува във всеки режим."
                    : "Режимът не е разрешен — стратегията не би търсила вход, дори условията да са изпълнени.",
                },
              ]}
            />
          </div>

          {/* why */}
          {data.why.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Защо</div>
              <ul className="space-y-1.5">
                {(compact ? data.why.slice(0, 4) : data.why).map((l, i) => (
                  <AnswerLine key={i} line={l} dot="bg-accent2" compact={compact} />
                ))}
              </ul>
            </div>
          )}

          {(data.warnings?.length ?? 0) > 0 && (
            <ul className="space-y-1">
              {data.warnings!.map((w) => (
                <li key={w.code} className="flex flex-wrap items-baseline gap-1.5 text-[12px] text-muted">
                  <Badge tone="warn">{w.title}</Badge>
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
          )}

          <RiskPlanBlock data={data} />

          {!compact && ((data.support?.length ?? 0) > 0 || (data.resistance?.length ?? 0) > 0) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-up">
                  <Term k="support">Support</Term>
                </span>
                {levels(data.support)}
              </span>
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-down">
                  <Term k="resistance">Resistance</Term>
                </span>
                {levels(data.resistance)}
              </span>
            </div>
          )}
        </>
      )}

      {(s.summary?.length ?? 0) > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={rulesOpen}
            onClick={() => setRulesOpen((o) => !o)}
            className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted hover:text-text"
          >
            <ScrollText size={12} aria-hidden /> Правилата на стратегията
            <ChevronDown size={13} className={cx("transition-transform", !rulesOpen && "-rotate-90")} aria-hidden />
          </button>
          {rulesOpen && (
            <ul className="fade-in mt-1.5 space-y-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              {s.summary!.map((l) => (
                <li key={l} className="text-[12px] leading-relaxed text-text/85">
                  {l}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Disclaimer>{data.disclaimer || SETUP_DISCLAIMER}</Disclaimer>
    </div>
  );
}

export function StrategyViewSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-36" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-7 w-32 rounded-lg" />
      </div>
      <div className={cx("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-4")}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
      <SkeletonText lines={4} />
    </div>
  );
}

/**
 * STRATEGY VIEW — "What would the strategy do?" on the last CLOSED candle: per-condition ✓/✕ checklist
 * (LONG / SHORT), regime filter row (applied), result badge (NO SETUP / POSSIBLE LONG SETUP / POSSIBLE
 * SHORT SETUP), why bullets, hypothetical risk plan and the exact disclaimer. Polls every 30 s.
 */
export function StrategyView({ symbol, timeframe, strategyId, compact, className }: StrategyViewProps) {
  const { data, error, isValidating, mutate } = useStrategyView(symbol, timeframe, strategyId);
  const stale = !!data && (data.symbol !== symbol || data.timeframe !== timeframe);

  if (error && (!data || stale)) {
    if (isDataNotAvailableError(error))
      return <DataNotAvailable compact={compact} className={className} reason={`${symbol} ${tfLabel(timeframe)}: ${errorMessage(error)}`} />;
    return (
      <ErrorState
        className={className}
        title="Strategy View не се зареди"
        description={errorMessage(error)}
        onRetry={() => {
          void mutate();
        }}
      />
    );
  }
  if (!data) return <StrategyViewSkeleton compact={compact} />;
  return (
    <StrategyViewBody
      data={data}
      compact={compact}
      refreshing={isValidating}
      stale={stale}
      onRefresh={() => {
        void mutate();
      }}
      className={className}
    />
  );
}
