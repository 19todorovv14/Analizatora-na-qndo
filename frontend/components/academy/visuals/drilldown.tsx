"use client";

/*
 * CANDLE DRILL-DOWN — "what happened inside this candle?"
 * Data: GET /api/learn/candle-drilldown?symbol&timeframe&time (S3a backend): the parent candle, its
 * lower-timeframe candles (1h → 12 × 5m, 1d → 24 × 1h …), where the high and the low happened first and
 * a short explanation. Renders the parent next to its children on one price scale with the parent's
 * O/H/L/C lines, markers on the child candles that set the high and the low (with their order) and a
 * hover read-out per child candle. Missing data → <DataNotAvailable/>; never invents numbers.
 */
import { ArrowRight, Microscope, TrendingDown, TrendingUp, X, Zap } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { useElementWidth, utcLabel } from "@/components/academy/visuals/shared";
import type { Drilldown, OhlcCandle } from "@/components/learn/types";
import { Badge, ChartSkeleton, DataNotAvailable, Disclaimer, ErrorState, IconButton, Notice, SourceBadge } from "@/components/ui";
import { ApiError, fetcher } from "@/lib/api";
import { TF_LABEL, cx, fmtPrice } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";

const MONO = "var(--font-mono)";

type RailItem = { k: "open" | "high" | "low" | "close"; y: number; py: number };

function spreadRail(items: RailItem[], gap: number, lo: number, hi: number): RailItem[] {
  const out = items.map((i) => ({ ...i }));
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gap);
  if (out.length) out[out.length - 1].y = Math.min(out[out.length - 1].y, hi);
  for (let i = out.length - 2; i >= 0; i--) out[i].y = Math.min(out[i].y, out[i + 1].y - gap);
  if (out.length) out[0].y = Math.max(out[0].y, lo);
  return out;
}

function DrilldownChart({ data }: { data: Drilldown }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(620);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const parent = data.parent as OhlcCandle;
  const kids = data.candles;
  const precision = data.precision ?? 2;

  const W = Math.max(280, width);
  const H = 250;
  const narrow = W < 480;
  const railW = narrow ? 84 : 128;
  const parentW = narrow ? 58 : 92;
  const top = 26;
  const bottom = 30;
  const kx0 = parentW + (narrow ? 14 : 22);
  const kx1 = W - railW - 12;
  const m = Math.max(1, kids.length);
  const slot = (kx1 - kx0) / m;
  const kidBody = Math.max(3, Math.min(16, slot * 0.58));
  const span = parent.high - parent.low || Math.abs(parent.high) * 0.001 || 1;
  const lo = Math.min(parent.low, ...kids.map((k) => k.low)) - span * 0.06;
  const hi = Math.max(parent.high, ...kids.map((k) => k.high)) + span * 0.06;
  const y = (p: number) => top + ((hi - p) / (hi - lo || 1)) * (H - top - bottom);
  const kcx = (i: number) => kx0 + slot * (i + 0.5);
  const pcx = parentW / 2;
  const pBody = Math.min(30, parentW * 0.36);
  const colorOf = (c: OhlcCandle) => (c.close > c.open ? PALETTE.up : c.close < c.open ? PALETTE.down : PALETTE.muted);

  const path = data.path;
  const hiIdx = path?.high_index ?? -1;
  const loIdx = path?.low_index ?? -1;
  const first = path?.first_extreme ?? null;
  const order = (which: "high" | "low") => (first === "same" ? 1 : first === which ? 1 : 2);
  const bigIdx = path?.largest_move?.index ?? -1;

  const railX = kx1 + 12;
  const rail = spreadRail(
    (["high", parent.close >= parent.open ? "close" : "open", parent.close >= parent.open ? "open" : "close", "low"] as RailItem["k"][]).map((k) => ({
      k,
      y: y(parent[k]),
      py: y(parent[k]),
    })),
    18,
    top,
    H - bottom,
  );
  const lineStyle: Record<RailItem["k"], { stroke: string; dash?: string }> = {
    high: { stroke: withAlpha(PALETTE.up, 0.55), dash: "4 4" },
    low: { stroke: withAlpha(PALETTE.down, 0.55), dash: "4 4" },
    open: { stroke: withAlpha(PALETTE.muted, 0.55), dash: "2 4" },
    close: { stroke: withAlpha(PALETTE.accent2, 0.7), dash: "2 4" },
  };
  const labelEvery = Math.max(1, Math.ceil(48 / slot));
  const hovered = hoverIdx !== null ? kids[hoverIdx] : null;

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block select-none" role="img" aria-label={`${data.timeframe} свещ и нейните ${kids.length} свещи по ${data.child_timeframe}`} onPointerLeave={() => setHoverIdx(null)}>
        {/* parent zone */}
        <rect x={2} y={top - 18} width={parentW - 4} height={H - top - bottom + 30} rx={10} fill={withAlpha(PALETTE.accent, 0.05)} stroke={withAlpha(PALETTE.accent2, 0.18)} />
        <text x={pcx} y={top - 6} textAnchor="middle" fontSize={10} fontWeight={600} letterSpacing="0.08em" fill={PALETTE.accent2}>
          {(TF_LABEL[data.timeframe] ?? data.timeframe).toUpperCase()}
        </text>
        <text x={(parentW + kx0) / 2} y={(top + H - bottom) / 2 + 4} textAnchor="middle" fontSize={13} fill={PALETTE.faint}>
          =
        </text>
        <text x={kx0} y={top - 6} fontSize={10} fontWeight={600} letterSpacing="0.08em" fill={PALETTE.muted}>
          {kids.length} × {data.child_timeframe.toUpperCase()}
        </text>

        {/* parent O/H/L/C lines across the children */}
        {rail.map((r) => (
          <line key={`pl-${r.k}`} x1={pcx + pBody / 2 + 4} x2={railX - 4} y1={r.py} y2={r.py} stroke={lineStyle[r.k].stroke} strokeDasharray={lineStyle[r.k].dash} />
        ))}

        {/* parent candle */}
        <line x1={pcx} x2={pcx} y1={y(parent.high)} y2={y(parent.low)} stroke={colorOf(parent)} strokeWidth={2.5} strokeLinecap="round" />
        <rect
          x={pcx - pBody / 2}
          y={y(Math.max(parent.open, parent.close))}
          width={pBody}
          height={Math.max(2, y(Math.min(parent.open, parent.close)) - y(Math.max(parent.open, parent.close)))}
          rx={3}
          fill={colorOf(parent)}
        />

        {/* children */}
        {kids.map((c, i) => {
          const cx0 = kcx(i);
          const col = colorOf(c);
          const bt = y(Math.max(c.open, c.close));
          const bb = y(Math.min(c.open, c.close));
          const dim = hoverIdx !== null && hoverIdx !== i;
          return (
            <g key={c.time} onPointerEnter={() => setHoverIdx(i)} onPointerDown={() => setHoverIdx(i)}>
              <rect x={cx0 - slot / 2} y={top - 16} width={slot} height={H - top - bottom + 32} fill={hoverIdx === i ? withAlpha(PALETTE.accent2, 0.06) : "transparent"} />
              {i === bigIdx && (
                <rect x={cx0 - kidBody / 2 - 4} y={y(c.high) - 4} width={kidBody + 8} height={y(c.low) - y(c.high) + 8} rx={4} fill="none" stroke={withAlpha(PALETTE.violet, 0.75)} strokeDasharray="3 2" />
              )}
              <g opacity={dim ? 0.45 : 1}>
                <line x1={cx0} x2={cx0} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                <rect x={cx0 - kidBody / 2} y={bt} width={kidBody} height={Math.max(1.5, bb - bt)} rx={1.5} fill={col} />
              </g>
              {i % labelEvery === 0 && (
                <text x={cx0} y={H - 10} textAnchor="middle" fontSize={9.5} fill={hoverIdx === i ? PALETTE.text : PALETTE.faint} style={{ fontFamily: MONO }}>
                  {utcLabel(c.time, data.child_timeframe)}
                </text>
              )}
            </g>
          );
        })}

        {/* high / low markers with their order */}
        {hiIdx >= 0 && kids[hiIdx] && (
          <g pointerEvents="none">
            <path d={`M${kcx(hiIdx) - 5},${y(kids[hiIdx].high) - 10} h10 l-5,6 z`} fill={PALETTE.up} />
            <text x={kcx(hiIdx)} y={y(kids[hiIdx].high) - 14} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={PALETTE.up}>
              {order("high")}· HIGH
            </text>
          </g>
        )}
        {loIdx >= 0 && kids[loIdx] && (
          <g pointerEvents="none">
            <path d={`M${kcx(loIdx) - 5},${y(kids[loIdx].low) + 10} h10 l-5,-6 z`} fill={PALETTE.down} />
            <text x={kcx(loIdx)} y={y(kids[loIdx].low) + 22} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={PALETTE.down}>
              {order("low")}· LOW
            </text>
          </g>
        )}

        {/* rail: parent O/H/L/C */}
        {rail.map((r) => {
          const w = W - railX - 2;
          const ink = r.k === "high" ? PALETTE.up : r.k === "low" ? PALETTE.down : r.k === "close" ? PALETTE.accent2 : PALETTE.muted;
          return (
            <g key={`rail-${r.k}`} pointerEvents="none">
              <path d={`M${railX - 4},${r.py} L${railX},${r.y}`} stroke={lineStyle[r.k].stroke} fill="none" />
              <rect x={railX} y={r.y - 8.5} width={w} height={17} rx={4.5} fill={withAlpha(PALETTE.surface, 0.92)} stroke={PALETTE.line} />
              <text x={railX + 6} y={r.y + 3.5} fontSize={9.5} fontWeight={700} fill={ink}>
                {narrow ? r.k[0].toUpperCase() : r.k.toUpperCase()}
              </text>
              <text x={railX + w - 6} y={r.y + 3.5} textAnchor="end" fontSize={10} fill={PALETTE.text} style={{ fontFamily: MONO }}>
                {fmtPrice(parent[r.k], precision)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* hover read-out for a child candle */}
      {hovered && hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 w-[188px] rounded-lg border border-white/10 bg-popover px-2.5 py-2 text-[11px] shadow-pop"
          style={{ left: Math.min(Math.max(4, kcx(hoverIdx) - 94), W - 192) }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="num font-semibold text-text">{utcLabel(hovered.time, data.child_timeframe)} UTC</span>
            <span className={cx("num font-medium", hovered.close >= hovered.open ? "text-up" : "text-down")}>
              {hovered.open ? `${hovered.close >= hovered.open ? "+" : ""}${(((hovered.close - hovered.open) / hovered.open) * 100).toFixed(2)}%` : "—"}
            </span>
          </div>
          {(["open", "high", "low", "close"] as const).map((k) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-muted">{k[0].toUpperCase() + k.slice(1)}</span>
              <span className="num text-text">{fmtPrice(hovered[k], precision)}</span>
            </div>
          ))}
          {hoverIdx === hiIdx && <div className="mt-1 text-up">Тук е High-ът на голямата свещ.</div>}
          {hoverIdx === loIdx && <div className="mt-1 text-down">Тук е Low-ът на голямата свещ.</div>}
        </div>
      )}
    </div>
  );
}

function PathChips({ data }: { data: Drilldown }) {
  const p = data.path;
  if (!p) return null;
  const k = data.child_timeframe;
  const first = p.first_extreme;
  const hiT = utcLabel(p.high_time, k);
  const loT = utcLabel(p.low_time, k);
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {first && first !== "same" && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-muted">
          {first === "low" ? <TrendingDown size={12} strokeWidth={2} className="text-down" aria-hidden /> : <TrendingUp size={12} strokeWidth={2} className="text-up" aria-hidden />}
          Първо {first === "low" ? <b className="font-semibold text-down">Low</b> : <b className="font-semibold text-up">High</b>}
          <span className="num text-faint">({first === "low" ? loT : hiT})</span>
          <ArrowRight size={11} strokeWidth={2} className="text-faint" aria-hidden />
          после {first === "low" ? <b className="font-semibold text-up">High</b> : <b className="font-semibold text-down">Low</b>}
          <span className="num text-faint">({first === "low" ? hiT : loT})</span>
        </span>
      )}
      {first === "same" && (
        <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-muted">High и Low са в една и съща {k} свещ — редът не се вижда и тук.</span>
      )}
      <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-muted">
        Open на <span className="num text-text">{Math.round(p.open_position_pct)}%</span> · Close на{" "}
        <span className="num text-text">{Math.round(p.close_position_pct)}%</span> от диапазона
      </span>
      {p.largest_move && (
        <span className="inline-flex items-center gap-1 rounded-md border border-violet/25 bg-violet/[0.06] px-2 py-1 text-muted">
          <Zap size={11} strokeWidth={2} className="text-violet" aria-hidden />
          Най-силна {k} свещ: <span className="num text-text">{utcLabel(p.largest_move.time, k)}</span>
          <span className={cx("num", p.largest_move.change_pct >= 0 ? "text-up" : "text-down")}>
            {p.largest_move.change_pct >= 0 ? "+" : ""}
            {p.largest_move.change_pct.toFixed(2)}%
          </span>
        </span>
      )}
    </div>
  );
}

/** Drill-down panel for one candle (opened by clicking a real candle in the lesson visual). */
export function CandleDrilldown({
  symbol,
  timeframe,
  time,
  onClose,
  className,
}: {
  symbol: string;
  timeframe: string;
  /** any epoch second inside the candle */
  time: number;
  onClose?: () => void;
  className?: string;
}) {
  const key = `/learn/candle-drilldown?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&time=${time}`;
  const { data, error, isLoading, mutate } = useSWR<Drilldown>(key, fetcher, { revalidateOnFocus: false });

  let body: React.ReactNode;
  if (error) {
    body =
      error instanceof ApiError && error.status === 503 ? (
        <DataNotAvailable reason={error.message} provider={symbol} compact />
      ) : (
        <ErrorState title="Drill-down не се зареди" description={error instanceof Error ? error.message : undefined} onRetry={() => mutate()} />
      );
  } else if (isLoading || !data) {
    body = <ChartSkeleton height={250} />;
  } else if (!data.available || !data.parent || !data.candles.length) {
    body = <DataNotAvailable reason={data.reason ?? "Доставчикът няма свещи от по-малкия timeframe за този период."} provider={data.source?.name} />;
  } else {
    body = (
      <div className="space-y-3">
        <DrilldownChart data={data} />
        <PathChips data={data} />
        {!data.complete && (
          <Notice tone="warn" title="Свещта още се формира">
            Периодът не е приключил — Close и екстремумите може да се променят.
          </Notice>
        )}
        {!data.matches_parent && data.complete && (
          <p className="text-xs text-faint">
            Малките свещи не съвпадат напълно с голямата (доставчикът агрегира данните различно) — гледай реда на движенията, не точните центове.
          </p>
        )}
        {data.explanation.length > 0 && (
          <ol className="space-y-1.5">
            {data.explanation.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-text/90">
                <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[11px] font-semibold text-accent2">
                  {i + 1}
                </span>
                <span className="min-w-0">{t}</span>
              </li>
            ))}
          </ol>
        )}
        {data.disclaimer && <Disclaimer>{data.disclaimer}</Disclaimer>}
      </div>
    );
  }

  return (
    <section data-drilldown className={cx("glass-inset animate-fade-in p-3 sm:p-4", className)} aria-label="Какво се е случило вътре в свещта">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent2 ring-1 ring-inset ring-accent/30">
              <Microscope size={14} strokeWidth={2} aria-hidden />
            </span>
            <h3 className="text-sm font-semibold text-text">Вътре в свещта</h3>
            {data?.available && (
              <Badge tone="accent">
                {TF_LABEL[data.timeframe] ?? data.timeframe} → {data.candles.length} × {data.child_timeframe}
              </Badge>
            )}
            <SourceBadge source={data?.source ?? null} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {symbol} · свещта от <span className="num text-text/90">{utcLabel(data?.parent?.time ?? time, "1h")} UTC</span>
            {timeframe === "1d" || timeframe === "1w" ? ` (${utcLabel(data?.parent?.time ?? time, "1d")})` : ""} — по-малкият timeframe показва реда на движенията.
          </p>
        </div>
        {onClose && <IconButton icon={X} label="Затвори drill-down" onClick={onClose} size="sm" />}
      </div>
      {body}
    </section>
  );
}
