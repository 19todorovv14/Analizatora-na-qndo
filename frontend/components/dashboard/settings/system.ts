/*
 * GET /api/system/data-sources and GET /api/system/ai — types + pure display helpers (unit-tested).
 * Neither endpoint ever returns a secret: keys are only reported as present (true) / missing (false).
 */
import type { SourceLike, SourceStatus } from "@/components/ui";

export type ClassProvider = { id: string; known: boolean; name: string; status: SourceStatus | string; problem: string | null; supported_instruments: number };

export type ClassSource = {
  asset_class: string;
  label: string;
  env: string;
  fallback_env: string | null;
  inherited: boolean;
  chain: string[];
  providers: ClassProvider[];
  source: SourceLike | null;
  status: SourceStatus | string;
  available: boolean;
  reason: string | null;
  instruments: { total: number; available: number; by_source: Record<string, number>; serving: Record<string, number>; supported_by: Record<string, number> };
  how_to_enable: string;
};

export type Reachability = {
  reachable: boolean | null;
  checked_at: number | null;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  stale: boolean;
};

export type ProviderInfo = Reachability & {
  id: string;
  name: string;
  status: SourceStatus | string;
  source: SourceLike | null;
  used_by: string[];
  configured: boolean;
  key_required: boolean;
  key_env: string | null;
  key_present: boolean | null;
  problem: string | null;
  local?: boolean;
  rate_limit: string;
  docs_url: string | null;
  note: string;
  how_to_enable: string;
};

export type AuxProvider = Partial<Reachability> & {
  provider: string;
  configured: boolean;
  status: SourceStatus | string;
  key_env: string;
  key_required: boolean;
  key_present: boolean | null;
  used_for: string;
  rate_limit: string;
  how_to_enable: string;
  docs_url?: string | null;
  disclaimer?: string;
};

export type CatalogSync = { id: number; provider: string; kind: string; status: string; count: number | null; started_ts: number | null; finished_ts: number | null; message: string | null };

export type DataSources = {
  as_of: number;
  keys_policy: string;
  paper_note: string;
  checked: string[];
  classes: ClassSource[];
  providers: Record<string, ProviderInfo>;
  catalog: {
    total: number;
    by_class: Record<string, number>;
    by_source: Record<string, number>;
    available: number;
    auto_sync: boolean;
    binance_quotes?: string[];
    twelvedata_countries?: string[];
    how_to_sync: string;
    last_syncs: CatalogSync[];
  };
  market_cap: AuxProvider;
  news: AuxProvider;
  warmup?: { enabled: boolean; running: boolean; passes?: number; last_pass_ts?: number | null; last_error?: string | null };
  health_checks: { enabled: boolean; ttl_seconds: number; method: string };
  how_to_enable: string[];
};

export type AiInfo = {
  provider: string;
  active: "offline" | "anthropic" | string;
  model: string | null;
  configured_model: string | null;
  effort: string | null;
  max_tokens: number | null;
  timeout_seconds: number | null;
  key_env: string;
  key_present: boolean;
  fallbacks: string;
  offline: { active: boolean; reason: string | null; explanation: string };
  status_note: string;
  output_sections: string[];
  modes: { key: string; label: string }[];
  safety_rules: { key: string; title: string; text: string }[];
  standard_disclaimer: string;
  setup_disclaimer: string;
  language: { code: string; note: string };
  explain_mode_default: boolean;
  keys_policy: string;
  how_to_enable: string;
};

export const STATUS_LABEL: Record<string, string> = { live: "LIVE", delayed: "DELAYED", demo: "DEMO", unavailable: "N/A" };

export function statusTone(status: string | null | undefined): "up" | "info" | "warn" | "neutral" {
  if (status === "live") return "up";
  if (status === "delayed") return "info";
  if (status === "demo") return "warn";
  return "neutral";
}

/** "да" / "не" / "—" (null = not applicable, e.g. a provider that needs no key). */
export function yesNo(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v ? "да" : "не";
}

/** Human reachability line for a provider health check. */
export function reachText(r: Partial<Reachability> | null | undefined): { text: string; tone: "up" | "down" | "neutral" } {
  if (!r || r.reachable === null || r.reachable === undefined) return { text: "непроверен", tone: "neutral" };
  if (r.reachable) {
    const ms = r.latency_ms !== null && r.latency_ms !== undefined ? ` · ${Math.round(r.latency_ms)} ms` : "";
    return { text: `достъпен${ms}${r.stale ? " (стара проверка)" : ""}`, tone: "up" };
  }
  const why = r.error || (r.http_status ? `HTTP ${r.http_status}` : "");
  return { text: `недостъпен${why ? ` — ${why}` : ""}`, tone: "down" };
}

/** "MARKET_DATA_CRYPTO=binance,twelvedata" — the server setting behind a class. */
export function chainText(c: Pick<ClassSource, "env" | "chain">): string {
  return `${c.env}=${c.chain.join(",") || "—"}`;
}

/** Share of a class's instruments that the configured chain can serve (0–100). */
export function coveragePct(c: Pick<ClassSource, "instruments">): number {
  const t = c.instruments?.total ?? 0;
  if (!t) return 0;
  return Math.round(((c.instruments.available ?? 0) / t) * 100);
}

/** Orders providers: the ones in use first (live → delayed → demo), then the rest. */
export function orderProviders(p: Record<string, ProviderInfo>): ProviderInfo[] {
  const rank = (x: ProviderInfo) => (x.used_by.length ? 0 : 1) * 10 + (x.status === "live" ? 0 : x.status === "delayed" ? 1 : x.status === "demo" ? 2 : 3);
  return Object.values(p).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/** Highlights ENV_VAR names in a how-to text: returns alternating [text, code, text, …] parts. */
export function splitEnv(text: string): { t: string; code: boolean }[] {
  const out: { t: string; code: boolean }[] = [];
  const re = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+(?:=[^\s,;)]*)?/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i), code: false });
    out.push({ t: m[0], code: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), code: false });
  return out;
}
