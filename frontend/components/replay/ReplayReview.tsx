"use client";

/*
 * AI HISTORY REVIEW of a finished replay: score ring, what happened (the whole window + the next 30 bars on
 * one chart, with your decisions, the comparison strategy's trades and paper trades as markers), predictions
 * vs outcomes, correct / wrong, flags (entered too early / chased / ignored structure / R:R), invalidation
 * levels, the teacher sections, "Here is what a rule-based strategy would have done.", recommended lessons
 * and the "Replay another period" CTA.
 */
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Eye,
  GitBranch,
  ListChecks,
  RotateCcw,
  Shield,
  ShieldAlert,
  Shuffle,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { ReplayChart } from "@/components/replay/ReplayChart";
import {
  ACTION_META,
  MODE_META,
  STRATEGY_DISCLAIMER,
  STRATEGY_SENTENCE,
  decisionLines,
  decisionMarkers,
  exitLabel,
  mergeCandles,
  outcomeView,
  paperTradeMarkers,
  snapMarkers,
  strategyTradeMarkers,
} from "@/components/replay/model";
import { ActionBadge, FlagChip, OutcomeBadge, ScoreRing } from "@/components/replay/parts";
import type { CompactDecision, FlagItem, HistoryReview, Prediction, ReviewData, StrategyComparison } from "@/components/replay/types";
import { TradeReviewCard } from "@/components/trading/TradeReviewCard";
import { Badge, Button, Disclaimer, EmptyState, RegimeBadge, SourceBadge, StatTile, Switch, Term } from "@/components/ui";
import type { MarkerDef } from "@/components/charts/TradingChart";
import { TF_LABEL, cx, fmtDate, fmtMoney, fmtPct, fmtPrice, fmtR, fmtTime, pnlClass } from "@/lib/format";
import { PALETTE } from "@/lib/theme";
import { lessonHref } from "@/lib/lessons";

type Layers = {
  decisions: boolean;
  strategy: boolean;
  paper: boolean;
  swings: boolean;
};

export function ReplayReview({
  data,
  onAnother,
  onSetup,
  busy,
  history,
}: {
  data: ReviewData;
  /** "Replay another period": a new random past period with the same instrument / timeframe / mode */
  onAnother: () => void;
  /** back to the setup form */
  onSetup: () => void;
  busy?: boolean;
  /** past sessions list (rendered at the end) */
  history?: React.ReactNode;
}) {
  const hr = data.review;
  const s = data.session;
  const mode = hr?.mode ?? s.mode ?? "trade";
  const precision = data.precision;
  const [selected, setSelected] = useState<number | null>(null);
  const [layers, setLayers] = useState<Layers>({
    decisions: true,
    strategy: true,
    paper: true,
    swings: false,
  });
  const chartRef = useRef<HTMLDivElement>(null);

  const candles = useMemo(() => mergeCandles(data.candles, data.next), [data.candles, data.next]);
  const strategyTrades = useMemo(() => hr?.strategy_comparison?.trades ?? [], [hr]);
  const markers = useMemo<MarkerDef[]>(() => {
    const out: MarkerDef[] = [];
    if (layers.decisions) out.push(...decisionMarkers(data.decisions, { selectedId: selected }));
    if (layers.strategy) out.push(...strategyTradeMarkers(strategyTrades));
    if (layers.paper) out.push(...paperTradeMarkers(data.paperTrades));
    if (layers.swings)
      for (const sw of hr?.what_happened.key_swings ?? [])
        out.push({
          time: sw.time,
          position: sw.kind === "high" ? "aboveBar" : "belowBar",
          shape: "circle",
          color: PALETTE.faint,
          text: sw.label ?? sw.kind,
        });
    return snapMarkers(out, candles);
  }, [layers, data.decisions, data.paperTrades, strategyTrades, hr, selected, candles]);
  const lines = useMemo(
    () =>
      selected !== null
        ? decisionLines(data.decisions, null, precision, {
            selectedId: selected,
          })
        : [],
    [selected, data.decisions, precision],
  );
  // fit the session window (+ the next bars) instead of the 150 history candles before it
  const windowBars = Math.max(60, candles.filter((c) => c.time >= s.start_ts).length + 6);
  const selectedTs = data.decisions.find((d) => d.id === selected)?.bar_ts ?? null;
  const demo = data.source ? data.source.status === "demo" || !data.source.is_live : false;

  const focus = (id: number) => {
    setSelected((cur) => (cur === id ? null : id));
    const el = chartRef.current;
    if (el && typeof el.getBoundingClientRect === "function") {
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="space-y-4">
      {/* ── header ─────────────────────────────────────────────── */}
      <section className="card min-w-0 overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
          <ScoreRing score={hr?.score ?? s.score ?? null} grade={hr?.grade ?? s.grade ?? null} size={104} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-text">Replay review</h2>
              <Badge tone="violet">
                <Sparkles size={11} aria-hidden /> AI history review
              </Badge>
              {hr?.provider_label && <Badge>{hr.provider_label}</Badge>}
              <SourceBadge source={data.source} />
            </div>
            <p className="num mt-1 text-sm text-muted">
              {s.symbol} · {TF_LABEL[s.timeframe] ?? s.timeframe} · {MODE_META[mode].label}
              {s.preset ? ` · ${s.preset.label}` : ""} · {fmtDate(s.start_ts)} → {fmtDate(s.cursor_ts)}
            </p>
            {(hr?.summary?.length ? hr.summary : data.summary).length > 0 && (
              <ul className="mt-2 space-y-1 text-sm leading-relaxed text-text/90">
                {(hr?.summary?.length ? hr.summary : data.summary).map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent2" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            <Button onClick={onAnother} disabled={busy}>
              <RotateCcw size={15} aria-hidden /> Replay another period
            </Button>
            <Button variant="ghost" onClick={onSetup}>
              Нови настройки
            </Button>
          </div>
        </div>
      </section>

      {!hr && (
        <EmptyState
          compact
          icon={Bot}
          title="Няма AI преглед за тази сесия"
          description="Сесията е от по-стара версия — по-долу е класическият преглед на сделките."
        />
      )}

      {/* ── what happened ─────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card flex min-w-0 flex-col" ref={chartRef} aria-label="Какво стана — цялата графика">
          <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-white/[0.06] px-4 py-2">
            <h3 className="text-[13px] font-semibold text-text">Какво стана — цялата графика + следващите {data.next.length} свещи</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <Switch checked={layers.decisions} onChange={(v) => setLayers({ ...layers, decisions: v })} label="Решения" />
              <Switch checked={layers.strategy} onChange={(v) => setLayers({ ...layers, strategy: v })} label="Стратегия" />
              {data.paperTrades.length > 0 && <Switch checked={layers.paper} onChange={(v) => setLayers({ ...layers, paper: v })} label="Paper сделки" />}
              <Switch checked={layers.swings} onChange={(v) => setLayers({ ...layers, swings: v })} label="Swing точки" />
            </div>
          </header>
          <div className="h-[340px] p-1.5 sm:h-[440px] xl:h-auto xl:min-h-[440px] xl:flex-1">
            <ReplayChart
              candles={candles}
              precision={precision}
              markers={markers}
              priceLines={lines}
              boundary="review"
              boundaryTime={s.cursor_ts}
              boundaryLabel={`След края · ${data.next.length} свещи`}
              fitKey={`review-${s.id}`}
              visibleBars={windowBars}
              demo={demo}
              highlightTime={selectedTs}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] px-4 py-2 text-[11px] text-muted">
            <Legend color={PALETTE.up} label="верни / target" />
            <Legend color={PALETTE.down} label="грешни / stop" />
            <Legend color={PALETTE.warn} label="пропуснато движение" />
            <Legend color={PALETTE.violet} label="rule-based стратегия" />
            {data.paperTrades.length > 0 && <Legend color={PALETTE.gold} label="paper сделки" />}
          </div>
        </section>
        {hr && <WhatHappenedCard hr={hr} precision={precision} />}
      </div>

      {hr && (
        <>
          <PredictionsTable predictions={hr.predictions} precision={precision} selected={selected} onSelect={focus} />

          <div className="grid gap-4 lg:grid-cols-2">
            <CompactList
              title="Верни"
              icon={CheckCircle2}
              tone="up"
              items={hr.correct}
              empty="Нито едно вярно решение този път — прегледът по-долу казва защо."
              onSelect={focus}
            />
            <CompactList
              title="Грешни"
              icon={XCircle}
              tone="down"
              items={[...hr.wrong, ...(hr.undetermined ?? [])]}
              empty="Няма грешни решения."
              onSelect={focus}
            />
          </div>

          <FlagsCard hr={hr} onSelect={focus} />

          <TeacherSections hr={hr} />

          <StrategyComparisonCard sc={hr.strategy_comparison} precision={precision} />

          <div className="grid gap-4 xl:grid-cols-2">
            <InvalidationCard hr={hr} precision={precision} onSelect={focus} />
            <LessonsCard hr={hr} />
          </div>
        </>
      )}

      {data.reviews.length > 0 && (
        <section className="card min-w-0" aria-label="Paper сделки — преглед">
          <header className="flex min-h-11 items-center border-b border-white/[0.06] px-4 py-2.5">
            <h3 className="text-[13px] font-semibold text-text">Paper сделки — TRADE REVIEW</h3>
          </header>
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {data.reviews.map((r) => (
              <div key={r.position_id} className="rounded-lg border border-white/[0.07] p-3">
                <TradeReviewCard review={r} />
              </div>
            ))}
          </div>
        </section>
      )}

      {hr?.disclaimer && <Disclaimer>{hr.disclaimer}</Disclaimer>}

      {history}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

function CardShell({
  title,
  icon: Icon,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  icon?: LucideIcon;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("card min-w-0", className)}>
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text">
          {Icon && <Icon size={14} className="shrink-0 text-faint" aria-hidden />}
          {title}
        </h3>
        {right}
      </header>
      {children}
    </section>
  );
}

function WhatHappenedCard({ hr, precision }: { hr: HistoryReview; precision: number }) {
  const w = hr.what_happened;
  if (!w.available) {
    return (
      <CardShell title="Какво стана" icon={Eye}>
        <p className="p-4 text-sm text-muted">{w.reason ?? "Няма достатъчно свещи за анализ."}</p>
      </CardShell>
    );
  }
  return (
    <CardShell title="Какво стана" icon={Eye}>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile
            label="Промяна"
            value={<span className={cx("num", pnlClass(w.change_pct))}>{fmtPct(w.change_pct, 2, true)}</span>}
            sub={`${fmtPrice(w.start_price, precision)} → ${fmtPrice(w.end_price, precision)}`}
          />
          <StatTile
            label="След края"
            value={<span className={cx("num", pnlClass(w.next?.change_pct))}>{w.next ? fmtPct(w.next.change_pct, 2, true) : "—"}</span>}
            sub={w.next ? `${w.next.bars} свещи` : "няма данни"}
          />
          <StatTile
            label="Макс. нагоре"
            value={<span className="num text-up">{fmtPct(w.max_up_pct, 2, true)}</span>}
            sub={w.max_up_atr ? `${w.max_up_atr.toFixed(1)} ATR` : undefined}
          />
          <StatTile
            label="Макс. надолу"
            value={<span className="num text-down">{fmtPct(w.max_down_pct, 2, true)}</span>}
            sub={w.max_down_atr ? `${w.max_down_atr.toFixed(1)} ATR` : undefined}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>
            <Term k="regime">Режим</Term>:
          </span>
          <RegimeBadge regime={w.regime_start} />
          {w.regime_end && w.regime_end !== w.regime_start && (
            <>
              <ArrowRight size={12} aria-hidden />
              <RegimeBadge regime={w.regime_end} />
            </>
          )}
        </div>
        {w.setup?.text && <p className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-muted">{w.setup.text}</p>}
        <ul className="space-y-1.5 text-xs leading-relaxed text-text/85">
          {(w.text ?? []).slice(0, 5).map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </CardShell>
  );
}

function PredictionsTable({
  predictions,
  precision,
  selected,
  onSelect,
}: {
  predictions: Prediction[];
  precision: number;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <CardShell
      title="Твоите прогнози срещу реалността"
      icon={ListChecks}
      right={<span className="text-[11px] text-faint">{predictions.length} решения · клик = на графиката</span>}
    >
      {predictions.length === 0 ? (
        <div className="p-4">
          <EmptyState
            compact
            icon={ListChecks}
            title="Нямаше LONG / SHORT / WAIT решения"
            description="Следващия път запиши решение на всяка важна свещ — така прегледът може да оцени процеса ти."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.06em] text-faint">
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-2 font-semibold">Свещ</th>
                <th className="px-2 py-2 font-semibold">Решение</th>
                <th className="px-2 py-2 text-right font-semibold">Entry</th>
                <th className="px-2 py-2 text-right font-semibold">Stop</th>
                <th className="px-2 py-2 text-right font-semibold">Target</th>
                <th className="px-2 py-2 text-right font-semibold">R:R</th>
                <th className="px-2 py-2 font-semibold">Резултат</th>
                <th className="px-2 py-2 text-right font-semibold">Score</th>
                <th className="px-4 py-2 font-semibold">Коментар</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {predictions.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={cx("cursor-pointer align-top transition-colors hover:bg-white/[0.03]", selected === p.id && "bg-accent/[0.08]")}
                  aria-selected={selected === p.id}
                >
                  <td className="num whitespace-nowrap px-4 py-2.5 text-muted">{fmtTime(p.bar_ts)}</td>
                  <td className="px-2 py-2.5">
                    <ActionBadge action={p.action} />
                  </td>
                  <td className="num px-2 py-2.5 text-right">{fmtPrice(p.entry_price, precision)}</td>
                  <td className="num px-2 py-2.5 text-right text-down/90">{p.stop !== null ? fmtPrice(p.stop, precision) : "—"}</td>
                  <td className="num px-2 py-2.5 text-right text-up/90">{p.target !== null ? fmtPrice(p.target, precision) : "—"}</td>
                  <td className="num px-2 py-2.5 text-right">{p.planned_rr !== null ? p.planned_rr.toFixed(2) : "—"}</td>
                  <td className="px-2 py-2.5">
                    <OutcomeBadge decision={p} />
                  </td>
                  <td className="num px-2 py-2.5 text-right font-semibold">{p.score !== null ? Math.round(p.score) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <p className="max-w-[440px] leading-relaxed text-muted">{p.comment}</p>
                    {p.flags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.flags.map((f) => (
                          <FlagChip key={f.key} flag={f} />
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

function CompactList({
  title,
  icon,
  tone,
  items,
  empty,
  onSelect,
}: {
  title: string;
  icon: LucideIcon;
  tone: "up" | "down";
  items: CompactDecision[];
  empty: string;
  onSelect: (id: number) => void;
}) {
  return (
    <CardShell title={title} icon={icon} right={<Badge tone={tone}>{items.length}</Badge>}>
      {items.length ? (
        <ul className="divide-y divide-white/[0.05]">
          {items.map((d) => {
            const v = outcomeView({
              action: d.action,
              outcome:
                d.action === "wait"
                  ? { status: "resolved", right_to_wait: d.right_to_wait }
                  : {
                      status: d.status as "open",
                      bars_held: 1,
                      r_result: d.r_result,
                    },
            });
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <ActionBadge action={d.action} className="mt-0.5" />
                  <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">{d.text}</span>
                  <span className={cx("num shrink-0 text-xs font-semibold", v.tone === "up" ? "text-up" : v.tone === "down" ? "text-down" : "text-warn")}>
                    {d.r_result !== null ? fmtR(d.r_result) : d.score !== null ? Math.round(d.score) : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-4 text-xs text-faint">{empty}</p>
      )}
    </CardShell>
  );
}

function FlagGroup({ title, hint, items, onSelect }: { title: string; hint: string; items: FlagItem[]; onSelect: (id: number) => void }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-text">{title}</div>
        <Badge tone={items.length ? "warn" : "up"}>{items.length ? `×${items.length}` : "OK"}</Badge>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</p>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map((f) => (
            <li key={`${f.id}-${f.text}`}>
              <button type="button" onClick={() => onSelect(f.id)} className="w-full text-left text-xs leading-relaxed text-muted hover:text-text">
                <span className="num mr-1 text-faint">{fmtTime(f.bar_ts)}</span>
                <span className={cx("mr-1 font-semibold", f.action === "long" ? "text-up" : "text-down")}>{ACTION_META[f.action]?.label}</span>
                {f.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlagsCard({ hr, onSelect }: { hr: HistoryReview; onSelect: (id: number) => void }) {
  const rr = hr.rr_assessment;
  const verdictTone = rr.verdict === "good" ? "up" : rr.verdict === "poor" ? "down" : rr.verdict === "mixed" ? "warn" : "neutral";
  return (
    <CardShell
      title="Грешки в процеса"
      icon={AlertTriangle}
      right={
        hr.flags_summary.length > 0 ? (
          <div className="hidden flex-wrap justify-end gap-1 sm:flex">
            {hr.flags_summary.slice(0, 4).map((f) => (
              <FlagChip
                key={f.key}
                flag={{
                  key: f.key,
                  label: `${f.label} ×${f.count}`,
                  severity: f.severity,
                  text: f.label,
                }}
              />
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <FlagGroup
          title="Entered too early"
          hint="Вход преди потвърждение — структурата още беше срещу теб."
          items={hr.entered_too_early}
          onSelect={onSelect}
        />
        <FlagGroup title="Chased" hint="Гонене: вход > 1.5 ATR от EMA 20 след голяма свещ." items={hr.chased} onSelect={onSelect} />
        <FlagGroup
          title="Ignored structure"
          hint="LONG под съпротива / SHORT над подкрепа (в рамките на 0.5 ATR)."
          items={hr.ignored_structure}
          onSelect={onSelect}
        />
        <div className="min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-text">
              <Term k="rr">R:R</Term> оценка
            </div>
            <Badge tone={verdictTone}>{rr.verdict}</Badge>
          </div>
          <div className="num mt-1 text-xs text-muted">
            средно {rr.avg_planned_rr !== null ? rr.avg_planned_rr.toFixed(2) : "—"} · общо {fmtR(rr.total_r)}
          </div>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
            {rr.text.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </CardShell>
  );
}

function InvalidationCard({ hr, precision, onSelect }: { hr: HistoryReview; precision: number; onSelect: (id: number) => void }) {
  return (
    <CardShell title="Invalidation нива — къде идеята е грешна" icon={ShieldAlert}>
      {hr.invalidation_levels.length ? (
        <ul className="divide-y divide-white/[0.05]">
          {hr.invalidation_levels.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => onSelect(l.id)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.03]">
                <ActionBadge action={l.action} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="num text-xs text-text">
                    {fmtPrice(l.level, precision)}
                    {l.structural_level !== null && (
                      <span className="text-faint">
                        {" "}
                        · {l.structural_label} {fmtPrice(l.structural_level, precision)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{l.text}</p>
                </div>
                <Badge tone={l.hit ? "down" : "up"}>{l.hit ? "достигнато" : "не е"}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-xs text-faint">Няма LONG / SHORT решения — няма и invalidation нива.</p>
      )}
    </CardShell>
  );
}

const SECTION_ICON: Record<string, LucideIcon> = {
  observation: Eye,
  rules: ListChecks,
  scenario: GitBranch,
  invalidation: ShieldAlert,
  risk: Shield,
  alternative: Shuffle,
};

function TeacherSections({ hr }: { hr: HistoryReview }) {
  return (
    <CardShell title="AI учител — разбор" icon={Bot} right={hr.provider_label ? <Badge>{hr.provider_label}</Badge> : undefined}>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {hr.sections.map((sec) => {
          const Icon = SECTION_ICON[sec.key] ?? Sparkles;
          return (
            <div key={sec.key} className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent2">
                <Icon size={12} aria-hidden />
                {sec.title}
              </div>
              <ul className="mt-1 space-y-1 text-xs leading-relaxed text-text/85">
                {sec.body.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          );
        })}
        {hr.safety_note && <p className="text-[11px] text-faint md:col-span-2 xl:col-span-3">{hr.safety_note}</p>}
      </div>
    </CardShell>
  );
}

function StrategyComparisonCard({ sc, precision }: { sc: StrategyComparison; precision: number }) {
  const m = sc.metrics;
  return (
    <section className="card min-w-0 border-violet/20" aria-label="Rule-based стратегия">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Bot size={14} className="text-violet" aria-hidden />
          {sc.sentence || STRATEGY_SENTENCE}
        </h3>
        {sc.strategy && (
          <span className="truncate text-[11px] text-muted">
            {sc.strategy.name}
            {sc.strategy.is_template ? " · шаблон" : ""}
          </span>
        )}
      </header>
      {!sc.available ? (
        <p className="p-4 text-sm text-muted">{sc.reason ?? "Сравнението не е налично за този период."}</p>
      ) : (
        <div className="space-y-4 p-4">
          {m && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              <StatTile label="Сделки" value={<span className="num">{m.total_trades}</span>} />
              <StatTile label="Win rate" term="winrate" value={<span className="num">{m.win_rate !== null ? fmtPct(m.win_rate, 0) : "—"}</span>} />
              <StatTile label="Общо R" term="r" value={<span className={cx("num", pnlClass(m.total_r))}>{fmtR(m.total_r)}</span>} />
              <StatTile label="Нетно P/L" value={<span className={cx("num", pnlClass(m.net_pnl))}>{fmtMoney(m.net_pnl, true)}</span>} />
              <StatTile label="Return" value={<span className={cx("num", pnlClass(m.return_pct))}>{fmtPct(m.return_pct, 2, true)}</span>} />
              <StatTile label="Max DD" term="drawdown" value={<span className="num text-down">{fmtPct(-Math.abs(m.max_drawdown_pct), 2)}</span>} />
              <StatTile label="Buy & hold" value={<span className={cx("num", pnlClass(m.buy_and_hold_pct))}>{fmtPct(m.buy_and_hold_pct, 2, true)}</span>} />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="label">Сделки на правилата (виолетовите маркери)</div>
              {sc.trades.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-[0.06em] text-faint">
                      <tr className="border-b border-white/[0.06]">
                        <th className="py-1.5 pr-2 font-semibold">Посока</th>
                        <th className="py-1.5 pr-2 font-semibold">Вход</th>
                        <th className="py-1.5 pr-2 font-semibold">Изход</th>
                        <th className="py-1.5 pr-2 font-semibold">Причина</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">R</th>
                        <th className="py-1.5 text-right font-semibold">P/L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {sc.trades.map((t, i) => (
                        <tr key={`${t.entry_ts}-${i}`}>
                          <td className="py-1.5 pr-2">
                            <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                          </td>
                          <td className="num py-1.5 pr-2 text-muted">
                            {fmtTime(t.entry_ts)} @ {fmtPrice(t.entry_price, precision)}
                          </td>
                          <td className="num py-1.5 pr-2 text-muted">
                            {fmtTime(t.exit_ts)} @ {fmtPrice(t.exit_price, precision)}
                          </td>
                          <td className="py-1.5 pr-2 text-muted">{exitLabel(t.exit_reason)}</td>
                          <td className={cx("num py-1.5 pr-2 text-right", pnlClass(t.r_multiple))}>{fmtR(t.r_multiple)}</td>
                          <td className={cx("num py-1.5 text-right", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-muted">
                  Правилата не намериха setup в този период — NO TRADE. Липсата на сделка също е решение.
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-2">
              {sc.text && sc.text.length > 1 && (
                <ul className="space-y-1 text-xs leading-relaxed text-text/85">
                  {sc.text
                    .filter((t) => t !== sc.sentence)
                    .map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                </ul>
              )}
              {sc.rules && sc.rules.length > 0 && (
                <div>
                  <div className="label">Правила</div>
                  <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-muted">
                    {sc.rules.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          <p className="text-[11px] italic leading-relaxed text-faint">{sc.disclaimer ?? STRATEGY_DISCLAIMER}</p>
        </div>
      )}
    </section>
  );
}

function LessonsCard({ hr }: { hr: HistoryReview }) {
  return (
    <CardShell title="Препоръчани уроци" icon={BookOpen}>
      {hr.lessons.length ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {hr.lessons.map((l) => (
            <Link
              key={l.slug}
              href={lessonHref(l.slug, l.href)}
              className="group rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 transition-colors hover:border-accent/40 hover:bg-accent/[0.05]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text">{l.title}</span>
                <ArrowRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent2" aria-hidden />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{l.reason}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="p-4 text-xs text-muted">Няма повтарящи се грешки — продължи с нов период, за да затвърдиш процеса.</p>
      )}
    </CardShell>
  );
}
