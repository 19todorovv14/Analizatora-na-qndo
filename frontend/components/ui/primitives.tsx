/*
 * Core presentational primitives. No "use client" on purpose: none of these hold state, so they
 * render in Server Components too (e.g. PageHeader with a lucide icon prop on a server page).
 * Interactive pieces they embed (GlossaryTip, InfoTip) are client components.
 */
import { CircleAlert, CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import { SkeletonText } from "@/components/ui/feedback";
import { GlossaryTip, InfoTip } from "@/components/ui/term";
import { cx } from "@/lib/format";

/* ───────────────────────────────────────────────────────────── Card */

export type CardVariant = "glass" | "solid" | "inset";

/** True when a class list already sets all-side padding (so Card does not add its default p-4). */
const hasPadding = (cls?: string) => !!cls && /(^|\s)!?p-/.test(cls);

export function Card({
  title,
  right,
  children,
  className,
  bodyClass,
  id,
  variant = "glass",
  loading,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
  /** glass (default, translucent) · solid (opaque, dense data) · inset (recessed well) */
  variant?: CardVariant;
  /** render a text skeleton instead of the children */
  loading?: boolean;
}) {
  const surface = { glass: "card", solid: "card-solid", inset: "glass-inset" }[variant];
  return (
    <section id={id} className={cx(surface, "min-w-0", className)} aria-busy={loading || undefined}>
      {(title || right) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <h2 className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold tracking-[-0.005em] text-text">{title}</h2>
          {right && <div className="flex min-w-0 items-center justify-end gap-2">{right}</div>}
        </header>
      )}
      <div className={cx(!hasPadding(bodyClass) && "p-4", bodyClass)}>{loading ? <SkeletonText lines={3} /> : children}</div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── Button */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "up" | "down" | "outline" | "warn";
  size?: "sm" | "md" | "lg";
};

const BTN_VARIANT = {
  primary:
    "border border-[#5b95f7]/40 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-btn hover:from-[#4a8cf7] hover:to-[#2f6df0] active:from-[#2f74ea] active:to-[#2158d8]",
  ghost: "border border-transparent bg-transparent text-text hover:bg-white/[0.06] active:bg-white/[0.09]",
  outline:
    "border border-white/10 bg-white/[0.04] text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] hover:border-white/[0.18] hover:bg-white/[0.07] active:bg-white/[0.09]",
  up: "border border-[#2fd3a9]/30 bg-gradient-to-b from-[#14a884] to-[#0e8a6c] text-white shadow-btn hover:from-[#17b48e] hover:to-[#109474] active:from-[#109474] active:to-[#0c7c61]",
  down: "border border-[#ff7a80]/30 bg-gradient-to-b from-[#e5484d] to-[#c9353c] text-white shadow-btn hover:from-[#ec5257] hover:to-[#d23c43] active:from-[#d23c43] active:to-[#b92f36]",
  warn: "border border-[#ffd27a]/40 bg-gradient-to-b from-[#f7c25e] to-[#eea83a] text-[#1a1204] shadow-btn hover:from-[#f9ca6e] hover:to-[#f2b04a] active:to-[#e19c2f]",
} as const;

const BTN_SIZE = {
  sm: "min-h-7 gap-1.5 rounded-md px-2.5 py-1 text-xs",
  md: "min-h-9 gap-2 rounded-lg px-3.5 py-1.5 text-sm",
  lg: "min-h-11 gap-2 rounded-lg px-5 py-2 text-[15px]",
} as const;

/** Note: no default `type` on purpose — forms rely on implicit submit. */
export function Button({ variant = "primary", size = "md", className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex select-none items-center justify-center font-medium leading-tight transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
    />
  );
}

/* ──────────────────────────────────────────────────────────── Badge */

export type Tone = "neutral" | "up" | "down" | "warn" | "info" | "accent" | "violet" | "gold";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-muted ring-white/10",
  up: "bg-up/10 text-up ring-up/25",
  down: "bg-down/10 text-down ring-down/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  info: "bg-info/10 text-info ring-info/25",
  accent: "bg-accent/15 text-accent2 ring-accent/30",
  violet: "bg-violet/10 text-violet ring-violet/25",
  gold: "bg-gold/10 text-gold ring-gold/25",
};

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] ring-1 ring-inset",
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────────────────────────────────────── Stat */

export function Stat({
  label,
  value,
  sub,
  tone,
  term,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** a text colour class, e.g. "text-up" */
  tone?: string;
  /** glossary key → "?" with the explanation card */
  term?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.03)]">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase leading-4 tracking-[0.05em] text-muted">
        {label}
        {term && <GlossaryTip k={term} />}
      </div>
      <div className={cx("num mt-1 text-lg font-semibold leading-snug", tone || "text-text")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── Tabs */

/** Underlined tab strip. Plain buttons on purpose (no role="tab"). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { key: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("no-scrollbar flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_0_rgb(255_255_255/0.07)]", className)}>
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 pb-2 pt-1.5 text-sm font-medium transition-colors duration-150",
              on ? "border-accent text-text" : "border-transparent text-muted hover:border-white/15 hover:text-text",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────── loading & notices */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-accent2", className)}
    />
  );
}

export function Loading({ text = "Зареждане…" }: { text?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 p-6 text-sm text-muted">
      <Spinner /> {text}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-8 text-center text-sm leading-relaxed text-muted">
      {children}
    </div>
  );
}

const NOTICE: Record<"info" | "warn" | "down" | "up", { cls: string; icon: LucideIcon; ink: string }> = {
  info: { cls: "border-info/25 bg-info/[0.07]", icon: Info, ink: "text-info" },
  warn: { cls: "border-warn/25 bg-warn/[0.07]", icon: TriangleAlert, ink: "text-warn" },
  down: { cls: "border-down/30 bg-down/[0.08]", icon: OctagonAlert, ink: "text-down" },
  up: { cls: "border-up/25 bg-up/[0.07]", icon: CircleCheck, ink: "text-up" },
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "down" | "up";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = NOTICE[tone];
  const Icon = t.icon;
  return (
    <div className={cx("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", t.cls, className)}>
      <Icon size={16} strokeWidth={2} className={cx("mt-0.5 shrink-0", t.ink)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="mb-0.5 font-semibold text-text">{title}</div>}
        {children && <div className="leading-relaxed text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-down/30 bg-down/[0.08] px-3 py-2 text-sm text-down">
      <CircleAlert size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{error}</span>
    </div>
  );
}

export function ProgressBar({ value, tone = "accent", className }: { value: number; tone?: "accent" | "up" | "warn"; className?: string }) {
  const color = {
    accent: "bg-gradient-to-r from-accent to-accent2",
    up: "bg-gradient-to-r from-up/70 to-up",
    warn: "bg-gradient-to-r from-warn/70 to-warn",
  }[tone];
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className={cx("h-2 w-full overflow-hidden rounded-full bg-white/[0.06] shadow-[inset_0_1px_1px_rgb(0_0_0/0.3)]", className)}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500 ease-out-quart", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── forms */

export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="label flex items-center gap-1">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      {children}
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx("input", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ──────────────────────────────────────────────────────── badges */

export function PaperBadge({ compact, className }: { compact?: boolean; className?: string }) {
  const text = "Paper mode — virtual funds only";
  return (
    <span
      title={compact ? `${text}. Няма реални пари и реални поръчки.` : "Няма реални пари и реални поръчки."}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border border-warn/30 bg-warn/[0.08] px-2 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-warn",
        compact && "whitespace-nowrap",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn shadow-[0_0_0_3px_rgb(245_184_74/0.15)]" aria-hidden />
      {compact ? "Paper" : text}
    </span>
  );
}

export type SourceStatus = "live" | "delayed" | "demo" | "unavailable";

export type SourceLike = {
  id?: string;
  name?: string;
  is_live?: boolean;
  disclaimer?: string;
  status?: SourceStatus | null;
};

const SOURCE: Record<SourceStatus, { label: string; cls: string; dot: string; hint: string }> = {
  live: {
    label: "LIVE · read-only",
    cls: "bg-up/10 text-up ring-up/25",
    dot: "bg-up animate-pulse-soft",
    hint: "Реални пазарни данни само за четене — сделките остават виртуални.",
  },
  delayed: {
    label: "DELAYED",
    cls: "bg-info/10 text-info ring-info/25",
    dot: "bg-info",
    hint: "Реални данни със закъснение — не са в реално време.",
  },
  demo: {
    label: "DEMO",
    cls: "bg-warn/10 text-warn ring-warn/25",
    dot: "bg-warn",
    hint: "Синтетични демо данни за обучение — не са реални пазарни цени.",
  },
  unavailable: {
    label: "N/A",
    cls: "bg-white/[0.06] text-faint ring-white/10",
    dot: "bg-faint",
    hint: "Няма налични данни от този източник.",
  },
};

/** Market data source chip. `status` wins; without it `is_live` decides live vs demo. */
export function SourceBadge({ source, className }: { source?: SourceLike | null; className?: string }) {
  if (!source) return null;
  const status: SourceStatus = source.status && source.status in SOURCE ? source.status : source.is_live ? "live" : "demo";
  const s = SOURCE[status];
  const title = status === "demo" ? source.disclaimer || s.hint : [source.name, source.disclaimer || s.hint].filter(Boolean).join(" — ");
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] ring-1 ring-inset",
        s.cls,
        className,
      )}
    >
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

const REGIME_TONE: Record<string, Tone> = {
  TRENDING_UP: "up",
  TRENDING_DOWN: "down",
  RANGING: "info",
  HIGH_VOLATILITY: "warn",
  LOW_VOLATILITY: "neutral",
  UNCLEAR: "neutral",
};

export function RegimeBadge({ regime }: { regime?: string | null }) {
  if (!regime) return null;
  return <Badge tone={REGIME_TONE[regime] ?? "neutral"}>{regime.replace(/_/g, " ")}</Badge>;
}

/* ─────────────────────────────────────────────────────── layout */

/** Page title row used at the top of every page. */
export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  badge,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.02] text-accent2 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07),0_6px_16px_-8px_rgb(0_0_0/0.6)]">
            <Icon size={19} strokeWidth={1.75} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-lg font-semibold leading-tight tracking-[-0.015em] text-text sm:text-xl">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Lightweight titled block without card chrome. */
export function Section({
  title,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("min-w-0", className)}>
      <div className="mb-2.5 flex min-h-6 items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** Keyboard key cap. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-white/10 bg-white/[0.06] px-1.5 font-sans text-[10.5px] font-medium leading-none text-muted shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.4)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ─────────────────────────────────────────────────────── rich text */

/** Renders lesson-style text: paragraphs, "- " bullets and **bold**. */
export function RichText({ paragraphs, className }: { paragraphs: string[]; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={key} className="ml-5 list-disc text-text/90">
          {bullets.map((b, i) => (
            <li key={i}>{bold(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  paragraphs.forEach((p, i) => {
    if (p.startsWith("- ")) {
      bullets.push(p.slice(2));
    } else {
      flush(`ul-${i}`);
      blocks.push(<p key={i}>{bold(p)}</p>);
    }
  });
  flush("ul-end");
  return <div className={cx("prose-lesson text-[0.95rem] text-text/90", className)}>{blocks}</div>;
}

function bold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-text">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

const AI_HEAD =
  /^(OBSERVATION|ANALYSIS|HYPOTHESIS|DECISION|NO TRADE \/ RISK FACTORS|TRADE REVIEW|What happened|What you did well|What you did poorly|Main lesson|Result|RULES|ALTERNATIVE SCENARIO|SCENARIO|INVALIDATION|RISK|NEXT LESSON|PRACTICE EXERCISE|WHAT HAPPENED|STRATEGY VIEW|WHY)\b/;

/** Renders AI text with its section headers (OBSERVATION, ANALYSIS, RISK, Main lesson…) highlighted. */
export function AiText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((l, i) => {
        if (!l.trim()) return <div key={i} className="h-1.5" />;
        if (AI_HEAD.test(l))
          return (
            <div key={i} className="pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent2">
              {bold(l)}
            </div>
          );
        if (l.startsWith("- "))
          return (
            <div key={i} className="flex gap-2 pl-1 text-text/90">
              <span className="select-none text-faint" aria-hidden>
                •
              </span>
              <span className="min-w-0">{bold(l.slice(2))}</span>
            </div>
          );
        return (
          <div key={i} className="text-text/90">
            {bold(l)}
          </div>
        );
      })}
    </div>
  );
}
