/*
 * Pure helpers behind the "Strategy validation" card and the results header (unit-tested with node --test):
 * IS / OOS comparison rows and formatting, sensitivity sign flips, walk-forward bar geometry, cost labels and the
 * beginner plain-language reading of the key metrics.
 */
import { fmtMoney, fmtPct, fmtR } from "@/lib/format";

import { fmtPF, fmtSigned } from "./format";
import type { MetricsV2, OosComparisonRow, OutOfSample, RunSummary, WalkForwardWindow } from "./types";

/* ───────────────────────────────────────────── in-sample vs OOS */

/** Value (or delta) of an IS / OOS comparison row, formatted for its metric. */
export function fmtCmp(key: string, v: number | null | undefined, delta = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (key) {
    case "total_trades":
      return delta ? fmtSigned(v, 0) : String(Math.round(v));
    case "win_rate":
    case "return_pct":
    case "max_drawdown_pct":
      return delta ? `${fmtSigned(v, 1)} pp` : fmtPct(v, key === "return_pct" ? 2 : 1, key === "return_pct");
    case "profit_factor":
      return delta ? fmtSigned(Math.max(-99, Math.min(99, v))) : fmtPF(v);
    case "expectancy_r":
      return fmtR(v);
    case "net_pnl":
      return fmtMoney(v, true);
    default:
      return delta ? fmtSigned(v) : v.toFixed(2);
  }
}

/** Colour of a delta: lower drawdown is good, more / fewer trades is neutral. */
export function deltaTone(key: string, d: number | null | undefined): "text-up" | "text-down" | "text-muted" {
  if (d === null || d === undefined || !Number.isFinite(d) || d === 0 || key === "total_trades") return "text-muted";
  const good = key === "max_drawdown_pct" ? d < 0 : d > 0;
  return good ? "text-up" : "text-down";
}

const SUMMARY_KEYS: [keyof RunSummary, string][] = [
  ["total_trades", "Trades"],
  ["win_rate", "Win rate %"],
  ["profit_factor", "Profit factor"],
  ["expectancy_r", "Expectancy (R)"],
  ["net_pnl", "Net P/L"],
  ["max_drawdown_pct", "Max drawdown %"],
];

/** Comparison table rows: the backend's `comparison` (v2) or rows derived from the two v1 run summaries. */
export function comparisonRows(o: Pick<OutOfSample, "in_sample" | "out_of_sample" | "comparison">): OosComparisonRow[] {
  if (o.comparison?.length) return o.comparison;
  return SUMMARY_KEYS.map(([k, label]) => {
    const a = o.in_sample[k] as number | null;
    const b = o.out_of_sample[k] as number | null;
    const ok = a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b);
    return { key: k, label, in_sample: a, out_of_sample: b, delta: ok ? (b as number) - (a as number) : null };
  });
}

/* ───────────────────────────────────────── stress + sensitivity */

/** The main run as a RunSummary (first row of the stress / sensitivity table). */
export function baseSummary(m: MetricsV2): RunSummary {
  return {
    total_trades: m.total_trades,
    net_pnl: m.net_pnl,
    win_rate: m.win_rate,
    profit_factor: m.profit_factor,
    expectancy_r: m.expectancy_r,
    max_drawdown_pct: m.max_drawdown_pct,
    return_pct: m.return_pct,
  };
}

/** true when a parameter variant (with trades) flips the sign of the net result. */
export function flipsSign(base: Pick<RunSummary, "net_pnl">, variant: Pick<RunSummary, "net_pnl" | "total_trades">): boolean {
  return variant.total_trades > 0 && Math.sign(variant.net_pnl) !== Math.sign(base.net_pnl);
}

export function sensitivityFlips(base: Pick<RunSummary, "net_pnl">, variants: Pick<RunSummary, "net_pnl" | "total_trades">[]): number {
  return variants.filter((v) => flipsSign(base, v)).length;
}

/* ───────────────────────────────────────────── walk-forward bars */

export type WfBar = { index: number; value: number; top: number; height: number; positive: boolean; empty: boolean };

/**
 * Bar geometry (percent of the plot height) for the walk-forward chart. The zero line sits where the data needs it
 * (top when every window lost, bottom when every window won, proportional otherwise) so no half of the plot is
 * wasted; every bar keeps a visible minimum height.
 */
export function wfGeometry(windows: Pick<WalkForwardWindow, "index" | "return_pct" | "trades">[], minHeight = 1.5): { zero: number; bars: WfBar[] } {
  const vals = windows.map((w) => (Number.isFinite(w.return_pct ?? NaN) ? (w.return_pct as number) : 0));
  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const zero = (hi / span) * 100;
  const bars = windows.map((w, i) => {
    const v = vals[i];
    const h = Math.max((Math.abs(v) / span) * 100, minHeight);
    const top = v >= 0 ? Math.max(0, zero - h) : Math.min(zero, 100 - h);
    return { index: w.index, value: v, positive: v >= 0, empty: !w.trades, height: h, top };
  });
  return { zero, bars };
}

/* ───────────────────────────────────────────────────── costs */

/** Badge text for the costs share: "разходи = 34% от брутното" or "разходи = 4.7× брутната печалба". */
export function costShareLabel(share: number | null): string | null {
  if (share === null || !Number.isFinite(share)) return null;
  if (share >= 100) return `разходи = ${(share / 100).toFixed(1)}× брутната печалба`;
  return `разходи = ${share.toFixed(0)}% от брутното`;
}

/* ─────────────────────────────────────────── beginner reading */

/** Plain-language reading of the key numbers (beginner mode). */
export function plainReading(m: Pick<MetricsV2, "total_trades" | "winning_trades" | "win_rate" | "expectancy_r" | "max_drawdown_pct">): string[] {
  if (!m.total_trades) return ["Няма сделки — условията не са се изпълнили. Пробвай по-дълъг период или по-малко условия."];
  const out = [
    `${m.total_trades} сделки, от които ${m.winning_trades} печеливши (win rate ${fmtPct(m.win_rate, 0)}). Win rate сам по себе си не казва дали стратегията печели — важно е колко печели средно печелившата спрямо губещата.`,
  ];
  if (m.expectancy_r !== null && m.expectancy_r !== undefined)
    out.push(
      m.expectancy_r > 0
        ? `Expectancy ${fmtR(m.expectancy_r)}: средно всяка сделка е донесла ${m.expectancy_r.toFixed(2)} пъти риска. Положително, но малко предимство лесно изчезва при други пазарни условия.`
        : `Expectancy ${fmtR(m.expectancy_r)}: средно всяка сделка е губила част от риска. Правилата не са дали предимство в този период.`,
    );
  out.push(
    `Max drawdown ${fmtPct(m.max_drawdown_pct)}: в най-лошия момент сметката е била толкова под предишния си връх. Питай се дали би издържал(а) това психологически.`,
  );
  return out;
}

/** Tone of the max-drawdown tile: > 20% down, > 10% warn. */
export function drawdownTone(ddPct: number | null | undefined): "down" | "warn" | "neutral" {
  const d = Math.abs(ddPct ?? 0);
  return d > 20 ? "down" : d > 10 ? "warn" : "neutral";
}
