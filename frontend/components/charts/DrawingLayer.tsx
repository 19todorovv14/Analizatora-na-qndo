"use client";

import { type DPoint, type Drawing, fibLevels, positionPlan } from "@/components/charts/drawings";
import { fmtDuration, fmtPrice } from "@/lib/format";
import { CHART, withAlpha } from "@/lib/theme";

/** Snapshot of the chart's coordinate system (pane 0), refreshed when the chart scrolls, zooms or rescales. */
export type Projector = {
  /** time-scale width (px) = price pane width without the price axis */
  w: number;
  /** price pane height (px) */
  h: number;
  /** number of bars */
  n: number;
  /** bar interval (s) */
  step: number;
  /** px per bar */
  barSpacing: number;
  timeToX: (t: number) => number | null;
  priceToY: (p: number) => number | null;
};

export const EMPTY_PROJ: Projector = { w: 0, h: 0, n: 0, step: 60, barSpacing: 6, timeToX: () => null, priceToY: () => null };

export type ZoneLike = { id: string; low: number; high: number; color: string; label?: string };

export type HandleKey = "p1" | "p2" | "p3";

type Props = {
  proj: Projector;
  drawings: readonly Drawing[];
  zones: readonly ZoneLike[];
  /** in-progress drawing (dashed preview) */
  draft: Drawing | null;
  /** transient measurement */
  measure: { p1: DPoint; p2: DPoint } | null;
  selected: string | null;
  /** cursor mode: drawings can be selected and their handles dragged */
  interactive: boolean;
  precision: number;
  highlightTime?: number | null;
  onSelect: (id: string) => void;
  onHandleDown: (e: React.PointerEvent<SVGElement>, id: string, handle: HandleKey) => void;
  onHandleMove: (e: React.PointerEvent<SVGElement>) => void;
  onHandleUp: (e: React.PointerEvent<SVGElement>) => void;
  svgRef?: React.Ref<SVGSVGElement>;
};

const UP = CHART.up;
const DOWN = CHART.down;
const LABEL_FONT = 11;

function Label({ x, y, text, color, anchor = "start", bg = CHART.overlayLabelBg }: { x: number; y: number; text: string; color: string; anchor?: "start" | "middle" | "end"; bg?: string }) {
  const w = Math.max(24, text.length * 6.3 + 10);
  const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  return (
    <g>
      <rect x={left} y={y - 9} width={w} height={17} rx={4} fill={bg} stroke={withAlpha(color, 0.45)} strokeWidth={0.8} />
      <text x={left + w / 2} y={y + 3.5} fontSize={LABEL_FONT} textAnchor="middle" fill={color} fontWeight={600}>
        {text}
      </text>
    </g>
  );
}

/**
 * SVG layer drawn over the price pane: zones, user drawings (trend, ray, horizontal, rectangle, text,
 * fib retracement, long/short position), the measure box, the highlighted candle and edit handles.
 * Pure rendering from the projector — all state lives in TradingChart.
 */
export function DrawingLayer({
  proj,
  drawings,
  zones,
  draft,
  measure,
  selected,
  interactive,
  precision,
  highlightTime,
  onSelect,
  onHandleDown,
  onHandleMove,
  onHandleUp,
  svgRef,
}: Props) {
  const { w: W, h: H, timeToX, priceToY } = proj;
  if (!(W > 0 && H > 0 && proj.n > 1)) return <svg ref={svgRef} width={0} height={0} className="absolute inset-0" aria-hidden />;

  const fmt = (p: number) => fmtPrice(p, precision);
  const shapes: React.ReactNode[] = [];

  // highlighted candle (lessons, drill-down)
  if (highlightTime != null) {
    const x = timeToX(highlightTime);
    if (x !== null && x > -50 && x < W + 50) {
      const bw = Math.max(6, proj.barSpacing * 0.9);
      shapes.push(
        <rect key="hl" x={x - bw / 2} y={0} width={bw} height={H} fill={withAlpha(CHART.accent, 0.13)} stroke={withAlpha(CHART.accent2, 0.5)} strokeDasharray="3 3" />,
      );
    }
  }

  zones.forEach((z) => {
    const yTop = priceToY(z.high);
    const yBot = priceToY(z.low);
    if (yTop === null || yBot === null) return;
    shapes.push(
      <g key={`zone-${z.id}`}>
        <rect x={0} y={Math.min(yTop, yBot)} width={W} height={Math.abs(yBot - yTop)} fill={z.color} />
        {z.label && (
          <text x={8} y={Math.min(yTop, yBot) + 13} fontSize={LABEL_FONT} fill={CHART.textStrong}>
            {z.label}
          </text>
        )}
      </g>,
    );
  });

  const clickable = (id: string, preview: boolean) =>
    !preview && interactive ? { style: { pointerEvents: "all" as const, cursor: "pointer" }, onClick: () => onSelect(id) } : { style: { pointerEvents: "none" as const } };

  const hitLine = (id: string, preview: boolean, x1: number, y1: number, x2: number, y2: number) =>
    preview || !interactive ? null : (
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={() => onSelect(id)} />
    );

  const handle = (id: string, key: HandleKey, x: number, y: number, color: string, cursor = "grab") => (
    <circle
      key={`${id}-${key}`}
      data-handle={key}
      cx={x}
      cy={y}
      r={5}
      fill={CHART.surface}
      stroke={color}
      strokeWidth={2}
      style={{ pointerEvents: "all", cursor, touchAction: "none" }}
      onPointerDown={(e) => onHandleDown(e, id, key)}
      onPointerMove={onHandleMove}
      onPointerUp={onHandleUp}
      onPointerCancel={onHandleUp}
    />
  );

  const render = (d: Drawing, preview = false): React.ReactNode => {
    const x1 = timeToX(d.p1.time);
    const y1 = priceToY(d.p1.price);
    if (x1 === null || y1 === null) return null;
    const x2 = d.p2 ? timeToX(d.p2.time) : null;
    const y2 = d.p2 ? priceToY(d.p2.price) : null;
    const isSel = selected === d.id && !preview;
    const showHandles = isSel && interactive;
    const stroke = { stroke: d.color, strokeWidth: isSel ? 2.4 : 1.6, strokeDasharray: preview ? "5 4" : undefined };

    if (d.type === "hline") {
      return (
        <g key={d.id}>
          <line x1={0} x2={W} y1={y1} y2={y1} {...stroke} />
          {hitLine(d.id, preview, 0, y1, W, y1)}
          <rect x={W - 74} y={y1 - 9} width={72} height={18} rx={4} fill={d.color} />
          <text x={W - 38} y={y1 + 4} fontSize={LABEL_FONT} textAnchor="middle" fill={CHART.overlayLabelInk} fontWeight={600}>
            {fmt(d.p1.price)}
          </text>
          {showHandles && handle(d.id, "p1", Math.min(Math.max(x1, 16), W - 96), y1, d.color, "ns-resize")}
        </g>
      );
    }
    if (d.type === "text") {
      return (
        <text key={d.id} x={x1} y={y1} fill={d.color} fontSize={13} fontWeight={600} {...clickable(d.id, preview)}>
          {d.text}
          {isSel ? " ●" : ""}
        </text>
      );
    }
    if (x2 === null || y2 === null) return null;

    if (d.type === "rect") {
      return (
        <g key={d.id}>
          <rect
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            fill={withAlpha(d.color, 0.13)}
            {...stroke}
            {...clickable(d.id, preview)}
          />
          {showHandles && (
            <>
              {handle(d.id, "p1", x1, y1, d.color)}
              {handle(d.id, "p2", x2, y2, d.color)}
            </>
          )}
        </g>
      );
    }

    if (d.type === "fib") {
      const xa = Math.min(x1, x2);
      const xb = Math.max(xa + 60, Math.max(x1, x2));
      const levels = fibLevels(d.p1, d.p2!);
      const ys = levels.map((l) => priceToY(l.price));
      return (
        <g key={d.id}>
          {levels.slice(0, -1).map((l, i) => {
            const ya = ys[i];
            const yb = ys[i + 1];
            if (ya === null || yb === null) return null;
            const golden = l.level === 0.5;
            return <rect key={`f${i}`} x={xa} y={Math.min(ya, yb)} width={xb - xa} height={Math.abs(yb - ya)} fill={withAlpha(d.color, golden ? 0.12 : i % 2 ? 0.035 : 0.06)} style={{ pointerEvents: "none" }} />;
          })}
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={d.color} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
          {levels.map((l, i) => {
            const y = ys[i];
            if (y === null) return null;
            const key = l.level === 0.618 || l.level === 0.5 || l.level === 0.382;
            return (
              <g key={`l${i}`}>
                <line x1={xa} x2={xb} y1={y} y2={y} stroke={d.color} strokeWidth={key ? 1.4 : 1} opacity={key ? 0.95 : 0.7} strokeDasharray={preview ? "5 4" : undefined} />
                {hitLine(d.id, preview, xa, y, xb, y)}
                <text x={xa + 4} y={y - 3} fontSize={10.5} fill={d.color} fontWeight={key ? 650 : 500}>
                  {l.level.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} ({fmt(l.price)})
                </text>
              </g>
            );
          })}
          {showHandles && (
            <>
              {handle(d.id, "p1", x1, y1, d.color)}
              {handle(d.id, "p2", x2, y2, d.color)}
            </>
          )}
        </g>
      );
    }

    if (d.type === "position") {
      const plan = positionPlan(d);
      if (!plan) return null;
      const yE = y1;
      const yS = priceToY(plan.stop);
      const yT = priceToY(plan.target);
      if (yS === null || yT === null) return null;
      const xa = Math.min(x1, x2);
      const xb = Math.max(xa + 90, Math.max(x1, x2));
      const long = plan.side === "long";
      const tag = `${long ? "LONG" : "SHORT"} · R:R ${plan.rr.toFixed(2)}`;
      return (
        <g key={d.id}>
          <rect x={xa} y={Math.min(yE, yT)} width={xb - xa} height={Math.abs(yT - yE)} fill={withAlpha(UP, 0.16)} stroke={withAlpha(UP, 0.55)} strokeWidth={1} strokeDasharray={preview ? "5 4" : undefined} {...clickable(d.id, preview)} />
          <rect x={xa} y={Math.min(yE, yS)} width={xb - xa} height={Math.abs(yS - yE)} fill={withAlpha(DOWN, 0.16)} stroke={withAlpha(DOWN, 0.55)} strokeWidth={1} strokeDasharray={preview ? "5 4" : undefined} {...clickable(d.id, preview)} />
          <line x1={xa} x2={xb} y1={yE} y2={yE} stroke={CHART.textStrong} strokeWidth={1.2} />
          <Label x={(xa + xb) / 2} y={long ? yT - 13 : yT + 13} anchor="middle" color={UP} text={`Target ${fmt(plan.target)} · +${plan.rewardPct.toFixed(2)}% · ${plan.rr.toFixed(2)}R`} />
          <Label x={(xa + xb) / 2} y={long ? yS + 13 : yS - 13} anchor="middle" color={DOWN} text={`Stop ${fmt(plan.stop)} · −${plan.riskPct.toFixed(2)}%`} />
          <Label x={xa + 4} y={yE} anchor="start" color={CHART.textStrong} text={tag} />
          {showHandles && (
            <>
              {handle(d.id, "p1", xa, yE, CHART.textStrong)}
              {handle(d.id, "p2", xb, yS, DOWN)}
              {handle(d.id, "p3", xb, yT, UP, "ns-resize")}
            </>
          )}
        </g>
      );
    }

    // trend / ray
    let ex: number = x2;
    let ey: number = y2;
    if (d.type === "ray" && x2 !== x1) {
      ex = x2 > x1 ? W : 0;
      ey = y1 + ((y2 - y1) * (ex - x1)) / (x2 - x1);
    }
    return (
      <g key={d.id}>
        <line x1={x1} y1={y1} x2={ex} y2={ey} {...stroke} />
        {hitLine(d.id, preview, x1, y1, ex, ey)}
        {preview && (
          <>
            <circle cx={x1} cy={y1} r={3.5} fill={d.color} />
            <circle cx={x2} cy={y2} r={3.5} fill={d.color} />
          </>
        )}
        {showHandles && (
          <>
            {handle(d.id, "p1", x1, y1, d.color)}
            {handle(d.id, "p2", x2, y2, d.color)}
          </>
        )}
      </g>
    );
  };

  drawings.forEach((d) => {
    const node = render(d);
    if (node) shapes.push(node);
  });
  if (draft) {
    const node = render(draft, true);
    if (node) shapes.push(node);
  }

  if (measure) {
    const x1 = timeToX(measure.p1.time);
    const x2 = timeToX(measure.p2.time);
    const y1 = priceToY(measure.p1.price);
    const y2 = priceToY(measure.p2.price);
    if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
      const dp = measure.p2.price - measure.p1.price;
      const pct = (dp / measure.p1.price) * 100;
      const bars = Math.round((measure.p2.time - measure.p1.time) / proj.step);
      const col = dp >= 0 ? UP : DOWN;
      shapes.push(
        <g key="measure">
          <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={withAlpha(col, 0.15)} stroke={col} strokeDasharray="4 3" />
          <rect x={(x1 + x2) / 2 - 78} y={Math.min(y1, y2) - 42} width={156} height={36} rx={8} fill={CHART.overlayLabelBg} stroke={withAlpha(col, 0.6)} />
          <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 27} fontSize={LABEL_FONT} textAnchor="middle" fill={col} fontWeight={600}>
            {dp >= 0 ? "+" : ""}
            {fmt(dp)} ({pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%)
          </text>
          <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 13} fontSize={10.5} textAnchor="middle" fill={CHART.text}>
            {bars} свещи · {fmtDuration(Math.abs(measure.p2.time - measure.p1.time))}
          </text>
        </g>,
      );
    }
  }

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      className="absolute inset-0"
      style={{ pointerEvents: "none", overflow: "visible" }}
      fontFamily={CHART.fontFamily}
    >
      {shapes}
    </svg>
  );
}
