"use client";

import { ArrowRight, BrainCircuit, RefreshCw } from "lucide-react";
import useSWR from "swr";

import { SETUP_DISCLAIMER, teacherHref } from "@/components/ai/model";
import { LinkButton } from "@/components/market/LinkButton";
import { cleanReason, decisionTone, fmtQuotePrice } from "@/components/market/model";
import { Card, DataNotAvailable, Disclaimer, ErrorState, IconButton, InfoTip, RegimeBadge, SkeletonText, Term } from "@/components/ui";
import { ApiError, errorMessage, errorReason, isDataNotAvailable, post } from "@/lib/api";
import { cx } from "@/lib/format";
import type { Analysis } from "@/lib/types";

export type AnalyzeResponse = { analysis: Analysis; panel?: Record<string, string | number | null> };

const DECISION_CLS: Record<string, string> = {
  up: "border-up/35 bg-up/10 text-up",
  down: "border-down/35 bg-down/10 text-down",
  warn: "border-warn/35 bg-warn/10 text-warn",
  neutral: "border-white/12 bg-white/[0.05] text-text",
};

/** The structured analysis (pure render — exported for tests). */
export function AiAnalysisBody({ analysis, precision = 2 }: { analysis: Analysis; precision?: number }) {
  const a = analysis;
  const tone = decisionTone(a.decision);
  const lv = (xs: { price: number }[] | undefined) =>
    (xs ?? [])
      .slice(0, 2)
      .map((l) => fmtQuotePrice(l.price, precision))
      .join(" · ") || "—";
  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("rounded-lg border px-2.5 py-1 text-[13px] font-bold tracking-wide", DECISION_CLS[tone])}>DECISION: {a.decision}</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Term k="confidence">Confidence</Term>: <span className="font-semibold text-text">{a.confidence}</span>
          {a.confidence_note && <InfoTip text={a.confidence_note} />}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-faint">
          <Term k="regime">Regime</Term>
        </dt>
        <dd className="min-w-0">
          <RegimeBadge regime={a.regime?.regime} />
        </dd>
        <dt className="text-faint">
          <Term k="trend">Trend</Term>
        </dt>
        <dd className="min-w-0 text-text/90">{a.trend || "—"}</dd>
        <dt className="text-faint">Structure</dt>
        <dd className="min-w-0 text-text/90">{a.structure?.text || "—"}</dd>
        <dt className="text-faint">
          <Term k="support">Support</Term>
        </dt>
        <dd className="num min-w-0 text-up">{lv(a.support)}</dd>
        <dt className="text-faint">
          <Term k="resistance">Resistance</Term>
        </dt>
        <dd className="num min-w-0 text-down">{lv(a.resistance)}</dd>
      </dl>

      {!!a.observation?.length && (
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent2">OBSERVATION</div>
          <ul className="mt-1 space-y-1">
            {a.observation.slice(0, 5).map((o, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-text/85">
                <span className="select-none text-faint" aria-hidden>
                  •
                </span>
                <span className="min-w-0">{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.setup && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs">
          <div className="font-medium text-text">
            Possible {a.setup.side.toUpperCase()} setup: <span className="text-muted">{a.setup.name}</span>
          </div>
          <div className="mt-0.5 text-muted">
            Invalidation <span className="num text-text">{fmtQuotePrice(a.setup.invalidation, precision)}</span>
            {a.setup.reward_risk !== null && (
              <>
                {" "}
                · <Term k="rr">R:R</Term> <span className="num text-text">{a.setup.reward_risk.toFixed(2)}</span>
              </>
            )}
          </div>
          <p className="mt-1 text-[11px] text-faint">{SETUP_DISCLAIMER}</p>
        </div>
      )}

      {!!a.no_trade_reasons?.length && (
        <ul className="space-y-1">
          {a.no_trade_reasons.slice(0, 3).map((r) => (
            <li key={r.code} className="text-xs leading-relaxed text-muted">
              <span className="font-medium text-warn">{r.title}:</span> {r.text}
            </li>
          ))}
        </ul>
      )}
      {a.wait_reason && <p className="text-xs leading-relaxed text-muted">{a.wait_reason}</p>}

      <Disclaimer>{a.disclaimer}</Disclaimer>
    </div>
  );
}

/**
 * AI analysis card of the asset page: POST /api/ai/analyze {symbol, timeframe: "1h"} (structured,
 * rule-based — no LLM call), decision, regime, structure, S/R and observations + a link to the
 * AI Teacher. DATA NOT AVAILABLE when no provider serves the instrument.
 */
export function AiAnalysisCard({ symbol, precision = 2, enabled = true }: { symbol: string; precision?: number; enabled?: boolean }) {
  const tf = "1h";
  const { data, error, isValidating, mutate } = useSWR<AnalyzeResponse>(
    enabled ? ["ai-analyze", symbol, tf] : null,
    () => post<AnalyzeResponse>("/ai/analyze", { symbol, timeframe: tf, explain: false }),
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 120_000, shouldRetryOnError: false },
  );

  let body: React.ReactNode;
  if (!enabled) {
    body = <DataNotAvailable compact reason="Няма данни за анализ на този инструмент." />;
  } else if (error && !data) {
    body = isDataNotAvailable(error) ? (
      <DataNotAvailable compact reason={cleanReason(errorReason(error), "Няма данни за анализ.")} />
    ) : (
      <ErrorState
        title="Анализът не се зареди"
        description={error instanceof ApiError && error.status === 503 ? errorReason(error) : errorMessage(error)}
        onRetry={() => mutate()}
        className="py-6"
      />
    );
  } else if (!data) {
    body = <SkeletonText lines={7} />;
  } else {
    body = <AiAnalysisBody analysis={data.analysis} precision={precision} />;
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <BrainCircuit size={15} strokeWidth={2} className="text-violet" aria-hidden />
          AI analysis · 1H
        </span>
      }
      right={
        enabled ? (
          <IconButton
            icon={RefreshCw}
            label="Обнови анализа"
            size="sm"
            onClick={() => mutate()}
            disabled={isValidating}
            className={cx(isValidating && "[&_svg]:animate-spin")}
          />
        ) : null
      }
    >
      {body}
      <div className="mt-3.5 flex justify-end">
        <LinkButton href={teacherHref({ mode: "analyze", symbol, timeframe: tf })} variant="ghost" className="text-accent2 hover:text-text">
          Open in AI Teacher <ArrowRight size={13} strokeWidth={2.25} aria-hidden />
        </LinkButton>
      </div>
    </Card>
  );
}
