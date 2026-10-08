/*
 * Cells that render one field of a quote snapshot. A quote whose status is not "ok" never shows
 * numbers: it shows "N/A" (DATA NOT AVAILABLE, reason in the title), "Зарежда се…" or "On demand".
 * No hooks: render in Server Components too.
 */
import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader } from "lucide-react";

import { AI_STATUS_META, fmtCompact, fmtPctPlain, fmtQuotePrice, fmtUsdCompact, quoteOk, quoteState, trendMeta } from "@/components/market/model";
import type { AiStatus, Quote } from "@/components/market/types";
import { ChangePill, Sparkline } from "@/components/ui";
import { cx } from "@/lib/format";

/** Compact "N/A" / "Зарежда се…" / "On demand" chip for a quote that has no values. */
export function QuoteStatusChip({ quote, className }: { quote: Quote | null | undefined; className?: string }) {
  const s = quoteState(quote);
  if (s.kind === "ok") return null;
  if (s.kind === "missing") return <span className={cx("text-faint", className)}>—</span>;
  const title = s.kind === "na" || s.kind === "error" ? `DATA NOT AVAILABLE — ${s.detail ?? ""}` : (s.detail ?? undefined);
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] ring-1 ring-inset",
        s.kind === "pending" ? "bg-info/10 text-info ring-info/20" : "bg-white/[0.04] text-faint ring-white/10",
        className,
      )}
    >
      {s.kind === "pending" && <Loader size={10} strokeWidth={2.25} className="animate-spin" aria-hidden />}
      {s.label}
    </span>
  );
}

/** Last price (tabular) or the status chip. */
export function PriceCell({ quote, precision = 2, className }: { quote: Quote | null | undefined; precision?: number; className?: string }) {
  if (!quoteOk(quote) || quote.price === null) return <QuoteStatusChip quote={quote} className={className} />;
  return <span className={cx("num text-text", className)}>{fmtQuotePrice(quote.price, quote.precision ?? precision)}</span>;
}

/** 24h (or 7d) change pill; "—" when unknown. */
export function ChangeCell({ quote, field = "change_24h_pct", className }: { quote: Quote | null | undefined; field?: "change_24h_pct" | "change_7d_pct"; className?: string }) {
  if (!quoteOk(quote)) return <span className={cx("num text-xs text-faint", className)}>—</span>;
  return <ChangePill value={quote[field]} className={className} />;
}

/** 24h volume in USD (fallback: base units). */
export function VolumeCell({ quote, className }: { quote: Quote | null | undefined; className?: string }) {
  if (!quoteOk(quote)) return <span className={cx("num text-faint", className)}>—</span>;
  const text = quote.volume_24h_usd !== null ? fmtUsdCompact(quote.volume_24h_usd) : fmtCompact(quote.volume_24h);
  return <span className={cx("num text-muted", className)}>{text}</span>;
}

/** 24h range % ((high − low) / low). */
export function RangeCell({ quote, className }: { quote: Quote | null | undefined; className?: string }) {
  if (!quoteOk(quote)) return <span className={cx("num text-faint", className)}>—</span>;
  return <span className={cx("num text-muted", className)}>{fmtPctPlain(quote.range_24h_pct)}</span>;
}

export function QuoteSparkline({ quote, width = 72, height = 22, className }: { quote: Quote | null | undefined; width?: number; height?: number; className?: string }) {
  const data = quoteOk(quote) ? quote.sparkline : [];
  return <Sparkline data={data} width={width} height={height} className={className} />;
}

/** Uptrend / Downtrend / Sideways with an arrow; "—" when unknown. */
export function TrendBadge({ trend, className, compact }: { trend: string | null | undefined; className?: string; compact?: boolean }) {
  const m = trendMeta(trend);
  if (!m) return <span className={cx("text-xs text-faint", className)}>—</span>;
  const Icon = m.tone === "up" ? ArrowUpRight : m.tone === "down" ? ArrowDownRight : ArrowRight;
  const ink = m.tone === "up" ? "text-up" : m.tone === "down" ? "text-down" : "text-muted";
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", ink, className)} title={m.label}>
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      {compact ? <span className="sr-only">{m.label}</span> : m.label}
    </span>
  );
}

const AI_TONE: Record<string, string> = {
  up: "bg-up/10 text-up ring-up/25",
  down: "bg-down/10 text-down ring-down/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  neutral: "bg-white/[0.05] text-muted ring-white/10",
};

/** AI status of the watchlist (rule-based, educational): LONG SETUP / SHORT SETUP / WAIT / NO TRADE. */
export function AiStatusBadge({ status, pending, className }: { status: string | null | undefined; pending?: boolean; className?: string }) {
  if (!status) {
    return pending ? (
      <span className={cx("inline-flex items-center gap-1 text-[11px] text-info", className)}>
        <Loader size={11} strokeWidth={2.25} className="animate-spin" aria-hidden />
        AI…
      </span>
    ) : (
      <span className={cx("text-xs text-faint", className)}>—</span>
    );
  }
  const m = AI_STATUS_META[status as AiStatus];
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] ring-1 ring-inset",
        AI_TONE[m?.tone ?? "neutral"],
        className,
      )}
    >
      {status}
    </span>
  );
}
