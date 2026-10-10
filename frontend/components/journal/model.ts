/*
 * Trading Journal v2 — types + pure helpers (filters, planned R:R, risk, review grade tone). Unit-tested.
 * API: GET/POST /api/journal, PUT/DELETE /api/journal/{id}, POST /api/journal/{id}/ai-review, GET /api/journal/stats.
 */

export type JournalAiReview = {
  title: string;
  kind: "trade" | "reflection" | string;
  symbol?: string | null;
  side?: string | null;
  summary: string;
  main_lesson?: string | null;
  did_well: string[];
  did_poorly: string[];
  questions: string[];
  planned_rr: number | null;
  r_multiple: number | null;
  stop_valid: boolean | null;
  process_score: number | null;
  grade: string | null;
  lessons?: string[];
  lesson_refs: { slug: string; title: string; href: string }[];
  disclaimer?: string;
  provider?: string;
  generated_ts?: number;
  entry_id?: number;
  note?: string | null;
  linked: { position_id: string; symbol: string; side: string; result: number | null; r_multiple: number | null; closed: boolean } | null;
  what_happened?: string | string[];
};

export type JournalEntry = {
  id?: number;
  trade_id?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  side?: string | null;
  setup?: string;
  reason?: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  emotion?: string;
  confidence?: number | null;
  result?: number | null;
  r_multiple?: number | null;
  lesson?: string;
  tags?: string[];
  mistakes?: string[];
  /** data URL; the list endpoint may send `true` when it omits the image */
  screenshot?: string | null | boolean;
  created_ts?: number;
  updated_ts?: number;
  /* v2 */
  exit_price?: number | null;
  strategy?: string | null;
  risk_amount?: number | null;
  notes?: string | null;
  ai_review?: JournalAiReview | null;
};

export type JournalGroup = { key: string; trades: number; net_pnl: number; win_rate: number | null; average_r?: number | null };

export type JournalStats = {
  entries: number;
  trades: number;
  most_profitable_setup: JournalGroup | null;
  worst_setup: JournalGroup | null;
  setups: JournalGroup[];
  most_common_mistake: { mistake: string; count: number } | null;
  mistakes: { mistake: string; count: number }[];
  average_holding_seconds: number | null;
  best_timeframe: JournalGroup | null;
  worst_timeframe: JournalGroup | null;
  timeframes?: JournalGroup[];
  average_risk_pct: number | null;
  average_r: number | null;
  emotions: Record<string, number>;
  confidence_vs_r: Record<string, number>;
  strategies?: JournalGroup[];
  best_strategy?: JournalGroup | null;
  worst_strategy?: JournalGroup | null;
  entries_by_strategy?: { key: string; entries: number; with_result: number; net_result: number | null; win_rate: number | null; average_r: number | null }[];
};

/* ───────────────────────────────────────────────────────── filters */

export type ResultFilter = "all" | "win" | "loss" | "open";

export type JournalFilters = {
  q: string;
  result: ResultFilter;
  symbol: string;
  strategy: string;
  reviewed: boolean;
};

export const EMPTY_FILTERS: JournalFilters = { q: "", result: "all", symbol: "", strategy: "", reviewed: false };

/** Strategy label used for grouping / filtering: strategy, else setup, else "". */
export function strategyOf(e: JournalEntry): string {
  return (e.strategy || e.setup || "").trim();
}

export function resultKind(e: JournalEntry): "win" | "loss" | "open" {
  if (e.result === null || e.result === undefined || Number.isNaN(e.result)) return "open";
  return e.result > 0 ? "win" : e.result < 0 ? "loss" : "open";
}

export function filterEntries(entries: JournalEntry[], f: JournalFilters): JournalEntry[] {
  const q = f.q.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.result !== "all" && resultKind(e) !== f.result) return false;
    if (f.symbol && (e.symbol ?? "") !== f.symbol) return false;
    if (f.strategy && strategyOf(e) !== f.strategy) return false;
    if (f.reviewed && !e.ai_review) return false;
    if (q) {
      const hay = [e.symbol, e.setup, e.strategy, e.reason, e.notes, e.lesson, e.emotion, ...(e.tags ?? []), ...(e.mistakes ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Sorted distinct non-empty values (for the filter selects). */
export function distinct(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function activeFilterCount(f: JournalFilters): number {
  return (f.q.trim() ? 1 : 0) + (f.result !== "all" ? 1 : 0) + (f.symbol ? 1 : 0) + (f.strategy ? 1 : 0) + (f.reviewed ? 1 : 0);
}

/* ──────────────────────────────────────────────────────── trade maths */

/** Planned reward:risk from entry / stop / target (null when the stop is missing or on the wrong side). */
export function plannedRR(e: Pick<JournalEntry, "entry" | "stop" | "target" | "side">): number | null {
  const { entry, stop, target } = e;
  if (!entry || !stop || !target) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!risk) return null;
  if (e.side === "long" && (stop >= entry || target <= entry)) return null;
  if (e.side === "short" && (stop <= entry || target >= entry)) return null;
  return reward / risk;
}

/** Stop on the protective side of the entry? null when unknown (no side / stop / entry). */
export function stopValid(e: Pick<JournalEntry, "entry" | "stop" | "side">): boolean | null {
  if (!e.entry || !e.stop || (e.side !== "long" && e.side !== "short")) return null;
  return e.side === "long" ? e.stop < e.entry : e.stop > e.entry;
}

export function gradeTone(grade: string | null | undefined): "up" | "info" | "warn" | "down" | "neutral" {
  switch ((grade ?? "").toUpperCase()) {
    case "A":
      return "up";
    case "B":
      return "info";
    case "C":
      return "warn";
    case "D":
    case "F":
      return "down";
    default:
      return "neutral";
  }
}

/** Body for POST / PUT /api/journal from the form state (drops read-only and empty fields). */
export function journalBody(e: JournalEntry, tagsText: string): Record<string, unknown> {
  const clean = (v: string | null | undefined) => (v ?? "").trim();
  return {
    trade_id: e.trade_id || null,
    symbol: clean(e.symbol) || null,
    timeframe: clean(e.timeframe) || null,
    side: e.side || null,
    setup: clean(e.setup),
    reason: e.reason ?? "",
    entry: e.entry ?? null,
    stop: e.stop ?? null,
    target: e.target ?? null,
    emotion: e.emotion ?? "",
    confidence: e.confidence ?? null,
    // a linked trade owns the result (the backend fills it); manual entries send their own
    result: e.trade_id ? null : (e.result ?? null),
    lesson: e.lesson ?? "",
    tags: tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    mistakes: e.mistakes ?? [],
    screenshot: typeof e.screenshot === "string" ? e.screenshot : undefined,
    exit_price: e.exit_price ?? null,
    strategy: clean(e.strategy) || null,
    risk_amount: e.risk_amount ?? null,
    notes: clean(e.notes) || null,
  };
}

/** "" → null, "1,5" → 1.5, garbage → NaN (the form shows the error). */
export function parseNum(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (s === "") return null;
  return Number(s);
}
