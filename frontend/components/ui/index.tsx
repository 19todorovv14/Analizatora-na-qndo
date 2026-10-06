"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/format";
import { TERMS } from "@/lib/glossary";

export function Card({
  title,
  right,
  children,
  className,
  bodyClass,
  id,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("card", className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-wide text-text">{title}</h2>
          {right}
        </header>
      )}
      <div className={cx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "up" | "down" | "outline" | "warn";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: BtnProps) {
  const v = {
    primary: "bg-accent hover:bg-accent2 text-white",
    ghost: "bg-transparent hover:bg-panel3 text-text",
    outline: "border border-line hover:border-accent text-text bg-panel2",
    up: "bg-up hover:brightness-110 text-white",
    down: "bg-down hover:brightness-110 text-white",
    warn: "bg-warn hover:brightness-110 text-black",
  }[variant];
  const s = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-1.5 text-sm", lg: "px-5 py-2.5 text-base" }[size];
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        v,
        s,
        className,
      )}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "up" | "down" | "warn" | "info" | "accent" | "violet";
  className?: string;
}) {
  const t = {
    neutral: "bg-panel3 text-muted",
    up: "bg-up/15 text-up",
    down: "bg-down/15 text-down",
    warn: "bg-warn/15 text-warn",
    info: "bg-info/15 text-info",
    accent: "bg-accent/20 text-accent2",
    violet: "bg-violet/20 text-violet",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", t, className)}>
      {children}
    </span>
  );
}

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
  tone?: string;
  term?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted">
        {label}
        {term && <InfoTip text={TERMS[term] ?? term} />}
      </div>
      <div className={cx("num mt-0.5 text-lg font-semibold", tone)}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function InfoTip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={cx("relative inline-flex", className)}>
      <button
        type="button"
        aria-label="Обяснение"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-faint text-[9px] leading-none text-muted hover:border-accent hover:text-accent2"
      >
        ?
      </button>
      {open && (
        <span className="absolute left-1/2 top-5 z-50 w-64 -translate-x-1/2 rounded-md border border-line bg-panel3 p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-text shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

/** A term with a dotted underline and a definition tooltip. */
export function Term({ k, children }: { k: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="cursor-help border-b border-dotted border-muted">{children}</span>
      {open && TERMS[k] && (
        <span className="absolute left-0 top-6 z-50 w-64 rounded-md border border-line bg-panel3 p-2.5 text-xs leading-relaxed text-text shadow-xl">
          {TERMS[k]}
        </span>
      )}
    </span>
  );
}

/** "Why am I seeing this?" — explains the reasoning behind any insight or warning. */
export function WhyButton({ children, label = "Why am I seeing this?" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button onClick={() => setOpen((o) => !o)} className="text-xs text-accent2 hover:underline" type="button">
        {open ? "Скрий обяснението" : label}
      </button>
      {open && <div className="fade-in mt-1.5 rounded-md border border-line bg-panel2 p-2.5 text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

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
    <div className={cx("flex gap-1 border-b border-line", className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm transition",
            value === t.key ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent", className)} />;
}

export function Loading({ text = "Зареждане…" }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted">
      <Spinner /> {text}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

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
  const t = {
    info: "border-info/40 bg-info/10",
    warn: "border-warn/40 bg-warn/10",
    down: "border-down/50 bg-down/10",
    up: "border-up/40 bg-up/10",
  }[tone];
  return (
    <div className={cx("rounded-md border p-3 text-sm", t, className)}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="rounded-md border border-down/50 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>;
}

export function ProgressBar({ value, tone = "accent", className }: { value: number; tone?: "accent" | "up" | "warn"; className?: string }) {
  const color = { accent: "bg-accent", up: "bg-up", warn: "bg-warn" }[tone];
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-panel3", className)}>
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label flex items-center gap-1">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      {children}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx("card fade-in w-full", wide ? "max-w-4xl" : "max-w-lg")}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Затвори">
            ✕
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

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

/** Renders AI text with OBSERVATION/ANALYSIS/HYPOTHESIS headers highlighted. */
export function AiText({ text }: { text: string }) {
  const lines = text.split("\n");
  const HEAD = /^(OBSERVATION|ANALYSIS|HYPOTHESIS|DECISION|NO TRADE \/ RISK FACTORS|TRADE REVIEW|What happened|What you did well|What you did poorly|Main lesson|Result)\b/;
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((l, i) => {
        if (!l.trim()) return <div key={i} className="h-1.5" />;
        if (HEAD.test(l)) return <div key={i} className="pt-1 text-xs font-bold uppercase tracking-wider text-accent2">{bold(l)}</div>;
        if (l.startsWith("- ")) return <div key={i} className="pl-3 text-text/90">• {bold(l.slice(2))}</div>;
        return <div key={i} className="text-text/90">{bold(l)}</div>;
      })}
    </div>
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

export function PaperBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-warn/50 bg-warn/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-warn">
      ● Paper mode — virtual funds only
    </span>
  );
}

export function SourceBadge({ source }: { source?: { id: string; name: string; is_live: boolean; disclaimer: string } }) {
  if (!source) return null;
  return (
    <span
      title={source.disclaimer}
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        source.is_live ? "bg-up/15 text-up" : "bg-info/15 text-info",
      )}
    >
      {source.is_live ? "Live data (read-only)" : "Demo data (synthetic)"}
    </span>
  );
}

const REGIME_TONE: Record<string, "up" | "down" | "info" | "warn" | "neutral"> = {
  TRENDING_UP: "up",
  TRENDING_DOWN: "down",
  RANGING: "info",
  HIGH_VOLATILITY: "warn",
  LOW_VOLATILITY: "neutral",
  UNCLEAR: "neutral",
};

export function RegimeBadge({ regime }: { regime?: string | null }) {
  if (!regime) return null;
  return <Badge tone={REGIME_TONE[regime] ?? "neutral"}>{regime.replace("_", " ")}</Badge>;
}
