import { ShieldCheck } from "lucide-react";

import { cx } from "@/lib/format";

const PILL: Record<string, { cls: string; dot: string; label: string }> = {
  RUNNING: { cls: "bg-up/10 text-up ring-up/30", dot: "bg-up animate-pulse-soft shadow-[0_0_0_3px_rgb(34_199_158/0.18)]", label: "RUNNING" },
  PAUSED: { cls: "bg-warn/10 text-warn ring-warn/30", dot: "bg-warn", label: "PAUSED" },
  STOPPED: { cls: "bg-white/[0.06] text-muted ring-white/12", dot: "bg-faint", label: "STOPPED" },
};

/** RUNNING / PAUSED / STOPPED status pill with a live dot. */
export function StatusPill({ status, className, size = "sm" }: { status: string; className?: string; size?: "sm" | "md" }) {
  const p = PILL[status] ?? PILL.STOPPED;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold uppercase tracking-[0.06em] ring-1 ring-inset",
        size === "md" ? "px-2.5 py-1 text-[11.5px]" : "px-2 py-0.5 text-[10.5px]",
        p.cls,
        className,
      )}
    >
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", p.dot)} aria-hidden />
      {PILL[status] ? p.label : status}
    </span>
  );
}

/** Prominent "PAPER BOT ONLY — virtual funds" label. */
export function PaperBotLabel({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-warn/35 bg-warn/[0.1] font-semibold uppercase tracking-[0.07em] text-warn",
        compact ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]",
        className,
      )}
      title="Ботовете работят само с виртуални пари. Няма реални поръчки и API ключове."
    >
      <ShieldCheck size={compact ? 12 : 14} strokeWidth={2.25} aria-hidden />
      PAPER BOT ONLY — virtual funds
    </span>
  );
}
