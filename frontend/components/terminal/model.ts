/*
 * Terminal model — pure helpers (no React) shared by TerminalLayout, the terminal hotkeys and the
 * session clock. Unit-tested in components/terminal/__tests__.
 */
import { normSymbol } from "@/components/charts/chartMath";
import { TOOL_HOTKEYS, type Tool } from "@/components/charts/drawings";
import type { TicketPrefill } from "@/components/trading/ticket";
import { TIMEFRAMES } from "@/lib/format";
import { parseNum, type OrderSide } from "@/lib/sizing";

/* ───────────────────────────────────────────────────────── layout */

/** Desktop terminal (grid with side + bottom panels) from this width up; below it the right panel is a drawer. */
export const LG_QUERY = "(min-width: 1024px)";
/** Phones: the right panel opens as a bottom sheet (tablets: a side drawer). */
export const SM_QUERY = "(min-width: 640px)";

export type PanelLimits = { def: number; min: number; max: number };
export const RIGHT_LIMITS: PanelLimits = { def: 340, min: 260, max: 600 };
export const BOTTOM_LIMITS: PanelLimits = { def: 220, min: 120, max: 560 };
/** width of the collapsed right rail (tab icons) */
export const RAIL_WIDTH = 44;
/** resize handle track (px) */
export const HANDLE = 6;
/** the chart keeps at least this much room when panels are dragged wide / tall */
export const MIN_CHART_WIDTH = 360;
export const MIN_CHART_HEIGHT = 220;

export type TermPart = "right" | "bottom" | "right-open" | "bottom-open" | "right-tab" | "bottom-tab";

/** localStorage key of a persisted terminal setting, per route: "ta-term:charts:right". */
export function termKey(route: string, part: TermPart): string {
  return `ta-term:${route}:${part}`;
}

/** Clamp a stored panel size to its limits and to the room left for the chart (`available` px, if known). */
export function fitPanel(size: number, limits: PanelLimits, available?: number | null, reserve = 0): number {
  const v = Number.isFinite(size) ? size : limits.def;
  let max = limits.max;
  if (available !== undefined && available !== null && Number.isFinite(available) && available > 0) {
    max = Math.min(max, Math.max(limits.min, available - reserve));
  }
  return Math.round(Math.min(max, Math.max(limits.min, v)));
}

export type GridInput = {
  hasLeft: boolean;
  rightOpen: boolean;
  rightSize: number;
  bottomOpen: boolean;
  bottomSize: number;
};

/**
 * CSS grid of the desktop terminal. Areas: top / left / chart / right / bottom + the two resize
 * handles (rh, bh). The right panel spans chart + bottom rows; a collapsed right panel keeps a rail,
 * a collapsed bottom panel keeps its tab header (row height auto).
 */
export function gridTemplate(g: GridInput): { columns: string; rows: string; areas: string } {
  const right = g.rightOpen ? `${HANDLE}px ${Math.round(g.rightSize)}px` : `0px ${RAIL_WIDTH}px`;
  const bottom = g.bottomOpen ? `${HANDLE}px ${Math.round(g.bottomSize)}px` : "0px auto";
  const columns = `${g.hasLeft ? "auto " : ""}minmax(0,1fr) ${right}`;
  const rows = `auto minmax(0,1fr) ${bottom}`;
  const rowsAreas = g.hasLeft
    ? ['"top top top top"', '"left chart rh right"', '"bh bh rh right"', '"bottom bottom rh right"']
    : ['"top top top"', '"chart rh right"', '"bh rh right"', '"bottom rh right"'];
  return { columns, rows, areas: rowsAreas.join(" ") };
}

/* ───────────────────────────────────────────────────────── hotkeys */

export type HotkeyFn = () => void;

/** Alt+1 … Alt+8 → the timeframes 1m … 1W (same order as the timeframe bar). */
export function timeframeBindings(onTimeframe: (tf: string) => void): Record<string, HotkeyFn> {
  const out: Record<string, HotkeyFn> = {};
  TIMEFRAMES.forEach((tf, i) => {
    if (i < 9) out[`alt+${i + 1}`] = () => onTimeframe(tf);
  });
  return out;
}

export type LetterActions = {
  onTool?: (t: Tool) => void;
  onSide?: (side: "buy" | "sell") => void;
  toggleRight?: () => void;
  toggleBottom?: () => void;
};

/**
 * Single-key bindings: H / T / R / M drawing tools, B / S order side, "]" right panel, "\" bottom
 * panel. `skip()` lets the caller ignore a key that completes a shell "g x" navigation sequence.
 */
export function letterBindings(a: LetterActions, skip: () => boolean = () => false): Record<string, HotkeyFn> {
  const out: Record<string, HotkeyFn> = {};
  const guard = (fn: HotkeyFn): HotkeyFn => () => {
    if (!skip()) fn();
  };
  if (a.onTool) {
    const onTool = a.onTool;
    for (const [tool, key] of Object.entries(TOOL_HOTKEYS) as [Tool, string][]) out[key] = guard(() => onTool(tool));
  }
  if (a.onSide) {
    const onSide = a.onSide;
    out.b = guard(() => onSide("buy"));
    out.s = guard(() => onSide("sell"));
  }
  if (a.toggleRight) out["]"] = guard(a.toggleRight);
  if (a.toggleBottom) out["\\"] = guard(a.toggleBottom);
  return out;
}

/** True when the previous key was a lone "g" pressed less than `windowMs` ago (shell "g x" navigation). */
export function isNavSequence(prev: { key: string; code?: string; t: number } | null, now: number, windowMs = 800): boolean {
  if (!prev) return false;
  return (prev.key === "g" || prev.code === "KeyG") && now - prev.t <= windowMs;
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/**
 * Remembers the key before the current one (feed it every keydown in the capture phase) so a terminal
 * letter binding can step aside when it completes a shell "g x" navigation sequence.
 */
export function createNavTracker(clock: () => number = () => performance.now()) {
  let prev: { key: string; code: string; t: number } | null = null;
  let last: { key: string; code: string; t: number } | null = null;
  return {
    record(e: { key: string; code?: string; repeat?: boolean }) {
      if (e.repeat || MODIFIERS.has(e.key)) return;
      prev = last;
      last = { key: e.key.toLowerCase(), code: e.code ?? "", t: clock() };
    },
    /** true while the current key is the second key of "g x" */
    skip(): boolean {
      return isNavSequence(prev, clock());
    },
  };
}

/* ───────────────────────────────────────────────────────── session clock */

const TF_SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
/** Monday 00:00 UTC offset of the unix epoch (1970-01-01 was a Thursday) */
const WEEK_OFFSET = 4 * 86400;

/** Seconds until the current bar of `timeframe` closes (UTC-aligned bars; weekly bars start Monday). */
export function barCloseIn(now: number, timeframe: string): number | null {
  const step = TF_SEC[timeframe];
  if (!step || !Number.isFinite(now) || now <= 0) return null;
  const shifted = timeframe === "1w" ? now - WEEK_OFFSET : now;
  const rem = step - (((shifted % step) + step) % step);
  return rem === step ? step : rem;
}

/** "mm:ss" (< 1 h), "h:mm:ss" (< 1 day) or "Nd hh:mm". */
export function fmtCountdown(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p2(h)}:${p2(m)}`;
  if (h > 0) return `${h}:${p2(m)}:${p2(ss)}`;
  return `${p2(m)}:${p2(ss)}`;
}

/** "14:05:09 UTC" */
export function fmtUtcClock(now: number): string {
  if (!Number.isFinite(now) || now <= 0) return "--:--:-- UTC";
  const d = new Date(now * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC`;
}

/** File name of a chart screenshot: "BTC-USDT_1h_2026-10-08_1405.png" */
export function screenshotName(symbol: string, timeframe: string, now: number, ext = "png"): string {
  const d = new Date((Number.isFinite(now) && now > 0 ? now : 0) * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}_${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
  return `${symbol.replace(/[^A-Za-z0-9]+/g, "-")}_${timeframe}_${stamp}.${ext}`;
}

/** Parameters of a terminal link (/charts?…, /trade?…). */
export type TerminalQuery = {
  symbol: string | null;
  timeframe: string | null;
  /** order levels to PREFILL the ticket with (null = none in the link) — never placed automatically */
  order: TicketPrefill | null;
};

function querySide(raw: string | null): OrderSide | null {
  switch (raw?.trim().toLowerCase()) {
    case "buy":
    case "long":
      return "buy";
    case "sell":
    case "short":
      return "sell";
    default:
      return null;
  }
}

function queryPrice(raw: string | null): number | null {
  const v = parseNum(raw);
  return v !== null && v > 0 ? v : null;
}

/**
 * Terminal link parameters: `?symbol=&tf=` plus the optional order prefill
 * `side=buy|sell (long|short)&entry=&stop=&target=&leverage=` (Trade Simulator → "Отвори в Paper Trading").
 * Invalid values are ignored one by one; leverage below 1x is ignored, above 100x capped.
 */
export function readTerminalQuery(search: string): TerminalQuery {
  const p = new URLSearchParams(search);
  const symbol = p.get("symbol")?.trim() || null;
  const tf = p.get("tf") || p.get("timeframe");
  const lev = parseNum(p.get("leverage")?.trim().replace(/x$/i, "") ?? null);
  const order: TicketPrefill = {
    side: querySide(p.get("side")),
    entry: queryPrice(p.get("entry")),
    stop: queryPrice(p.get("stop")),
    target: queryPrice(p.get("target")),
    leverage: lev !== null && lev >= 1 ? Math.min(lev, 100) : null,
  };
  const hasOrder = Object.values(order).some((v) => v !== null);
  return { symbol, timeframe: tf && (TIMEFRAMES as readonly string[]).includes(tf) ? tf : null, order: hasOrder ? order : null };
}

/**
 * A queued link prefill: "apply" once the ticket is on the linked instrument and its parameters (decimals,
 * bid / ask, max leverage) arrived or failed to load; "drop" when another instrument was chosen meanwhile.
 */
export function prefillStatus(target: string | null, symbol: string, settled: boolean): "wait" | "apply" | "drop" {
  if (target && normSymbol(target) !== normSymbol(symbol)) return "drop";
  return settled ? "apply" : "wait";
}
