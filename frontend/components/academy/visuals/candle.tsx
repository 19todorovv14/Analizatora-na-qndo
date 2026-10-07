"use client";

/*
 * INTERACTIVE CANDLE (lesson visual type "candle").
 *
 * - CandleAnatomy: SVG candles drawn at real pixel width. Hover (or tap / keyboard focus) shows OPEN /
 *   HIGH / LOW / CLOSE on a price rail with leader lines, and brackets BODY / UPPER WICK / LOWER WICK
 *   next to the candle; the part under the cursor is highlighted. A read-out below repeats the numbers
 *   (touch + screen-reader friendly). Exported for other packages (e.g. the Candlestick Lab).
 * - CandleVisual: the lesson visual — tabs "Анатомия" (the lesson's example candles), "Реална свещ"
 *   (recent demo/live candles from /market/candles) and "Candle builder". Clicking a real candle opens
 *   the drill-down (lower-timeframe candles inside it, components/academy/visuals/drilldown.tsx);
 *   clicking a synthetic candle explains that it has no inner history.
 */
import { CandlestickChart, Hammer, MousePointerClick, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { CandleDrilldown } from "@/components/academy/visuals/drilldown";
import { Caption, RANGE_CLASS, useElementWidth, utcLabel } from "@/components/academy/visuals/shared";
import { Badge, Button, ChartSkeleton, DataNotAvailable, ErrorState, Notice, Segmented, SourceBadge, Term, type SourceLike } from "@/components/ui";
import { ApiError, fetcher } from "@/lib/api";
import { TF_LABEL, TF_SECONDS, cx, fmtPrice } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";
import type { CandlesResponse } from "@/lib/types";

/* ───────────────────────────────────────────────────────── model */

export type CandleItem = { open: number; high: number; low: number; close: number; time?: number };
export type CandlePart = "upper_wick" | "body" | "lower_wick";
type PriceKey = "open" | "high" | "low" | "close";

export const CLICK_CAPTION = "Click the candle to see what happened during this period.";

const PART_LABEL: Record<CandlePart, string> = { upper_wick: "UPPER WICK", body: "BODY", lower_wick: "LOWER WICK" };
const PART_TERM: Record<CandlePart, string> = { upper_wick: "wick", body: "body", lower_wick: "wick" };
const PRICE_LABEL: Record<PriceKey, string> = { open: "OPEN", high: "HIGH", low: "LOW", close: "CLOSE" };
const PRICE_SHORT: Record<PriceKey, string> = { open: "O", high: "H", low: "L", close: "C" };

export function toCandleItem(v: unknown): CandleItem | null {
  if (Array.isArray(v) && v.length >= 4 && v.slice(0, 4).every((x) => typeof x === "number" && Number.isFinite(x))) {
    const [open, high, low, close] = v as number[];
    return { open, high, low, close };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ([o.open, o.high, o.low, o.close].every((x) => typeof x === "number")) {
      return { open: o.open as number, high: o.high as number, low: o.low as number, close: o.close as number, time: typeof o.time === "number" ? o.time : undefined };
    }
  }
  return null;
}

export function candleAnatomy(c: CandleItem) {
  const top = Math.max(c.open, c.close);
  const bot = Math.min(c.open, c.close);
  const range = c.high - c.low;
  const body = top - bot;
  const upper = c.high - top;
  const lower = bot - c.low;
  const pct = (v: number) => (range > 0 ? (v / range) * 100 : 0);
  const dir: "bullish" | "bearish" | "neutral" = range > 0 && body / range < 0.03 ? "neutral" : c.close > c.open ? "bullish" : c.close < c.open ? "bearish" : "neutral";
  return { top, bot, range, body, upper, lower, bodyPct: pct(body), upperPct: pct(upper), lowerPct: pct(lower), dir };
}

function partsFromHighlight(h?: string | null): CandlePart[] {
  if (h === "body") return ["body"];
  if (h === "upper_wick") return ["upper_wick"];
  if (h === "lower_wick") return ["lower_wick"];
  if (h === "wick") return ["upper_wick", "lower_wick"];
  return [];
}

function priceFromHighlight(h?: string | null): PriceKey | null {
  return h === "open" || h === "high" || h === "low" || h === "close" ? h : null;
}

/** Spread label positions so they keep `gap` px apart inside [lo, hi] (input order = visual order). */
function spread<T extends { y: number }>(items: T[], gap: number, lo: number, hi: number): T[] {
  const out = items.map((it) => ({ ...it }));
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gap);
  if (out.length) out[out.length - 1].y = Math.min(out[out.length - 1].y, hi);
  for (let i = out.length - 2; i >= 0; i--) out[i].y = Math.min(out[i].y, out[i + 1].y - gap);
  if (out.length) out[0].y = Math.max(out[0].y, lo);
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gap);
  return out;
}

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
  const activeIdx = Math.min(n - 1, Math.max(0, hover?.i ?? focusIdx ?? selected ?? defaultActive));
  const hlParts: CandlePart[] = hover ? (hover.part ? [hover.part] : []) : partsFromHighlight(highlight);
  const hlPrice: PriceKey | null = hover ? null : priceFromHighlight(highlight);

  const W = Math.max(260, width);
  const H = height;
  const narrow = W < 460;
  const railW = narrow ? 92 : 148;
  const gutter = narrow ? 80 : 96;
  const x0 = gutter;
  const x1 = W - railW - 14;
  const slot = n ? (x1 - x0) / n : 1;
  const bodyW = Math.max(8, Math.min(42, slot * 0.4));
  const showTimes = candles.some((c) => typeof c.time === "number");
  const top = 14;
  const bottom = showTimes ? 28 : 12;
  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const lo0 = n ? Math.min(...lows) : 0;
  const hi0 = n ? Math.max(...highs) : 1;
  const pad = (hi0 - lo0 || Math.abs(hi0) * 0.01 || 1) * 0.08;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const y = (p: number) => top + ((hi - p) / (hi - lo || 1)) * (H - top - bottom);
  const cxOf = (i: number) => x0 + slot * (i + 0.5);

  if (!n) return null;

  const active = candles[activeIdx];
  const a = candleAnatomy(active);
  const acx = cxOf(activeIdx);

  const partAt = (c: CandleItem, py: number): CandlePart => {
    const bt = y(Math.max(c.open, c.close));
    const bb = y(Math.min(c.open, c.close));
    if (bb - bt < 7) {
      const mid = (bt + bb) / 2;
      if (Math.abs(py - mid) <= 4) return "body";
      return py < mid ? "upper_wick" : "lower_wick";
    }
    if (py < bt) return "upper_wick";
    if (py > bb) return "lower_wick";
    return "body";
  };

  const onMove = (e: React.PointerEvent, i: number) => {
    if (!svgEl) return;
    const py = e.clientY - svgEl.getBoundingClientRect().top;
    const part = partAt(candles[i], py);
    setHover((h) => (h && h.i === i && h.part === part ? h : { i, part }));
  };

  // price rail labels for the active candle (top → bottom)
  const railX = x1 + 14;
  const priceKeys: PriceKey[] = a.dir === "bearish" ? ["high", "open", "close", "low"] : ["high", "close", "open", "low"];
  const rail = spread(
    priceKeys.map((k) => ({ k, y: y(active[k]), py: y(active[k]) })),
    19,
    top + 8,
    H - bottom - 8,
  );

  // part brackets for the active candle
  const bx = acx - bodyW / 2 - 9;
  const segs: { part: CandlePart; a: number; b: number }[] = [
    { part: "upper_wick", a: y(active.high), b: y(a.top) },
    { part: "body", a: y(a.top), b: y(a.bot) },
    { part: "lower_wick", a: y(a.bot), b: y(active.low) },
  ];
  const partLabels = spread(
    segs.map((s) => ({ ...s, y: (s.a + s.b) / 2, my: (s.a + s.b) / 2 })),
    14,
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
            <line key={f} x1={x0 - 30} x2={x1} y1={top + f * (H - top - bottom)} y2={top + f * (H - top - bottom)} stroke={PALETTE.line} strokeDasharray="2 5" />
          ))}

          {/* leader lines (under the candles) */}
          {rail.map((r) => {
            const k = r.k as PriceKey;
            const isWick = k === "high" || k === "low";
            const ax = isWick ? acx + 1.5 : acx + bodyW / 2 + 1;
            const hot = hlPrice === k;
            return (
              <path
                key={`lead-${k}`}
                d={`M${ax},${r.py} H${railX - 12} L${railX - 2},${r.y}`}
                fill="none"
                stroke={hot ? PALETTE.gold : withAlpha(PALETTE.muted, 0.45)}
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
                <g opacity={dim ? 0.38 : 1} style={{ transition: "opacity 160ms ease" }}>
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

          {/* part brackets + labels (left of the active candle) */}
          <g pointerEvents="none">
            {partLabels.map((s) => {
              const len = s.b - s.a;
              const hot = hlParts.includes(s.part);
              const ink = hot ? PALETTE.gold : PALETTE.muted;
              const text = PART_LABEL[s.part];
              const tw = text.length * 6.1 + 10;
              return (
                <g key={s.part}>
                  {len >= 3 && (
                    <path
                      d={`M${bx + 4},${s.a + 1} H${bx} V${s.b - 1} H${bx + 4}`}
                      fill="none"
                      stroke={hot ? PALETTE.gold : withAlpha(PALETTE.muted, 0.6)}
                      strokeWidth={hot ? 1.6 : 1}
                    />
                  )}
                  {Math.abs(s.y - s.my) > 2 && <path d={`M${bx - 5},${s.y} L${bx},${s.my}`} stroke={withAlpha(PALETTE.muted, 0.5)} fill="none" />}
                  <rect x={bx - 6 - tw} y={s.y - 8} width={tw} height={16} rx={4} fill={withAlpha(PALETTE.surface, 0.88)} stroke={hot ? withAlpha(PALETTE.gold, 0.45) : "none"} />
                  <text x={bx - 11} y={s.y + 3.5} textAnchor="end" fontSize={9.5} fontWeight={600} letterSpacing="0.06em" fill={ink}>
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
              const hot = hlPrice === k;
              const w = W - railX - 2;
              return (
                <g key={`rail-${k}`}>
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

function LiveCandles({ symbol, timeframe }: { symbol: string; timeframe: string }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(560);
  const key = `/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=12`;
  const { data, error, mutate, isLoading } = useSWR<CandlesResponse>(key, fetcher, { refreshInterval: 60_000, revalidateOnFocus: false });
  const [openTime, setOpenTime] = useState<number | null>(null);

  const count = width < 460 ? 4 : 6;
  const candles = useMemo(() => {
    if (!data?.candles?.length) return [];
    const tf = TF_SECONDS[timeframe] ?? 3600;
    const now = data.server_time;
    const closed = now ? data.candles.filter((c) => c.time + tf <= now) : data.candles;
    return (closed.length ? closed : data.candles).slice(-count);
  }, [data, timeframe, count]);

  const selectedIdx = openTime === null ? null : candles.findIndex((c) => c.time === openTime);

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
          selected={selectedIdx !== null && selectedIdx >= 0 ? selectedIdx : null}
          onCandleClick={(i) => setOpenTime(candles[i].time ?? null)}
          ariaLabel={`${symbol} ${TF_LABEL[timeframe] ?? timeframe} — последни свещи`}
        />
        {openTime !== null && (
          <CandleDrilldown symbol={symbol} timeframe={timeframe} time={openTime} onClose={() => setOpenTime(null)} className="mt-3" />
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
      {candles.length > 0 && (
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

function classify(c: CandleItem): string[] {
  const a = candleAnatomy(c);
  const out: string[] = [];
  if (a.range <= 0) return out;
  if (a.bodyPct <= 10) out.push("doji");
  if (a.lower >= 2 * a.body && a.upperPct <= 15 && a.bodyPct > 5) out.push("hammer");
  if (a.upper >= 2 * a.body && a.lowerPct <= 15 && a.bodyPct > 5) out.push("shooting star");
  if (a.bodyPct >= 90) out.push("marubozu");
  return out;
}

function CandleBuilder({ onShowReal }: { onShowReal?: () => void }) {
  const [b, setB] = useState<OHLC>([100, 108, 96, 105]);
  const [note, setNote] = useState(false);
  const c: CandleItem = { open: b[0], high: b[1], low: b[2], close: b[3] };
  const valid = b[2] <= Math.min(b[0], b[3]) && b[1] >= Math.max(b[0], b[3]);
  const patterns = valid ? classify(c) : [];
  const setK = (i: number, v: number) => setB((prev) => prev.map((x, j) => (j === i ? v : x)) as OHLC);
  const presets: { label: string; v: OHLC }[] = [
    { label: "Bullish", v: [100, 108, 98, 107] },
    { label: "Bearish", v: [107, 109, 99, 100] },
    { label: "Doji", v: [104, 109, 99, 104.2] },
    { label: "Hammer", v: [106, 107, 96, 106.8] },
    { label: "Shooting star", v: [100, 110, 99.5, 100.8] },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <SlidersHorizontal size={14} strokeWidth={2} className="text-accent2" aria-hidden />
          Candle builder
        </div>
        {(["Open", "High", "Low", "Close"] as const).map((label, i) => (
          <label key={label} className="block">
            <span className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-muted">
                <Term k={label.toLowerCase()}>{label}</Term>
              </span>
              <span className="num font-medium text-text">{b[i].toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={90}
              max={115}
              step={0.5}
              value={b[i]}
              aria-label={label}
              onChange={(e) => setK(i, Number(e.target.value))}
              className={RANGE_CLASS}
              style={{ background: `linear-gradient(to right, var(--color-accent) ${((b[i] - 90) / 25) * 100}%, rgb(148 163 184 / 0.16) ${((b[i] - 90) / 25) * 100}%)` }}
            />
          </label>
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {presets.map((p) => (
            <button
              key={p.label}
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
            {note && <SyntheticNote onShowReal={onShowReal} onClose={() => setNote(false)} />}
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

export function CandleVisual({ visual }: { visual: Record<string, unknown> }) {
  const candles = useMemo(
    () => (Array.isArray(visual.candles) ? (visual.candles as unknown[]).map(toCandleItem).filter((c): c is CandleItem => !!c) : []),
    [visual.candles],
  );
  const highlight = typeof visual.highlight === "string" ? visual.highlight : null;
  const pattern = typeof visual.pattern === "string" ? visual.pattern.replace(/_/g, " ") : null;
  const builder = !!visual.builder;
  const liveCfg = visual.live && typeof visual.live === "object" ? (visual.live as { symbol?: string; timeframe?: string }) : null;
  const live = liveCfg ? { symbol: String(liveCfg.symbol ?? "BTC/USDT"), timeframe: String(liveCfg.timeframe ?? "1h") } : null;

  const tabs: { value: Tab; label: React.ReactNode }[] = [];
  if (candles.length) tabs.push({ value: "anatomy", label: <><Sparkles size={12} strokeWidth={2} aria-hidden /> Анатомия</> });
  if (live) tabs.push({ value: "live", label: <><CandlestickChart size={12} strokeWidth={2} aria-hidden /> Реална свещ</> });
  if (builder) tabs.push({ value: "builder", label: <><Hammer size={12} strokeWidth={2} aria-hidden /> Candle builder</> });
  const initial: Tab = live && !builder ? "live" : (tabs[0]?.value ?? "anatomy");
  const [tab, setTab] = useState<Tab>(initial);
  const [note, setNote] = useState(false);
  const showReal = live ? () => { setNote(false); setTab("live"); } : undefined;

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
          {note && <div className="mt-2"><SyntheticNote onShowReal={showReal} onClose={() => setNote(false)} /></div>}
        </div>
      )}

      {tab === "live" && live && <LiveCandles symbol={live.symbol} timeframe={live.timeframe} />}

      {tab === "builder" && builder && <CandleBuilder onShowReal={showReal} />}
    </div>
  );
}
