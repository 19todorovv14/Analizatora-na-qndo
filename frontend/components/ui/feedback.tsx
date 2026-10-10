/*
 * Loading, empty, error and "no data" states + checklists and disclaimers.
 * No "use client": usable from Server Components (icons are passed as components).
 */
import { Check, DatabaseZap, Inbox, Minus, RefreshCw, ShieldAlert, TriangleAlert, X, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/format";

/* ────────────────────────────────────────────────────────── skeletons */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cx("skeleton", className)} style={style} />;
}

const LINE_WIDTHS = ["100%", "93%", "78%", "88%", "64%", "84%"];

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cx("space-y-2.5 py-0.5", className)}>
      <span className="sr-only">Зареждане…</span>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: lines > 1 && i === lines - 1 ? "58%" : LINE_WIDTHS[i % LINE_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}

// deterministic "candles" so server and client render the same placeholder
const BARS = [38, 52, 46, 61, 57, 70, 64, 49, 55, 68, 74, 66, 58, 63, 77, 82, 71, 65, 73, 86, 79, 69, 75, 88, 81, 72, 84, 90];

export function ChartSkeleton({ height = 320, className }: { height?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cx("relative w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.015]", className)}
      style={{ height }}
    >
      <span className="sr-only">Зареждане на графиката…</span>
      <div className="grid-mesh absolute inset-0 opacity-60" aria-hidden />
      <div className="absolute inset-x-4 bottom-8 top-10 flex items-end gap-[3px] pr-14" aria-hidden>
        {BARS.map((h, i) => (
          <Skeleton key={i} className="min-w-0 flex-1 rounded-[3px]" style={{ height: `${h}%`, opacity: 0.55 + (i % 3) * 0.15 }} />
        ))}
      </div>
      <div className="absolute bottom-8 right-3 top-10 flex w-10 flex-col justify-between" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-2 w-full" />
        ))}
      </div>
      <div className="absolute bottom-3 left-4 right-16 flex justify-between" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-2 w-10" />
        ))}
      </div>
      <div className="absolute left-4 top-3 flex gap-2" aria-hidden>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5, className }: { rows?: number; cols?: number; className?: string }) {
  const c = Math.max(1, cols);
  return (
    <div role="status" aria-busy="true" className={cx("w-full overflow-hidden", className)}>
      <span className="sr-only">Зареждане на таблицата…</span>
      <div className="grid gap-4 border-b border-white/[0.06] px-3 pb-2.5 pt-1" style={{ gridTemplateColumns: `repeat(${c}, minmax(0, 1fr))` }} aria-hidden>
        {Array.from({ length: c }, (_, j) => (
          <Skeleton key={j} className="h-2.5" style={{ width: j === 0 ? "55%" : "40%" }} />
        ))}
      </div>
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <div
          key={i}
          className="grid items-center gap-4 border-b border-white/[0.04] px-3 py-3 last:border-0"
          style={{ gridTemplateColumns: `repeat(${c}, minmax(0, 1fr))` }}
          aria-hidden
        >
          {Array.from({ length: c }, (_, j) => (
            <Skeleton key={j} className="h-3" style={{ width: j === 0 ? `${62 + ((i * 7) % 30)}%` : `${45 + ((i * 13 + j * 17) % 40)}%`, opacity: 0.85 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────── empty / error states */

function StateIcon({ icon: Icon, tone = "accent" }: { icon: LucideIcon; tone?: "accent" | "down" | "muted" }) {
  const ink = { accent: "text-accent2", down: "text-down", muted: "text-muted" }[tone];
  return (
    <span
      className={cx(
        "flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07),0_8px_20px_-10px_rgb(0_0_0/0.7)]",
        ink,
      )}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

export function EmptyState({
  icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
  headingLevel = 3,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
  /** heading level of the title (2–6); `false` renders a plain <p> (no extra heading in the outline) */
  headingLevel?: 2 | 3 | 4 | 5 | 6 | false;
}) {
  const TitleTag = headingLevel === false ? "p" : (`h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6");
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] text-center",
        compact ? "gap-2.5 px-4 py-6" : "gap-3.5 px-6 py-12",
        className,
      )}
    >
      <StateIcon icon={icon} />
      <div className="max-w-md">
        <TitleTag className="text-[15px] font-semibold tracking-[-0.01em] text-text">{title}</TitleTag>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="mt-0.5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Нещо се обърка",
  description = "Данните не можаха да се заредят. Опитай отново след малко.",
  onRetry,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx("flex flex-col items-center justify-center gap-3.5 rounded-xl border border-down/20 bg-down/[0.035] px-6 py-10 text-center", className)}
    >
      <StateIcon icon={TriangleAlert} tone="down" />
      <div className="max-w-md">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text">{title}</h3>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
        >
          <RefreshCw size={13} strokeWidth={2} aria-hidden />
          Опитай отново
        </button>
      )}
    </div>
  );
}

/**
 * The ONLY way the UI shows missing market data — never invent numbers. Shows the literal heading
 * "DATA NOT AVAILABLE", the reason, the provider and a link to the data-source settings.
 */
export function DataNotAvailable({
  reason,
  provider,
  compact,
  className,
}: {
  reason?: React.ReactNode;
  provider?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const why = reason ?? "Няма налични данни от доставчика за този инструмент или период.";
  if (compact) {
    return (
      <span
        role="status"
        className={cx(
          "inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-[11px] leading-4 text-muted",
          className,
        )}
      >
        <DatabaseZap size={12} strokeWidth={2} className="shrink-0 text-faint" aria-hidden />
        <span className="font-semibold tracking-[0.06em] text-text/80">DATA NOT AVAILABLE</span>
        <span className="min-w-0 text-faint">{why}</span>
        {provider && <span className="text-faint">· {provider}</span>}
        <Link href="/settings/data-sources" className="font-medium text-accent2 hover:text-text">
          Източници →
        </Link>
      </span>
    );
  }
  return (
    <div
      role="status"
      className={cx(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-[repeating-linear-gradient(135deg,rgb(148_163_184/0.03)_0_10px,transparent_10px_20px)] px-6 py-10 text-center",
        className,
      )}
    >
      <StateIcon icon={DatabaseZap} tone="muted" />
      <div className="max-w-md">
        <div className="text-xs font-semibold tracking-[0.14em] text-text/85">DATA NOT AVAILABLE</div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{why}</p>
        {provider && (
          <p className="mt-1 text-xs text-faint">
            Източник: <span className="text-muted">{provider}</span>
          </p>
        )}
      </div>
      <Link
        href="/settings/data-sources"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent2 transition-colors hover:bg-white/[0.05] hover:text-text"
      >
        Източници на данни →
      </Link>
    </div>
  );
}

/* ───────────────────────────────────────────── checklist & disclaimer */

export type ChecklistItem = { label: React.ReactNode; pass: boolean | null; detail?: React.ReactNode };

function Marker({ pass }: { pass: boolean | null }) {
  if (pass === true)
    return (
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-up/15 text-up ring-1 ring-inset ring-up/30">
        <Check size={11} strokeWidth={3} aria-hidden />
        <span className="sr-only">✓</span>
      </span>
    );
  if (pass === false)
    return (
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-down/15 text-down ring-1 ring-inset ring-down/30">
        <X size={11} strokeWidth={3} aria-hidden />
        <span className="sr-only">✕</span>
      </span>
    );
  return (
    <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-faint ring-1 ring-inset ring-white/10">
      <Minus size={11} strokeWidth={3} aria-hidden />
      <span className="sr-only">—</span>
    </span>
  );
}

/** Pass / fail / unknown list (✓ / ✕ / —), e.g. setup conditions or lesson goals. */
export function Checklist({ items, className }: { items: ChecklistItem[]; className?: string }) {
  return (
    <ul className={cx("space-y-2", className)}>
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm">
          <Marker pass={it.pass} />
          <div className="min-w-0">
            <div className={cx("leading-5", it.pass === null ? "text-muted" : "text-text")}>{it.label}</div>
            {it.detail && <div className="mt-0.5 text-xs leading-relaxed text-muted">{it.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Small bordered note for risk / educational disclaimers. */
export function Disclaimer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "flex gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-muted",
        className,
      )}
    >
      <ShieldAlert size={13} strokeWidth={2} className="mt-px shrink-0 text-faint" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
