"use client";

/*
 * "Equity vs price move" — one 2px line per leverage (1x … 100x on an ordinal blue ramp, the selected one wider and
 * on top), liquidation points (red dot with a surface ring), the slider's current move as a cursor with a dot on
 * every line, and a snapping crosshair whose tooltip lists every series. The equity axis is fixed to
 * [0, 2 × account], so changing leverage or basis never rescales the picture; lines that leave it are clipped —
 * the exact values stay in the tooltip and in the table view (the accessible alternative to the chart).
 */
import { useId, useMemo, useState } from "react";

import { useElementWidth } from "@/components/academy/visuals/shared";
import {
  TABLE_MOVES,
  curveGeometry,
  curveTable,
  equityAtMove,
  leverageColor,
  pointsAt,
  signedPct,
  snapMove,
  usd,
  usdCompact,
} from "@/components/labs/model";
import type { CurveFamily } from "@/components/labs/types";
import { ChartSkeleton } from "@/components/ui";
import { cx } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";

const PAD = { left: 48, right: 56, top: 18, bottom: 26 };
const AXIS_TEXT = { fill: PALETTE.faint, fontSize: 10.5 } as const;

function Legend({ family, selected }: { family: CurveFamily; selected: number }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted" aria-label="Легенда">
      {family.series.map((s) => (
        <li
          key={s.leverage}
          className={cx("inline-flex items-center gap-1.5", !s.can_open && "opacity-45")}
          title={s.can_open ? undefined : "Не може да се отвори: нужният margin е над сметката"}
        >
          <span className="inline-block w-4 rounded-full" style={{ height: s.leverage === selected ? 3 : 2, background: leverageColor(s.leverage) }} aria-hidden />
          <span className={cx("num", s.leverage === selected ? "font-semibold text-text" : "text-muted", !s.can_open && "line-through")}>{s.leverage}x</span>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PALETTE.down, boxShadow: `0 0 0 2px ${PALETTE.surface}` }} aria-hidden />
        ликвидация
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-px" style={{ background: withAlpha(PALETTE.text, 0.6) }} aria-hidden />
        текущо движение
      </li>
    </ul>
  );
}

/** The chart's table view: equity per leverage at −20 % … +20 % and the liquidation move. */
export function CurvesTable({ family, selected }: { family: CurveFamily; selected: number }) {
  const rows = curveTable(family, TABLE_MOVES);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-right text-xs">
        <caption className="sr-only">Equity на сметката при различни движения на цената, по leverage</caption>
        <thead>
          <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="px-2 py-2 text-left font-medium">
              Leverage
            </th>
            {TABLE_MOVES.map((m) => (
              <th key={m} scope="col" className="num px-2 py-2 font-medium">
                {signedPct(m, 0)}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 font-medium">
              Ликвидация
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.leverage} className={cx("border-b border-white/[0.04] last:border-0", r.leverage === selected && "bg-accent/[0.07]")}>
              <th scope="row" className="px-2 py-1.5 text-left font-semibold text-text">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: leverageColor(r.leverage) }} aria-hidden />
                  <span className="num">{r.leverage}x</span>
                </span>
              </th>
              {r.cells.map((p, i) => (
                <td
                  key={TABLE_MOVES[i]}
                  className={cx(
                    "num whitespace-nowrap px-2 py-1.5",
                    !r.canOpen || !p
                      ? "text-faint"
                      : p.liquidated
                        ? "font-semibold text-down"
                        : p.equity < family.equity - 0.005
                          ? "text-down"
                          : p.equity > family.equity + 0.005
                            ? "text-up"
                            : "text-text",
                  )}
                >
                  {!r.canOpen || !p ? "—" : usd(p.equity)}
                  {r.canOpen && p?.liquidated && <span className="ml-1 text-[10px] font-normal">ликв.</span>}
                </td>
              ))}
              <td className="num whitespace-nowrap px-2 py-1.5 text-muted">
                {!r.canOpen ? "не се отваря" : r.liquidationMove === null ? "недостижима" : signedPct(r.liquidationMove, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CurvesSvg({ family, selected, move, width, height }: { family: CurveFamily; selected: number; move: number; width: number; height: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = `lc${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const domain = useMemo<[number, number]>(() => [0, 2 * family.equity], [family.equity]);
  const geo = useMemo(() => curveGeometry(family, { width, height, ...PAD }, domain), [family, width, height, domain]);

  const open = geo.series.filter((s) => s.series.can_open);
  const ordered = [...open].sort((a, b) => Number(a.leverage === selected) - Number(b.leverage === selected));
  const plotTop = PAD.top;
  const plotBottom = height - PAD.bottom;
  const clampY = (v: number) => Math.max(plotTop, Math.min(plotBottom, geo.y(v)));
  const cursorX = geo.x(Math.max(geo.x0, Math.min(geo.x1, move)));
  const xTicks = [-20, -10, 0, 10, 20].filter((m) => m >= geo.x0 && m <= geo.x1);
  const sel = open.find((s) => s.leverage === selected) ?? null;
  const openSet = new Set(open.map((s) => s.leverage));
  const hoverRows = hover === null ? [] : pointsAt(family, hover).filter((r) => openSet.has(r.leverage));
  const hoverX = hover === null ? 0 : geo.x(hover);
  const tipLeft = hoverX > width - 214 ? Math.max(4, hoverX - 204) : hoverX + 12;
  const step = family.moves_pct.length > 1 ? Math.abs(family.moves_pct[1] - family.moves_pct[0]) || 1 : 1;

  const pickAt = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const m = geo.x0 + ((clientX - r.left) / Math.max(1, r.width)) * (geo.x1 - geo.x0);
    setHover(snapMove(family.moves_pct, m));
  };

  return (
    <>
      <svg
        width={width}
        height={height}
        className="block select-none"
        role="img"
        aria-label={`Equity спрямо движението на цената при leverage ${family.series.map((s) => `${s.leverage}x`).join(", ")}. Таблицата показва същите стойности.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={plotTop - 2} width={geo.plotW} height={plotBottom - plotTop + 4} />
          </clipPath>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geo.y(t)}
              y2={geo.y(t)}
              stroke={Math.abs(t - family.equity) < 1e-6 ? withAlpha(PALETTE.text, 0.26) : PALETTE.line}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={PAD.left - 8} y={geo.y(t) + 3.5} textAnchor="end" className="num" {...AXIS_TEXT}>
              {usdCompact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((m) => (
          <g key={m}>
            {m === 0 && <line x1={geo.x(0)} x2={geo.x(0)} y1={plotTop} y2={plotBottom} stroke={PALETTE.line} strokeWidth={1} shapeRendering="crispEdges" />}
            <text x={geo.x(m)} y={height - 8} textAnchor="middle" className="num" {...AXIS_TEXT}>
              {signedPct(m, 0)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {ordered.map((s) => {
            const isSel = s.leverage === selected;
            const color = leverageColor(s.leverage);
            return (
              <g key={s.leverage}>
                {isSel && <path d={s.d} stroke={withAlpha(color, 0.16)} strokeWidth={8} />}
                <path d={s.d} stroke={color} strokeWidth={isSel ? 3 : 2} opacity={isSel ? 1 : 0.85} />
              </g>
            );
          })}
        </g>

        <line x1={cursorX} x2={cursorX} y1={plotTop} y2={plotBottom} stroke={withAlpha(PALETTE.text, 0.5)} strokeWidth={1} shapeRendering="crispEdges" />
        <text x={cursorX} y={plotTop - 6} textAnchor="middle" className="num" fill={PALETTE.muted} fontSize={10}>
          {signedPct(move, 1)}
        </text>
        {ordered.map((s) => {
          const eq = equityAtMove(s.series.points, move);
          if (eq === null) return null;
          const isSel = s.leverage === selected;
          return <circle key={`c${s.leverage}`} cx={cursorX} cy={clampY(eq)} r={isSel ? 4.5 : 3} fill={leverageColor(s.leverage)} stroke={PALETTE.surface} strokeWidth={2} />;
        })}

        {open.flatMap((s) =>
          s.liq.map((p) => (
            <circle key={`l${s.leverage}-${p.move}`} cx={p.x} cy={clampY(p.equity)} r={4.5} fill={PALETTE.down} stroke={PALETTE.surface} strokeWidth={2}>
              <title>{`${s.leverage}x: ликвидация при ${signedPct(p.move, 1)} (equity ${usd(p.equity)})`}</title>
            </circle>
          )),
        )}

        {sel?.end && (
          <g>
            <text x={width - PAD.right + 7} y={clampY(sel.end.equity) - 1} className="num" fill={PALETTE.text} fontSize={11} fontWeight={600}>
              {selected}x{sel.end.equity > domain[1] ? " ↑" : ""}
            </text>
            <text x={width - PAD.right + 7} y={clampY(sel.end.equity) + 11} className="num" fill={PALETTE.muted} fontSize={10}>
              {usdCompact(sel.end.equity)}
            </text>
          </g>
        )}

        {hover !== null && <line x1={hoverX} x2={hoverX} y1={plotTop} y2={plotBottom} stroke={withAlpha(PALETTE.muted, 0.6)} strokeWidth={1} shapeRendering="crispEdges" />}

        <rect
          x={PAD.left}
          y={plotTop}
          width={geo.plotW}
          height={plotBottom - plotTop}
          fill="transparent"
          tabIndex={0}
          aria-label="Показалец на графиката: стрелките наляво и надясно го местят"
          className="cursor-crosshair outline-none"
          onPointerMove={(e) => pickAt(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pickAt(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(snapMove(family.moves_pct, move))}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const cur = hover ?? snapMove(family.moves_pct, move);
            setHover(snapMove(family.moves_pct, cur + (e.key === "ArrowLeft" ? -step : step)));
          }}
        />
      </svg>

      {hover !== null && hoverRows.length > 0 && (
        <div className="glass-strong pointer-events-none absolute z-10 w-[200px] rounded-lg px-3 py-2 text-xs shadow-xl" style={{ left: tipLeft, top: PAD.top + 2 }}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-white/[0.07] pb-1.5">
            <span className="text-muted">Движение на цената</span>
            <span className="num font-semibold text-text">{signedPct(hover, 1)}</span>
          </div>
          <ul className="space-y-1" aria-live="polite">
            {[...hoverRows].reverse().map(({ leverage, point }) => (
              <li key={leverage} className={cx("-mx-1 flex items-center gap-2 rounded px-1", leverage === selected && "bg-white/[0.06]")}>
                <span className="inline-block h-[2px] w-3 shrink-0 rounded-full" style={{ background: leverageColor(leverage) }} aria-hidden />
                <span className={cx("num font-semibold", point.liquidated ? "text-down" : "text-text")}>{usd(point.equity)}</span>
                <span className="num ml-auto text-[11px] text-muted">
                  {leverage}x{point.liquidated && <span className="ml-1 text-down">ликв.</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function LeverageCurves({
  family,
  selected,
  move,
  loading,
  height = 300,
  view = "chart",
}: {
  family: CurveFamily | null | undefined;
  /** highlighted leverage (the simulator's chip) */
  selected: number;
  /** the slider's price move in % (cursor) */
  move: number;
  /** a newer family is loading — the old frame stays, dimmed */
  loading?: boolean;
  height?: number;
  view?: "chart" | "table";
}) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>(640);
  return (
    <div className="space-y-2.5">
      {family && <Legend family={family} selected={selected} />}
      <div ref={boxRef} className={cx("relative min-w-0 transition-opacity duration-200", loading && "opacity-60")}>
        {!family ? (
          <ChartSkeleton height={height} />
        ) : view === "table" ? (
          <CurvesTable family={family} selected={selected} />
        ) : (
          <CurvesSvg family={family} selected={selected} move={move} width={width} height={height} />
        )}
      </div>
    </div>
  );
}
