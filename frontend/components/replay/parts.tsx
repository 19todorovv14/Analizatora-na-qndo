"use client";

/* Small building blocks of the replay screens: score ring, action / outcome badges, flag chips, toasts. */
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { ACTION_META, TONE_COLOR, gradeOf, outcomeView, scoreTone } from "@/components/replay/model";
import type { Toast } from "@/components/replay/useReplaySession";
import type { DecisionFlag, ReplayAction, ReplayDecision } from "@/components/replay/types";
import { Badge, type Tone } from "@/components/ui";
import { cx } from "@/lib/format";

/** 0–100 score as a ring with the grade (A ≥ 85, B ≥ 70, C ≥ 55, else D); "—" before anything is scored. */
export function ScoreRing({
  score,
  grade,
  size = 72,
  label = "score",
  className,
}: {
  score: number | null | undefined;
  grade?: string | null;
  size?: number;
  label?: string;
  className?: string;
}) {
  const has = score !== null && score !== undefined && Number.isFinite(score);
  const value = has ? Math.max(0, Math.min(100, score)) : 0;
  const g = grade ?? gradeOf(has ? value : null);
  const color = TONE_COLOR[scoreTone(has ? value : null)];
  const stroke = Math.max(4, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={cx("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={has ? `Replay ${label}: ${Math.round(value)} от 100${g ? `, оценка ${g}` : ""}` : `Replay ${label}: още няма оценка`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(148 163 184 / 0.14)" strokeWidth={stroke} />
        {has && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(c * value) / 100} ${c}`}
            style={{ transition: "stroke-dasharray 400ms ease" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="num font-semibold text-text" style={{ fontSize: Math.round(size * 0.27) }}>
          {has ? Math.round(value) : "—"}
        </span>
        {size >= 56 && (
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: has ? color : undefined }}>
            {has && g ? `grade ${g}` : label}
          </span>
        )}
      </div>
    </div>
  );
}

export function ActionBadge({ action, className }: { action: ReplayAction; className?: string }) {
  const m = ACTION_META[action];
  return (
    <Badge tone={m.tone} className={className}>
      {m.label}
    </Badge>
  );
}

export function OutcomeBadge({ decision, className }: { decision: Pick<ReplayDecision, "action" | "outcome">; className?: string }) {
  const v = outcomeView(decision);
  return (
    <Badge tone={v.tone} className={cx("normal-case tracking-normal", className)}>
      {v.label}
    </Badge>
  );
}

const SEVERITY_TONE: Record<string, Tone> = {
  warning: "warn",
  info: "info",
  high: "down",
};

export function FlagChip({ flag, className }: { flag: Pick<DecisionFlag, "key" | "label" | "severity" | "text">; className?: string }) {
  const tone = SEVERITY_TONE[flag.severity] ?? "neutral";
  return (
    <span
      title={flag.text}
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tone === "warn" ? "bg-warn/10 text-warn ring-warn/25" : tone === "down" ? "bg-down/10 text-down ring-down/25" : "bg-info/10 text-info ring-info/20",
        className,
      )}
    >
      {tone === "warn" ? <AlertTriangle size={11} aria-hidden /> : <Info size={11} aria-hidden />}
      {flag.label}
    </span>
  );
}

const TOAST_ICON: Partial<Record<Tone, typeof Info>> = {
  up: CheckCircle2,
  down: XCircle,
  warn: AlertTriangle,
};
const TOAST_RING: Partial<Record<Tone, string>> = {
  up: "border-up/30",
  down: "border-down/30",
  warn: "border-warn/35",
  info: "border-info/30",
};

/** Toast stack (flags of a recorded decision, resolved predictions): fixed bottom-right, or `inline` inside a relative box. */
export function ReplayToasts({ toasts, onDismiss, inline }: { toasts: Toast[]; onDismiss: (id: string) => void; inline?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "pointer-events-none z-50 flex flex-col gap-2",
        // inline: over the bottom-left of the chart (the decision panel stays visible)
        inline ? "absolute bottom-10 left-3 w-[min(320px,calc(100%-1.5rem))]" : "fixed bottom-4 right-3 w-[min(340px,calc(100vw-1.5rem))] sm:right-4",
      )}
      style={inline ? { pointerEvents: "none" } : undefined}
    >
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.tone] ?? Info;
        return (
          <div
            key={t.id}
            className={cx(
              "glass-strong pointer-events-auto flex gap-2.5 rounded-xl border px-3 py-2.5 shadow-pop animate-slide-in-up",
              TOAST_RING[t.tone] ?? "border-white/10",
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" style={{ color: TONE_COLOR[t.tone] }} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text">{t.title}</div>
              {t.text && <div className="mt-0.5 text-xs leading-relaxed text-muted">{t.text}</div>}
            </div>
            <button
              type="button"
              aria-label="Затвори известието"
              onClick={() => onDismiss(t.id)}
              className="-mr-1 -mt-0.5 h-6 w-6 shrink-0 rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              <X size={13} className="mx-auto" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
