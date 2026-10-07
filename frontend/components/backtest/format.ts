import type { Tone } from "@/components/ui";

/** Profit factor: the backend sends 1e9 for "no losing trades" (∞). */
export function fmtPF(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v > 1e6) return "∞";
  return v.toFixed(2);
}

export function pfTone(v: number | null | undefined): Tone {
  if (v === null || v === undefined || !Number.isFinite(v)) return "neutral";
  return v > 1 ? "up" : v < 1 ? "down" : "neutral";
}

export function signTone(v: number | null | undefined): Tone {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "neutral";
  return v > 0 ? "up" : "down";
}

export const EXIT_LABEL: Record<string, string> = {
  stop_loss: "Stop loss",
  take_profit: "Take profit",
  exit_signal: "Exit rule",
  end_of_test: "End of test",
  end_of_window: "End of window",
  manual: "Manual",
  liquidation: "Liquidation",
};

export function exitTone(reason: string): Tone {
  if (reason === "take_profit") return "up";
  if (reason === "stop_loss" || reason === "liquidation") return "down";
  if (reason === "exit_signal") return "info";
  return "neutral";
}

export const REGIME_BAR: Record<string, string> = {
  TRENDING_UP: "bg-up/70",
  TRENDING_DOWN: "bg-down/70",
  RANGING: "bg-info/70",
  HIGH_VOLATILITY: "bg-warn/70",
  LOW_VOLATILITY: "bg-violet/60",
  UNCLEAR: "bg-white/25",
};

/** "12 дни" / "5 ч" / "3 седм." from a bar count and a timeframe in seconds. */
export function barsToText(bars: number | null | undefined, tfSeconds: number | undefined): string {
  if (bars === null || bars === undefined || !Number.isFinite(bars)) return "—";
  if (!tfSeconds) return `${bars} свещи`;
  const hours = (bars * tfSeconds) / 3600;
  if (hours < 48) return `${Math.round(hours)} ч`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)} дни`;
  return `${(days / 30.44).toFixed(1)} мес.`;
}

/** Number with sign, fixed digits ("+2.45" / "-0.31"). */
export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

/**
 * Walk-forward verdict badge. The backend calls BOTH "≥ 75% of windows positive" and "≤ 25% positive"
 * `consistent` (stable sign), so the tone must come from the profitable fraction: consistently negative
 * windows are a red flag, not a green one.
 */
export function wfVerdict(wf: {
  verdict: string;
  available?: boolean;
  profitable_fraction?: number | null;
  windows?: { profitable: boolean }[];
}): { label: string; tone: Tone } {
  if (wf.available === false || wf.verdict === "insufficient") return { label: "insufficient data", tone: "neutral" };
  const n = wf.windows?.length ?? 0;
  const fraction = wf.profitable_fraction ?? (n ? (wf.windows ?? []).filter((w) => w.profitable).length / n : null);
  if (wf.verdict === "consistent") {
    if (fraction !== null && fraction < 0.5) return { label: "consistently negative", tone: "down" };
    return { label: "consistent", tone: "up" };
  }
  if (wf.verdict === "inconsistent") return { label: "inconsistent", tone: "warn" };
  return { label: wf.verdict.replace(/_/g, " "), tone: "neutral" };
}

/** Overfitting risk → badge tone. */
export function riskTone(risk: string | null | undefined): Tone {
  return risk === "LOW" ? "up" : risk === "MEDIUM" ? "warn" : risk === "HIGH" ? "down" : "neutral";
}

/** Share of fees + slippage in the gross profit (null when there is no gross profit to eat into). */
export function costShare(c: { fees: number; slippage_est: number; gross_pnl_before_fees: number }): number | null {
  if (!(c.gross_pnl_before_fees > 0)) return null;
  return Math.min(999, ((c.fees + c.slippage_est) / c.gross_pnl_before_fees) * 100);
}
