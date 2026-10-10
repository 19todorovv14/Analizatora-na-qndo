/*
 * Pure helpers of the TRADING COMMAND CENTER (/dashboard). No React — unit-tested.
 */
import type { DashboardData, DashLearning, Insight, MarketBlock, MarketClass, NextAction } from "@/components/dashboard/types";
import type { MarketItem } from "@/components/market/types";

/** "Добро утро" / "Добър ден" / "Добър вечер" by the viewer's local hour. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Добро утро";
  if (hour >= 12 && hour < 18) return "Добър ден";
  return "Добър вечер";
}

export type Cta = { label: string; href: string; hint: string };

/**
 * Primary + secondary call to action. LEARN workspace → continue the learning path (next lesson /
 * quiz / lab); TRADE workspace → the paper trading terminal. A brand-new user in TRADE mode still
 * gets "Първа paper сделка" as the primary action.
 */
export function primaryCtas(mode: "learn" | "trade", data: Pick<DashboardData, "learning" | "recent_trades" | "open_positions">): {
  primary: Cta;
  secondary: Cta;
} {
  const next = data.learning?.next;
  const learn: Cta = next?.href
    ? { label: "Продължи обучението", href: next.href, hint: next.title }
    : { label: "Към Academy", href: "/learn", hint: "Learning path" };
  const newTrader = !data.recent_trades?.length && !data.open_positions?.length;
  const trade: Cta = newTrader
    ? { label: "Първа paper сделка", href: "/trade", hint: "Виртуални пари — без реален риск" }
    : { label: "Отвори Paper Trading", href: "/trade", hint: "Терминал с виртуални пари" };
  return mode === "trade" ? { primary: trade, secondary: learn } : { primary: learn, secondary: trade };
}

/** A new user: no trades, no open positions and no completed lessons. */
export function isNewUser(data: Pick<DashboardData, "recent_trades" | "open_positions" | "learning">): boolean {
  return !data.recent_trades?.length && !data.open_positions?.length && !(data.learning?.lessons_completed ?? 0);
}

export const MOVER_TABS = [
  { key: "gainers", label: "Gainers" },
  { key: "losers", label: "Losers" },
  { key: "most_volume", label: "Volume" },
] as const;

export type MoverTab = (typeof MOVER_TABS)[number]["key"];

export function moverItems(market: MarketBlock | null | undefined, tab: MoverTab): MarketItem[] {
  return (market?.movers?.[tab] ?? []).slice(0, 5);
}

/** Breadth of a class tile: share of advancers among ranked instruments (0–100) or null. */
export function breadth(c: Pick<MarketClass, "advancers" | "decliners">): number | null {
  const n = (c.advancers ?? 0) + (c.decliners ?? 0);
  if (!n) return null;
  return Math.round((c.advancers / n) * 100);
}

export type ClassState = "ok" | "unavailable" | "warming" | "plan";

/** Display state of a class tile from its availability code. */
export function classState(c: Pick<MarketClass, "available" | "code" | "ranked">): ClassState {
  if (c.code === "WARMING") return "warming";
  if (c.code === "PLAN_LIMIT") return "plan";
  if (!c.available || c.code === "DATA_NOT_AVAILABLE") return "unavailable";
  if (!c.ranked) return "warming";
  return "ok";
}

/** Insights in display order: warnings first, then market, then the next step (stable). */
export function orderInsights(items: Insight[]): Insight[] {
  const rank = (i: Insight) => (i.kind === "behavior" ? (i.severity === "warn" ? 0 : 1) : i.kind === "market" ? 2 : 3);
  return items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => rank(a.it) - rank(b.it) || a.idx - b.idx)
    .map((x) => x.it);
}

/** Next actions without the ones the primary CTA already covers (same href). */
export function extraActions(actions: NextAction[] | undefined, primaryHref: string): NextAction[] {
  return (actions ?? []).filter((a) => a.href !== primaryHref).slice(0, 4);
}

export function xpPercent(l: Pick<DashLearning, "xp_progress">): number {
  const p = l.xp_progress?.percent;
  return p === undefined || p === null || Number.isNaN(p) ? 0 : Math.max(0, Math.min(100, p));
}

export function lessonsPercent(l: Pick<DashLearning, "lessons_completed" | "lessons_total">): number {
  if (!l.lessons_total) return 0;
  return Math.round((l.lessons_completed / l.lessons_total) * 100);
}
