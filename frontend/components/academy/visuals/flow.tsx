"use client";

/*
 * Process diagrams (lesson visual type "strategy_flow") and reflection prompts. The diagrams are
 * schematic — no market numbers. Variants: lookahead (signal on candle i → entry on the OPEN of i+1),
 * walk_forward (rolling in-sample / out-of-sample windows), sensitivity (stable plateau vs isolated peak).
 */
import { ArrowRight, Check, NotebookPen, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Caption, useElementWidth } from "@/components/academy/visuals/shared";
import { Badge, Segmented, Term } from "@/components/ui";
import { cx } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";

const PAST_PERFORMANCE = "Past performance does not guarantee future results.";

export function StrategyFlow({ focus, variant }: { focus: string; variant?: string }) {
  if (variant === "lookahead") return <LookaheadDiagram />;
  if (variant === "walk_forward") return <WalkForwardDiagram />;
  if (variant === "sensitivity") return <SensitivityDiagram />;
  const stages =
    focus === "validation"
      ? ["In-sample (70%)", "Out-of-sample (30%)", "Sensitivity ±10–25%", "Cost stress test", "Forward test (paper bot)"]
      : focus === "backtest"
        ? ["Свещ i затваря", "Сигнал по правилата", "Вход на OPEN на i+1", "SL / TP / такси / slippage", "Метрики + validation"]
        : ["Market data", "Indicators", "Market structure", "Strategy rules", "Risk engine", "Signal"];
  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap items-stretch gap-x-1.5 gap-y-2">
        {stages.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.07] px-2.5 py-2 text-sm font-medium text-text">
              <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/20 text-[11px] font-semibold text-accent2">{i + 1}</span>
              {s}
            </span>
            {i < stages.length - 1 && <ArrowRight size={14} strokeWidth={2} className="shrink-0 text-faint" aria-hidden />}
          </li>
        ))}
      </ol>
      <Caption>
        {focus === "validation"
          ? `Всяка стъпка търси причина стратегията да НЕ работи. ${PAST_PERFORMANCE}`
          : "Изходът е LONG SETUP / SHORT SETUP / WAIT / NO TRADE — никога автоматична реална поръчка."}
      </Caption>
    </div>
  );
}

/* ── lookahead bias ─────────────────────────────────────────────── */

const SCHEMA = [
  [100, 103, 99, 102],
  [102, 104, 101, 101.5],
  [101.5, 102.5, 98.5, 99],
  [99, 106, 98.8, 105.5],
  [105.5, 107, 104, 106.5],
];

function LookaheadDiagram() {
  const [mode, setMode] = useState<"wrong" | "right">("wrong");
  const [ref, width] = useElementWidth<HTMLDivElement>(560);
  const W = Math.max(280, width);
  const H = 200;
  const lo = 97;
  const hi = 108.5;
  const y = (p: number) => 18 + ((hi - p) / (hi - lo)) * (H - 50);
  const slot = (W - 40) / SCHEMA.length;
  const cxOf = (i: number) => 20 + slot * (i + 0.5);
  const sig = 3; // the signal candle (closes strongly up)
  const entryIdx = mode === "wrong" ? sig : sig + 1;
  const entryPrice = SCHEMA[entryIdx][0];
  return (
    <div className="space-y-3">
      <Segmented
        options={[
          { value: "wrong", label: <><X size={12} strokeWidth={2.4} aria-hidden /> С lookahead</> },
          { value: "right", label: <><Check size={12} strokeWidth={2.4} aria-hidden /> Правилно</> },
        ]}
        value={mode}
        onChange={setMode}
        ariaLabel="Lookahead bias"
      />
      <div ref={ref} className="glass-inset overflow-hidden">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Схема: сигнал на свещ i и вход">
          {SCHEMA.map((c, i) => {
            const [o, h, l, cl] = c;
            const col = cl >= o ? PALETTE.up : PALETTE.down;
            const bw = Math.min(26, slot * 0.4);
            const future = mode === "wrong" ? false : i > sig + 1;
            return (
              <g key={i} opacity={future ? 0.35 : 1}>
                {i === sig && <rect x={cxOf(i) - slot / 2 + 4} y={8} width={slot - 8} height={H - 40} rx={8} fill={withAlpha(PALETTE.accent, 0.07)} stroke={withAlpha(PALETTE.accent2, 0.3)} strokeDasharray="4 3" />}
                <line x1={cxOf(i)} x2={cxOf(i)} y1={y(h)} y2={y(l)} stroke={col} strokeWidth={2} />
                <rect x={cxOf(i) - bw / 2} y={y(Math.max(o, cl))} width={bw} height={Math.max(2, y(Math.min(o, cl)) - y(Math.max(o, cl)))} rx={2} fill={col} />
                <text x={cxOf(i)} y={H - 12} textAnchor="middle" fontSize={10.5} fill={i === sig ? PALETTE.accent2 : PALETTE.faint} style={{ fontFamily: "var(--font-mono)" }}>
                  {i === sig ? "i (сигнал)" : i === sig + 1 ? "i+1" : `i${i - sig}`}
                </text>
              </g>
            );
          })}
          {/* entry marker on the open */}
          <g>
            <line x1={cxOf(entryIdx) - slot / 2 + 6} x2={cxOf(entryIdx) - 6} y1={y(entryPrice)} y2={y(entryPrice)} stroke={mode === "wrong" ? PALETTE.down : PALETTE.up} strokeWidth={2} />
            <circle cx={cxOf(entryIdx) - 6} cy={y(entryPrice)} r={4.5} fill={mode === "wrong" ? PALETTE.down : PALETTE.up} stroke={PALETTE.surface} strokeWidth={2} />
            <text x={cxOf(entryIdx) - slot / 2 + 6} y={y(entryPrice) + 16} fontSize={10.5} fontWeight={600} fill={mode === "wrong" ? PALETTE.down : PALETTE.up}>
              вход на OPEN
            </text>
          </g>
        </svg>
      </div>
      <div
        className={cx(
          "rounded-lg border px-3 py-2 text-sm leading-relaxed",
          mode === "wrong" ? "border-down/25 bg-down/[0.06] text-text/90" : "border-up/25 bg-up/[0.06] text-text/90",
        )}
      >
        {mode === "wrong" ? (
          <>
            <b className="font-semibold text-down">Грешно:</b> сигналът използва Close на свещ i, но входът е на нейния Open — в този момент Close още не съществува.
            Тестът „вижда бъдещето“ и резултатът изглежда по-добър, отколкото би бил на живо.
          </>
        ) : (
          <>
            <b className="font-semibold text-up">Правилно:</b> свещ i затваря → правилата се проверяват → входът е на OPEN на свещ i+1. Използва се само
            информация, налична в момента на решението.
          </>
        )}
      </div>
      <Caption>Схема, не реални данни. В Backtesting Lab входът винаги е на следващата свещ.</Caption>
    </div>
  );
}

/* ── walk-forward ───────────────────────────────────────────────── */

function WalkForwardDiagram() {
  const rows = 5;
  const isLen = 4;
  const oosLen = 1;
  const total = isLen + oosLen * rows;
  return (
    <div className="space-y-3">
      <div className="glass-inset space-y-1.5 p-3">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2">
            <span className="num text-[11px] text-faint">Стъпка {r + 1}</span>
            <div className="relative h-6">
              <div
                className="absolute inset-y-0 flex items-center justify-center rounded-md bg-accent/20 text-[10px] font-semibold tracking-[0.06em] text-accent2 ring-1 ring-inset ring-accent/30"
                style={{ left: `${(r * oosLen * 100) / total}%`, width: `${(isLen * 100) / total}%` }}
              >
                IN-SAMPLE · оптимизирай
              </div>
              <div
                className="absolute inset-y-0 flex items-center justify-center rounded-md bg-up/20 text-[10px] font-semibold tracking-[0.06em] text-up ring-1 ring-inset ring-up/35"
                style={{ left: `${((r * oosLen + isLen) * 100) / total}%`, width: `${(oosLen * 100) / total}%` }}
              >
                OOS
              </div>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2 pt-1">
          <span />
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            време <ArrowRight size={11} strokeWidth={2} aria-hidden />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="accent">In-sample = избор на параметри</Badge>
        <Badge tone="up">Out-of-sample = честа проверка</Badge>
      </div>
      <Caption>
        Резултатът на <Term k="walk_forward">walk-forward</Term> е сглобен САМО от зелените (out-of-sample) отрязъци — данни, които параметрите не са „виждали“. {PAST_PERFORMANCE}
      </Caption>
    </div>
  );
}

/* ── parameter sensitivity ──────────────────────────────────────── */

const PLATEAU = [0.35, 0.55, 0.72, 0.8, 0.84, 0.82, 0.78, 0.7, 0.52];
const SPIKE = [0.2, 0.25, 0.18, 0.3, 0.95, 0.28, 0.22, 0.3, 0.2];

function SensitivityDiagram() {
  const panel = (title: string, vals: number[], good: boolean) => (
    <div className="glass-inset min-w-0 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-text">{title}</span>
        <Badge tone={good ? "up" : "down"}>{good ? "по-надеждно" : "overfitting риск"}</Badge>
      </div>
      <div className="flex h-24 items-end gap-1" role="img" aria-label={title}>
        {vals.map((v, i) => (
          <div
            key={i}
            className={cx("min-w-0 flex-1 rounded-t-[4px]", i === 4 ? (good ? "bg-up/80" : "bg-down/80") : "bg-white/15")}
            style={{ height: `${v * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        <span>по-малък параметър</span>
        <span>избран</span>
        <span>по-голям</span>
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {panel("Стабилно плато", PLATEAU, true)}
        {panel("Изолиран пик", SPIKE, false)}
      </div>
      <Caption>
        Илюстрация, не реални резултати: височината е качеството на теста при съседни стойности на параметъра. Ако ±10–25% промяна срива резултата, вероятно си
        намерил шума, не предимство (<Term k="overfitting">overfitting</Term>).
      </Caption>
    </div>
  );
}

/* ── reflection ─────────────────────────────────────────────────── */

export function Reflection({ prompts }: { prompts: string[] }) {
  return (
    <div className="space-y-3">
      {prompts.map((p, i) => (
        <label key={p} className="block">
          <span className="mb-1.5 flex gap-2 text-sm font-medium text-text">
            <span className="num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet/15 text-[11px] text-violet">{i + 1}</span>
            {p}
          </span>
          <textarea className="input min-h-20" placeholder="Отговорът остава само в браузъра ти…" />
        </label>
      ))}
      <Link href="/journal" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent2 hover:text-text">
        <NotebookPen size={13} strokeWidth={2} aria-hidden /> Запиши наблюденията си в Journal →
      </Link>
    </div>
  );
}
