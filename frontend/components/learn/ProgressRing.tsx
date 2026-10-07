/*
 * Circular progress meter (single ratio against 100%). Stateless — usable from server or client.
 * The track is the same hue as the fill at low alpha; the value lives in the centre slot.
 */
import { cx } from "@/lib/format";

export type RingTone = "accent" | "up" | "warn" | "muted" | "gold";

const STROKE: Record<RingTone, string> = {
  accent: "var(--color-accent2)",
  up: "var(--color-up)",
  warn: "var(--color-warn)",
  muted: "var(--color-faint)",
  gold: "var(--color-gold)",
};

export function ProgressRing({
  value,
  size = 44,
  stroke = 3.5,
  tone = "accent",
  children,
  className,
  label,
}: {
  /** 0–100 */
  value: number;
  size?: number;
  stroke?: number;
  tone?: RingTone;
  /** centre content (level number, icon…) */
  children?: React.ReactNode;
  className?: string;
  /** accessible label, e.g. "LEVEL 1: 17%" */
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = STROKE[tone];
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(148 163 184 / 0.14)" strokeWidth={stroke} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out-quart"
          />
        )}
      </svg>
      <span className="relative flex items-center justify-center">{children}</span>
    </span>
  );
}
