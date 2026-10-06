/*
 * Brand mark + wordmark. No hooks / no "use client": renders on the server too (landing, 404).
 * The tile is a CSS gradient (not an SVG <linearGradient>): gradients referenced by id break when
 * the first instance sits in a display:none subtree (e.g. the desktop sidebar on mobile).
 */
import { cx } from "@/lib/format";

export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(140deg,#6aa5ff_0%,#3b82f6_45%,#2a49c9_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_6px_16px_-6px_rgb(59_130_246/0.65)] ring-1 ring-inset ring-white/15",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 20 20" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} fill="none">
        <path d="M5 4.5v11M10 2.5v13.5M15 6v10" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.3" strokeLinecap="round" />
        <rect x="3.4" y="8" width="3.2" height="5" rx="0.9" fill="#fff" fillOpacity="0.72" />
        <rect x="8.4" y="5" width="3.2" height="8" rx="0.9" fill="#fff" />
        <rect x="13.4" y="8.5" width="3.2" height="4.5" rx="0.9" fill="#fff" fillOpacity="0.6" />
      </svg>
    </span>
  );
}

/** Mark + "Trading Academy" wordmark. */
export function Brand({ size = 30, className, sub }: { size?: number; className?: string; sub?: React.ReactNode }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark size={size} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-text">Trading Academy</span>
        {sub && <span className="block truncate text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">{sub}</span>}
      </span>
    </span>
  );
}
