"use client";

/*
 * LONG / SHORT / WAIT decision bar: stop / target inputs (typed or click-to-set from the chart), planned R:R,
 * a debounced server preview (flags such as "Chasing?" / "Against structure", stop distance in ATR) and, in
 * trade mode, an optional paper order sized by risk %. WAIT is recorded and reveals the next candle.
 */
import { ArrowDownRight, ArrowUpRight, Crosshair, Hourglass, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { ACTION_META, armDraft, checkLevels, num, plannedRR, rrTone, type Draft } from "@/components/replay/model";
import { FlagChip, OutcomeBadge } from "@/components/replay/parts";
import { useDecisionPreview } from "@/components/replay/useReplaySession";
import type { ReplayDecision, ReplayMode } from "@/components/replay/types";
import { Badge, Button, Kbd, Switch, Term } from "@/components/ui";
import { cx, fmtPrice, fmtTime } from "@/lib/format";
import { LearnHint } from "@/lib/workspace";
import type { Candle } from "@/lib/types";

export type PickField = "stop" | "target" | null;

const RR_CLASS = {
  up: "text-up",
  warn: "text-warn",
  down: "text-down",
  neutral: "text-muted",
} as Record<string, string>;

export function DecisionPanel({
  sid,
  mode,
  candles,
  precision,
  draft,
  onDraft,
  pick,
  onPick,
  current,
  busy,
  active,
  onRecord,
  onWait,
  beginner,
}: {
  sid: number;
  mode: ReplayMode;
  candles: Candle[];
  precision: number;
  draft: Draft;
  onDraft: (d: Draft) => void;
  pick: PickField;
  onPick: (f: PickField) => void;
  /** the decision already recorded on the cursor bar (a new one replaces it) */
  current: ReplayDecision | null;
  busy: boolean;
  active: boolean;
  onRecord: () => void;
  onWait: () => void;
  beginner?: boolean;
}) {
  const ids = useId();
  const last = candles[candles.length - 1];
  const entry = last?.close ?? null;
  const cursor = last?.time ?? null;
  const stop = num(draft.stop);
  const target = num(draft.target);
  const chk = draft.action ? checkLevels(draft.action, entry, stop, target, precision) : null;
  const rr = draft.action ? plannedRR(draft.action, entry, stop, target) : null;
  const {
    preview,
    error: previewError,
    loading,
  } = useDecisionPreview(sid, cursor, {
    action: draft.action,
    stop,
    target,
    valid: !!chk?.ok,
  });
  const shownRR = preview?.planned_rr ?? rr;
  const disabled = !active || busy;
  const armed = draft.action;
  const ref = useRef<HTMLElement>(null);
  // arming LONG / SHORT (button or hotkey) brings the form into view inside the scrolling side column
  useEffect(() => {
    if (armed) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [armed]);

  const arm = (a: "long" | "short") => {
    onDraft(armDraft(draft, a, candles, precision));
    onPick(null);
  };

  return (
    <section ref={ref} className="card min-w-0 scroll-mt-28" aria-label="Решение на текущата свещ">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2">
        <h2 className="shrink-0 text-[13px] font-semibold text-text">Решение</h2>
        <span className="num truncate text-[11px] text-muted" title={`Текуща (последна разкрита) свещ: ${fmtTime(cursor)}`}>
          close {fmtPrice(entry, precision)}
        </span>
      </header>
      <div className="space-y-3 p-3.5">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Посока">
          {(["long", "short"] as const).map((a) => {
            const m = ACTION_META[a];
            const on = armed === a;
            const Icon = a === "long" ? ArrowUpRight : ArrowDownRight;
            return (
              <button
                key={a}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => (on ? onDraft({ ...draft, action: null }) : arm(a))}
                title={`${m.label}: ${a === "long" ? "очакваш движение нагоре" : "очакваш движение надолу"} (клавиш ${m.hotkey})`}
                className={cx(
                  "flex h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-bold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  a === "long"
                    ? on
                      ? "border-up/60 bg-up/20 text-up shadow-[0_0_0_1px_rgb(34_199_158/0.25)]"
                      : "border-up/25 bg-up/[0.06] text-up hover:bg-up/[0.12]"
                    : on
                      ? "border-down/60 bg-down/20 text-down shadow-[0_0_0_1px_rgb(242_85_92/0.25)]"
                      : "border-down/25 bg-down/[0.06] text-down hover:bg-down/[0.12]",
                )}
              >
                <Icon size={16} aria-hidden />
                {m.label}
                <Kbd className="hidden opacity-70 sm:inline-flex">{m.hotkey}</Kbd>
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={onWait}
            title="WAIT: няма ясен setup — записва се като решение и се показва следващата свещ (клавиш W)"
            className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] text-sm font-bold tracking-wide text-muted transition-colors hover:bg-white/[0.08] hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Hourglass size={15} aria-hidden />
            WAIT
            <Kbd className="hidden opacity-70 sm:inline-flex">W</Kbd>
          </button>
        </div>

        {current && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-xs text-muted">
            <span>На тази свещ вече имаш:</span>
            <Badge tone={ACTION_META[current.action].tone}>{ACTION_META[current.action].label}</Badge>
            <OutcomeBadge decision={current} />
            <span className="text-faint">ново решение ще го замени</span>
          </div>
        )}

        {!armed && (
          <p className="text-xs leading-relaxed text-muted">
            Избери <b className="text-up">LONG</b>, <b className="text-down">SHORT</b> или <b className="text-text">WAIT</b> само по това, което виждаш. При
            LONG / SHORT задаваш <Term k="stoploss">stop</Term> и <Term k="takeprofit">target</Term> — кликни върху графиката, за да ги поставиш.
          </p>
        )}

        {armed && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (chk?.ok && !disabled) onRecord();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <LevelInput
                id={`${ids}-stop`}
                label="Stop"
                term="stoploss"
                value={draft.stop}
                onChange={(v) => onDraft({ ...draft, stop: v })}
                error={chk?.stopError ?? null}
                picking={pick === "stop"}
                onPick={() => onPick(pick === "stop" ? null : "stop")}
                tone="down"
              />
              <LevelInput
                id={`${ids}-target`}
                label="Target"
                term="takeprofit"
                value={draft.target}
                onChange={(v) => onDraft({ ...draft, target: v })}
                error={chk?.targetError ?? null}
                picking={pick === "target"}
                onPick={() => onPick(pick === "target" ? null : "target")}
                tone="up"
              />
            </div>
            <p className="text-[11px] leading-snug text-faint">
              {pick
                ? `Кликни върху графиката, за да поставиш ${pick === "stop" ? "stop" : "target"}.`
                : `Клик върху графиката: ${armed === "long" ? "под цената = stop, над нея = target" : "над цената = stop, под нея = target"}.`}
            </p>

            <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-xs">
              <div>
                <div className="text-faint">Entry (close)</div>
                <div className="num font-medium text-text">{fmtPrice(entry, precision)}</div>
              </div>
              <div>
                <div className="text-faint">
                  <Term k="rr">R:R</Term> план
                </div>
                <div className={cx("num font-semibold", RR_CLASS[rrTone(shownRR)])}>{shownRR !== null ? `${shownRR.toFixed(2)}R` : "—"}</div>
              </div>
              <div>
                <div className="text-faint">
                  Stop в <Term k="atr">ATR</Term>
                </div>
                <div className="num font-medium text-text">
                  {preview?.risk_atr !== null && preview?.risk_atr !== undefined ? preview.risk_atr.toFixed(2) : "—"}
                </div>
              </div>
            </div>

            <div className="min-h-6" aria-live="polite">
              {loading && chk?.ok ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
                  <Loader2 size={12} className="animate-spin" aria-hidden /> Проверка на правилата…
                </span>
              ) : previewError ? (
                <span className="text-[11px] text-down">{previewError}</span>
              ) : preview ? (
                preview.flags.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {preview.flags.map((f) => (
                      <FlagChip key={f.key} flag={f} />
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-up">Без предупреждения по правилата — запиши решението.</span>
                )
              ) : null}
            </div>

            {mode === "trade" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-white/[0.06] px-2.5 py-2">
                <Switch checked={draft.placeOrder} onChange={(v) => onDraft({ ...draft, placeOrder: v })} label="Пусни и paper поръчка" />
                {draft.placeOrder && (
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    Риск
                    <input
                      className="input num !w-16 !px-2 !py-1 text-xs"
                      inputMode="decimal"
                      value={draft.riskPct}
                      onChange={(e) => onDraft({ ...draft, riskPct: e.target.value })}
                      aria-label="Риск на сделка в %"
                    />
                    %
                  </label>
                )}
              </div>
            )}

            <input
              className="input text-xs"
              placeholder="Бележка (по желание): защо влизаш тук?"
              maxLength={300}
              value={draft.note}
              onChange={(e) => onDraft({ ...draft, note: e.target.value })}
              aria-label="Бележка към решението"
            />

            <div className="flex gap-2">
              <Button type="submit" variant={armed === "long" ? "up" : "down"} className="flex-1" disabled={disabled || !chk?.ok}>
                Запиши {ACTION_META[armed].label}
                <Kbd className="ml-1 hidden opacity-70 sm:inline-flex">Enter</Kbd>
              </Button>
              <Button type="button" variant="ghost" onClick={() => onDraft({ ...draft, action: null })} aria-label="Откажи решението">
                <X size={15} aria-hidden />
              </Button>
            </div>
          </form>
        )}

        {beginner && (
          <LearnHint>
            Оценка 0–100: посока, R:R ≥ 1.5, stop зад swing ниво (≥ 0.5 ATR), без гонене и без вход срещу структурата. WAIT също се оценява.
          </LearnHint>
        )}
      </div>
    </section>
  );
}

function LevelInput({
  id,
  label,
  term,
  value,
  onChange,
  error,
  picking,
  onPick,
  tone,
}: {
  id: string;
  label: string;
  term: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  picking: boolean;
  onPick: () => void;
  tone: "up" | "down";
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cx("mb-1 block text-[11px] font-medium", tone === "up" ? "text-up" : "text-down")}>
        <Term k={term}>{label}</Term>
      </label>
      <div className="flex gap-1">
        <input
          id={id}
          className={cx("input num min-w-0 flex-1 !px-2 text-sm", error && "!border-down/60")}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <button
          type="button"
          onClick={onPick}
          aria-pressed={picking}
          title={`Постави ${label.toLowerCase()} с клик върху графиката`}
          aria-label={`${label} от графиката`}
          className={cx(
            "flex h-[34px] w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
            picking ? "border-accent/60 bg-accent/20 text-accent2" : "border-white/10 text-faint hover:bg-white/[0.06] hover:text-text",
          )}
        >
          <Crosshair size={14} aria-hidden />
        </button>
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1 text-[11px] leading-snug text-down">
          {error}
        </p>
      )}
    </div>
  );
}
