"use client";

import { Info, RefreshCw, ScanSearch, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { ChatPanel } from "@/components/ai/ChatPanel";
import { ContextChips } from "@/components/ai/ContextChips";
import { DecisionPanel } from "@/components/ai/DecisionPanel";
import { useStrategyView, useTeacherAsk, useTeacherContext, useTeacherModes } from "@/components/ai/hooks";
import { MODE_ICON } from "@/components/ai/icons";
import {
  buildAskBody,
  followUpRequest,
  isDataNotAvailableError,
  isTeacherMode,
  lessonIndicators,
  modeUsesChart,
  overlayFromAnalysis,
  overlayFromAnswer,
  overlayFromView,
  parseDraftInputs,
  parseTeacherQuery,
  providerInfo,
  QUESTION_MODES,
  tfLabel,
  unavailableReason,
  type OverlayLayers,
  type TeacherQuery,
} from "@/components/ai/model";
import { EMPTY_INPUTS, ModeInputs, type ConsoleInputs } from "@/components/ai/ModeInputs";
import { ModePicker } from "@/components/ai/ModePicker";
import { StrategyView } from "@/components/ai/StrategyView";
import { TeacherAnswer } from "@/components/ai/TeacherAnswer";
import { TeacherChart } from "@/components/ai/TeacherChart";
import { TeacherHistory } from "@/components/ai/TeacherHistory";
import type { AskRequest, FollowUp, StrategyOption, TeacherMode, TeacherSessionRow } from "@/components/ai/types";
import { IndicatorMenu, SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import {
  Badge,
  Button,
  Card,
  DataNotAvailable,
  EmptyState,
  ErrorState,
  ErrorText,
  Kbd,
  Loading,
  Notice,
  PageHeader,
  SkeletonText,
  Tabs,
  Tooltip,
} from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useLocalState } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Analysis } from "@/lib/types";
import { LearnHint } from "@/lib/workspace";

type AnalyzeResponse = { analysis: Analysis; panel: Record<string, string | number | null>; explanation?: { text: string; provider: string } };
type AiStatus = { active: string; configured?: string; model: string | null; note: string };

const DEFAULT_INDICATORS = ["ema20", "ema50", "ema200"];
const DEFAULT_LAYERS: OverlayLayers = { levels: true, setup: true, structure: true };

const asLayers = (v: unknown): OverlayLayers =>
  v && typeof v === "object" ? { ...DEFAULT_LAYERS, ...(v as Partial<OverlayLayers>) } : DEFAULT_LAYERS;

/** "Автоматично" + own strategies + templates (strategy used by Strategy View and the chart modes). */
function StrategySelect({
  strategies,
  value,
  onChange,
}: {
  strategies: StrategyOption[] | undefined;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const list = strategies ?? [];
  const mine = list.filter((s) => !s.is_template);
  const templates = list.filter((s) => s.is_template);
  return (
    <select
      className="input w-full min-w-0 sm:w-auto sm:max-w-[16rem]"
      aria-label="Стратегия"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Стратегия: автоматично</option>
      {mine.length > 0 && (
        <optgroup label="Моите стратегии">
          {mine.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {templates.length > 0 && (
        <optgroup label="Шаблони (образователни)">
          {templates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default function AiTeacherPage() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useLocalState("ta-ai-symbol", "BTC/USDT");
  const [tf, setTf] = useLocalState("ta-ai-tf", "1h");
  const [storedIndicators, setIndicators] = useLocalState<string[]>("ta-ai-indicators", DEFAULT_INDICATORS);
  const [storedStrategy, setStoredStrategy] = useLocalState<number | null>("ta-ai-strategy", null);
  const [storedMode, setMode] = useLocalState<TeacherMode>("ta-ai-mode", "analyze");
  const [storedLayers, setLayers] = useLocalState<OverlayLayers>("ta-ai-layers", DEFAULT_LAYERS);
  const [inputs, setInputs] = useState<ConsoleInputs>(EMPTY_INPUTS);
  const [chatQuestion, setChatQuestion] = useState<string | null>(null);
  const [pendingAuto, setPendingAuto] = useState<TeacherQuery | null>(null);
  const [lowerTab, setLowerTab] = useState<"strategy" | "engine">("strategy");
  const [lastSource, setLastSource] = useState<"teacher" | "engine">("teacher");
  // classic signal engine ("Analyze chart" → DECISION panel)
  const [res, setRes] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);

  const mode: TeacherMode = isTeacherMode(storedMode) ? storedMode : "analyze";
  const indicators = Array.isArray(storedIndicators) ? storedIndicators : DEFAULT_INDICATORS;
  const indicatorsRef = useRef(indicators);
  useEffect(() => {
    indicatorsRef.current = indicators;
  }, [indicators]);
  const layers = asLayers(storedLayers);
  const modes = useTeacherModes();
  const modeInfo = modes.find((m) => m.key === mode) ?? modes[0];
  const teacher = useTeacherAsk();
  const teacherAsk = teacher.ask;
  const { data: strategiesData } = useSWR<{ strategies: StrategyOption[] }>("/strategies", fetcher);
  const strategies = strategiesData?.strategies;
  const strategyId = storedStrategy && (!strategies || strategies.some((s) => s.id === storedStrategy)) ? storedStrategy : null;
  const { data: status } = useSWR<AiStatus>("/ai/status", fetcher, { revalidateOnFocus: false });
  const view = useStrategyView(symbol, tf, strategyId);
  const ctx = useTeacherContext(symbol, tf, strategyId);

  // default strategy of REVIEW STRATEGY: picked one → toolbar one → newest own → first template
  const reviewSid =
    inputs.reviewStrategyId ?? strategyId ?? strategies?.find((s) => !s.is_template)?.id ?? strategies?.find((s) => s.is_template)?.id ?? null;

  /*
   * Bring the next answer (or its error) into view when it starts below the fold — measured AFTER React
   * committed it: measuring in the ask() callback can run before the render, when the column is still
   * short and the scroll gets clamped. The console stays reachable above the answer.
   */
  const revealNext = useRef(false);
  const askAndReveal = useCallback(
    (req: AskRequest) => {
      revealNext.current = true;
      return teacherAsk(req);
    },
    [teacherAsk],
  );
  useEffect(() => {
    if (!revealNext.current || (!teacher.answer && !teacher.error)) return;
    revealNext.current = false;
    const a = teacher.error ? null : teacher.answer;
    // TEACH ME uses the live chart as the example → show the lesson's indicator (RSI, MACD, ATR…)
    if (a?.mode === "teach" && a.lesson?.slug) {
      const next = lessonIndicators(a.lesson.slug, indicatorsRef.current);
      if (next !== indicatorsRef.current) setIndicators(next);
    }
    const el = answerRef.current;
    const col = columnRef.current;
    if (!el) return;
    // scroll when the answer's header is below the middle of the view, or above it (a refreshed answer
    // replacing one the user had scrolled into)
    if (col && getComputedStyle(col).overflowY !== "visible" && col.scrollHeight > col.clientHeight) {
      const rel = el.offsetTop - col.scrollTop;
      if (rel > col.clientHeight * 0.5 || rel < 0) col.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: "smooth" });
    } else {
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.6 || top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [teacher.answer, teacher.error, setIndicators]);

  /* ── ?mode=&symbol=&tf=&topic=&q=&strategy_id=&position_id=… (academy / dashboard deep links) ── */
  useEffect(() => {
    const q = parseTeacherQuery(window.location.search);
    if (q.symbol) setSymbol(q.symbol);
    if (q.timeframe) setTf(q.timeframe);
    if (q.strategyId && q.mode !== "review_strategy") setStoredStrategy(q.strategyId);
    if (q.mode) {
      setMode(q.mode);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the deep link
      setInputs((i) => ({
        ...i,
        question: q.question ?? "",
        topic: q.topic ?? "",
        positionId: q.positionId ?? "",
        reviewStrategyId: q.mode === "review_strategy" ? (q.strategyId ?? null) : i.reviewStrategyId,
        backtestId: q.backtestId ?? null,
        compareKind: q.compareSymbol ? "symbol" : "timeframe",
        compareSymbol: q.compareSymbol ?? "",
        compareTimeframe: q.compareTimeframe ?? "",
      }));
      setPendingAuto(q); // run it after the stored + query values have been applied
    } else if (q.question) {
      setChatQuestion(q.question); // legacy /ai?q=… → the chat asks it
    }
  }, [setSymbol, setTf, setStoredStrategy, setMode]);

  useEffect(() => {
    if (!pendingAuto?.mode) return;
    const q = pendingAuto;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume the deep link exactly once
    setPendingAuto(null);
    const m = q.mode!;
    void askAndReveal(
      buildAskBody(m, {
        symbol,
        timeframe: tf,
        indicators,
        strategyId: m === "review_strategy" ? (q.strategyId ?? reviewSid) : (q.strategyId ?? strategyId),
        positionId: q.positionId,
        backtestId: q.backtestId,
        compareKind: q.compareSymbol ? "symbol" : "timeframe",
        compareSymbol: q.compareSymbol,
        compareTimeframe: q.compareTimeframe,
        question: q.question,
        topic: q.topic,
      }),
    );
  }, [pendingAuto, symbol, tf, indicators, strategyId, reviewSid, askAndReveal]);

  /* ── classic signal engine ── */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the stale analysis when the market changes
    setRes(null);
  }, [symbol, tf]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    setLowerTab("engine");
    setLastSource("engine");
    try {
      setRes(await post<AnalyzeResponse>("/ai/analyze", { symbol, timeframe: tf, strategy_id: strategyId || undefined }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /* ── teacher ── */
  const runMode = (m: TeacherMode = mode) => {
    setLastSource("teacher");
    void askAndReveal(
      buildAskBody(m, {
        symbol,
        timeframe: tf,
        indicators,
        strategyId: m === "review_strategy" ? reviewSid : strategyId,
        positionId: inputs.positionId || null,
        backtestId: inputs.backtestId,
        compareKind: inputs.compareKind,
        compareSymbol: inputs.compareSymbol,
        compareTimeframe: inputs.compareTimeframe,
        question: inputs.question,
        topic: inputs.topic || null,
        draft: inputs.draftOn ? parseDraftInputs(inputs.draft) : null,
      }),
    );
  };

  const onFollowUp = (f: FollowUp) => {
    const req = followUpRequest(f, { strategyId, indicators });
    setMode(f.mode);
    if (req.symbol && req.symbol !== symbol) setSymbol(req.symbol);
    if (req.timeframe && req.timeframe !== tf) setTf(req.timeframe);
    setInputs((i) => ({
      ...i,
      topic: f.mode === "teach" ? (req.topic ?? "") : i.topic,
      compareKind: req.compare_symbol ? "symbol" : f.mode === "compare" ? "timeframe" : i.compareKind,
      compareSymbol: req.compare_symbol ?? i.compareSymbol,
      compareTimeframe: req.compare_timeframe ?? i.compareTimeframe,
      positionId: req.position_id ?? i.positionId,
    }));
    setLastSource("teacher");
    void askAndReveal(req);
    const col = columnRef.current;
    if (col && getComputedStyle(col).overflowY !== "visible") col.scrollTo({ top: Math.max(0, (answerRef.current?.offsetTop ?? 0) - 8), behavior: "smooth" });
    else answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onRepeat = (row: TeacherSessionRow) => {
    if (!row.mode) return;
    const c = row.context ?? {};
    setMode(row.mode);
    if (c.symbol && modeUsesChart(row.mode)) setSymbol(c.symbol);
    if (c.timeframe && modeUsesChart(row.mode)) setTf(c.timeframe);
    if (row.mode === "review_trade") setInputs((i) => ({ ...i, positionId: c.position_id ?? "" }));
    if (row.mode === "review_strategy") setInputs((i) => ({ ...i, reviewStrategyId: c.strategy_id ?? null }));
    setLastSource("teacher");
    void askAndReveal(
      buildAskBody(row.mode, {
        symbol: (modeUsesChart(row.mode) && c.symbol) || symbol,
        timeframe: (modeUsesChart(row.mode) && c.timeframe) || tf,
        indicators,
        strategyId: c.strategy_id ?? (row.mode === "review_strategy" ? reviewSid : strategyId),
        positionId: c.position_id ?? null,
      }),
    );
  };

  const answer = teacher.answer;
  const answerIsChart = !!answer && modeUsesChart(answer.mode) && !!answer.symbol;
  const answerStale = answerIsChart && (answer!.symbol !== symbol || answer!.timeframe !== tf);

  /* ── chart overlay: newest source first (teacher answer / signal engine), Strategy View as the base ── */
  const overlay = useMemo(() => {
    const fromAnswer = overlayFromAnswer(answer, symbol, tf);
    const fromEngine = overlayFromAnalysis(res?.analysis, symbol, tf);
    const fromView = overlayFromView(view.data, symbol, tf);
    return (lastSource === "engine" ? (fromEngine ?? fromAnswer) : (fromAnswer ?? fromEngine)) ?? fromView;
  }, [answer, res, view.data, symbol, tf, lastSource]);

  /* ── "What the teacher knows" ── */
  const answerContext = answer && !answerStale && answer.context_used?.length ? answer.context_used : null;
  const modeContext = modeInfo.context;
  const contextItems = answerContext ?? ctx.data?.context_used?.filter((c) => !modeContext?.length || modeContext.includes(c.key));

  const ModeIcon = MODE_ICON[mode];
  const statusInfo = status ? providerInfo({ provider: status.active, provider_label: status.active === "offline" ? "OFFLINE" : undefined }) : null;
  const askLabel = `${modeInfo.label}${modeUsesChart(mode) ? ` · ${symbol} ${tfLabel(tf)}` : ""}`;

  return (
    <div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        icon={Sparkles}
        title="AI Trading Teacher"
        badge={
          statusInfo && (
            <Tooltip content={status?.note}>
              <span tabIndex={0} className="inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Badge tone={statusInfo.tone}>AI: {status?.active === "offline" ? "offline" : statusInfo.label}</Badge>
              </span>
            </Tooltip>
          )
        }
        subtitle="Учител, който вижда графиката, стратегията, paper сметката, сделките и прогреса ти. Обяснява правила, invalidation и риск — никога не прогнозира цената."
        actions={<TeacherHistory onRepeat={onRepeat} onFollowUp={onFollowUp} />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,460px)] xl:grid-rows-[auto_auto_auto_1fr]">
        {/* ── chart ── */}
        <Card className="xl:col-start-1 xl:row-start-1" bodyClass="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SymbolPicker value={symbol} onChange={setSymbol} className="w-full sm:w-auto sm:max-w-[15rem]" />
            <TimeframeBar value={tf} onChange={setTf} beginner={beginner} />
            <IndicatorMenu active={indicators} onChange={setIndicators} />
            <StrategySelect strategies={strategies} value={strategyId} onChange={setStoredStrategy} />
          </div>
          <TeacherChart
            symbol={symbol}
            timeframe={tf}
            indicators={indicators}
            overlay={overlay}
            layers={layers}
            onLayersChange={setLayers}
            height={400}
            beginner={beginner}
          />
        </Card>

        {/* ── teacher console + answer ── */}
        <div
          ref={columnRef}
          className="min-w-0 space-y-4 xl:sticky xl:top-[calc(var(--spacing-topbar)+0.75rem)] xl:col-start-2 xl:row-span-4 xl:row-start-1 xl:max-h-[calc(100dvh-var(--spacing-topbar)-1.5rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:pr-1"
        >
          <Card bodyClass="p-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Режим на учителя</h2>
                <span className="text-[10.5px] text-faint">8 режима</span>
              </div>
              <ModePicker value={mode} onChange={setMode} modes={modes} />
            </div>

            <div className="space-y-3 rounded-xl border border-white/[0.07] bg-black/15 p-3">
              <p className="text-[12px] leading-snug text-muted">
                <span className="font-semibold tracking-[0.04em] text-text">{modeInfo.label}</span> — {modeInfo.description}
              </p>
              <ModeInputs
                mode={mode}
                value={{ ...inputs, reviewStrategyId: reviewSid }}
                onChange={(p) => setInputs((i) => ({ ...i, ...p }))}
                symbol={symbol}
                timeframe={tf}
                strategies={strategies}
                onSubmit={() => runMode()}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => runMode()} disabled={teacher.busy} className="min-w-0 max-w-full">
                  <ModeIcon size={15} aria-hidden />
                  <span className="truncate">{teacher.busy ? "Учителят мисли…" : askLabel}</span>
                </Button>
                {QUESTION_MODES.includes(mode) && (
                  <span className="hidden items-center gap-1 text-[11px] text-faint sm:inline-flex">
                    <Kbd>Ctrl</Kbd>
                    <Kbd>↵</Kbd> във въпроса
                  </span>
                )}
              </div>
            </div>

            <ContextChips items={contextItems} loading={!contextItems && ctx.isLoading} />
          </Card>

          <div ref={answerRef} className="scroll-mt-20">
            {answerStale && !teacher.busy && !teacher.error && (
              // sticky + opaque: switching symbol/timeframe while reading keeps this banner in view
              // (scroll anchoring would otherwise insert it above the visible part of the answer)
              <div className="sticky top-[calc(var(--spacing-topbar)+0.5rem)] z-10 mb-3 rounded-lg bg-surface shadow-pop xl:top-0">
                <Notice tone="info" title={`Отговорът е за ${answer!.symbol} ${tfLabel(answer!.timeframe)}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    Графиката е сменена на {symbol} {tfLabel(tf)}.
                    <Button size="sm" variant="outline" onClick={() => runMode(answer!.mode)}>
                      <RefreshCw size={12} aria-hidden /> Обнови за {symbol} {tfLabel(tf)}
                    </Button>
                  </span>
                </Notice>
              </div>
            )}
            {teacher.error && !teacher.busy ? (
              isDataNotAvailableError(teacher.error) ? (
                <DataNotAvailable reason={unavailableReason(teacher.error)} />
              ) : (
                <ErrorState
                  title="Учителят не можа да отговори"
                  description={errorMessage(teacher.error)}
                  onRetry={() => teacher.request && void askAndReveal(teacher.request)}
                />
              )
            ) : answer ? (
              <Card bodyClass="p-3 sm:p-4">
                <TeacherAnswer answer={answer} onFollowUp={onFollowUp} busy={teacher.busy} strategyId={strategyId} />
              </Card>
            ) : teacher.busy ? (
              <Card bodyClass="p-4 space-y-3">
                <div role="status" aria-live="polite" className="text-[12px] text-muted">
                  Учителят проверява: графика → индикатори → структура → режим → правила на стратегията → риск…
                </div>
                <SkeletonText lines={6} />
              </Card>
            ) : (
              <div className="space-y-3">
                <EmptyState
                  compact
                  icon={Sparkles}
                  title="Избери режим и попитай учителя"
                  description="Отговорът идва като карти OBSERVATION · RULES · SCENARIO · INVALIDATION · RISK · ALTERNATIVE SCENARIO, с числата от графиката и следващи стъпки."
                />
                <LearnHint title="Как работи учителят">
                  Учителят вижда графиката (индикатори, структура, режим, нива), стратегията ти, paper сметката, последните сделки, дневника и
                  прогреса в академията — виж „Какво знае учителят“. Обяснява правила, invalidation и риск; не казва „купи“ и не прогнозира цената.
                </LearnHint>
              </div>
            )}
          </div>
        </div>

        {/* ── strategy view / classic signal engine ── */}
        <Card className="xl:col-start-1 xl:row-start-2" bodyClass="p-0">
          <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-2.5">
            <Tabs
              value={lowerTab}
              onChange={setLowerTab}
              tabs={[
                { key: "strategy", label: "Strategy View" },
                { key: "engine", label: "Signal engine" },
              ]}
              className="min-w-[15rem] flex-1 !shadow-none"
            />
            <div className="mb-2 flex items-center gap-2">
              <Tooltip content="Класическият signal engine: индикатори → структура → режим → NO-TRADE проверки → решение.">
                <Info size={14} className="text-faint" aria-hidden />
              </Tooltip>
              <Button size="sm" variant="outline" onClick={analyze} disabled={busy}>
                <ScanSearch size={14} aria-hidden />
                {busy ? "Анализирам…" : "Analyze chart"}
              </Button>
            </div>
          </div>
          <div className="border-t border-white/[0.06] p-4">
            {lowerTab === "strategy" ? (
              <StrategyView symbol={symbol} timeframe={tf} strategyId={strategyId} />
            ) : (
              <div className="space-y-3">
                <ErrorText error={error} />
                {busy && !res && <Loading text="Signal engine: indicators → structure → regime → rules → risk…" />}
                {res ? (
                  <DecisionPanel analysis={res.analysis} panel={res.panel} explanation={res.explanation} beginner={beginner} />
                ) : (
                  !busy && (
                    <p className="text-sm leading-relaxed text-muted">
                      Натисни <b className="text-text">Analyze chart</b>. Engine-ът изчислява индикатори, пазарна структура (HH/HL/LH/LL), режим,
                      support/resistance, проверява NO-TRADE условията и показва решение WAIT / POSSIBLE LONG / POSSIBLE SHORT / NO TRADE — с обяснение
                      защо.
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── free chat ── */}
        <Card
          className={cx("xl:col-start-1 xl:row-start-3")}
          title="Ask the AI Teacher"
          right={<span className="hidden text-[11px] text-faint sm:inline">свободен чат</span>}
        >
          <ChatPanel symbol={symbol} timeframe={tf} initialQuestion={chatQuestion} />
          {status && <p className="mt-2 text-[11px] text-faint">{status.note}</p>}
        </Card>
      </div>
    </div>
  );
}
