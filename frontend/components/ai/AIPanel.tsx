"use client";

import { Crosshair, HelpCircle, MessageSquareText, RefreshCw, Sparkles, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatPanel } from "@/components/ai/ChatPanel";
import { useTeacherAsk } from "@/components/ai/hooks";
import { buildAskBody, draftKey, draftRR, fmtValue, followUpRequest, isDataNotAvailableError, normalizeDraft, teacherHref, tfLabel } from "@/components/ai/model";
import { StrategyView } from "@/components/ai/StrategyView";
import { TeacherAnswer } from "@/components/ai/TeacherAnswer";
import type { DraftOrder, FollowUp, TeacherAnswerData } from "@/components/ai/types";
import { Badge, Button, DataNotAvailable, ErrorText, IconButton, SkeletonText, Tabs } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";

export type AIPanelTab = "strategy" | "explain" | "why" | "ask";

export type AIPanelProps = {
  /** instrument on the chart, e.g. "BTC/USDT" */
  symbol: string;
  /** chart timeframe key, e.g. "1h" */
  timeframe: string;
  /** strategy for Strategy View / Explain / WHY? (omitted → most recent own strategy, else default template) */
  strategyId?: number | null;
  /** draft order from the order panel — "Explain this setup" explains THIS plan (never places it) */
  draft?: { side: DraftOrder["side"]; entry: number | null | undefined; stop?: number | null; target?: number | null; qty?: number | null } | null;
  /** dense layout for terminal right panels */
  compact?: boolean;
  /** initially open tab (default "strategy") */
  defaultTab?: AIPanelTab;
  className?: string;
};

const answerMatches = (a: TeacherAnswerData | null, symbol: string, timeframe: string) =>
  !!a && (!a.symbol || a.symbol === symbol) && (!a.timeframe || a.timeframe === timeframe);

function AnswerArea({
  answer,
  busy,
  error,
  compact,
  onFollowUp,
  strategyId,
  empty,
}: {
  answer: TeacherAnswerData | null;
  busy: boolean;
  error: unknown;
  compact?: boolean;
  onFollowUp: (f: FollowUp) => void;
  strategyId?: number | null;
  empty?: React.ReactNode;
}) {
  if (error && !busy) {
    return isDataNotAvailableError(error) ? <DataNotAvailable compact reason={errorMessage(error)} /> : <ErrorText error={errorMessage(error)} />;
  }
  if (busy && !answer) {
    return (
      <div className="space-y-2" role="status" aria-live="polite">
        <div className="text-[11px] text-muted">Учителят проверява графика → структура → режим → правила → риск…</div>
        <SkeletonText lines={5} />
      </div>
    );
  }
  if (!answer) return <>{empty}</>;
  return <TeacherAnswer answer={answer} compact={compact} busy={busy} onFollowUp={onFollowUp} strategyId={strategyId} />;
}

/**
 * AI block for terminal side panels: tabs Strategy View | Explain | WHY? | Ask.
 * - Strategy View: <StrategyView compact/> for the chart's symbol/timeframe.
 * - Explain: "Explain this setup" → teacher mode `explain` with the draft order (entry/stop/target).
 * - WHY?: teacher mode `why` (runs when the tab opens and whenever the market changes).
 * - Ask: compact free-form chat (ChatPanel).
 * Follow-ups EXPLAIN / WHY? run inside the panel; other modes open the full /ai page in a new tab.
 * Never places orders.
 */
export function AIPanel({ symbol, timeframe, strategyId, draft, compact, defaultTab = "strategy", className }: AIPanelProps) {
  const [tab, setTab] = useState<AIPanelTab>(defaultTab);
  const explain = useTeacherAsk();
  const why = useTeacherAsk();
  const nDraft = normalizeDraft(draft ?? null);
  const rr = draftRR(draft ?? null);
  const sid = strategyId ?? null;

  const explainAnswer = answerMatches(explain.answer, symbol, timeframe) ? explain.answer : null;
  const whyAnswer = answerMatches(why.answer, symbol, timeframe) ? why.answer : null;
  const explainStale = !!explainAnswer && draftKey(explain.request?.draft ?? null) !== draftKey(draft ?? null);

  const runExplain = () => explain.ask(buildAskBody("explain", { symbol, timeframe, strategyId: sid, draft: draft ?? null }));
  const runWhy = () => why.ask(buildAskBody("why", { symbol, timeframe, strategyId: sid }));

  // WHY? answers the current chart: (re)run when its tab is open and the market / strategy changes
  const whyKey = `${symbol}|${timeframe}|${sid ?? ""}`;
  const autoKey = useRef<string | null>(null);
  const whyAsk = why.ask;
  useEffect(() => {
    if (tab !== "why" || autoKey.current === whyKey) return;
    autoKey.current = whyKey;
    void whyAsk(buildAskBody("why", { symbol, timeframe, strategyId: sid }));
  }, [tab, whyKey, whyAsk, symbol, timeframe, sid]);

  const onFollowUp = (f: FollowUp) => {
    const req = followUpRequest(f, { strategyId: sid });
    if (f.mode === "explain") {
      setTab("explain");
      const d = normalizeDraft(draft ?? null);
      void explain.ask(d && (!req.symbol || req.symbol === symbol) ? { ...req, draft: d } : req);
    } else if (f.mode === "why") {
      setTab("why");
      void why.ask(req);
    } else if (typeof window !== "undefined") {
      window.open(teacherHref(req), "_blank", "noopener,noreferrer");
    }
  };

  const tabs: { key: AIPanelTab; label: React.ReactNode }[] = [
    { key: "strategy", label: "Strategy View" },
    { key: "explain", label: "Explain" },
    { key: "why", label: "WHY?" },
    { key: "ask", label: "Ask" },
  ];

  return (
    <div className={cx("flex min-h-0 min-w-0 flex-col", className)}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} className={compact ? "[&>button]:px-2.5 [&>button]:text-[13px]" : undefined} />
      <div className={cx("min-h-0 flex-1 overflow-y-auto", compact ? "pt-3" : "pt-4")}>
        {tab === "strategy" && <StrategyView symbol={symbol} timeframe={timeframe} strategyId={sid} compact={compact} />}

        {tab === "explain" && (
          <div className="space-y-3">
            <div className="@container rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                <Crosshair size={12} className="text-accent2" aria-hidden />
                {nDraft ? "Твоята чернова" : "Текущият setup"}
                <span className="ml-auto font-normal normal-case tracking-normal text-faint">
                  {symbol} · {tfLabel(timeframe)}
                </span>
              </div>
              {nDraft ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] @sm:grid-cols-4">
                  <span>
                    <Badge tone={nDraft.side === "long" ? "up" : "down"}>{nDraft.side}</Badge>
                  </span>
                  <span className="text-muted">
                    Entry <span className="num text-text">{fmtValue(nDraft.entry)}</span>
                  </span>
                  <span className="text-muted">
                    SL <span className="num text-down">{nDraft.stop ? fmtValue(nDraft.stop) : "—"}</span>
                  </span>
                  <span className="text-muted">
                    TP <span className="num text-up">{nDraft.target ? fmtValue(nDraft.target) : "—"}</span>
                    {rr != null && <span className="num text-accent2"> · {fmtValue(rr)}R</span>}
                  </span>
                </div>
              ) : (
                <p className="text-[12px] leading-relaxed text-muted">
                  Няма чернова на поръчка — учителят ще обясни setup-а на графиката. Попълни Entry / Stop Loss / Take Profit, за да получиш разбор
                  на твоя план.
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={runExplain} disabled={explain.busy}>
                  <Sparkles size={13} aria-hidden /> Explain this setup
                </Button>
                {explainStale && !explain.busy && <span className="text-[11px] text-warn">Черновата е променена след обяснението — обнови.</span>}
              </div>
            </div>
            <AnswerArea
              answer={explainAnswer}
              busy={explain.busy}
              error={explain.error}
              compact={compact}
              onFollowUp={onFollowUp}
              strategyId={sid}
              empty={
                <p className="flex gap-2 px-1 text-[12px] leading-relaxed text-faint">
                  <Target size={14} className="mt-0.5 shrink-0" aria-hidden />
                  Учителят проверява правилата, invalidation, R:R и риска — не казва дали да влезеш и никога не пуска поръчка.
                </p>
              }
            />
          </div>
        )}

        {tab === "why" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11.5px] text-muted">
              <HelpCircle size={13} className="shrink-0 text-accent2" aria-hidden />
              <span className="min-w-0 flex-1">Защо engine-ът и стратегията стигат до това решение — стъпка по стъпка.</span>
              <IconButton icon={RefreshCw} label="Обнови отговора" size="sm" disabled={why.busy} onClick={() => void runWhy()} />
            </div>
            <AnswerArea answer={whyAnswer} busy={why.busy} error={why.error} compact={compact} onFollowUp={onFollowUp} strategyId={sid} />
          </div>
        )}

        {tab === "ask" && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <MessageSquareText size={13} className="text-accent2" aria-hidden /> Свободен въпрос — учителят обяснява, не дава сигнали.
            </p>
            <ChatPanel symbol={symbol} timeframe={timeframe} compact />
          </div>
        )}
      </div>
    </div>
  );
}
