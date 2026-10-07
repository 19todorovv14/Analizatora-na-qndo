"use client";

/*
 * INTERACTIVE CANDLE (lesson visual type "candle").
 *
 * - CandleAnatomy: SVG candles drawn at real pixel width. Hover (or tap / keyboard focus) shows OPEN /
 *   HIGH / LOW / CLOSE on a price rail with leader lines, and a dimension column between the candles and
 *   the rail brackets BODY / UPPER WICK / LOWER WICK of the active candle (it never covers neighbouring
 *   candles). The part under the cursor is highlighted together with the two prices that bound it. A
 *   read-out below repeats the numbers (touch + screen-reader friendly). Exported for other packages
 *   (e.g. the Candlestick Lab).
 * - CandleVisual: the lesson visual — tabs "Анатомия" (the lesson's example candles), "Реална свещ"
 *   (recent demo/live candles from /market/candles) and "Candle builder". Clicking a real candle opens
 *   the drill-down (lower-timeframe candles inside it, components/academy/visuals/drilldown.tsx);
 *   clicking a synthetic candle explains that it has no inner history.
 * Pure maths lives in candleModel.ts (unit-tested).
 */
import { CandlestickChart, Hammer, Microscope, MousePointerClick, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import {
  PART_LABEL,
  PART_LABEL_SHORT,
  PRICE_LABEL,
  PRICE_SHORT,
  candleAnatomy,
  classifyCandle,
  isValidCandle,
  lastClosed,
  partAtY,
  partsFromHighlight,
  priceFromHighlight,
  pricesOfPart,
  railOrder,
  spreadLabels,
  toCandleItem,
  type CandleItem,
  type CandlePart,
  type PriceKey,
} from "@/components/academy/visuals/candleModel";
import { CandleDrilldown } from "@/components/academy/visuals/drilldown";
import { Caption, RANGE_CLASS, useElementWidth, utcLabel } from "@/components/academy/visuals/shared";
import { Badge, Button, ChartSkeleton, DataNotAvailable, ErrorState, Notice, Segmented, SourceBadge, Term, type SourceLike } from "@/components/ui";
import { ApiError, fetcher } from "@/lib/api";
import { TF_LABEL, TF_SECONDS, cx, fmtPrice } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";
import type { CandlesResponse } from "@/lib/types";

/* ───────────────────────────────────────────────────────── model */

export type { CandleItem, CandlePart } from "@/components/academy/visuals/candleModel";
export { candleAnatomy, toCandleItem } from "@/components/academy/visuals/candleModel";

export const CLICK_CAPTION = "Click the candle to see what happened during this period.";

const PART_TERM: Record<CandlePart, string> = { upper_wick: "wick", body: "body", lower_wick: "wick" };

const MONO = "var(--font-mono)";

/* ─────────────────────────────────────────────────── CandleAnatomy */

export type CandleAnatomyProps = {
  candles: CandleItem[];
  precision?: number;
  /** lesson highlight: open | high | low | close | body | wick | upper_wick | lower_wick */
  highlight?: string | null;
  height?: number;
  /** candle shown with the anatomy labels when nothing is hovered (default 0) */
  defaultActive?: number;
  /** ring around a candle (e.g. the one whose drill-down is open) */
  selected?: number | null;
  onCandleClick?: (index: number) => void;
  /** timeframe for the time labels under real candles */
  timeframe?: string;
  /** read-out panel (values + explanation) under the SVG — default true */
  readout?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function CandleAnatomy({
  candles,
  precision = 2,
  highlight,
  height = 260,
  defaultActive = 0,
  selected = null,
  onCandleClick,
  timeframe,
  readout = true,
  ariaLabel = "Интерактивна свещ",
  className,
}: CandleAnatomyProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(560);
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ i: number; part: CandlePart | null } | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  const n = candles.length;
  if (!n) return null;

  const activeIdx = Math.min(n - 1, Math.max(0, hover?.i ?? focusIdx ?? selected ?? defaultActive));
  const active = candles[activeIdx];
  const a = candleAnatomy(active);
  const hlParts: CandlePart[] = hover ? (hover.part ? [hover.part] : []) : partsFromHighlight(highlight);
  const hlPrice: PriceKey | null = hover ? null : priceFromHighlight(highlight);
  // hovering a part lights up the two prices that bound it (e.g. BODY → OPEN + CLOSE)
  const hotPrices = new Set<PriceKey>(hover?.part && hover.i === activeIdx ? pricesOfPart(hover.part, active) : hlPrice ? [hlPrice] : []);

  // layout: [pad][candles][dimension column: part brackets][price rail]
  const W = Math.max(260, width);
  const H = height;
  const narrow = W < 460;
  const railW = narrow ? 92 : 148;
  const colW = narrow ? 66 : 104;
  const x0 = narrow ? 6 : 14;
  const x1 = W - railW - colW - 8;
  const slot = (x1 - x0) / n;
  const bodyW = Math.max(8, Math.min(42, slot * 0.4));
  const showTimes = candles.some((c) => typeof c.time === "number");
  const top = 14;
  const bottom = showTimes ? 28 : 12;
  const lo0 = Math.min(...candles.map((c) => c.low));
  const hi0 = Math.max(...candles.map((c) => c.high));
  const pad = (hi0 - lo0 || Math.abs(hi0) * 0.01 || 1) * 0.08;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const y = (p: number) => top + ((hi - p) / (hi - lo || 1)) * (H - top - bottom);
  const cxOf = (i: number) => x0 + slot * (i + 0.5);
  const acx = cxOf(activeIdx);

  const onMove = (e: React.PointerEvent, i: number) => {
    if (!svgEl) return;
    const py = e.clientY - svgEl.getBoundingClientRect().top;
    const c = candles[i];
    const part = partAtY(py, y(Math.max(c.open, c.close)), y(Math.min(c.open, c.close)));
    setHover((h) => (h && h.i === i && h.part === part ? h : { i, part }));
  };

  // price rail labels for the active candle (top → bottom)
  const railX = W - railW;
  const rail = spreadLabels(
    railOrder(active).map((k) => ({ k, y: y(active[k]), py: y(active[k]) })),
    19,
    top + 8,
    H - bottom - 8,
  );

  // dimension column: one bracket per part at its exact price span, label to the right of it
  const bx = x1 + 12;
  const segs: { part: CandlePart; a: number; b: number }[] = [
    { part: "upper_wick", a: y(active.high), b: y(a.top) },
    { part: "body", a: y(a.top), b: y(a.bot) },
    { part: "lower_wick", a: y(a.bot), b: y(active.low) },
  ];
  const partLabels = spreadLabels(
    segs.map((s) => ({ ...s, y: (s.a + s.b) / 2, my: (s.a + s.b) / 2 })),
    15,
    top + 6,
    H - bottom - 4,
  );

  const timeEvery = Math.max(1, Math.ceil(46 / slot));

  return (
    <div className={cx("min-w-0", className)}>
      <div ref={wrapRef} className="relative w-full">
        <svg
          ref={setSvgEl}
          data-candle-svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label={ariaLabel}
          className="block touch-pan-y select-none"
          onPointerLeave={() => setHover(null)}
        >
          {/* recessive grid */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={x0} x2={x1} y1={top + f * (H - top - bottom)} y2={top + f * (H - top - bottom)} stroke={PALETTE.line} strokeDasharray="2 5" />
          ))}

          {/* leader lines from the active candle to the rail (under the candles) */}
          {rail.map((r) => {
            const k = r.k as PriceKey;
            const isWick = k === "high" || k === "low";
            const ax = isWick ? acx + 1.5 : acx + bodyW / 2 + 1;
            const hot = hotPrices.has(k);
            return (
              <path
                key={`lead-${k}`}
                d={`M${ax},${r.py} H${railX - 12} L${railX - 2},${r.y}`}
                fill="none"
                stroke={hot ? PALETTE.gold : withAlpha(PALETTE.muted, 0.42)}
                strokeWidth={hot ? 1.5 : 1}
                strokeDasharray={hot ? undefined : "3 3"}
              />
            );
          })}

          {candles.map((c, i) => {
            const an = candleAnatomy(c);
            const cx0 = cxOf(i);
            const isActive = i === activeIdx;
            const color = an.dir === "bullish" ? PALETTE.up : an.dir === "bearish" ? PALETTE.down : PALETTE.muted;
            const bt = y(an.top);
            const bb = y(an.bot);
            const dim = !isActive && n > 1;
            const hotUpper = isActive && hlParts.includes("upper_wick");
            const hotLower = isActive && hlParts.includes("lower_wick");
            const hotBody = isActive && hlParts.includes("body");
            const label = `Свещ ${i + 1}${c.time ? ` (${utcLabel(c.time, timeframe)} UTC)` : ""}: Open ${fmtPrice(c.open, precision)}, High ${fmtPrice(c.high, precision)}, Low ${fmtPrice(c.low, precision)}, Close ${fmtPrice(c.close, precision)}`;
            return (
              <g
                key={i}
                data-candle-index={i}
                role="button"
                tabIndex={0}
                aria-label={onCandleClick ? `${label}. ${CLICK_CAPTION}` : label}
                aria-pressed={selected === i ? true : undefined}
                className="outline-none"
                style={{ cursor: onCandleClick ? "pointer" : "default" }}
                onPointerMove={(e) => onMove(e, i)}
                onPointerDown={(e) => onMove(e, i)}
                onFocus={() => setFocusIdx(i)}
                onBlur={() => setFocusIdx(null)}
                onClick={() => onCandleClick?.(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onCandleClick?.(i);
                  }
                }}
              >
                <rect x={cx0 - slot / 2} y={0} width={slot} height={H} fill="transparent" />
                {(selected === i || focusIdx === i) && (
                  <rect
                    x={cx0 - Math.min(slot / 2 - 2, bodyW + 10)}
                    y={y(c.high) - 8}
                    width={Math.min(slot - 4, bodyW * 2 + 20)}
                    height={y(c.low) - y(c.high) + 16}
                    rx={8}
                    fill={withAlpha(PALETTE.accent, 0.06)}
                    stroke={withAlpha(PALETTE.accent2, focusIdx === i ? 0.9 : 0.55)}
                    strokeDasharray={focusIdx === i ? undefined : "4 3"}
                  />
                )}
                <g opacity={dim ? 0.4 : 1} style={{ transition: "opacity 160ms ease" }}>
                  {/* wicks */}
                  <line x1={cx0} x2={cx0} y1={y(c.high)} y2={bt} stroke={color} strokeWidth={2} strokeLinecap="round" />
                  <line x1={cx0} x2={cx0} y1={bb} y2={y(c.low)} stroke={color} strokeWidth={2} strokeLinecap="round" />
                  {hotUpper && an.upper > 0 && (
                    <line x1={cx0} x2={cx0} y1={y(c.high)} y2={bt} stroke={PALETTE.gold} strokeWidth={5} strokeLinecap="round" opacity={0.95} />
                  )}
                  {hotLower && an.lower > 0 && (
                    <line x1={cx0} x2={cx0} y1={bb} y2={y(c.low)} stroke={PALETTE.gold} strokeWidth={5} strokeLinecap="round" opacity={0.95} />
                  )}
                  {/* body */}
                  <rect
                    x={cx0 - bodyW / 2}
                    y={bt}
                    width={bodyW}
                    height={Math.max(bb - bt, 2)}
                    rx={Math.min(3, bodyW / 6)}
                    fill={an.dir === "neutral" ? PALETTE.muted : color}
                    fillOpacity={0.92}
                    stroke={hotBody ? PALETTE.gold : "none"}
                    strokeWidth={hotBody ? 2.5 : 0}
                  />
                  {hotBody && (
                    <rect x={cx0 - bodyW / 2 - 4} y={bt - 4} width={bodyW + 8} height={Math.max(bb - bt, 2) + 8} rx={5} fill="none" stroke={withAlpha(PALETTE.gold, 0.35)} />
                  )}
                </g>
                {showTimes && c.time && i % timeEvery === (n - 1) % timeEvery && (
                  <text x={cx0} y={H - 9} textAnchor="middle" fontSize={10} fill={isActive ? PALETTE.text : PALETTE.faint} style={{ fontFamily: MONO }}>
                    {utcLabel(c.time, timeframe)}
                  </text>
                )}
              </g>
            );
          })}

          {/* dimension column: brackets at the exact price span of each part + labels */}
          <g pointerEvents="none">
            {partLabels.map((s) => {
              const len = s.b - s.a;
              const hot = hlParts.includes(s.part);
              const text = narrow ? PART_LABEL_SHORT[s.part] : PART_LABEL[s.part];
              const tw = text.length * (narrow ? 5.9 : 6.2) + 10;
              return (
                <g key={s.part} data-part-label={s.part}>
                  {len >= 2 && (
                    <path
                      d={`M${bx - 4},${s.a + 0.5} H${bx} V${s.b - 0.5} H${bx - 4}`}
                      fill="none"
                      stroke={hot ? PALETTE.gold : withAlpha(PALETTE.muted, 0.65)}
                      strokeWidth={hot ? 1.75 : 1}
                    />
                  )}
                  {len < 2 && <circle cx={bx} cy={(s.a + s.b) / 2} r={1.6} fill={withAlpha(PALETTE.muted, 0.7)} />}
                  {/* elbow from the bracket middle to a displaced label */}
                  <path d={`M${bx},${s.my} L${bx + 5},${s.y}`} stroke={hot ? withAlpha(PALETTE.gold, 0.7) : withAlpha(PALETTE.muted, 0.5)} fill="none" />
                  <rect
                    x={bx + 5}
                    y={s.y - 8}
                    width={tw}
                    height={16}
                    rx={4}
                    fill={hot ? withAlpha(PALETTE.gold, 0.14) : withAlpha(PALETTE.surface, 0.9)}
                    stroke={hot ? withAlpha(PALETTE.gold, 0.5) : withAlpha(PALETTE.line, 1)}
                  />
                  <text x={bx + 10} y={s.y + 3.5} fontSize={9.5} fontWeight={600} letterSpacing="0.06em" fill={hot ? PALETTE.gold : PALETTE.muted}>
                    {text}
                  </text>
                </g>
              );
            })}
          </g>

          {/* price rail */}
          <g pointerEvents="none">
            {rail.map((r) => {
              const k = r.k as PriceKey;
              const hot = hotPrices.has(k);
              const w = W - railX - 2;
              return (
                <g key={`rail-${k}`} data-price-label={k}>
                  <rect
                    x={railX}
                    y={r.y - 9}
                    width={w}
                    height={18}
                    rx={5}
                    fill={hot ? withAlpha(PALETTE.gold, 0.14) : withAlpha(PALETTE.surface, 0.92)}
                    stroke={hot ? withAlpha(PALETTE.gold, 0.6) : PALETTE.line}
                  />
                  <text x={railX + 7} y={r.y + 3.5} fontSize={9.5} fontWeight={600} letterSpacing="0.07em" fill={hot ? PALETTE.gold : PALETTE.muted}>
                    {narrow ? PRICE_SHORT[k] : PRICE_LABEL[k]}
                  </text>
                  <text x={railX + w - 7} y={r.y + 3.5} textAnchor="end" fontSize={10.5} fill={hot ? PALETTE.gold : PALETTE.text} style={{ fontFamily: MONO }}>
                    {fmtPrice(active[k], precision)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {readout && <CandleReadout candle={active} precision={precision} parts={hlParts} price={hlPrice} hovering={!!hover} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────── read-out */

const PART_TEXT: Record<CandlePart, string> = {
  upper_wick: "Цени над тялото, които купувачите са достигнали, но не са задържали до затварянето — отхвърлени по-високи цени.",
  body: "Нетният резултат за периода: разстоянието от Open до Close.",
  lower_wick: "Цени под тялото, до които продавачите са стигнали, но цената е върната нагоре преди затварянето — отхвърлени по-ниски цени.",
};

const PRICE_TEXT: Record<PriceKey, string> = {
  open: "OPEN е първата цена на периода — откъдето започва свещта.",
  high: "HIGH е най-високата цена, достигната през периода — върхът на горната сянка.",
  low: "LOW е най-ниската цена, достигната през периода — дъното на долната сянка.",
  close: "CLOSE е последната цена на периода. Close спрямо Open определя цвета на свещта.",
};

function CandleReadout({
  candle,
  precision,
  parts,
  price,
  hovering,
}: {
  candle: CandleItem;
  precision: number;
  parts: CandlePart[];
  price: PriceKey | null;
  hovering: boolean;
}) {
  const a = candleAnatomy(candle);
  const dirLabel = a.dir === "bullish" ? "Bullish" : a.dir === "bearish" ? "Bearish" : "Doji / neutral";
  const dirWhy = a.dir === "bullish" ? "Close > Open" : a.dir === "bearish" ? "Close < Open" : "Open ≈ Close";
  const rows: { part: CandlePart; value: number; pct: number; formula: string }[] = [
    { part: "upper_wick", value: a.upper, pct: a.upperPct, formula: "High − max(O, C)" },
    { part: "body", value: a.body, pct: a.bodyPct, formula: "|Close − Open|" },
    { part: "lower_wick", value: a.lower, pct: a.lowerPct, formula: "min(O, C) − Low" },
  ];
  const focusPart = parts[0] ?? null;
  const note = focusPart
    ? `${PART_LABEL[focusPart]}: ${PART_TEXT[focusPart]}${focusPart === "body" ? ` ${dirLabel}, защото ${dirWhy}.` : ""}`
    : price
      ? PRICE_TEXT[price]
      : hovering
        ? "Премести курсора върху тялото или върху сенките."
        : "Задръж мишката (или докосни) свещта — частта под курсора се оцветява.";
  return (
    <div className="mt-2.5 space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={a.dir === "bullish" ? "up" : a.dir === "bearish" ? "down" : "neutral"}>{dirLabel}</Badge>
        <span className="text-muted">{dirWhy}</span>
        <span className="text-faint">·</span>
        <span className="text-muted">
          Range (High − Low): <span className="num text-text">{fmtPrice(a.range, precision)}</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {rows.map((r) => {
          const hot = parts.includes(r.part);
          return (
            <div
              key={r.part}
              className={cx(
                "min-w-0 rounded-lg border px-2 py-1.5 transition-colors sm:px-2.5",
                hot ? "border-gold/40 bg-gold/[0.07]" : "border-white/[0.06] bg-white/[0.02]",
              )}
            >
              <div className={cx("truncate text-[10px] font-semibold tracking-[0.07em]", hot ? "text-gold" : "text-muted")}>
                <Term k={PART_TERM[r.part]}>{PART_LABEL[r.part]}</Term>
              </div>
              <div className="num mt-0.5 truncate text-sm text-text">{fmtPrice(r.value, precision)}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={cx("h-full rounded-full", hot ? "bg-gold" : "bg-white/25")} style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} />
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-1 text-[10px] text-faint">
                <span className="num">{r.pct.toFixed(0)}%</span>
                <span className="hidden truncate sm:inline">{r.formula}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="min-h-[2.5em] text-xs leading-relaxed text-muted">{note}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────── synthetic note */

function SyntheticNote({ onShowReal, onClose }: { onShowReal?: () => void; onClose: () => void }) {
  return (
    <Notice tone="info" title="Синтетична свещ — няма вътрешна история" className="animate-fade-in">
      Тази свещ е само 4 числа (Open, High, Low, Close), създадени за урока. Реалната свещ обобщава много по-малки движения —
      при нея може да видиш по-малкия timeframe и кое е било първо: High или Low.
      <span className="mt-2 flex flex-wrap gap-2">
        {onShowReal && (
          <Button size="sm" variant="primary" type="button" onClick={onShowReal}>
            <CandlestickChart size={13} strokeWidth={2} aria-hidden />
            Виж реална свещ
          </Button>
        )}
        <Button size="sm" variant="ghost" type="button" onClick={onClose}>
          Разбрах
        </Button>
      </span>
    </Notice>
  );
}

/* ─────────────────────────────────────────────────── live candles */

function LiveCandles({ symbol, timeframe, drilldown = true, autoOpen = false }: { symbol: string; timeframe: string; drilldown?: boolean; autoOpen?: boolean }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(560);
  const key = `/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=12`;
  const { data, error, mutate, isLoading } = useSWR<CandlesResponse>(key, fetcher, { refreshInterval: 60_000, revalidateOnFocus: false });
  // undefined = the user has not chosen yet (autoOpen then shows the latest closed candle); null = closed
  const [picked, setPicked] = useState<number | null | undefined>(undefined);

  const count = width < 460 ? 4 : 6;
  const candles = useMemo(
    () => (data?.candles?.length ? lastClosed(data.candles, TF_SECONDS[timeframe] ?? 3600, data.server_time, count) : []),
    [data, timeframe, count],
  );
  const last = candles[candles.length - 1];
  const openTime = !drilldown ? null : picked === undefined ? (autoOpen && last ? last.time : null) : picked;
  const selectedIdx = openTime === null ? -1 : candles.findIndex((c) => c.time === openTime);

  let body: React.ReactNode;
  if (error) {
    body =
      error instanceof ApiError && error.status === 503 ? (
        <DataNotAvailable reason={error.message} provider={symbol} />
      ) : (
        <ErrorState title="Свещите не се заредиха" description={error instanceof Error ? error.message : undefined} onRetry={() => mutate()} />
      );
  } else if (isLoading || !data) {
    body = <ChartSkeleton height={260} />;
  } else if (!candles.length) {
    body = <DataNotAvailable reason="Доставчикът не върна свещи за този инструмент и timeframe." provider={data.source?.name} />;
  } else {
    body = (
      <>
        <CandleAnatomy
          candles={candles}
          precision={data.precision ?? 2}
          timeframe={timeframe}
          defaultActive={candles.length - 1}
          selected={selectedIdx >= 0 ? selectedIdx : null}
          onCandleClick={drilldown ? (i) => setPicked(candles[i].time ?? null) : undefined}
          ariaLabel={`${symbol} ${TF_LABEL[timeframe] ?? timeframe} — последни свещи`}
        />
        {drilldown && openTime === null && last && (
          <div className="mt-2">
            <Button size="sm" variant="outline" type="button" onClick={() => setPicked(last.time)}>
              <Microscope size={13} strokeWidth={2} aria-hidden /> Виж какво се е случило в последната свещ
            </Button>
          </div>
        )}
        {drilldown && openTime !== null && (
          <CandleDrilldown symbol={symbol} timeframe={timeframe} time={openTime} onClose={() => setPicked(null)} className="mt-3" />
        )}
      </>
    );
  }

  return (
    <div ref={wrapRef} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="num font-semibold text-text">
          {symbol} · {TF_LABEL[timeframe] ?? timeframe}
        </span>
        <SourceBadge source={(data?.source as SourceLike | undefined) ?? null} />
        <span className="text-faint">последни затворени свещи · времена в UTC</span>
      </div>
      {drilldown && candles.length > 0 && (
        <Caption icon={MousePointerClick} className="mb-1.5">
          {CLICK_CAPTION}
        </Caption>
      )}
      {body}
    </div>
  );
}

/* ─────────────────────────────────────────────────── builder */

type OHLC = [number, number, number, number];

const B_MIN = 90;
const B_MAX = 115;

const PRESETS: { key: string; label: string; v: OHLC }[] = [
  { key: "bullish", label: "Bullish", v: [100, 108, 98, 107] },
  { key: "bearish", label: "Bearish", v: [107, 109, 99, 100] },
  { key: "doji", label: "Doji", v: [104, 109, 99, 104.2] },
  { key: "hammer", label: "Hammer", v: [106, 107, 96, 106.8] },
  { key: "shooting_star", label: "Shooting star", v: [100, 110, 99.5, 100.8] },
];

/** Builder start: the lesson's pattern preset, else its first example candle (if it fits the sliders), else a bullish candle. */
function builderStart(pattern: string | null, example: CandleItem | undefined): OHLC {
  const preset = pattern ? PRESETS.find((p) => p.key === pattern) : undefined;
  if (preset) return preset.v;
  if (example && isValidCandle(example) && example.low >= B_MIN && example.high <= B_MAX) return [example.open, example.high, example.low, example.close];
  return [100, 108, 96, 105];
}

function CandleBuilder({ onShowReal, start }: { onShowReal?: () => void; start: OHLC }) {
  const [b, setB] = useState<OHLC>(start);
  const [note, setNote] = useState(false);
  const c: CandleItem = { open: b[0], high: b[1], low: b[2], close: b[3] };
  const valid = isValidCandle(c);
  const patterns = valid ? classifyCandle(c) : [];
  const setK = (i: number, v: number) => setB((prev) => prev.map((x, j) => (j === i ? v : x)) as OHLC);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <SlidersHorizontal size={14} strokeWidth={2} className="text-accent2" aria-hidden />
          Candle builder
        </div>
        {(["Open", "High", "Low", "Close"] as const).map((label, i) => {
          const pct = ((b[i] - B_MIN) / (B_MAX - B_MIN)) * 100;
          return (
            <label key={label} className="block">
              <span className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="text-muted">
                  <Term k={label.toLowerCase()}>{label}</Term>
                </span>
                <span className="num font-medium text-text">{b[i].toFixed(1)}</span>
              </span>
              <input
                type="range"
                min={B_MIN}
                max={B_MAX}
                step={0.5}
                value={b[i]}
                aria-label={label}
                onChange={(e) => setK(i, Number(e.target.value))}
                className={RANGE_CLASS}
                style={{ background: `linear-gradient(to right, var(--color-accent) ${pct}%, rgb(148 163 184 / 0.16) ${pct}%)` }}
              />
            </label>
          );
        })}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setB(p.v)}
              className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-white/20 hover:text-text"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        {valid ? (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="warn">synthetic</Badge>
              {patterns.map((p) => (
                <Badge key={p} tone="accent">
                  {p}
                </Badge>
              ))}
            </div>
            <CandleAnatomy candles={[c]} precision={1} height={230} onCandleClick={() => setNote(true)} ariaLabel="Синтетична свещ от Candle builder" />
            <Caption icon={MousePointerClick} className="mt-1">
              {CLICK_CAPTION}
            </Caption>
            {note && (
              <div className="mt-2">
                <SyntheticNote onShowReal={onShowReal} onClose={() => setNote(false)} />
              </div>
            )}
          </>
        ) : (
          <Notice tone="down" title="Невалидна свещ">
            High трябва да е най-високата стойност, а Low — най-ниската (High ≥ Open, Close ≥ Low).
          </Notice>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────── lesson visual */

type Tab = "anatomy" | "live" | "builder";

/**
 * Config keys (all optional): candles [[o,h,l,c]…], highlight, pattern, builder:true,
 * live:{symbol,timeframe}, drilldown (default true when live is set; drilldown without builder opens
 * the latest candle's drill-down right away — the "inside the candle" lesson).
 */
export function CandleVisual({ visual }: { visual: Record<string, unknown> }) {
  const candles = useMemo(
    () => (Array.isArray(visual.candles) ? (visual.candles as unknown[]).map(toCandleItem).filter((c): c is CandleItem => !!c) : []),
    [visual.candles],
  );
  const highlight = typeof visual.highlight === "string" ? visual.highlight : null;
  const patternKey = typeof visual.pattern === "string" ? visual.pattern : null;
  const pattern = patternKey ? patternKey.replace(/_/g, " ") : null;
  const builder = !!visual.builder;
  const liveCfg = visual.live && typeof visual.live === "object" ? (visual.live as { symbol?: string; timeframe?: string }) : null;
  const live = liveCfg ? { symbol: String(liveCfg.symbol ?? "BTC/USDT"), timeframe: String(liveCfg.timeframe ?? "1h") } : null;
  const drilldown = visual.drilldown !== false;
  const autoOpen = visual.drilldown === true && !builder;

  const tabs: { value: Tab; label: React.ReactNode }[] = [];
  if (candles.length) tabs.push({ value: "anatomy", label: <><Sparkles size={12} strokeWidth={2} className="hidden sm:block" aria-hidden /> Анатомия</> });
  if (live) tabs.push({ value: "live", label: <><CandlestickChart size={12} strokeWidth={2} className="hidden sm:block" aria-hidden /> Реална свещ</> });
  if (builder) tabs.push({ value: "builder", label: <><Hammer size={12} strokeWidth={2} className="hidden sm:block" aria-hidden /> Candle builder</> });
  const initial: Tab = live && !builder ? "live" : (tabs[0]?.value ?? "anatomy");
  const [tab, setTab] = useState<Tab>(initial);
  const [note, setNote] = useState(false);
  const showReal = live
    ? () => {
        setNote(false);
        setTab("live");
      }
    : undefined;

  return (
    <div className="min-w-0 space-y-3">
      {tabs.length > 1 && (
        <Segmented options={tabs} value={tab} onChange={(v) => setTab(v)} ariaLabel="Изглед на свещта" size="md" className="max-w-full overflow-x-auto" />
      )}

      {tab === "anatomy" && candles.length > 0 && (
        <div className="min-w-0">
          {pattern && (
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
              Модел: <Badge tone="accent">{pattern}</Badge>
            </div>
          )}
          <CandleAnatomy candles={candles} highlight={highlight} onCandleClick={() => setNote(true)} ariaLabel="Учебни свещи — анатомия" />
          <Caption icon={MousePointerClick} className="mt-1">
            {CLICK_CAPTION}
          </Caption>
          {note && (
            <div className="mt-2">
              <SyntheticNote onShowReal={showReal} onClose={() => setNote(false)} />
            </div>
          )}
        </div>
      )}

      {tab === "live" && live && <LiveCandles symbol={live.symbol} timeframe={live.timeframe} drilldown={drilldown} autoOpen={autoOpen} />}

      {tab === "builder" && builder && <CandleBuilder onShowReal={showReal} start={builderStart(patternKey, candles[0])} />}
    </div>
  );
}
