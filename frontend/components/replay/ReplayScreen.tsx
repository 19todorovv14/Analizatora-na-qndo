"use client";

/*
 * Active replay (terminal-like, chart dominant): top bar (instrument, mode, preset, source, progress, Finish),
 * the chart with the hidden-future boundary + decision markers + click-to-set levels, the candle controls
 * (Next candle ▶, +5, +20, auto-play) and the right column (live score, decision bar, trade-mode order panel).
 * Hotkeys: Space / → next candle, Shift+→ +5, L long, S short, W wait, Enter record, P auto-play.
 */
import { FastForward, Flag, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DecisionPanel, type PickField } from "@/components/replay/DecisionPanel";
import { ReplayChart } from "@/components/replay/ReplayChart";
import { ReplayToasts } from "@/components/replay/parts";
import { ScoreHud } from "@/components/replay/ScoreHud";
import { TradePanel } from "@/components/replay/TradePanel";
import {
  AUTO_SPEEDS,
  EMPTY_DRAFT,
  MODE_META,
  armDraft,
  checkLevels,
  clearDraft,
  decisionLines,
  decisionMarkers,
  levelForClick,
  num,
  positionLines,
  precisionOf,
  priceInput,
  progress,
  type Draft,
} from "@/components/replay/model";
import type { ReplayOptions, ReplayState } from "@/components/replay/types";
import type { ReplaySessionApi } from "@/components/replay/useReplaySession";
import { Badge, Button, DataNotAvailable, ErrorText, Kbd, Segmented, SourceBadge, Switch, useStoredState } from "@/components/ui";
import { TF_LABEL, cx, fmtTime } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";

const isBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

export function ReplayScreen({
  api,
  state,
  options,
  beginner,
  onNew,
}: {
  api: ReplaySessionApi;
  state: ReplayState;
  options?: ReplayOptions | null;
  beginner?: boolean;
  onNew: () => void;
}) {
  const [draftState, setDraftState] = useState<{ sid: number; d: Draft }>({
    sid: state.session.id,
    d: EMPTY_DRAFT,
  });
  const [pick, setPick] = useState<PickField>(null);
  const [showEma, setShowEma] = useStoredState<boolean>("ta-replay-ema", true, {
    validate: isBool,
  });
  const s = state.session;
  // a draft belongs to its session
  const draft = draftState.sid === s.id ? draftState.d : EMPTY_DRAFT;
  const setDraft = useCallback((d: Draft) => setDraftState({ sid: s.id, d }), [s.id]);

  const mode = state.mode ?? s.mode ?? "trade";
  const candles = state.candles;
  const last = candles[candles.length - 1];
  const precision = precisionOf(state, last?.close);
  const decisions = useMemo(() => state.decisions ?? [], [state.decisions]);
  const active = s.status === "active";
  const prog = progress(s);
  const demo = state.source ? state.source.status === "demo" || !state.source.is_live : false;

  const markers = useMemo(() => decisionMarkers(decisions), [decisions]);
  const stop = num(draft.stop);
  const target = num(draft.target);
  const lines = useMemo(
    () => [
      ...decisionLines(decisions, { action: draft.action, stop, target }, precision),
      ...(mode === "trade" ? positionLines(state.account.positions, state.account.orders) : []),
    ],
    [decisions, draft.action, stop, target, precision, mode, state.account.positions, state.account.orders],
  );

  const onPriceClick = useCallback(
    (price: number) => {
      if (!draft.action || !last) return;
      const field = pick ?? levelForClick(draft.action, last.close, price);
      if (!field) return;
      setDraft({ ...draft, [field]: priceInput(price, precision) });
      setPick(null);
    },
    [draft, last, pick, precision, setDraft],
  );

  const record = useCallback(async () => {
    if (!draft.action || !last) return;
    const chk = checkLevels(draft.action, last.close, stop, target, precision);
    if (!chk.ok) return;
    const r = await api.decide({
      action: draft.action,
      stop,
      target,
      note: draft.note,
      place_order: mode === "trade" && draft.placeOrder,
      risk_pct: num(draft.riskPct),
    });
    if (r) {
      setDraft(clearDraft(draft));
      setPick(null);
    }
  }, [api, draft, last, stop, target, precision, mode, setDraft]);

  const wait = useCallback(async () => {
    const r = await api.decide({ action: "wait", note: draft.note });
    if (r && r.session.status === "active") await api.step(1);
    setDraft(clearDraft(draft));
  }, [api, draft, setDraft]);

  const arm = useCallback(
    (a: "long" | "short") => {
      if (!active) return;
      setDraft(armDraft(draft, a, candles, precision));
      setPick(null);
    },
    [active, draft, candles, precision, setDraft],
  );

  useHotkeys(
    {
      space: (e) => {
        // Space keeps activating a focused control (button / switch / link); elsewhere it is "next candle"
        const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("button,a,[role='switch'],[role='tab']") : null;
        if (el) el.click();
        else if (active) void api.step(1);
      },
      right: () => active && void api.step(1),
      "shift+right": () => active && void api.step(5),
      l: () => arm("long"),
      s: () => arm("short"),
      w: () => active && void wait(),
      p: () => active && api.setAuto(!api.auto),
      // Enter records an armed LONG / SHORT (inside the form's inputs the form submit does it)
      ...(draft.action ? { enter: () => void record() } : {}),
    },
    { enabled: active },
  );

  // the window ended while stepping → straight to the AI history review
  const ended = s.status !== "active" && !s.has_review;
  const { finish, busy } = api;
  const autoFinished = useRef<number | null>(null);
  useEffect(() => {
    if (!ended || busy || autoFinished.current === s.id) return;
    autoFinished.current = s.id;
    void finish();
  }, [ended, busy, s.id, finish]);

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-var(--spacing-topbar)-2rem)] lg:min-h-[560px]">
      {/* ── top bar ───────────────────────────────────────────── */}
      <div className="card flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-text">
            {s.symbol} <span className="text-muted">· {TF_LABEL[s.timeframe] ?? s.timeframe.toUpperCase()}</span>
          </h1>
          <Badge tone="info">replay</Badge>
          <Badge tone={mode === "predict" ? "violet" : "accent"}>{MODE_META[mode].label}</Badge>
          {s.preset && <Badge tone="neutral">{s.preset.label}</Badge>}
          <SourceBadge source={state.source} />
        </div>
        <div className="flex min-w-[180px] flex-1 items-center gap-2 text-[11px] text-muted">
          <div
            className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-white/[0.07]"
            role="progressbar"
            aria-valuenow={prog.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Разкрити свещи"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${prog.pct}%` }} />
          </div>
          <span className="num shrink-0" title="Текуща свещ (последната разкрита)">
            {fmtTime(s.cursor_ts)} · {prog.revealed}/{prog.total} · остават {s.remaining}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onNew} title="Към настройките (сесията остава в историята)">
            <RotateCcw size={14} aria-hidden /> Нова
          </Button>
          <Button size="sm" variant="down" onClick={() => void api.finish()} disabled={api.busy}>
            <Flag size={14} aria-hidden /> Finish + AI review
          </Button>
        </div>
      </div>

      {/* ── chart + side column ───────────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="card relative h-[58dvh] min-h-[320px] overflow-hidden p-1.5 lg:h-auto lg:min-h-0 lg:flex-1">
            <ReplayToasts inline toasts={api.toasts} onDismiss={api.dismissToast} />
            {candles.length ? (
              <ReplayChart
                candles={candles}
                precision={precision}
                markers={markers}
                priceLines={lines}
                indicators={state.indicators}
                showEma={showEma}
                boundary="live"
                boundaryLabel={`Бъдещето е скрито · ${s.remaining} свещи`}
                fitKey={`replay-${s.id}`}
                demo={demo}
                onPriceClick={draft.action ? onPriceClick : undefined}
                crosshair={!!draft.action}
              />
            ) : (
              <div className="grid h-full place-items-center p-4">
                <DataNotAvailable reason="Няма свещи за този период." />
              </div>
            )}
          </div>

          {/* ── candle controls ─────────────────────────────────── */}
          <div className="card flex shrink-0 flex-wrap items-center gap-2 px-2.5 py-2">
            <Button onClick={() => void api.step(1)} disabled={!active || api.busy}>
              <StepForward size={15} aria-hidden />
              Next candle ▶
            </Button>
            <Button variant="outline" onClick={() => void api.step(5)} disabled={!active || api.busy} title="5 свещи напред (Shift+→)">
              +5
            </Button>
            <Button variant="outline" onClick={() => void api.step(20)} disabled={!active || api.busy} title="20 свещи напред">
              +20
            </Button>
            <Button
              variant={api.auto ? "warn" : "outline"}
              onClick={() => api.setAuto(!api.auto)}
              disabled={!active}
              aria-pressed={api.auto}
              title="Auto play (P)"
            >
              {api.auto ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              {api.auto ? "Pause" : "Auto play"}
            </Button>
            <Segmented
              size="sm"
              ariaLabel="Скорост на auto play"
              options={AUTO_SPEEDS.map((x) => ({
                value: x.value,
                label: x.label,
              }))}
              value={api.speed}
              onChange={(v) => api.setSpeed(v)}
            />
            <span className="px-1 text-[11px] text-muted">
              <Switch checked={showEma} onChange={setShowEma} label="EMA 20" title="EMA 20 — референцията за „Chasing?“" />
            </span>
            <div className="ml-auto hidden items-center gap-2 text-[11px] text-faint xl:flex" aria-hidden>
              <span className="flex items-center gap-1">
                <Kbd>Space</Kbd>/<Kbd>→</Kbd> свещ
              </span>
              <span className="flex items-center gap-1">
                <Kbd>⇧→</Kbd>
                <FastForward size={11} />5
              </span>
              <span className="flex items-center gap-1">
                <Kbd>L</Kbd>
                <Kbd>S</Kbd>
                <Kbd>W</Kbd> решение
              </span>
            </div>
          </div>
          {api.error && !api.error.unavailable && <ErrorText error={api.error.message} />}
          {api.error?.unavailable && <DataNotAvailable reason={api.error.reason ?? api.error.message} compact />}
        </div>

        <aside className={cx("flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto lg:overscroll-contain lg:pr-0.5")} aria-label="Решения и резултат">
          <ScoreHud
            score={state.score}
            summary={state.decisions_summary}
            flagOptions={options?.flags}
            className="lg:sticky lg:top-0 lg:z-20 lg:shrink-0 lg:!bg-surface/95 lg:backdrop-blur-md"
          />
          <DecisionPanel
            sid={s.id}
            mode={mode}
            candles={candles}
            precision={precision}
            draft={draft}
            onDraft={setDraft}
            pick={pick}
            onPick={setPick}
            current={state.current_decision ?? null}
            busy={api.busy}
            active={active}
            onRecord={() => void record()}
            onWait={() => void wait()}
            beginner={beginner}
          />
          {mode === "trade" && (
            <TradePanel
              account={state.account}
              events={state.events}
              price={last?.close ?? null}
              precision={precision}
              findings={api.findings}
              busy={api.busy}
              active={active}
              onOrder={(req) => void api.order(req)}
              onClose={(id) => void api.action("close", id)}
              onCancel={(id) => void api.action("cancel", id)}
            />
          )}
          {mode === "predict" && (
            <p className="px-1 text-[11px] leading-relaxed text-faint">
              Predict режим: прогнозите не пускат поръчки по сметка — оценяват се само по разкритите свещи.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
