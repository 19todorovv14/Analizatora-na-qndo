export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function fmtPrice(v: number | null | undefined, precision = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtMoney(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = v < 0 ? "-" : signed && v > 0 ? "+" : "";
  return `${sign}$${s}`;
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtR(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}R`;
}

export function fmtTime(ts: number | null | undefined, withDate = true): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return withDate
    ? d.toLocaleString("bg-BG", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} мин`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)} ч`;
  return `${(h / 24).toFixed(1)} дни`;
}

export function pnlClass(v: number | null | undefined): string {
  if (!v) return "text-text";
  return v > 0 ? "text-up" : "text-down";
}

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export const TF_LABEL: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};
export const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

export function toDateInput(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function fromDateInput(v: string): number {
  return Math.floor(new Date(`${v}T00:00:00Z`).getTime() / 1000);
}
