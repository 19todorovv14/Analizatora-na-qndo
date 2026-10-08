/*
 * Small SVG render of a candle sequence (pattern gallery cards, practice rounds). Context candles are dimmed,
 * the pattern candles sit on a soft accent band. Scales with its container (viewBox), wicks keep a crisp width.
 * Stateless — renders in Server Components too.
 */
import { miniGeometry } from "@/components/labs/model";
import { cx } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";

export type MiniCandle = { open: number; high: number; low: number; close: number };

export function MiniCandles({
  candles,
  highlight = [],
  width = 168,
  height = 84,
  markLast = false,
  dimContext = true,
  className,
  ariaLabel,
}: {
  candles: MiniCandle[];
  /** indices drawn at full strength on the accent band (the pattern) */
  highlight?: number[];
  /** viewBox size — the SVG itself stretches to its container width */
  width?: number;
  height?: number;
  /** small caret above the last candle ("the pattern ends here") */
  markLast?: boolean;
  /** dim the candles that are not in `highlight` (default true when a highlight is given) */
  dimContext?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  if (!candles.length) return null;
  const top = markLast ? 12 : 0;
  const g = miniGeometry(candles, width, height - top, 6);
  const y = (p: number) => top + g.y(p);
  const hl = new Set(highlight);
  const first = highlight.length ? Math.min(...highlight) : -1;
  const last = highlight.length ? Math.max(...highlight) : -1;
  const n = candles.length;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel ?? `${n} свещи`}
      className={cx("block h-auto w-full", className)}
    >
      {first >= 0 && (
        <rect
          x={g.x(first) - g.slot / 2 + 1}
          y={top + 1}
          width={g.slot * (last - first + 1) - 2}
          height={height - top - 2}
          rx={6}
          fill={withAlpha(PALETTE.accent, 0.1)}
          stroke={withAlpha(PALETTE.accent2, 0.28)}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {candles.map((c, i) => {
        const up = c.close > c.open;
        const flat = Math.abs(c.close - c.open) <= (c.high - c.low) * 0.03;
        const color = flat ? PALETTE.muted : up ? PALETTE.up : PALETTE.down;
        const cx0 = g.x(i);
        const bt = y(Math.max(c.open, c.close));
        const bb = y(Math.min(c.open, c.close));
        const dim = dimContext && highlight.length > 0 && !hl.has(i);
        return (
          <g key={i} opacity={dim ? 0.42 : 1}>
            <line x1={cx0} x2={cx0} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <rect x={cx0 - g.bodyW / 2} y={bt} width={g.bodyW} height={Math.max(bb - bt, 1.2)} rx={Math.min(1.5, g.bodyW / 5)} fill={color} />
          </g>
        );
      })}
      {markLast && (
        <path
          d={`M${g.x(n - 1) - 4},${2} L${g.x(n - 1) + 4},${2} L${g.x(n - 1)},${8} Z`}
          fill={PALETTE.gold}
          aria-hidden
        />
      )}
    </svg>
  );
}
