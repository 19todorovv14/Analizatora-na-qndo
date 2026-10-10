/*
 * Pure helpers shared by the S7 analytics pages (Statistics, Performance, Risk, Dashboard, Journal).
 * No React here — unit-tested with Node's built-in runner (components/dashboard/__tests__).
 */
import type {
  BreakdownKey,
  BreakdownRow,
  CoachCheck,
  ConfidenceStat,
  MonthlyRow,
  Performance,
  RBucket,
  RiskStatus,
  SampleLevel,
} from "@/components/analytics/types";

export type ToneKey = "up" | "down" | "warn" | "info" | "neutral" | "accent";

/* ───────────────────────────────────────────────────── formatting */

/** The backend sends profit factor 1e9 when there are no losing trades → "∞". */
export const PF_INFINITE = 1e8;

export function fmtPF(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v >= PF_INFINITE) return "∞";
  return v.toFixed(2);
}

/** Profit factor tone: < 1 loses money, 1–1.3 thin, > 1.3 healthy (still not a promise). */
export function pfTone(v: number | null | undefined): ToneKey {
  if (v === null || v === undefined || Number.isNaN(v)) return "neutral";
  if (v < 1) return "down";
  if (v < 1.3) return "warn";
  return "up";
}

export function signTone(v: number | null | undefined): ToneKey {
  if (!v || Number.isNaN(v)) return "neutral";
  return v > 0 ? "up" : "down";
}

/** "3ч 20м", "2д 4ч", "45м", "30с". */
export function fmtHold(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}с`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}ч ${m % 60}м` : `${h}ч`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}д ${h % 24}ч` : `${d}д`;
}

const EXIT_LABEL: Record<string, string> = {
  take_profit: "Take profit",
  stop_loss: "Stop loss",
  trailing_stop: "Trailing stop",
  manual: "Ръчно",
  liquidation: "Liquidation",
  stop_out: "Stop out",
  signal: "Сигнал",
  time: "Време",
  end_of_data: "Край на данните",
};

export function exitLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return EXIT_LABEL[reason] ?? reason.replace(/_/g, " ");
}

/* ─────────────────────────────────────────────────────────── risk */

export function riskTone(status: string | null | undefined): ToneKey {
  if (status === "OK") return "up";
  if (status === "WARNING") return "warn";
  if (status === "LIMIT") return "down";
  return "neutral";
}

/** value as a 0–100+ share of limit (null when the limit is missing / zero). */
export function limitShare(value: number | null | undefined, limit: number | null | undefined): number | null {
  if (value === null || value === undefined || !limit || Number.isNaN(value)) return null;
  return Math.max(0, (value / limit) * 100);
}

/** Meter tone for "how much of a limit is used": < 70% fine, < 100% close, ≥ 100% hit. */
export function limitTone(pct: number | null | undefined): "up" | "warn" | "down" {
  if (pct === null || pct === undefined) return "up";
  if (pct >= 100) return "down";
  if (pct >= 70) return "warn";
  return "up";
}

export function dailyLossUse(st: Pick<RiskStatus, "day_loss_pct" | "rules">): number | null {
  return limitShare(st.day_loss_pct, st.rules?.max_daily_loss_pct);
}

export function exposureLimit(st: Pick<RiskStatus, "max_exposure_pct" | "rules">): number {
  return st.max_exposure_pct ?? st.rules?.max_portfolio_exposure_pct ?? 0;
}

export function exposureUse(st: Pick<RiskStatus, "exposure_pct" | "max_exposure_pct" | "rules">): number | null {
  return limitShare(st.exposure_pct, exposureLimit(st));
}

/** Margin level as a percentage. The API sends a ratio (1.5 = 150%) in `margin_level`; null when flat. */
export function marginLevelPct(level: number | null | undefined, levelPct?: number | null): number | null {
  if (levelPct !== null && levelPct !== undefined && Number.isFinite(levelPct)) return levelPct;
  if (level === null || level === undefined || !Number.isFinite(level)) return null;
  return level * 100;
}

export function marginTone(pct: number | null): ToneKey {
  if (pct === null) return "neutral";
  if (pct < 100) return "down";
  if (pct < 200) return "warn";
  return "up";
}

/* ──────────────────────────────────────────────── sample & confidence */

const SAMPLE: Record<string, { label: string; tone: ToneKey }> = {
  none: { label: "Няма сделки", tone: "neutral" },
  very_small: { label: "Много малка извадка", tone: "warn" },
  small: { label: "Малка извадка", tone: "warn" },
  moderate: { label: "Умерена извадка", tone: "info" },
  large: { label: "Голяма извадка", tone: "up" },
};

export function sampleMeta(level: SampleLevel | null | undefined): { label: string; tone: ToneKey } {
  return SAMPLE[level ?? "none"] ?? { label: String(level), tone: "neutral" };
}

/** "95% CI: -0.98R … +1.41R" — null when the interval is missing. */
export function ciText(stat: ConfidenceStat | null | undefined, fmt: (v: number) => string): string | null {
  const ci = stat?.ci95;
  if (!ci || ci.length !== 2 || ci.some((x) => x === null || x === undefined || Number.isNaN(x))) return null;
  return `95% CI: ${fmt(ci[0])} … ${fmt(ci[1])}`;
}

/** True when the 95% interval of a value straddles `zero` (no evidence of an edge yet). */
export function ciIncludes(stat: ConfidenceStat | null | undefined, zero = 0): boolean {
  const ci = stat?.ci95;
  if (!ci || ci.length !== 2) return true;
  return ci[0] <= zero && ci[1] >= zero;
}

/* ───────────────────────────────────────────────────── breakdowns */

export const BREAKDOWN_DIMS: { key: BreakdownKey; label: string; hint: string }[] = [
  { key: "asset", label: "Актив", hint: "Резултат по инструмент." },
  { key: "asset_class", label: "Клас", hint: "Крипто, акции, Forex, индекси, стоки." },
  { key: "timeframe", label: "Timeframe", hint: "На кой timeframe е взето решението за вход." },
  { key: "setup", label: "Setup", hint: "Етикетът на setup-а от сделката или журнала." },
  { key: "strategy", label: "Стратегия", hint: "Стратегия / бот, ако сделката има такъв етикет." },
  { key: "side", label: "Long / Short", hint: "Посока на позицията." },
  { key: "weekday", label: "Ден", hint: "Ден от седмицата на входа (UTC)." },
  { key: "hour", label: "Час (UTC)", hint: "Час на входа по UTC." },
];

export type BreakdownSort = "default" | "trades" | "net_pnl" | "win_rate" | "average_r";

/** Sort rows (stable). "default" keeps the API order (natural order for weekday / hour). */
export function sortBreakdown(rows: BreakdownRow[], by: BreakdownSort): BreakdownRow[] {
  if (by === "default") return rows.slice();
  const val = (r: BreakdownRow): number => {
    const v = r[by];
    return v === null || v === undefined || Number.isNaN(v as number) ? -Infinity : (v as number);
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => val(b.r) - val(a.r) || a.i - b.i)
    .map((x) => x.r);
}

/** Largest |net_pnl| of a breakdown (for the inline bars); 0 when empty. */
export function maxAbsPnl(rows: BreakdownRow[]): number {
  return rows.reduce((m, r) => Math.max(m, Math.abs(r.net_pnl || 0)), 0);
}

/* ───────────────────────────────────────────────── monthly returns */

export const MONTHS_BG = ["Яну", "Фев", "Мар", "Апр", "Май", "Юни", "Юли", "Авг", "Сеп", "Окт", "Ное", "Дек"];

/** Largest |return %| (or |pnl| when return % is missing) across all month cells. */
export function monthlyScale(rows: MonthlyRow[]): number {
  let m = 0;
  for (const y of rows) for (const c of y.months) if (c) m = Math.max(m, Math.abs(c.return_pct ?? c.pnl ?? 0));
  return m;
}

/**
 * Heat colour of a month cell as CSS (token-based color-mix): green for gains, red for losses, the
 * intensity proportional to |value| / scale (10%…55%). Null cells and zeros stay neutral.
 */
export function heatStyle(value: number | null | undefined, scale: number): { backgroundColor?: string } {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0 || !scale) return {};
  const strength = Math.round(10 + 45 * Math.min(1, Math.abs(value) / scale));
  const token = value > 0 ? "--color-up" : "--color-down";
  return { backgroundColor: `color-mix(in srgb, var(${token}) ${strength}%, transparent)` };
}

/* ──────────────────────────────────────────────── R distribution */

export function bucketTone(b: Pick<RBucket, "from" | "to">): "up" | "down" | "neutral" {
  if (b.to !== null && b.to <= 0) return "down";
  if (b.from !== null && b.from >= 0) return "up";
  return "neutral";
}

/** Compact axis label of an R bucket: "<-2", "-1…-0.5", "≥3". */
export function bucketShort(b: Pick<RBucket, "from" | "to">): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  if (b.from === null && b.to !== null) return `<${n(b.to)}`;
  if (b.to === null && b.from !== null) return `≥${n(b.from)}`;
  if (b.from !== null && b.to !== null) return `${n(b.from)}…${n(b.to)}`;
  return "—";
}

export function maxBucket(buckets: RBucket[]): number {
  return buckets.reduce((m, b) => Math.max(m, b.count), 0);
}

/* ─────────────────────────────────────────────────────── streaks */

export function currentStreakText(s: Performance["streaks"] | null | undefined): string {
  const c = s?.current;
  if (!c || !c.kind || !c.length) return "—";
  const word = c.kind === "win" ? (c.length === 1 ? "печеливша" : "печеливши") : c.length === 1 ? "губеща" : "губещи";
  return `${c.length} ${word} подред`;
}

/* ─────────────────────────────────────────────────── coach checks */

const CHECK: Record<string, { label: string; tone: ToneKey }> = {
  found: { label: "Засечено", tone: "warn" },
  ok: { label: "OK", tone: "up" },
  insufficient_data: { label: "Малко данни", tone: "neutral" },
};

export function checkMeta(status: CoachCheck["status"]): { label: string; tone: ToneKey } {
  return CHECK[status] ?? { label: status, tone: "neutral" };
}

/** Coach checks ordered: found first, then OK, then not-enough-data (stable inside each group). */
export function orderChecks(checks: CoachCheck[]): CoachCheck[] {
  const rank = (s: string) => (s === "found" ? 0 : s === "ok" ? 1 : 2);
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.status) - rank(b.c.status) || a.i - b.i)
    .map((x) => x.c);
}

/** Discipline score tone (0–100). */
export function scoreTone(v: number | null | undefined): "up" | "warn" | "down" | "neutral" {
  if (v === null || v === undefined || Number.isNaN(v)) return "neutral";
  if (v >= 80) return "up";
  if (v >= 50) return "warn";
  return "down";
}
