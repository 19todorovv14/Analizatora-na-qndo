"use client";

import { BookOpen, CircleQuestionMark } from "lucide-react";
import Link from "next/link";

import { Tooltip } from "@/components/ui/overlay";
import { useExplain } from "@/lib/explain";
import { cx } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";

/** WHAT IT IS / WHY IT MATTERS / COMMON MISTAKE card for a glossary key (null when unknown). */
export function GlossaryCard({ k, className }: { k: string; className?: string }) {
  const g = GLOSSARY[k];
  if (!g) return null;
  const rows: [string, string, string][] = [
    ["WHAT IT IS", g.what, "text-accent2"],
    ["WHY IT MATTERS", g.why, "text-info"],
    ["COMMON MISTAKE", g.mistake, "text-warn"],
  ];
  return (
    <div className={cx("p-3.5", className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent2">
          <BookOpen size={13} strokeWidth={2} aria-hidden />
        </span>
        <div className="text-[13px] font-semibold leading-snug text-text">{g.title}</div>
      </div>
      <dl className="mt-3 space-y-2.5">
        {rows.map(([label, text, tone]) => (
          <div key={label}>
            <dt className={cx("text-[10px] font-semibold uppercase tracking-[0.08em]", tone)}>{label}</dt>
            <dd className="mt-0.5 text-xs leading-relaxed text-text/85">{text}</dd>
          </div>
        ))}
      </dl>
      {g.lesson && (
        <div className="mt-3 border-t border-white/[0.06] pt-2.5">
          <Link href={`/learn/${g.lesson}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent2 transition-colors hover:text-text">
            Урок →
          </Link>
        </div>
      )}
    </div>
  );
}

function HelpDot({ content, rich, className }: { content: React.ReactNode; rich?: boolean; className?: string }) {
  return (
    <Tooltip
      content={content}
      pinOnClick
      interactive={rich}
      className={cx("inline-flex align-middle", className)}
      contentClassName={rich ? "w-[320px] p-0" : "w-max"}
      maxWidth={rich ? 340 : 280}
    >
      <button
        type="button"
        aria-label="Обяснение"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-accent2 focus-visible:text-accent2"
      >
        <CircleQuestionMark size={13} strokeWidth={2} aria-hidden />
      </button>
    </Tooltip>
  );
}

/** Small "?" that explains something on hover / focus / tap. */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return <HelpDot content={text} className={className} />;
}

/** "?" with the full glossary card for `k` (falls back to the key text when unknown). */
export function GlossaryTip({ k, className }: { k: string; className?: string }) {
  if (!GLOSSARY[k]) return <HelpDot content={k} className={className} />;
  return <HelpDot content={<GlossaryCard k={k} />} rich className={className} />;
}

/**
 * A trading term. Explain mode ON → dotted underline + glossary card on hover/focus.
 * Explain mode OFF, or an unknown key → the children render plainly.
 */
export function Term({ k, children }: { k: string; children: React.ReactNode }) {
  const { explain } = useExplain();
  if (!explain || !GLOSSARY[k]) return <>{children}</>;
  return (
    <Tooltip content={<GlossaryCard k={k} />} interactive side="top" align="start" className="inline" contentClassName="w-[320px] p-0" maxWidth={340}>
      <span
        tabIndex={0}
        className="cursor-help rounded-sm underline decoration-muted/60 decoration-dotted decoration-1 underline-offset-[3px] transition-colors hover:decoration-accent2 focus-visible:decoration-accent2"
      >
        {children}
      </span>
    </Tooltip>
  );
}
